"""Exercise task-sync models and their migration in temporary PostgreSQL tables."""

import importlib.util
import json
from pathlib import Path
import re

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import DataError, DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import SyncServerIdentity, TaskSyncClientTask, TaskSyncReceipt


SYNC_TABLES = {
    "sync_server_identity",
    "task_sync_client_tasks",
    "task_sync_receipts",
}
OWNER = "single-owner"
CLIENT_KEY = "a" * 32
OPERATION_KEY = "b" * 32
REQUEST_HASH = "c" * 64


def assert_temporary(connection, name):
    """Never let an unqualified test name resolve to WeekFlow's real table."""

    assert connection.scalar(text("""
        SELECT relnamespace = pg_my_temp_schema()
        FROM pg_class WHERE oid = to_regclass(:name)
    """), {"name": name}) is True


@pytest.fixture
def migrated_sync(monkeypatch):
    """Run the real migration using temporary tables, then roll it all back."""

    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/f4d8b2c913a7_add_task_sync_tracking_tables.py"
    )
    spec = importlib.util.spec_from_file_location("task_sync_migration_under_test", migration_path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            # A small existing-task inventory proves the migration and its
            # downgrade leave task IDs, relationships and completion alone.
            connection.execute(text("""
                CREATE TEMPORARY TABLE tasks (
                    id INTEGER PRIMARY KEY,
                    source_task_id BIGINT,
                    title TEXT NOT NULL,
                    completed BOOLEAN NOT NULL,
                    goal_id INTEGER
                ) ON COMMIT DROP
            """))
            assert_temporary(connection, "tasks")
            connection.execute(text("""
                INSERT INTO tasks (id, source_task_id, title, completed, goal_id)
                VALUES
                    (501, 1781204320001, 'Historical task', true, 7),
                    (502, NULL, 'Native task', false, 8)
            """))
            before_tasks = [dict(row) for row in connection.execute(
                text("SELECT * FROM tasks ORDER BY id")
            ).mappings()]
            operations = Operations(MigrationContext.configure(connection))

            class TemporaryOperations:
                """Allow only the operations needed by this migration."""

                def create_table(self, name, *columns, **kwargs):
                    assert name in SYNC_TABLES
                    assert "schema" not in kwargs
                    table = operations.create_table(
                        name, *columns,
                        prefixes=["TEMPORARY"],
                        postgresql_on_commit="DROP",
                        **kwargs,
                    )
                    assert_temporary(connection, name)
                    return table

                def bulk_insert(self, table, rows, **kwargs):
                    assert table.name == "sync_server_identity"
                    assert_temporary(connection, table.name)
                    return operations.bulk_insert(table, rows, **kwargs)

                def execute(self, statement):
                    for name in SYNC_TABLES:
                        assert_temporary(connection, name)
                    return operations.execute(statement)

                def drop_table(self, name):
                    assert name in SYNC_TABLES
                    assert_temporary(connection, name)
                    return operations.drop_table(name)

            monkeypatch.setattr(migration, "op", TemporaryOperations())
            migration.upgrade()
            for name in SYNC_TABLES:
                assert_temporary(connection, name)
            yield connection, migration, before_tasks
        finally:
            transaction.rollback()


def add_mapping(connection, *, owner=OWNER, client_key=CLIENT_KEY, task_id=501):
    connection.execute(text("""
        INSERT INTO task_sync_client_tasks (owner_key, client_task_key, server_task_id)
        VALUES (:owner, :client, :task)
    """), {"owner": owner, "client": client_key, "task": task_id})


def add_receipt(connection, **changes):
    values = {
        "owner": OWNER, "operation": OPERATION_KEY, "client": CLIENT_KEY,
        "action": "create", "request_hash": REQUEST_HASH,
        "response": json.dumps({"task_id": 501, "title": "Original successful response"}),
        **changes,
    }
    connection.execute(text("""
        INSERT INTO task_sync_receipts
            (owner_key, operation_key, client_task_key, action, request_hash, response_json)
        VALUES
            (:owner, :operation, :client, :action, :request_hash, CAST(:response AS jsonb))
    """), values)


@pytest.mark.parametrize("model", [SyncServerIdentity, TaskSyncClientTask, TaskSyncReceipt])
def test_migrated_table_matches_model(migrated_sync, model):
    """Compare the actual migrated PostgreSQL structure with its ORM model."""

    connection, _, _ = migrated_sync
    schema = connection.scalar(text("SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()"))
    inspector = inspect(connection)
    table = model.__table__
    columns = {column["name"]: column for column in inspector.get_columns(table.name, schema=schema)}
    assert set(columns) == set(table.c.keys())
    for name, column in columns.items():
        expected = table.c[name]
        assert column["nullable"] == expected.nullable
        assert str(column["type"].compile(dialect=connection.dialect)) == str(expected.type.compile(dialect=connection.dialect))
    primary = inspector.get_pk_constraint(table.name, schema=schema)
    assert primary["constrained_columns"] == list(table.primary_key.columns.keys())
    # PostgreSQL rewrites some CHECK expressions (including IN lists), so
    # compare their stable names here; behavioral tests exercise their rules.
    actual_checks = {constraint["name"] for constraint in inspector.get_check_constraints(table.name, schema=schema)}
    expected_checks = {constraint.name for constraint in table.constraints if constraint.__class__.__name__ == "CheckConstraint"}
    assert actual_checks == expected_checks
    foreign_keys = inspector.get_foreign_keys(table.name, schema=schema)
    if model is TaskSyncReceipt:
        assert len(foreign_keys) == 1
        assert foreign_keys[0]["constrained_columns"] == ["owner_key", "client_task_key"]
        assert foreign_keys[0]["referred_table"] == "task_sync_client_tasks"
        assert foreign_keys[0]["options"]["ondelete"] == "RESTRICT"
    else:
        assert foreign_keys == []


def test_identity_is_seeded_once_and_survives_new_sessions(migrated_sync):
    connection, _, _ = migrated_sync
    assert connection.scalar(text("SELECT count(*) FROM sync_server_identity")) == 1
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        identity = session.get(SyncServerIdentity, 1)
        assert identity is not None
        instance_key = identity.instance_key
        assert re.fullmatch(r"[0-9a-f]{32}", instance_key)
        assert identity.created_at.utcoffset() is not None
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        assert session.get(SyncServerIdentity, 1).instance_key == instance_key


@pytest.mark.parametrize("id_value, instance_key", [
    (2, "d" * 32), (0, "d" * 32), (1, "d" * 32),
    (1, None), (1, "short"), (1, "D" * 32), (1, "g" * 32),
])
def test_database_rejects_extra_or_invalid_identity(migrated_sync, id_value, instance_key):
    connection, _, _ = migrated_sync
    original = connection.scalar(text("SELECT instance_key FROM sync_server_identity WHERE id = 1"))
    # Test invalid key updates separately from duplicate-primary-key inserts.
    with pytest.raises((IntegrityError, DataError)):
        with connection.begin_nested():
            if id_value == 1 and instance_key != "d" * 32:
                connection.execute(text("UPDATE sync_server_identity SET instance_key = :key WHERE id = 1"), {"key": instance_key})
            else:
                connection.execute(text("INSERT INTO sync_server_identity (id, instance_key) VALUES (:id, :key)"), {"id": id_value, "key": instance_key})
    assert connection.scalar(text("SELECT instance_key FROM sync_server_identity WHERE id = 1")) == original


def test_orm_round_trips_mapping_and_receipt(migrated_sync):
    connection, _, _ = migrated_sync
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        session.add(TaskSyncClientTask(owner_key=OWNER, client_task_key=CLIENT_KEY, server_task_id=501))
        session.flush()
        session.add(TaskSyncReceipt(
            owner_key=OWNER, operation_key=OPERATION_KEY, client_task_key=CLIENT_KEY,
            action="create", request_hash=REQUEST_HASH,
            response_json={"task_id": 501, "task": {"completed": True, "notes": None}},
        ))
        session.flush()
        session.expunge_all()
        mapping = session.get(TaskSyncClientTask, (OWNER, CLIENT_KEY))
        receipt = session.get(TaskSyncReceipt, (OWNER, OPERATION_KEY))
        assert mapping.server_task_id == 501
        assert receipt.response_json == {"task_id": 501, "task": {"completed": True, "notes": None}}
        assert mapping.created_at.utcoffset() is not None
        assert receipt.created_at.utcoffset() is not None


def test_duplicate_client_key_cannot_be_reassigned_to_another_task(migrated_sync):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_mapping(connection, task_id=502)
    assert connection.scalar(text("SELECT server_task_id FROM task_sync_client_tasks")) == 501


@pytest.mark.parametrize("changes", [
    {"owner": ""}, {"owner": "   "}, {"owner": None},
    {"client_key": "short"}, {"client_key": "A" * 32}, {"client_key": "g" * 32},
    {"client_key": None}, {"task_id": 0}, {"task_id": -1}, {"task_id": None},
])
def test_invalid_mapping_is_rejected(migrated_sync, changes):
    connection, _, _ = migrated_sync
    with pytest.raises((IntegrityError, DataError)):
        with connection.begin_nested():
            add_mapping(connection, **changes)
    assert connection.scalar(text("SELECT count(*) FROM task_sync_client_tasks")) == 0


def test_different_owners_can_use_the_same_client_and_operation_keys(migrated_sync):
    connection, _, _ = migrated_sync
    for owner in (OWNER, "another-owner"):
        add_mapping(connection, owner=owner)
        add_receipt(connection, owner=owner)
    assert connection.scalar(text("SELECT count(*) FROM task_sync_client_tasks")) == 2
    assert connection.scalar(text("SELECT count(*) FROM task_sync_receipts")) == 2


def test_two_device_keys_can_refer_to_the_same_server_task(migrated_sync):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    add_mapping(connection, client_key="d" * 32)
    assert connection.scalar(text("SELECT count(*) FROM task_sync_client_tasks WHERE server_task_id = 501")) == 2


def test_operation_key_cannot_store_a_second_successful_result(migrated_sync):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    add_receipt(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_receipt(connection, response=json.dumps({"task_id": 999}))
    assert connection.scalar(text("SELECT response_json FROM task_sync_receipts"))["task_id"] == 501


@pytest.mark.parametrize("changes", [
    {"owner": ""}, {"owner": "   "}, {"owner": None},
    {"operation": "short"}, {"operation": "B" * 32}, {"operation": "g" * 32}, {"operation": None},
    {"action": "merge"}, {"action": None},
    {"request_hash": "short"}, {"request_hash": "C" * 64}, {"request_hash": "g" * 64}, {"request_hash": None},
    {"response": "[]"}, {"response": "null"}, {"response": '"text"'},
    {"response": "true"}, {"response": "42"}, {"response": None},
])
def test_invalid_receipt_is_rejected(migrated_sync, changes):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    with pytest.raises((IntegrityError, DataError)):
        with connection.begin_nested():
            add_receipt(connection, **changes)
    assert connection.scalar(text("SELECT count(*) FROM task_sync_receipts")) == 0
    assert connection.scalar(text("SELECT count(*) FROM task_sync_client_tasks")) == 1


@pytest.mark.parametrize("action", ["create", "update", "delete"])
def test_all_upload_actions_can_store_receipts(migrated_sync, action):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    add_receipt(connection, action=action)
    assert connection.scalar(text("SELECT action FROM task_sync_receipts")) == action


@pytest.mark.parametrize("wrong_owner, wrong_client", [(OWNER, "d" * 32), ("another-owner", CLIENT_KEY)])
def test_receipt_requires_the_matching_owner_and_client_mapping(migrated_sync, wrong_owner, wrong_client):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_receipt(connection, owner=wrong_owner, client=wrong_client)
    assert connection.scalar(text("SELECT count(*) FROM task_sync_receipts")) == 0


def test_mapping_with_a_receipt_cannot_be_deleted(migrated_sync):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    add_receipt(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            connection.execute(text("DELETE FROM task_sync_client_tasks"))
    assert connection.scalar(text("SELECT count(*) FROM task_sync_client_tasks")) == 1
    assert connection.scalar(text("SELECT count(*) FROM task_sync_receipts")) == 1


def test_task_edit_or_deletion_preserves_mapping_and_original_receipt(migrated_sync):
    connection, _, _ = migrated_sync
    add_mapping(connection)
    add_receipt(connection)
    before_mapping = dict(connection.execute(text("SELECT * FROM task_sync_client_tasks")).mappings().one())
    before_receipt = dict(connection.execute(text("SELECT * FROM task_sync_receipts")).mappings().one())
    connection.execute(text("UPDATE tasks SET title = 'Later edit', completed = false WHERE id = 501"))
    connection.execute(text("DELETE FROM tasks WHERE id = 501"))
    assert dict(connection.execute(text("SELECT * FROM task_sync_client_tasks")).mappings().one()) == before_mapping
    assert dict(connection.execute(text("SELECT * FROM task_sync_receipts")).mappings().one()) == before_receipt



def test_unused_migration_can_be_reversed_and_recreated_without_touching_tasks(migrated_sync):
    connection, migration, before_tasks = migrated_sync
    old_key = connection.scalar(text("SELECT instance_key FROM sync_server_identity WHERE id = 1"))
    migration.downgrade()
    for name in SYNC_TABLES:
        assert connection.scalar(text("SELECT to_regclass(:name)"), {"name": f"pg_temp.{name}"}) is None
    migration.upgrade()
    new_key = connection.scalar(text("SELECT instance_key FROM sync_server_identity WHERE id = 1"))
    assert re.fullmatch(r"[0-9a-f]{32}", new_key)
    assert new_key != old_key
    assert [dict(row) for row in connection.execute(text("SELECT * FROM tasks ORDER BY id")).mappings()] == before_tasks


@pytest.mark.parametrize("with_receipt", [False, True])
def test_downgrade_refuses_to_erase_used_sync_history(migrated_sync, with_receipt):
    connection, migration, before_tasks = migrated_sync
    add_mapping(connection)
    if with_receipt:
        add_receipt(connection)
    with pytest.raises(DBAPIError, match="task sync identity mappings or upload receipts would be lost"):
        with connection.begin_nested():
            migration.downgrade()
    for name in SYNC_TABLES:
        assert_temporary(connection, name)
    assert connection.scalar(text("SELECT count(*) FROM task_sync_client_tasks")) == 1
    assert connection.scalar(text("SELECT count(*) FROM task_sync_receipts")) == int(with_receipt)
    assert [dict(row) for row in connection.execute(text("SELECT * FROM tasks ORDER BY id")).mappings()] == before_tasks
