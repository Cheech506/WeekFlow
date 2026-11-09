"""Exercise auth models and their migration in disposable PostgreSQL tables.

These tests check storage rules. Password verification and API access checks
belong to the authentication service and router tests we will add later.
"""

from datetime import timedelta
import importlib.util
from pathlib import Path
from uuid import UUID, uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import CheckConstraint, func, inspect, select, text
from sqlalchemy.exc import DataError, DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app import database
from app.database import Base, engine
from app.models import Account, AuthSession


AUTH_TABLES = {"accounts", "auth_sessions"}
MIGRATION_PATH = (
    Path(database.__file__).resolve().parents[1]
    / "alembic/versions/a8e24d7b931c_create_accounts_and_auth_sessions.py"
)
# Deliberately not a real password hash: this file tests database structure,
# not the password-hashing implementation. No real credentials are needed.
TEST_PASSWORD_HASH = "test-only-placeholder-for-a-password-hash"


def load_migration():
    spec = importlib.util.spec_from_file_location("auth_migration_under_test", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def assert_temporary(connection, name):
    """Stop before a test name could resolve to a real application table."""
    assert connection.scalar(text("""
        SELECT relnamespace = pg_my_temp_schema()
        FROM pg_class WHERE oid = to_regclass(:name)
    """), {"name": name}) is True


def task_inventory(connection):
    assert_temporary(connection, "tasks")
    return [dict(row) for row in connection.execute(
        text("SELECT * FROM tasks ORDER BY id")
    ).mappings()]


@pytest.fixture
def migrated_auth(monkeypatch):
    """Run the real migration against temporary tables, then roll it back."""
    migration = load_migration()
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("""
                CREATE TEMPORARY TABLE tasks (
                    id INTEGER PRIMARY KEY,
                    title TEXT NOT NULL,
                    completed BOOLEAN NOT NULL,
                    goal_id INTEGER
                ) ON COMMIT DROP
            """))
            assert_temporary(connection, "tasks")
            connection.execute(text("""
                INSERT INTO tasks (id, title, completed, goal_id)
                VALUES (501, 'Existing completed task', true, 7),
                       (502, 'Existing unfinished task', false, NULL)
            """))
            before_tasks = task_inventory(connection)
            operations = Operations(MigrationContext.configure(connection))

            class TemporaryOperations:
                """Restrict all migration operations to the test's tables."""
                def create_table(self, name, *columns, **kwargs):
                    assert name in AUTH_TABLES and "schema" not in kwargs
                    if name == "auth_sessions":
                        assert_temporary(connection, "accounts")
                    result = operations.create_table(
                        name, *columns, prefixes=["TEMPORARY"],
                        postgresql_on_commit="DROP", **kwargs,
                    )
                    assert_temporary(connection, name)
                    return result

                def create_index(self, name, table_name, columns):
                    assert table_name in AUTH_TABLES
                    assert_temporary(connection, table_name)
                    result = operations.create_index(name, table_name, columns)
                    assert_temporary(connection, name)
                    return result

                def execute(self, statement):
                    for name in AUTH_TABLES:
                        assert_temporary(connection, name)
                    return operations.execute(statement)

                def drop_index(self, name, *, table_name):
                    assert table_name in AUTH_TABLES
                    assert_temporary(connection, table_name)
                    assert_temporary(connection, name)
                    return operations.drop_index(name, table_name=table_name)

                def drop_table(self, name):
                    assert name in AUTH_TABLES
                    assert_temporary(connection, name)
                    return operations.drop_table(name)

            monkeypatch.setattr(migration, "op", TemporaryOperations())
            migration.upgrade()
            for name in AUTH_TABLES:
                assert_temporary(connection, name)
            assert task_inventory(connection) == before_tasks
            yield connection, migration
            assert task_inventory(connection) == before_tasks
        finally:
            transaction.rollback()


def add_account(connection, **changes):
    assert_temporary(connection, "accounts")
    values = {"username": "owner", "password_hash": TEST_PASSWORD_HASH, **changes}
    return dict(connection.execute(
        Account.__table__.insert().values(**values).returning(Account.__table__)
    ).mappings().one())


def add_session(connection, **changes):
    assert_temporary(connection, "auth_sessions")
    now = connection.scalar(select(func.now()))
    values = {
        "account_id": 1,
        "token_hash": uuid4().hex + uuid4().hex,
        "client_type": "native",
        "csrf_token_hash": None,
        "created_at": now,
        "expires_at": now + timedelta(hours=8),
        "last_seen_at": now,
        "revoked_at": None,
        **changes,
    }
    return dict(connection.execute(
        AuthSession.__table__.insert().values(**values).returning(AuthSession.__table__)
    ).mappings().one())


