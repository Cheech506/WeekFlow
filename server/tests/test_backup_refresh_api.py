"""PostgreSQL API tests for updating an imported WeekFlow backup."""

from collections.abc import Generator
from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema

from app.database import Base, engine, get_db
from app.main import app
from app.models import Goal, RecurringRule, Task
from app.services.backup_import import MODELS
from test_backup_import_schemas import (
    GOAL_ID,
    RECURRING_RULE_ID,
    TASK_ID,
    make_valid_backup,
)


IMPORT_URL = "/api/v1/backups/import"
REFRESH_URL = f"{IMPORT_URL}/refresh"
COMPLETED_AT = "2026-09-24T18:30:00.000Z"


@pytest.fixture
def refresh_client() -> Generator[tuple[TestClient, Session], None, None]:
    """Use test-owned tables, with all DDL and writes rolled back afterward.

    The temporary schema is inside the existing database. Public WeekFlow
    tables are never used by these endpoint requests or their raw locks.
    Savepoints let an endpoint commit without committing the outer test.
    """

    schema_name = f"wf_refresh_test_{uuid4().hex}"
    with engine.connect() as connection:
        outer_transaction = connection.begin()
        session = None
        previous_overrides = app.dependency_overrides.copy()
        try:
            connection.execute(CreateSchema(schema_name))
            # The generated schema name contains only letters, digits, and _.
            connection.execute(
                text(f'SET LOCAL search_path TO "{schema_name}", public')
            )
            connection = connection.execution_options(
                schema_translate_map={None: schema_name}
            )
            Base.metadata.create_all(connection, checkfirst=False)
            session = Session(
                bind=connection,
                join_transaction_mode="create_savepoint",
            )

            def override_get_db():
                yield session

            app.dependency_overrides[get_db] = override_get_db
            with TestClient(app) as client:
                yield client, session
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)
            if session is not None:
                session.close()
            outer_transaction.rollback()


def import_initial(client: TestClient, backup: dict) -> None:
    response = client.post(IMPORT_URL, json=backup)
    assert response.status_code == 200, response.text
    assert response.json()["created_count"] == 13


def imported_task(session: Session) -> Task:
    session.expire_all()
    return session.scalars(
        select(Task).where(Task.source_task_id == TASK_ID)
    ).one()


def identities(session: Session) -> dict[str, list[tuple]]:
    """Capture every primary key, including the exception's composite key."""

    session.expire_all()
    return {
        name: sorted(
            tuple(row)
            for row in session.execute(
                select(*model.__table__.primary_key.columns)
            )
        )
        for name, model in MODELS.items()
    }


def assert_counts(
    response,
    *,
    created: int = 0,
    updated: int = 0,
    unchanged: int = 13,
) -> dict:
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["refresh_completed"] is True
    assert result["import_completed"] is True
    assert result["validation_passed"] is True
    assert result["created_count"] == created
    assert result["updated_count"] == updated
    assert result["already_imported_count"] == unchanged
    assert result["total_records"] == created + updated + unchanged
    assert result["database_changed"] is (created + updated > 0)
    for field, expected in (
        ("created_counts", created),
        ("updated_counts", updated),
        ("already_imported_counts", unchanged),
    ):
        assert set(result[field]) == set(MODELS)
        assert sum(result[field].values()) == expected
    return result


def test_refresh_creates_all_types_then_identical_retry_changes_nothing(
    refresh_client,
):
    client, session = refresh_client
    backup = make_valid_backup()
    result = assert_counts(
        client.post(REFRESH_URL, json=backup), created=13, unchanged=0
    )
    assert all(count == 1 for count in result["created_counts"].values())
    before = identities(session)
    assert_counts(client.post(REFRESH_URL, json=backup))
    assert identities(session) == before


def test_refresh_updates_task_completed_after_original_import(refresh_client):
    """Reproduce the changed-completion 409, then resolve it with refresh."""

    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    before = identities(session)
    task = imported_task(session)
    original_links = (task.goal_id, task.recurring_rule_id)
    backup["data"]["tasks"][0].update(
        completed=True, completedAt=COMPLETED_AT
    )

    strict_response = client.post(IMPORT_URL, json=backup)
    assert strict_response.status_code == 409
    assert imported_task(session).completed is False

    result = assert_counts(
        client.post(REFRESH_URL, json=backup), updated=1, unchanged=12
    )
    assert result["updated_counts"]["tasks"] == 1
    task = imported_task(session)
    assert task.completed is True
    assert task.completed_at == datetime(2026, 9, 24, 18, 30, tzinfo=UTC)
    assert (task.goal_id, task.recurring_rule_id) == original_links
    assert task.source_task_id == TASK_ID
    assert identities(session) == before


