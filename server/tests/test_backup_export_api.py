"""JSON export checks, including isolated PostgreSQL transfer tests."""

from copy import deepcopy
from datetime import UTC, datetime
from contextlib import ExitStack
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema

from app.database import Base, engine, get_db
from app.main import app
from app.models import Task, WeeklyTaskDecision
from app.routers import backups as candidate
from app.services.backup_export import BackupExportError
from unittest.mock import MagicMock

import pytest

from app.schemas import WeekFlowBackupImportRequest
from app.services.backup_import import (
    MODELS, SOURCE_ID_FIELDS, model_from_backup_item,
)
from test_backup_import_schemas import make_valid_backup

from app.services import backup_export as export


def rows():
    parsed = WeekFlowBackupImportRequest.model_validate(make_valid_backup())
    maps = {
        name: {getattr(item, field): index + 1
               for index, item in enumerate(getattr(parsed.data, name))}
        for name, field in SOURCE_ID_FIELDS.items()
    }
    stored = {}
    for name in MODELS:
        stored[name] = []
        for index, item in enumerate(getattr(parsed.data, name)):
            row = model_from_backup_item(name, item, maps)
            if name != "recurring_exceptions":
                row.id = index + 1
            if name == "weekly_task_decisions":
                row.recurring_rule_id = 1
            stored[name].append(row)
    return stored


def payload(stored):
    return export.build_backup_export(stored).model_dump(mode="json", by_alias=True)


def test_exports_all_thirteen_collections_and_validates_for_import():
    result = payload(rows())
    assert len(result["data"]) == 13
    assert all(len(collection) == 1 for collection in result["data"].values())
    WeekFlowBackupImportRequest.model_validate(result)


def test_native_relationships_override_stale_source_links():
    stored = rows()
    stored["tasks"][0].source_goal_id = 999
    stored["tasks"][0].source_recurring_rule_id = 999
    result = payload(stored)["data"]
    assert result["tasks"][0]["goalId"] == result["goals"][0]["id"]
    assert result["tasks"][0]["recurringRuleId"] == result["recurringRules"][0]["id"]


def test_goals_export_calendar_dates_as_timezone_aware_iso_text():
    stored = rows()
    goal = payload(stored)["data"]["goals"][0]
    assert datetime.fromisoformat(goal["startDate"]).date() == stored["goals"][0].start_date
    assert datetime.fromisoformat(goal["endDate"]).utcoffset() is not None


def test_builder_never_changes_postgres_ids_or_fields():
    stored = rows()
    before = {name: [dict(row.__dict__) for row in items] for name, items in stored.items()}
    payload(stored)
    assert {name: [dict(row.__dict__) for row in items] for name, items in stored.items()} == before


def test_missing_collection_fails_instead_of_exporting_partial_file():
    stored = rows()
    del stored["tasks"]
    with pytest.raises(export.BackupExportError, match="missing a WeekFlow collection"):
        payload(stored)


def test_missing_parent_fails_instead_of_silently_dropping_a_link():
    stored = rows()
    stored["tasks"][0].goal_id = 999
    with pytest.raises(export.BackupExportError, match="missing goals"):
        payload(stored)


def test_legacy_links_are_preserved_if_native_mapping_is_missing():
    stored = rows()
    stored["tasks"][0].goal_id = None
    assert payload(stored)["data"]["tasks"][0]["goalId"] == make_valid_backup()["data"]["tasks"][0]["goalId"]


def test_duplicate_backup_identity_fails():
    stored = rows()
    duplicate = deepcopy(stored["tasks"][0])
    duplicate.id = 20
    stored["tasks"].append(duplicate)
    with pytest.raises(export.BackupExportError, match="collide"):
        payload(stored)


def test_native_rows_get_backup_metadata_once_with_content_and_timestamps_retained():
    stored = rows()
    for name, field in SOURCE_ID_FIELDS.items():
        setattr(stored[name][0], field, None)
    db = MagicMock()
    before = {name: dict(items[0].__dict__) for name, items in stored.items()}
    export.assign_backup_identities(db, stored)
    assert db.execute.call_count == 12
    for name, field in SOURCE_ID_FIELDS.items():
        row = stored[name][0]
        assert 0 < getattr(row, field) <= 9_007_199_254_740_991
        for key, value in before[name].items():
            if key != field:
                assert row.__dict__[key] == value
    # Calling it again must not allocate new identities or issue updates.
    export.assign_backup_identities(db, stored)
    assert db.execute.call_count == 12
    result = payload(stored)["data"]
    assert result["weeklyTaskDecisions"][0]["recurringRuleId"] == result["recurringRules"][0]["id"]