def test_migration_follows_existing_sync_revision():
    migration = load_migration()
    assert migration.revision == "a8e24d7b931c"
    assert migration.down_revision == "f4d8b2c913a7"


def test_both_models_are_registered_for_alembic():
    assert Base.metadata.tables["accounts"] is Account.__table__
    assert Base.metadata.tables["auth_sessions"] is AuthSession.__table__


@pytest.mark.parametrize("model", [Account, AuthSession])
def test_migration_matches_model_structure(migrated_auth, model):
    connection, _ = migrated_auth
    schema = connection.scalar(text(
        "SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()"
    ))
    inspector = inspect(connection)
    table = model.__table__
    columns = {item["name"]: item for item in inspector.get_columns(table.name, schema=schema)}
    assert set(columns) == set(table.columns.keys())
    for name, actual in columns.items():
        expected = table.c[name]
        assert actual["nullable"] == expected.nullable
        assert str(actual["type"].compile(dialect=connection.dialect)) == str(expected.type.compile(dialect=connection.dialect))
        assert (actual["default"] is None) == (expected.server_default is None)
    assert inspector.get_pk_constraint(table.name, schema=schema)["constrained_columns"] == list(table.primary_key.columns.keys())
    assert {item["name"] for item in inspector.get_check_constraints(table.name, schema=schema)} == {
        item.name for item in table.constraints if isinstance(item, CheckConstraint)
    }
    expected_unique = (
        {("uq_accounts_username", ("username",))}
        if model is Account
        else {("uq_auth_sessions_token_hash", ("token_hash",))}
    )
    assert {
        (item["name"], tuple(item["column_names"]))
        for item in inspector.get_unique_constraints(table.name, schema=schema)
    } == expected_unique
    actual_indexes = {
        (item["name"], tuple(item["column_names"]))
        for item in inspector.get_indexes(table.name, schema=schema)
        if not item.get("duplicates_constraint")
    }
    assert actual_indexes == {(item.name, tuple(item.columns.keys())) for item in table.indexes}
    foreign_keys = inspector.get_foreign_keys(table.name, schema=schema)
    if model is AuthSession:
        assert len(foreign_keys) == 1
        assert foreign_keys[0]["constrained_columns"] == ["account_id"]
        assert foreign_keys[0]["referred_table"] == "accounts"
        assert foreign_keys[0]["referred_columns"] == ["id"]
        assert foreign_keys[0]["options"]["ondelete"] == "RESTRICT"
    else:
        assert foreign_keys == []


def test_migration_does_not_create_default_credentials(migrated_auth):
    connection, _ = migrated_auth
    for name in AUTH_TABLES:
        assert_temporary(connection, name)
        assert connection.scalar(text(f"SELECT count(*) FROM {name}")) == 0


def test_account_defaults_and_timezone_aware_timestamps(migrated_auth):
    connection, _ = migrated_auth
    account = add_account(connection)
    assert account["id"] == 1
    assert account["is_active"] is True
    for name in ("created_at", "updated_at", "password_changed_at"):
        assert account[name].utcoffset() is not None


@pytest.mark.parametrize("username", ["corey", "owner.name_01", "a" * 64])
def test_valid_usernames_can_be_stored(migrated_auth, username):
    connection, _ = migrated_auth
    assert add_account(connection, username=username)["username"] == username


@pytest.mark.parametrize("username", ["", "   ", "ab", "Corey", "owner name", "owner@host", "a" * 65, None])
def test_database_rejects_invalid_stored_usernames(migrated_auth, username):
    connection, _ = migrated_auth
    with pytest.raises((IntegrityError, DataError)):
        with connection.begin_nested():
            add_account(connection, username=username)
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


@pytest.mark.parametrize("password_hash", ["", "   ", None])
def test_database_rejects_blank_password_hash(migrated_auth, password_hash):
    connection, _ = migrated_auth
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_account(connection, password_hash=password_hash)