def test_refresh_can_reopen_task_without_changing_its_id(refresh_client):
    client, session = refresh_client
    backup = make_valid_backup()
    backup["data"]["tasks"][0].update(
        completed=True, completedAt=COMPLETED_AT
    )
    import_initial(client, backup)
    before = identities(session)
    backup["data"]["tasks"][0].update(completed=False, completedAt=None)
    assert_counts(
        client.post(REFRESH_URL, json=backup), updated=1, unchanged=12
    )
    task = imported_task(session)
    assert task.completed is False
    assert task.completed_at is None
    assert identities(session) == before


def test_refresh_adds_new_task_and_keeps_existing_primary_keys(refresh_client):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    original_id = imported_task(session).id
    new_task = deepcopy(backup["data"]["tasks"][0])
    new_task.update(
        id=TASK_ID + 100,
        title="New plain task",
        goalId=None,
        recurringRuleId=None,
        recurrenceOccurrenceDate=None,
    )
    backup["data"]["tasks"].append(new_task)
    result = assert_counts(
        client.post(REFRESH_URL, json=backup), created=1
    )
    assert result["created_counts"]["tasks"] == 1
    assert imported_task(session).id == original_id
    added = session.scalars(
        select(Task).where(Task.source_task_id == TASK_ID + 100)
    ).one()
    assert added.id != original_id
    assert added.title == "New plain task"


def test_refresh_maps_new_parent_source_ids_to_native_foreign_keys(
    refresh_client,
):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    original_id = imported_task(session).id
    new_goal = deepcopy(backup["data"]["goals"][0])
    new_goal.update(id=GOAL_ID + 100, title="New goal")
    backup["data"]["goals"].append(new_goal)
    new_rule = deepcopy(backup["data"]["recurringRules"][0])
    new_rule.update(id=RECURRING_RULE_ID + 100, goalId=GOAL_ID + 100)
    backup["data"]["recurringRules"].append(new_rule)
    backup["data"]["tasks"][0].update(
        goalId=GOAL_ID + 100, recurringRuleId=RECURRING_RULE_ID + 100
    )
    assert_counts(
        client.post(REFRESH_URL, json=backup),
        created=2,
        updated=1,
        unchanged=12,
    )
    task = imported_task(session)
    goal = session.get(Goal, task.goal_id)
    rule = session.get(RecurringRule, task.recurring_rule_id)
    assert task.id == original_id
    assert task.source_task_id == TASK_ID
    assert goal.source_goal_id == task.source_goal_id == GOAL_ID + 100
    assert rule.source_recurring_rule_id == RECURRING_RULE_ID + 100
    assert task.source_recurring_rule_id == RECURRING_RULE_ID + 100
    assert rule.goal_id == goal.id
    assert task.goal_id != task.source_goal_id
    assert task.recurring_rule_id != task.source_recurring_rule_id


def test_changing_schedule_goal_keeps_historical_task_goal(refresh_client):
    """A schedule's current goal must not replace an occurrence's own goal."""

    client, session = refresh_client
    backup = make_valid_backup()
    backup["data"]["tasks"][0].update(
        completed=True, completedAt=COMPLETED_AT
    )
    import_initial(client, backup)
    task = imported_task(session)
    original_id, historical_goal = task.id, task.goal_id
    new_goal = deepcopy(backup["data"]["goals"][0])
    new_goal.update(id=GOAL_ID + 100, title="Current schedule goal")
    backup["data"]["goals"].append(new_goal)
    backup["data"]["recurringRules"][0]["goalId"] = GOAL_ID + 100
    assert_counts(
        client.post(REFRESH_URL, json=backup),
        created=1,
        updated=1,
        unchanged=12,
    )
    task = imported_task(session)
    rule = session.get(RecurringRule, task.recurring_rule_id)
    assert task.id == original_id
    assert task.goal_id == historical_goal
    assert task.source_goal_id == GOAL_ID
    assert rule.goal_id != task.goal_id
    assert session.get(Goal, rule.goal_id).source_goal_id == GOAL_ID + 100
    assert task.completed is True