def test_exported_native_records_reimport_with_new_postgres_ids_and_links_intact():
    stored = rows()
    for name, field in SOURCE_ID_FIELDS.items():
        setattr(stored[name][0], field, None)
    export.assign_backup_identities(MagicMock(), stored)
    parsed = WeekFlowBackupImportRequest.model_validate(payload(stored))
    maps = {name: {getattr(item, field): 99 for item in getattr(parsed.data, name)}
            for name, field in SOURCE_ID_FIELDS.items()}
    task = model_from_backup_item("tasks", parsed.data.tasks[0], maps)
    assert task.goal_id == 99
    assert task.recurring_rule_id == 99


def test_invalid_timestamp_fails_before_a_file_is_returned():
    stored = rows()
    stored["tasks"][0].created_at = datetime(2026, 10, 27)
    with pytest.raises(export.BackupExportError, match="timezone"):
        payload(stored)


def test_known_imported_backup_ids_are_never_changed():
    stored = rows()
    db = MagicMock()
    export.assign_backup_identities(db, stored)
    db.execute.assert_not_called()


def test_active_request_transaction_is_rejected():
    db = MagicMock()
    db.in_transaction.return_value = True
    with pytest.raises(export.BackupExportError, match="fresh database session"):
        export.export_backup(db)
    db.execute.assert_not_called()


def test_updated_at_is_explicitly_preserved_in_metadata_updates():
    stored = rows()
    row = stored["task_templates"][0]
    row.source_task_template_id = None
    db = MagicMock()
    export.assign_backup_identities(db, stored)
    statement = db.execute.call_args.args[0]
    assert statement.compile().params["updated_at"] == row.updated_at


def test_empty_database_exports_valid_empty_collections():
    result = payload({name: [] for name in MODELS})
    assert all(items == [] for items in result["data"].values())


@pytest.fixture
def setup(monkeypatch):
    db = MagicMock()
    backup = WeekFlowBackupImportRequest.model_validate(make_valid_backup())
    service = MagicMock(return_value=backup)
    monkeypatch.setattr(candidate, "export_backup", service)
    app = FastAPI()
    app.include_router(candidate.router)
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        yield client, db, service


def test_export_returns_a_complete_importable_json_document(setup):
    client, db, service = setup
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 200, response.text
    service.assert_called_once_with(db)
    document = response.json()
    assert document["format"] == "weekflow-backup"
    assert document["version"] == 12
    assert len(document["data"]) == 13
    WeekFlowBackupImportRequest.model_validate(document)


def test_export_uses_camel_case_fields_required_by_the_existing_importer(setup):
    response = setup[0].post("/api/v1/backups/export")
    body = response.json()
    assert "exportedAt" in body and "exported_at" not in body
    assert "goalMilestones" in body["data"]
    assert "recurringRuleId" in body["data"]["tasks"][0]
    assert "recurring_rule_id" not in body["data"]["tasks"][0]


def test_export_suggests_a_json_filename_and_disables_http_caching(setup):
    response = setup[0].post("/api/v1/backups/export")
    assert response.headers["Content-Disposition"].startswith('attachment; filename="weekflow-backup-')
    assert response.headers["Content-Disposition"].endswith('.json"')
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Content-Type"].startswith("application/json")


def test_invalid_backup_returns_409_with_no_partial_document(setup):
    client, db, service = setup
    service.side_effect = BackupExportError("A record references a missing goals record.")
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 409
    assert "could not be created" in response.json()["detail"]
    assert "data" not in response.json()
    assert response.headers["Cache-Control"] == "no-store"
    db.rollback.assert_called_once()


def test_database_failure_returns_503_without_sql_or_connection_details(setup):
    client, db, service = setup
    service.side_effect = OperationalError("SELECT secret", {"password": "private"}, Exception("private"))
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 503
    assert "SELECT secret" not in response.text
    assert "private" not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    db.rollback.assert_called_once()


def test_get_never_triggers_backup_metadata_assignment(setup):
    client, _, service = setup
    assert client.get("/api/v1/backups/export").status_code == 405
    service.assert_not_called()


def test_old_import_routes_are_preserved():
    routes = {(route.path, method) for route in candidate.router.routes for method in route.methods}
    for suffix in ("/import", "/import/preview", "/import/refresh", "/export"):
        assert (f"/api/v1/backups{suffix}", "POST") in routes


