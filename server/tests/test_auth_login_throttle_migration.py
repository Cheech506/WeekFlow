"""Verify the real login-limit migration in a private PostgreSQL schema."""

from datetime import timedelta
import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import CheckConstraint, func, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app import database
from app.models import Account, AuthLoginThrottle, AuthSession, OwnerSetupCode
from test_auth_login_throttle_model import (
    add_counter, assert_private_table, saved_counters, throttle_db,
)


MIGRATION_PATH = (
    Path(database.__file__).resolve().parents[1]
    / "alembic/versions/d7a4c92e6b13_create_auth_login_throttles.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location("login_throttle_migration_under_test", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assert_private_name(connection, name):
    assert name in {"tasks", "accounts", "auth_sessions", "owner_setup_codes", "auth_login_throttles"}
    schema = connection.info["login_throttle_test_schema"]
    assert connection.scalar(text("""
        SELECT n.nspname = :schema
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.oid = to_regclass(:name)
    """), {"schema": schema, "name": name}) is True


def existing_records(connection):
    result = {}
    for name in ("tasks", "accounts", "auth_sessions", "owner_setup_codes"):
        assert_private_name(connection, name)
        result[name] = [dict(row) for row in connection.execute(
            text(f"SELECT * FROM {name} ORDER BY id")
        ).mappings()]
    return result


@pytest.fixture
def migrated_throttles(throttle_db, monkeypatch):
    connection = throttle_db
    migration = load_migration()
    assert_private_table(connection)
    # Replace only the private model-created table. The migration must create
    # the table and constraints examined by the tests below.
    AuthLoginThrottle.__table__.drop(connection)
    connection.execute(text("""
        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, completed BOOLEAN NOT NULL
        )
    """))
    Account.__table__.create(connection)
    AuthSession.__table__.create(connection)
    OwnerSetupCode.__table__.create(connection)
    for name in ("tasks", "accounts", "auth_sessions", "owner_setup_codes"):
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
        account_id=1, token_hash="c" * 64, client_type="native", expires_at=now + timedelta(hours=8),
    ))
    connection.execute(OwnerSetupCode.__table__.insert().values(
        code_hash="d" * 64, expires_at=now + timedelta(minutes=30), consumed_at=now,
    ))
    before = existing_records(connection)
    operations = Operations(MigrationContext.configure(connection))

    class PrivateOperations:
        def create_table(self, name, *columns, **kwargs):
            assert name == "auth_login_throttles" and "schema" not in kwargs
            result = operations.create_table(name, *columns, **kwargs)
            assert_private_table(connection)
            return result

        def create_index(self, name, table_name, columns):
            assert name == "ix_auth_login_throttles_window_ends_at"
            assert table_name == "auth_login_throttles" and columns == ["window_ends_at"]
            assert_private_table(connection)
            return operations.create_index(name, table_name, columns)

        def execute(self, statement):
            assert_private_table(connection)
            return operations.execute(statement)

        def drop_index(self, name, *, table_name):
            assert name == "ix_auth_login_throttles_window_ends_at"
            assert table_name == "auth_login_throttles"
            assert_private_table(connection)
            return operations.drop_index(name, table_name=table_name)

        def drop_table(self, name):
            assert name == "auth_login_throttles"
            assert_private_table(connection)
            return operations.drop_table(name)

    monkeypatch.setattr(migration, "op", PrivateOperations())
    migration.upgrade()
    assert existing_records(connection) == before
    yield connection, migration
    assert existing_records(connection) == before
    # throttle_db rolls back this entire schema, including its sentinel data.


def test_migration_follows_owner_setup_code_revision():
    migration = load_migration()
    assert migration.revision == "d7a4c92e6b13"
    assert migration.down_revision == "c91f2e6a4b70"
    assert migration.branch_labels is None and migration.depends_on is None


def test_migrated_table_matches_the_model(migrated_throttles):
    connection, _ = migrated_throttles
    schema = connection.info["login_throttle_test_schema"]
    inspector = inspect(connection)
    table = AuthLoginThrottle.__table__
    columns = {item["name"]: item for item in inspector.get_columns(table.name, schema=schema)}
    assert set(columns) == set(table.columns.keys())
    for name, actual in columns.items():
        expected = table.c[name]
        assert actual["nullable"] == expected.nullable
        assert str(actual["type"].compile(dialect=connection.dialect)) == str(expected.type.compile(dialect=connection.dialect))
        assert (actual["default"] is None) == (expected.server_default is None)
    assert inspector.get_pk_constraint(table.name, schema=schema)["constrained_columns"] == ["bucket_key"]
    assert {item["name"] for item in inspector.get_check_constraints(table.name, schema=schema)} == {
        item.name for item in table.constraints if isinstance(item, CheckConstraint)
    }
    assert inspector.get_foreign_keys(table.name, schema=schema) == []
    indexes = inspector.get_indexes(table.name, schema=schema)
    assert len(indexes) == 1
    assert indexes[0]["name"] == "ix_auth_login_throttles_window_ends_at"
    assert indexes[0]["column_names"] == ["window_ends_at"]
    assert indexes[0]["unique"] is False


