"""Run the real setup-code migration in an isolated PostgreSQL schema."""

from datetime import timedelta
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import CheckConstraint, func, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app import database
from app.models import Account, AuthSession, OwnerSetupCode
from test_owner_setup_code_model import (
    add_code,
    assert_private_table,
    saved_code,
    setup_db,
)


MIGRATION_PATH = (
    Path(database.__file__).resolve().parents[1]
    / "alembic/versions/c91f2e6a4b70_create_owner_setup_codes.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location("owner_setup_migration_under_test", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def assert_private_name(connection, name):
    schema = connection.info["owner_setup_test_schema"]
    assert name in {"tasks", "accounts", "auth_sessions", "owner_setup_codes"}
    assert connection.scalar(text("""
        SELECT n.nspname = :schema
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.oid = to_regclass(:name)
    """), {"schema": schema, "name": name}) is True


def existing_records(connection):
    result = {}
    for name in ("tasks", "accounts", "auth_sessions"):
        assert_private_name(connection, name)
        result[name] = [dict(row) for row in connection.execute(
            text(f"SELECT * FROM {name} ORDER BY id")
        ).mappings()]
    return result


@pytest.fixture
def migrated_setup(setup_db, monkeypatch):
    """Reuse the isolated model-test schema, then replace its table via migration."""
    connection = setup_db
    migration = load_migration()
    assert_private_table(connection)
    # Remove only the private model-created table so the migration, rather
    # than metadata.create(), is responsible for the structure tested below.
    OwnerSetupCode.__table__.drop(connection)

    connection.execute(text("""
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, completed BOOLEAN NOT NULL
        )
    """))
    Account.__table__.create(connection)
    AuthSession.__table__.create(connection)
    for name in ("tasks", "accounts", "auth_sessions"):
        assert_private_name(connection, name)
    connection.execute(text("""
        INSERT INTO tasks (id, title, completed)
        VALUES (501, 'Completed history', true), (502, 'Unfinished task', false)
    """))
    connection.execute(Account.__table__.insert().values(
        username="existing-owner", password_hash="test-only-placeholder", is_active=False,
    ))
    now = connection.scalar(select(func.now()))
    connection.execute(AuthSession.__table__.insert().values(
        account_id=1, token_hash="c" * 64, client_type="native",
        expires_at=now + timedelta(hours=8),
    ))
    before = existing_records(connection)
    operations = Operations(MigrationContext.configure(connection))

    class PrivateOperations:
        """Allow the migration to operate only on this schema's setup table."""
        def create_table(self, name, *columns, **kwargs):
            assert name == "owner_setup_codes" and "schema" not in kwargs
            result = operations.create_table(name, *columns, **kwargs)
            assert_private_table(connection)
            return result

        def execute(self, statement):
            assert_private_table(connection)
            return operations.execute(statement)

        def drop_table(self, name):
            assert name == "owner_setup_codes"
            assert_private_table(connection)
            return operations.drop_table(name)

    monkeypatch.setattr(migration, "op", PrivateOperations())
    migration.upgrade()
    assert existing_records(connection) == before
    yield connection, migration
    assert existing_records(connection) == before
    # The parent setup_db fixture rolls back all schemas, tables, and data.


def test_migration_follows_the_account_and_session_revision():
    migration = load_migration()
    assert migration.revision == "c91f2e6a4b70"
    assert migration.down_revision == "a8e24d7b931c"


def test_migrated_structure_matches_the_model(migrated_setup):
    connection, _ = migrated_setup
    schema = connection.info["owner_setup_test_schema"]
    inspector = inspect(connection)
    table = OwnerSetupCode.__table__
    columns = {item["name"]: item for item in inspector.get_columns(table.name, schema=schema)}
    assert set(columns) == set(table.columns.keys())
    for name, actual in columns.items():
        expected = table.c[name]
        assert actual["nullable"] == expected.nullable
        assert str(actual["type"].compile(dialect=connection.dialect)) == str(expected.type.compile(dialect=connection.dialect))
        assert (actual["default"] is None) == (expected.server_default is None)
    assert inspector.get_pk_constraint(table.name, schema=schema)["constrained_columns"] == ["id"]
    assert {item["name"] for item in inspector.get_check_constraints(table.name, schema=schema)} == {
        item.name for item in table.constraints if isinstance(item, CheckConstraint)
    }
    assert inspector.get_foreign_keys(table.name, schema=schema) == []
    assert inspector.get_indexes(table.name, schema=schema) == []


def test_migration_does_not_issue_a_code_or_change_existing_records(migrated_setup):
    connection, _ = migrated_setup
    assert connection.scalar(select(func.count()).select_from(OwnerSetupCode)) == 0
    assert connection.scalar(select(Account.username)) == "existing-owner"
    assert connection.scalar(select(Account.is_active)) is False
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 1


def test_migrated_database_defaults_work_without_python_defaults(migrated_setup):
    connection, _ = migrated_setup
    assert_private_table(connection)
    expires = connection.scalar(select(func.now())) + timedelta(minutes=15)
    row = connection.execute(text("""
        INSERT INTO owner_setup_codes (code_hash, expires_at)
        VALUES (:hash, :expires) RETURNING *
    """), {"hash": "a" * 64, "expires": expires}).mappings().one()
    assert row["id"] == 1
    assert row["failed_attempts"] == 0
    assert row["consumed_at"] is None
    assert row["blocked_until"] is None
    assert row["created_at"].utcoffset() is not None


@pytest.mark.parametrize("second_id", [0, 1, 2])
def test_migrated_table_enforces_one_current_code(migrated_setup, second_id):
    connection, _ = migrated_setup
    original = add_code(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_code(connection, id=second_id, code_hash="b" * 64)
    assert saved_code(connection) == original


@pytest.mark.parametrize("code_hash", ["short", "A" * 64, "g" * 64, None])
def test_migrated_table_rejects_invalid_hashes(migrated_setup, code_hash):
    connection, _ = migrated_setup
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_code(connection, code_hash=code_hash)


@pytest.mark.parametrize("field,seconds", [
    ("expires_at", 0), ("expires_at", -1),
    ("consumed_at", -1), ("blocked_until", -1),
])
def test_migrated_table_rejects_invalid_timestamp_order(migrated_setup, field, seconds):
    connection, _ = migrated_setup
    now = connection.scalar(select(func.now()))
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_code(connection, **{field: now + timedelta(seconds=seconds)})


def test_migrated_table_rejects_negative_attempt_counts(migrated_setup):
    connection, _ = migrated_setup
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_code(connection, failed_attempts=-1)


def test_empty_setup_storage_can_be_removed_and_recreated(migrated_setup):
    connection, migration = migrated_setup
    before = existing_records(connection)
    schema = connection.info["owner_setup_test_schema"]
    migration.downgrade()
    assert connection.scalar(text("SELECT to_regclass(:name)"), {
        "name": f"{schema}.owner_setup_codes",
    }) is None
    assert existing_records(connection) == before
    migration.upgrade()
    assert_private_table(connection)
    assert connection.scalar(select(func.count()).select_from(OwnerSetupCode)) == 0


@pytest.mark.parametrize("state", ["unused", "expired", "consumed", "blocked"])
def test_downgrade_preserves_every_kind_of_issued_code_state(migrated_setup, state):
    connection, migration = migrated_setup
    now = connection.scalar(select(func.now()))
    changes = {}
    if state == "expired":
        changes = {"created_at": now - timedelta(hours=2), "expires_at": now - timedelta(hours=1)}
    elif state == "consumed":
        changes = {"consumed_at": now}
    elif state == "blocked":
        changes = {"failed_attempts": 5, "blocked_until": now + timedelta(minutes=5)}
    original = add_code(connection, **changes)
    with pytest.raises(DBAPIError, match="owner setup code state would be lost"):
        with connection.begin_nested():
            migration.downgrade()
    assert_private_table(connection)
    assert saved_code(connection) == original