@pytest.mark.parametrize("relationship", ["goal", "schedule"])
def test_refresh_clears_native_and_source_links_together(
    refresh_client, relationship,
):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    original_id = imported_task(session).id
    item = backup["data"]["tasks"][0]
    if relationship == "goal":
        item["goalId"] = None
    else:
        item.update(recurringRuleId=None, recurrenceOccurrenceDate=None)
    assert_counts(
        client.post(REFRESH_URL, json=backup), updated=1, unchanged=12
    )
    task = imported_task(session)
    assert task.id == original_id
    if relationship == "goal":
        assert task.goal_id is None
        assert task.source_goal_id is None
        assert task.recurring_rule_id is not None
    else:
        assert task.recurring_rule_id is None
        assert task.source_recurring_rule_id is None
        assert task.recurrence_occurrence_date is None
        assert task.goal_id is not None


def test_refresh_repairs_missing_native_links_on_older_import(refresh_client):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    task = imported_task(session)
    original_id = task.id
    expected_links = (task.goal_id, task.recurring_rule_id)
    task.goal_id = None
    task.recurring_rule_id = None
    session.commit()
    assert_counts(
        client.post(REFRESH_URL, json=backup), updated=1, unchanged=12
    )
    task = imported_task(session)
    assert task.id == original_id
    assert (task.goal_id, task.recurring_rule_id) == expected_links
    assert task.source_goal_id == GOAL_ID
    assert task.source_recurring_rule_id == RECURRING_RULE_ID


def test_refresh_keeps_postgresql_only_records(refresh_client):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    response = client.post("/api/v1/tasks", json={"title": "Server-only task"})
    assert response.status_code == 201, response.text
    server_id = response.json()["id"]
    before = identities(session)
    assert_counts(client.post(REFRESH_URL, json=backup))
    assert identities(session) == before
    assert session.get(Task, server_id).title == "Server-only task"
    assert session.get(Task, server_id).source_task_id is None


def test_refresh_rolls_back_every_change_on_real_uniqueness_collision(
    refresh_client,
):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    task = imported_task(session)
    collision = client.post(
        "/api/v1/tasks",
        json={
            "title": "Existing server occurrence",
            "recurring_rule_id": task.recurring_rule_id,
            "recurrence_occurrence_date": "2026-09-24",
        },
    )
    assert collision.status_code == 201, collision.text
    before = identities(session)
    original_title = backup["data"]["goals"][0]["title"]
    backup["data"]["goals"][0]["title"] = "Must roll back"
    extra_goal = deepcopy(backup["data"]["goals"][0])
    extra_goal.update(id=GOAL_ID + 100, title="New goal must roll back")
    backup["data"]["goals"].append(extra_goal)
    backup["data"]["tasks"][0].update(
        completed=True, completedAt=COMPLETED_AT
    )
    duplicate_occurrence = deepcopy(backup["data"]["tasks"][0])
    duplicate_occurrence.update(
        id=TASK_ID + 100,
        dueDate="2026-09-24",
        recurrenceOccurrenceDate="2026-09-24",
    )
    backup["data"]["tasks"].append(duplicate_occurrence)

    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 409, response.text
    assert "No changes were saved" in response.json()["detail"]["message"]
    assert imported_task(session).completed is False
    assert session.get(Goal, imported_task(session).goal_id).title == original_title
    assert session.scalar(
        select(Goal).where(Goal.source_goal_id == GOAL_ID + 100)
    ) is None
    assert identities(session) == before

    # The failed transaction must also leave the session usable for a retry.
    backup["data"]["tasks"].pop()
    assert_counts(
        client.post(REFRESH_URL, json=backup),
        created=1,
        updated=2,
        unchanged=11,
    )


def test_refresh_rejects_invalid_backup_before_writing(refresh_client):
    client, session = refresh_client
    backup = make_valid_backup()
    import_initial(client, backup)
    before = identities(session)
    backup["data"]["tasks"][0]["source_task_id"] = TASK_ID + 100
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 422, response.text
    assert identities(session) == before
    assert imported_task(session).completed is False
