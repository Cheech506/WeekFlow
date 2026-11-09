"""Check login-limit storage in a private, rolled-back PostgreSQL schema."""

from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.schema import CreateSchema

from app.database import engine
from app.models.auth_login_throttle import AuthLoginThrottle


def assert_private_table(connection):
    schema = connection.info["login_throttle_test_schema"]
    assert connection.get_execution_options()["schema_translate_map"][None] == schema
    assert connection.scalar(text("""
        SELECT n.nspname = :schema
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.oid = to_regclass('auth_login_throttles')
    """), {"schema": schema}) is True


@pytest.fixture
def throttle_db():
    schema = "wf_login_throttle_model_test_" + uuid4().hex
    with engine.connect() as connection:
        connection = connection.execution_options(schema_translate_map={None: schema})
        transaction = connection.begin()
        try:
            connection.execute(CreateSchema(schema))
            # Only a generated private schema plus pg_catalog: raw SQL cannot
            # fall through to the application's public tables.
            connection.execute(text(
                "SELECT set_config('search_path', :path, true)"
            ), {"path": f'"{schema}", pg_catalog'})
            connection.info["login_throttle_test_schema"] = schema
            AuthLoginThrottle.__table__.create(connection)
            assert_private_table(connection)
            yield connection
        finally:
            transaction.rollback()
            connection.info.pop("login_throttle_test_schema", None)
        assert connection.scalar(text(
            "SELECT to_regnamespace(:schema)"
        ), {"schema": schema}) is None


def add_counter(connection, **changes):
    assert_private_table(connection)
    now = connection.scalar(select(func.now()))
    values = {
        "bucket_key": "instance",
        "window_started_at": now,
        "window_ends_at": now + timedelta(minutes=5),
        **changes,
    }
    return dict(connection.execute(
        AuthLoginThrottle.__table__.insert().values(**values)
        .returning(AuthLoginThrottle.__table__)
    ).mappings().one())


def saved_counters(connection):
    assert_private_table(connection)
    return [dict(row) for row in connection.execute(
        select(AuthLoginThrottle.__table__).order_by(AuthLoginThrottle.bucket_key)
    ).mappings()]


def test_model_stores_only_window_and_counter_fields():
    assert set(AuthLoginThrottle.__table__.columns.keys()) == {
        "bucket_key", "window_started_at", "window_ends_at", "attempt_count",
    }
    assert not AuthLoginThrottle.__table__.foreign_keys


def test_database_defaults_create_an_empty_counter_with_aware_timestamps(throttle_db):
    assert_private_table(throttle_db)
    ends = throttle_db.scalar(select(func.now())) + timedelta(minutes=5)
    row = throttle_db.execute(text("""
        INSERT INTO auth_login_throttles (bucket_key, window_ends_at)
        VALUES ('instance', :ends) RETURNING *
    """), {"ends": ends}).mappings().one()
    assert row["attempt_count"] == 0
    assert row["window_started_at"].utcoffset() is not None
    assert row["window_ends_at"].utcoffset() is not None
    assert row["window_ends_at"] > row["window_started_at"]


def test_instance_and_source_counters_can_coexist(throttle_db):
    first = add_counter(throttle_db, attempt_count=3)
    second = add_counter(throttle_db, bucket_key="ip:" + "a" * 64, attempt_count=1)
    assert saved_counters(throttle_db) == [first, second]


@pytest.mark.parametrize("key", [
    None, "", "owner", "INSTANCE", "instance ", "instance\n",
    "ip:10.0.0.26", "ip:" + "a" * 63, "ip:" + "a" * 65,
    "ip:" + "A" * 64, "ip:" + "g" * 64, "a" * 64,
])
def test_invalid_counter_keys_are_rejected(throttle_db, key):
    with pytest.raises((IntegrityError, DataError)):
        with throttle_db.begin_nested():
            add_counter(throttle_db, bucket_key=key)
    assert saved_counters(throttle_db) == []


def test_counter_key_is_unique(throttle_db):
    original = add_counter(throttle_db)
    with pytest.raises(IntegrityError):
        with throttle_db.begin_nested():
            add_counter(throttle_db, attempt_count=9)
    assert saved_counters(throttle_db) == [original]


@pytest.mark.parametrize("count", [-1, None])
def test_negative_or_missing_count_is_rejected(throttle_db, count):
    with pytest.raises(IntegrityError):
        with throttle_db.begin_nested():
            add_counter(throttle_db, attempt_count=count)
    assert saved_counters(throttle_db) == []


@pytest.mark.parametrize("seconds", [0, -1])
def test_empty_or_reversed_window_is_rejected(throttle_db, seconds):
    now = throttle_db.scalar(select(func.now()))
    with pytest.raises(IntegrityError):
        with throttle_db.begin_nested():
            add_counter(throttle_db, window_ends_at=now + timedelta(seconds=seconds))
    assert saved_counters(throttle_db) == []


@pytest.mark.parametrize("field", ["window_started_at", "window_ends_at"])
def test_window_timestamps_cannot_be_null(throttle_db, field):
    with pytest.raises(IntegrityError):
        with throttle_db.begin_nested():
            add_counter(throttle_db, **{field: None})
    assert saved_counters(throttle_db) == []


def test_window_deadline_is_required(throttle_db):
    assert_private_table(throttle_db)
    with pytest.raises(IntegrityError):
        with throttle_db.begin_nested():
            throttle_db.execute(text(
                "INSERT INTO auth_login_throttles (bucket_key) VALUES ('instance')"
            ))


def test_service_can_reserve_an_attempt_and_replace_an_expired_window(throttle_db):
    original = add_counter(throttle_db, attempt_count=4)
    throttle_db.execute(AuthLoginThrottle.__table__.update().where(
        AuthLoginThrottle.bucket_key == "instance"
    ).values(attempt_count=AuthLoginThrottle.attempt_count + 1))
    assert saved_counters(throttle_db)[0]["attempt_count"] == 5
    start = original["window_ends_at"] + timedelta(seconds=1)
    throttle_db.execute(AuthLoginThrottle.__table__.update().where(
        AuthLoginThrottle.bucket_key == "instance"
    ).values(window_started_at=start, window_ends_at=start + timedelta(minutes=5), attempt_count=1))
    row = saved_counters(throttle_db)[0]
    assert row["attempt_count"] == 1 and row["window_started_at"] == start


def test_table_does_not_hard_code_service_attempt_limits(throttle_db):
    assert add_counter(throttle_db, attempt_count=100)["attempt_count"] == 100


def test_expiration_index_is_present(throttle_db):
    schema = throttle_db.info["login_throttle_test_schema"]
    indexes = inspect(throttle_db).get_indexes("auth_login_throttles", schema=schema)
    assert any(
        item["name"] == "ix_auth_login_throttles_window_ends_at"
        and item["column_names"] == ["window_ends_at"]
        for item in indexes
    )
