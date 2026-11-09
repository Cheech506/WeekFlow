"""Check setup-code storage in an isolated, rolled-back PostgreSQL schema.

This file tests the model before its application migration is installed.
It does not generate a real setup code or prove API access enforcement.
"""

from datetime import timedelta
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema

from app.database import engine
from app.models.owner_setup_code import OwnerSetupCode


def assert_private_table(connection):
    """Refuse writes unless this connection uses its own test table."""
    schema = connection.info["owner_setup_test_schema"]
    # SQLAlchemy may add private bookkeeping keys to this mapping while
    # compiling SQL. Check its actual default-schema destination directly.
    assert connection.get_execution_options()["schema_translate_map"][None] == schema
    assert connection.scalar(text("""
        SELECT n.nspname = :schema
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.oid = to_regclass('owner_setup_codes')
    """), {"schema": schema}) is True


@pytest.fixture
def setup_db():
    """Create only a private test table; roll back its schema and records."""
    schema = "wf_setup_model_test_" + uuid4().hex
    with engine.connect() as connection:
        connection = connection.execution_options(schema_translate_map={None: schema})
        transaction = connection.begin()
        try:
            connection.execute(CreateSchema(schema))
            # The schema name is generated above, never taken from user input.
            # Excluding public prevents raw SQL from falling through to live data.
            connection.execute(text(f'SET LOCAL search_path TO "{schema}", pg_catalog'))
            connection.info["owner_setup_test_schema"] = schema
            OwnerSetupCode.__table__.create(connection)
            assert_private_table(connection)
            yield connection
        finally:
            transaction.rollback()
            connection.info.pop("owner_setup_test_schema", None)
        assert connection.scalar(text(
            "SELECT to_regnamespace(:schema)"
        ), {"schema": schema}) is None


def add_code(connection, **changes):
    assert_private_table(connection)
    now = connection.scalar(select(func.now()))
    values = {
        "code_hash": "a" * 64,
        "created_at": now,
        "expires_at": now + timedelta(minutes=15),
        **changes,
    }
    return dict(connection.execute(
        OwnerSetupCode.__table__.insert().values(**values).returning(OwnerSetupCode.__table__)
    ).mappings().one())


def saved_code(connection):
    assert_private_table(connection)
    return dict(connection.execute(select(OwnerSetupCode.__table__)).mappings().one())


def test_database_defaults_start_with_one_unused_unblocked_code(setup_db):
    connection = setup_db
    assert_private_table(connection)
    expires = connection.scalar(select(func.now())) + timedelta(minutes=15)
    # Raw SQL deliberately bypasses Python defaults, exercising PostgreSQL's.
    row = connection.execute(text("""
        INSERT INTO owner_setup_codes (code_hash, expires_at)
        VALUES (:hash, :expires) RETURNING *
    """), {"hash": "a" * 64, "expires": expires}).mappings().one()
    assert row["id"] == 1
    assert row["failed_attempts"] == 0
    assert row["consumed_at"] is None
    assert row["blocked_until"] is None
    assert row["created_at"].utcoffset() is not None
    assert row["expires_at"].utcoffset() is not None


def test_hash_round_trips_without_storing_the_raw_code(setup_db):
    # A public demo value, not a real first-run credential.
    raw_demo_code = "example-only-code-never-used-for-real-setup"
    digest = sha256(raw_demo_code.encode("utf-8")).hexdigest()
    add_code(setup_db, code_hash=digest)
    row = saved_code(setup_db)
    assert row["code_hash"] == digest
    assert raw_demo_code not in row.values()


@pytest.mark.parametrize("second_id", [0, 1, 2])
def test_database_allows_only_one_current_code_record(setup_db, second_id):
    original = add_code(setup_db)
    with pytest.raises(IntegrityError):
        with setup_db.begin_nested():
            add_code(setup_db, id=second_id, code_hash="b" * 64)
    assert saved_code(setup_db) == original


@pytest.mark.parametrize("code_hash", ["", "short", "A" * 64, "g" * 64, "a" * 65, None])
def test_invalid_hash_storage_is_rejected(setup_db, code_hash):
    with pytest.raises((IntegrityError, DataError)):
        with setup_db.begin_nested():
            add_code(setup_db, code_hash=code_hash)
    assert setup_db.scalar(select(func.count()).select_from(OwnerSetupCode)) == 0