def test_upgrade_creates_empty_storage_and_preserves_existing_auth_state(migrated_throttles):
    connection, _ = migrated_throttles
    assert saved_counters(connection) == []
    assert connection.scalar(select(Account.is_active)) is False
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 1
    assert connection.scalar(select(OwnerSetupCode.consumed_at)) is not None


def test_database_defaults_work_without_python_defaults(migrated_throttles):
    connection, _ = migrated_throttles
    assert_private_table(connection)
    ends = connection.scalar(select(func.now())) + timedelta(minutes=5)
    row = connection.execute(text("""
        INSERT INTO auth_login_throttles (bucket_key, window_ends_at)
        VALUES ('instance', :ends) RETURNING *
    """), {"ends": ends}).mappings().one()
    assert row["attempt_count"] == 0
    assert row["window_started_at"].utcoffset() is not None
    assert row["window_ends_at"] == ends


@pytest.mark.parametrize("key", ["", "owner", "ip:10.0.0.26", "ip:" + "a" * 63, "ip:" + "A" * 64, None])
def test_migrated_table_rejects_invalid_keys(migrated_throttles, key):
    connection, _ = migrated_throttles
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_counter(connection, bucket_key=key)
    assert saved_counters(connection) == []


def test_migrated_table_enforces_unique_keys(migrated_throttles):
    connection, _ = migrated_throttles
    original = add_counter(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_counter(connection, attempt_count=5)
    assert saved_counters(connection) == [original]


@pytest.mark.parametrize("count", [-1, None])
def test_migrated_table_rejects_invalid_counts(migrated_throttles, count):
    connection, _ = migrated_throttles
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_counter(connection, attempt_count=count)
    assert saved_counters(connection) == []


@pytest.mark.parametrize("seconds", [0, -1])
def test_migrated_table_rejects_empty_or_reversed_windows(migrated_throttles, seconds):
    connection, _ = migrated_throttles
    now = connection.scalar(select(func.now()))
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_counter(connection, window_ends_at=now + timedelta(seconds=seconds))


@pytest.mark.parametrize("field", ["window_started_at", "window_ends_at"])
def test_migrated_table_requires_window_timestamps(migrated_throttles, field):
    connection, _ = migrated_throttles
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_counter(connection, **{field: None})


def test_empty_table_can_be_downgraded_and_created_again(migrated_throttles):
    connection, migration = migrated_throttles
    schema = connection.info["login_throttle_test_schema"]
    migration.downgrade()
    assert not inspect(connection).has_table("auth_login_throttles", schema=schema)
    migration.upgrade()
    assert_private_table(connection)
    assert saved_counters(connection) == []


@pytest.mark.parametrize("count,expired", [(0, False), (3, False), (3, True)])
def test_downgrade_refuses_to_discard_any_counter_state(migrated_throttles, count, expired):
    connection, migration = migrated_throttles
    now = connection.scalar(select(func.now()))
    start = now - timedelta(minutes=10) if expired else now
    original = add_counter(connection, attempt_count=count,
        window_started_at=start, window_ends_at=start + timedelta(minutes=5))
    with pytest.raises(DBAPIError, match="login throttle state would be lost"):
        with connection.begin_nested():
            migration.downgrade()
    assert saved_counters(connection) == [original]
    schema = connection.info["login_throttle_test_schema"]
    assert inspect(connection).get_indexes("auth_login_throttles", schema=schema)


def test_index_creation_failure_rolls_back_partial_upgrade(migrated_throttles, monkeypatch):
    connection, migration = migrated_throttles
    migration.downgrade()
    def fail_index(*args, **kwargs):
        raise RuntimeError("Test index creation failure")
    monkeypatch.setattr(migration.op, "create_index", fail_index)
    with pytest.raises(RuntimeError, match="Test index creation failure"):
        with connection.begin_nested():
            migration.upgrade()
    schema = connection.info["login_throttle_test_schema"]
    assert not inspect(connection).has_table("auth_login_throttles", schema=schema)