def test_export_appears_in_openapi_with_the_importable_schema(setup):
    document = setup[0].get("/openapi.json").json()
    operation = document["paths"]["/api/v1/backups/export"]["post"]
    assert operation["summary"] == "Export WeekFlow JSON backup"
    assert "409" in operation["responses"] and "503" in operation["responses"]


def test_exporting_empty_collections_is_supported(setup):
    client, _, service = setup
    document = make_valid_backup()
    document["data"] = {name: [] for name in document["data"]}
    service.return_value = WeekFlowBackupImportRequest.model_validate(document)
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 200
    assert all(items == [] for items in response.json()["data"].values())


@pytest.fixture
def postgres_export_instances():
    """Create isolated schemas; roll back every test schema and all writes.

    No request in this fixture uses public WeekFlow tables. Each instance has
    its own connection, schema, and savepoint-backed session. Switching the
    dependency simulates two independent WeekFlow API installations.
    """

    previous = app.dependency_overrides.copy()
    with ExitStack() as cleanup:
        def new_instance():
            connection = cleanup.enter_context(engine.connect())
            transaction = connection.begin()
            cleanup.callback(transaction.rollback)
            schema = f"wf_export_test_{uuid4().hex}"
            connection.execute(CreateSchema(schema))
            connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
            connection = connection.execution_options(schema_translate_map={None: schema})
            Base.metadata.create_all(connection, checkfirst=False)
            # Raw service locks use unqualified table names. Verify every name
            # resolves to this test's schema before an endpoint can run.
            for model in MODELS.values():
                actual = connection.scalar(text("""
                    SELECT n.nspname FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.oid = to_regclass(:table_name)
                """), {"table_name": model.__tablename__})
                assert actual == schema
            session = Session(bind=connection, join_transaction_mode="create_savepoint")
            cleanup.callback(session.close)
            return session

        source = new_instance()
        active = {"session": source}

        def override_get_db():
            yield active["session"]

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as client:
                yield client, source, new_instance, active
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)


def seed_instance(client):
    response = client.post("/api/v1/backups/import/refresh", json=make_valid_backup())
    assert response.status_code == 200, response.text
    assert response.json()["created_count"] == 13


def saved_rows(session):
    """Read all columns and end the read session before the next request."""

    assert not session.in_transaction()
    with session.begin():
        return {name: [dict(row) for row in session.execute(
            select(model.__table__).order_by(*model.__table__.primary_key.columns)
        ).mappings()] for name, model in MODELS.items()}


def make_records_native(session):
    """Keep real foreign keys, but remove migration metadata as native rows do."""

    with session.begin():
        stored = {name: list(session.scalars(select(model))) for name, model in MODELS.items()}
        rules = {row.source_recurring_rule_id: row.id for row in stored["recurring_rules"]}
        for decision in stored["weekly_task_decisions"]:
            if decision.recurring_rule_id is None:
                decision.recurring_rule_id = rules.get(decision.source_recurring_rule_id)
            decision.source_recurring_rule_id = None
        for task in stored["tasks"]:
            task.source_goal_id = None
            task.source_recurring_rule_id = None
        for name, field in SOURCE_ID_FIELDS.items():
            for row in stored[name]:
                setattr(row, field, None)


def exported(client):
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 200, response.text
    document = response.json()
    WeekFlowBackupImportRequest.model_validate(document)
    return document


def test_postgres_empty_database_exports_all_thirteen_empty_collections(postgres_export_instances):
    client, session, _, _ = postgres_export_instances
    before = saved_rows(session)
    document = exported(client)
    assert len(document["data"]) == 13
    assert all(items == [] for items in document["data"].values())
    assert saved_rows(session) == before


def test_postgres_imported_records_export_without_modifying_any_saved_column(postgres_export_instances):
    client, session, _, _ = postgres_export_instances
    seed_instance(client)
    before = saved_rows(session)
    document = exported(client)
    assert all(len(items) == 1 for items in document["data"].values())
    assert saved_rows(session) == before


def test_postgres_native_export_assigns_only_missing_backup_metadata(postgres_export_instances):
    client, session, _, _ = postgres_export_instances
    seed_instance(client)
    make_records_native(session)
    before = saved_rows(session)
    document = exported(client)
    after = saved_rows(session)
    for name in MODELS:
        old, new = before[name][0], after[name][0]
        field = SOURCE_ID_FIELDS.get(name)
        if field:
            assert old[field] is None
            assert type(new[field]) is int and 0 < new[field] <= 9_007_199_254_740_991
            new = {key: value for key, value in new.items() if key != field}
            old = {key: value for key, value in old.items() if key != field}
        assert new == old, name
    data = document["data"]
    assert data["tasks"][0]["goalId"] == data["goals"][0]["id"]
    assert data["tasks"][0]["recurringRuleId"] == data["recurringRules"][0]["id"]
    assert data["weeklyTaskDecisions"][0]["recurringRuleId"] == data["recurringRules"][0]["id"]