@pytest.mark.parametrize("second_id", [0, 1, 2])
def test_database_cannot_hold_a_second_owner(migrated_auth, second_id):
    connection, _ = migrated_auth
    original = add_account(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_account(connection, id=second_id, username="another-owner")
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == original


def test_one_owner_can_have_separate_web_and_native_sessions(migrated_auth):
    connection, _ = migrated_auth
    add_account(connection)
    native = add_session(connection)
    web = add_session(connection, client_type="web", csrf_token_hash="b" * 64)
    assert isinstance(native["id"], UUID)
    assert isinstance(web["id"], UUID)
    assert native["id"] != web["id"]
    assert native["account_id"] == web["account_id"] == 1
    assert native["token_hash"] != web["token_hash"]
    assert native["csrf_token_hash"] is None
    assert web["csrf_token_hash"] == "b" * 64
    assert native["revoked_at"] is None
    for record in (native, web):
        for name in ("created_at", "expires_at", "last_seen_at"):
            assert record[name].utcoffset() is not None


def test_duplicate_token_hash_is_rejected(migrated_auth):
    connection, _ = migrated_auth
    add_account(connection)
    original = add_session(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection, token_hash=original["token_hash"])
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 1


@pytest.mark.parametrize("token_hash", ["short", "A" * 64, "g" * 64, None])
def test_database_rejects_invalid_token_hashes(migrated_auth, token_hash):
    connection, _ = migrated_auth
    add_account(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection, token_hash=token_hash)


@pytest.mark.parametrize("client_type", ["mobile", "", None])
def test_database_rejects_unknown_client_types(migrated_auth, client_type):
    connection, _ = migrated_auth
    add_account(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection, client_type=client_type)


@pytest.mark.parametrize("client_type,csrf_hash", [
    ("web", None), ("native", "b" * 64),
    ("web", "invalid"), ("web", "B" * 64),
])
def test_browser_csrf_storage_rules_are_enforced(migrated_auth, client_type, csrf_hash):
    connection, _ = migrated_auth
    add_account(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection, client_type=client_type, csrf_token_hash=csrf_hash)


@pytest.mark.parametrize("field,offset", [
    ("expires_at", 0), ("expires_at", -1),
    ("last_seen_at", -1), ("last_seen_at", 8 * 3600),
    ("revoked_at", -1),
])
def test_impossible_session_timestamp_order_is_rejected(migrated_auth, field, offset):
    connection, _ = migrated_auth
    add_account(connection)
    now = connection.scalar(select(func.now()))
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection, **{field: now + timedelta(seconds=offset)})


@pytest.mark.parametrize("field", ["created_at", "expires_at", "last_seen_at"])
def test_required_session_timestamps_cannot_be_null(migrated_auth, field):
    connection, _ = migrated_auth
    add_account(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection, **{field: None})


def test_session_requires_an_existing_account(migrated_auth):
    connection, _ = migrated_auth
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            add_session(connection)


def test_account_with_a_session_cannot_be_deleted(migrated_auth):
    connection, _ = migrated_auth
    add_account(connection)
    original = add_session(connection)
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            connection.execute(Account.__table__.delete().where(Account.id == 1))
    assert connection.scalar(select(Account.id)) == 1
    assert connection.scalar(select(AuthSession.id)) == original["id"]


def test_revoking_one_session_preserves_another_login(migrated_auth):
    connection, _ = migrated_auth
    add_account(connection)
    first = add_session(connection)
    second = add_session(connection)
    now = connection.scalar(select(func.now()))
    connection.execute(AuthSession.__table__.update().where(
        AuthSession.id == first["id"]
    ).values(revoked_at=now))
    records = {row["id"]: row for row in connection.execute(select(AuthSession.__table__)).mappings()}
    assert records[first["id"]]["revoked_at"] == now
    assert dict(records[second["id"]]) == second


def test_models_round_trip_in_a_new_orm_session(migrated_auth):
    connection, _ = migrated_auth
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        account = Account(username="owner", password_hash=TEST_PASSWORD_HASH)
        session.add(account)
        session.flush()
        login = AuthSession(
            account_id=account.id, token_hash="c" * 64, client_type="native",
            expires_at=connection.scalar(select(func.now())) + timedelta(hours=8),
        )
        session.add(login)
        session.flush()
        login_id = login.id
        assert isinstance(login_id, UUID)
        session.commit()
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        assert session.get(Account, 1).username == "owner"
        saved = session.get(AuthSession, login_id)
        assert saved.account_id == 1
        assert saved.token_hash == "c" * 64
        assert saved.last_seen_at.utcoffset() is not None


def test_empty_auth_tables_can_be_removed_and_recreated(migrated_auth):
    connection, migration = migrated_auth
    migration.downgrade()
    for name in AUTH_TABLES:
        assert connection.scalar(text("SELECT to_regclass(:name)"), {"name": f"pg_temp.{name}"}) is None
    migration.upgrade()
    for name in AUTH_TABLES:
        assert_temporary(connection, name)
        assert connection.scalar(text(f"SELECT count(*) FROM {name}")) == 0


@pytest.mark.parametrize("with_session", [False, True])
def test_downgrade_refuses_to_erase_credentials_or_sessions(migrated_auth, with_session):
    connection, migration = migrated_auth
    account = add_account(connection)
    login = add_session(connection) if with_session else None
    with pytest.raises(DBAPIError, match="accounts or auth sessions would be lost"):
        with connection.begin_nested():
            migration.downgrade()
    for name in AUTH_TABLES:
        assert_temporary(connection, name)
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == account
    logins = [dict(row) for row in connection.execute(select(AuthSession.__table__)).mappings()]
    assert logins == ([login] if login is not None else [])