def test_expiration_is_required_instead_of_defaulting_to_unlimited_access(setup_db):
    assert_private_table(setup_db)
    with pytest.raises(IntegrityError):
        with setup_db.begin_nested():
            setup_db.execute(OwnerSetupCode.__table__.insert().values(code_hash="a" * 64))


@pytest.mark.parametrize("field,seconds", [
    ("expires_at", 0), ("expires_at", -1),
    ("consumed_at", -1), ("blocked_until", -1),
])
def test_impossible_timestamp_order_is_rejected(setup_db, field, seconds):
    now = setup_db.scalar(select(func.now()))
    with pytest.raises(IntegrityError):
        with setup_db.begin_nested():
            add_code(setup_db, **{field: now + timedelta(seconds=seconds)})


@pytest.mark.parametrize("field", ["created_at", "expires_at"])
def test_required_timestamps_cannot_be_null(setup_db, field):
    with pytest.raises(IntegrityError):
        with setup_db.begin_nested():
            add_code(setup_db, **{field: None})


@pytest.mark.parametrize("attempts", [-1, None])
def test_failed_attempt_count_must_be_nonnegative_and_present(setup_db, attempts):
    with pytest.raises(IntegrityError):
        with setup_db.begin_nested():
            add_code(setup_db, failed_attempts=attempts)


def test_blocking_state_is_visible_to_a_different_orm_session(setup_db):
    original = add_code(setup_db)
    blocked_until = original["created_at"] + timedelta(minutes=5)
    with Session(bind=setup_db, join_transaction_mode="create_savepoint") as session:
        record = session.get(OwnerSetupCode, 1)
        record.failed_attempts = 5
        record.blocked_until = blocked_until
        session.commit()
    with Session(bind=setup_db, join_transaction_mode="create_savepoint") as session:
        record = session.get(OwnerSetupCode, 1)
        assert record.failed_attempts == 5
        assert record.blocked_until == blocked_until
        assert record.blocked_until.utcoffset() is not None
        assert record.code_hash == original["code_hash"]


def test_consumption_can_be_recorded_without_changing_the_code_identity(setup_db):
    original = add_code(setup_db)
    with Session(bind=setup_db, join_transaction_mode="create_savepoint") as session:
        record = session.get(OwnerSetupCode, 1)
        record.consumed_at = original["created_at"]
        session.commit()
    saved = saved_code(setup_db)
    assert saved["id"] == original["id"]
    assert saved["code_hash"] == original["code_hash"]
    assert saved["consumed_at"] == original["created_at"]
    assert saved["consumed_at"].utcoffset() is not None


def test_rotating_stored_state_keeps_one_row_and_replaces_the_previous_hash(setup_db):
    original = add_code(setup_db, failed_attempts=3)
    with Session(bind=setup_db, join_transaction_mode="create_savepoint") as session:
        record = session.get(OwnerSetupCode, 1)
        record.code_hash = "b" * 64
        record.failed_attempts = 0
        session.commit()
    saved = saved_code(setup_db)
    assert saved["id"] == original["id"] == 1
    assert saved["code_hash"] == "b" * 64
    assert saved["failed_attempts"] == 0
    assert setup_db.scalar(select(func.count()).select_from(OwnerSetupCode)) == 1


def test_expired_records_can_remain_stored_for_the_service_to_reject(setup_db):
    # A database CHECK cannot make a row disappear when time passes.
    # The future service must check expires_at on every setup attempt.
    now = setup_db.scalar(select(func.now()))
    add_code(
        setup_db,
        created_at=now - timedelta(hours=2),
        expires_at=now - timedelta(hours=1),
    )
    assert saved_code(setup_db)["expires_at"] < now


def test_rolled_back_state_changes_do_not_consume_or_block_the_code(setup_db):
    original = add_code(setup_db)
    with Session(bind=setup_db, join_transaction_mode="create_savepoint") as session:
        record = session.get(OwnerSetupCode, 1)
        record.consumed_at = original["created_at"]
        record.failed_attempts = 5
        record.blocked_until = original["created_at"] + timedelta(minutes=5)
        session.flush()
        session.rollback()
    assert saved_code(setup_db) == original