def test_postgres_second_export_preserves_ids_after_content_and_decision_edits(postgres_export_instances):
    client, session, _, _ = postgres_export_instances
    seed_instance(client)
    make_records_native(session)
    first = exported(client)
    with session.begin():
        task = session.scalar(select(Task))
        task.title = "Updated after first export"
        decision = session.scalar(select(WeeklyTaskDecision))
        decision.decided_at = datetime(2026, 10, 27, 18, tzinfo=UTC)
    second = exported(client)
    for name, collection in first["data"].items():
        if name != "recurringExceptions":
            assert [row["id"] for row in collection] == [row["id"] for row in second["data"][name]]
    assert second["data"]["tasks"][0]["title"] == "Updated after first export"


def test_postgres_export_validation_failure_rolls_back_metadata_allocations(postgres_export_instances, monkeypatch):
    client, session, _, _ = postgres_export_instances
    seed_instance(client)
    make_records_native(session)
    before = saved_rows(session)

    def fail_after_assignments(*args, **kwargs):
        raise BackupExportError("Forced validation failure after metadata assignment.")

    monkeypatch.setattr(export, "build_backup_export", fail_after_assignments)
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 409
    assert "data" not in response.json()
    assert saved_rows(session) == before


def test_postgres_database_failure_rolls_back_metadata_allocations(postgres_export_instances, monkeypatch):
    client, session, _, _ = postgres_export_instances
    seed_instance(client)
    make_records_native(session)
    before = saved_rows(session)

    def fail_after_assignments(*args, **kwargs):
        raise OperationalError("private SQL", {}, Exception("private DB error"))

    monkeypatch.setattr(export, "build_backup_export", fail_after_assignments)
    response = client.post("/api/v1/backups/export")
    assert response.status_code == 503
    assert "private" not in response.text
    assert saved_rows(session) == before


def test_postgres_export_has_current_completion_status(postgres_export_instances):
    client, session, _, _ = postgres_export_instances
    seed_instance(client)
    with session.begin():
        task = session.scalar(select(Task))
        task.completed = True
        task.completed_at = datetime(2026, 10, 27, 18, tzinfo=UTC)
    task_json = exported(client)["data"]["tasks"][0]
    assert task_json["completed"] is True
    assert task_json["completedAt"] is not None


def test_postgres_export_transfers_to_another_instance_with_different_primary_keys(postgres_export_instances):
    client, source, new_instance, active = postgres_export_instances
    seed_instance(client)
    make_records_native(source)
    document = exported(client)
    source_before = saved_rows(source)
    target = new_instance()
    active["session"] = target
    # Different sequence positions prove that links are translated rather than
    # assuming the destination has the same PostgreSQL primary keys.
    with target.begin():
        for name in SOURCE_ID_FIELDS:
            target.execute(text("SELECT setval(pg_get_serial_sequence(:table_name, 'id'), 1000, true)"),
                           {"table_name": MODELS[name].__tablename__})
    response = client.post("/api/v1/backups/import/refresh", json=document)
    assert response.status_code == 200, response.text
    assert response.json()["created_count"] == 13
    target_rows = saved_rows(target)
    task = target_rows["tasks"][0]
    assert task["id"] == 1001
    assert task["goal_id"] == target_rows["goals"][0]["id"]
    assert task["recurring_rule_id"] == target_rows["recurring_rules"][0]["id"]
    assert target_rows["goals"][0]["cycle_id"] == target_rows["planning_cycles"][0]["id"]
    assert target_rows["goal_milestones"][0]["goal_id"] == task["goal_id"]
    assert target_rows["weekly_commitments"][0]["task_id"] == task["id"]
    assert target_rows["cycle_goal_outcomes"][0]["cycle_review_id"] == target_rows["cycle_reviews"][0]["id"]
    assert exported(client)["data"] == document["data"]
    # Repeating this explicit import of the same file must not create copies.
    again = client.post("/api/v1/backups/import/refresh", json=document)
    assert again.status_code == 200, again.text
    assert again.json()["created_count"] == 0
    assert again.json()["updated_count"] == 0
    assert again.json()["already_imported_count"] == 13
    assert saved_rows(target) == target_rows
    assert saved_rows(source) == source_before
