"""Check shared login limits, transaction boundaries, and concurrent requests."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
import re
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from app.database import engine
from app.models import Account, AuthLoginThrottle, AuthSession
from app.services import login_throttle as throttle
from app.services.accounts import create_owner_account
from app.services.sessions import InvalidCredentialsError
from test_auth_login_throttle_model import (
    assert_private_table, saved_counters, throttle_db,
)


DEMO_ADDRESS = "192.0.2.10"
DEMO_PASSWORD = "a temporary limited login passphrase"


@pytest.fixture
def limited_db(throttle_db, monkeypatch):
    connection = throttle_db
    clock = {"now": connection.scalar(select(func.clock_timestamp())) + timedelta(seconds=1)}
    monkeypatch.setattr(throttle, "_database_now", lambda db: clock["now"])
    with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as db:
        yield connection, db, clock


def counters(connection):
    return {row["bucket_key"]: row for row in saved_counters(connection)}


def source_row(connection, address=DEMO_ADDRESS):
    return counters(connection)[throttle._source_key(address)]


@pytest.mark.parametrize("first,second", [
    ("2001:db8::1", "2001:0DB8:0000:0000:0000:0000:0000:0001"),
    ("192.0.2.10", "::ffff:192.0.2.10"),
    ("127.0.0.1", "::ffff:7f00:1"),
])
def test_equivalent_addresses_share_one_source_key(first, second):
    assert throttle._source_key(first) == throttle._source_key(second)


def test_source_keys_have_supported_shape_without_storing_raw_address():
    key = throttle._source_key(DEMO_ADDRESS)
    assert re.fullmatch(r"ip:[0-9a-f]{64}", key)
    assert DEMO_ADDRESS not in key
    assert throttle._source_key("192.0.2.11") != key


@pytest.mark.parametrize("address", [
    None, False, 123, b"192.0.2.10", "", " ", "localhost", "testclient",
    "192.0.2.10:8000", "https://192.0.2.10", "192.0.2.10, 192.0.2.11",
    " 192.0.2.10", "192.0.2.10 ", "192.0.2.010", "[::1]", "fe80::1%en0",
    "private-invalid-source", "x" * 100_000,
])
def test_invalid_source_is_rejected_before_database_work(address):
    db = SimpleNamespace(in_transaction=lambda: False)
    with pytest.raises(throttle.InvalidLoginSourceError) as error:
        throttle.reserve_login_attempt(db, address)
    assert str(error.value) == "The login source could not be verified."


def test_first_attempt_creates_both_counters_and_commits(limited_db):
    connection, db, clock = limited_db
    throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    rows = counters(connection)
    assert len(rows) == 2
    assert all(row["attempt_count"] == 1 for row in rows.values())
    assert rows["instance"]["window_started_at"] == clock["now"]
    assert rows["instance"]["window_ends_at"] == clock["now"] + timedelta(minutes=5)
    assert source_row(connection)["window_ends_at"] == clock["now"] + timedelta(minutes=1)
    assert db.in_transaction() is False


def test_source_limit_blocks_sixth_attempt_without_changing_counters(limited_db):
    connection, db, _ = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    before = saved_counters(connection)
    with pytest.raises(throttle.LoginRateLimitedError) as error:
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert str(error.value) == "Too many login attempts. Try again later."
    assert error.value.retry_after_seconds == 60
    assert saved_counters(connection) == before
    assert db.in_transaction() is False


def test_different_sources_share_the_installation_limit(limited_db):
    connection, db, _ = limited_db
    for number in range(1, 21):
        throttle.reserve_login_attempt(db, f"192.0.2.{number}")
    before = saved_counters(connection)
    with pytest.raises(throttle.LoginRateLimitedError) as error:
        throttle.reserve_login_attempt(db, "198.51.100.1")
    assert error.value.retry_after_seconds == 300
    assert saved_counters(connection) == before  # No new source row allocated.
    assert counters(connection)["instance"]["attempt_count"] == 20


def test_one_blocked_source_does_not_spend_capacity_for_other_sources(limited_db):
    connection, db, _ = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    with pytest.raises(throttle.LoginRateLimitedError):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert counters(connection)["instance"]["attempt_count"] == 5
    throttle.reserve_login_attempt(db, "198.51.100.1")
    assert counters(connection)["instance"]["attempt_count"] == 6
    assert source_row(connection, "198.51.100.1")["attempt_count"] == 1


def test_repeated_rejections_do_not_extend_the_window(limited_db):
    connection, db, clock = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    deadline = source_row(connection)["window_ends_at"]
    for elapsed in (10, 10, 10):
        clock["now"] += timedelta(seconds=elapsed)
        with pytest.raises(throttle.LoginRateLimitedError) as error:
            throttle.reserve_login_attempt(db, DEMO_ADDRESS)
        assert error.value.retry_after_seconds == int((deadline - clock["now"]).total_seconds())
        assert source_row(connection)["window_ends_at"] == deadline


def test_expired_source_window_resets_at_its_exact_boundary(limited_db):
    connection, db, clock = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    clock["now"] = source_row(connection)["window_ends_at"]
    throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert source_row(connection)["attempt_count"] == 1
    assert source_row(connection)["window_started_at"] == clock["now"]
    assert counters(connection)["instance"]["attempt_count"] == 6


def test_expired_installation_window_resets_without_changing_old_source_rows(limited_db):
    connection, db, clock = limited_db
    throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    previous_source = source_row(connection)
    clock["now"] = counters(connection)["instance"]["window_ends_at"]
    throttle.reserve_login_attempt(db, "198.51.100.1")
    assert counters(connection)["instance"]["attempt_count"] == 1
    assert source_row(connection) == previous_source


def test_retry_after_rounds_up_and_never_becomes_zero(limited_db):
    connection, db, clock = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    clock["now"] = source_row(connection)["window_ends_at"] - timedelta(microseconds=1)
    with pytest.raises(throttle.LoginRateLimitedError) as error:
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert error.value.retry_after_seconds == 1


def test_ipv4_mapped_form_cannot_bypass_source_limit(limited_db):
    _, db, _ = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    with pytest.raises(throttle.LoginRateLimitedError):
        throttle.reserve_login_attempt(db, "::ffff:" + DEMO_ADDRESS)


def test_database_clock_rollback_fails_closed(limited_db):
    connection, db, clock = limited_db
    throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    before = saved_counters(connection)
    clock["now"] -= timedelta(seconds=1)
    with pytest.raises(throttle.LoginThrottleStorageError, match="clock could not be confirmed"):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert saved_counters(connection) == before


def test_counter_is_refreshed_instead_of_trusting_cached_orm_state(limited_db):
    connection, db, _ = limited_db
    throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    with db.begin():
        cached = db.get(AuthLoginThrottle, "instance")
    assert cached.attempt_count == 1
    connection.execute(AuthLoginThrottle.__table__.update().where(
        AuthLoginThrottle.bucket_key == "instance"
    ).values(attempt_count=20))
    with pytest.raises(throttle.LoginRateLimitedError):
        throttle.reserve_login_attempt(db, "198.51.100.1")
    assert counters(connection)["instance"]["attempt_count"] == 20


def test_existing_transaction_is_not_committed(limited_db):
    _, db, _ = limited_db
    with db.begin():
        pending = AuthLoginThrottle(bucket_key="instance", attempt_count=7)
        db.add(pending)
        with pytest.raises(throttle.LoginThrottleStorageError, match="fresh database session"):
            throttle.reserve_login_attempt(db, DEMO_ADDRESS)
        assert pending in db.new and db.in_transaction()
        db.expunge(pending)


def test_database_failure_is_safe_and_has_no_in_memory_fallback(limited_db, monkeypatch):
    connection, db, _ = limited_db
    calls = []
    def unavailable(*args, **kwargs):
        calls.append(1)
        raise OperationalError("private SQL", {"source": DEMO_ADDRESS}, Exception("private connection details"))
    monkeypatch.setattr(db, "execute", unavailable)
    with pytest.raises(throttle.LoginThrottleStorageError) as error:
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert calls == [1]
    assert "private" not in str(error.value) and DEMO_ADDRESS not in str(error.value)
    assert error.value.__suppress_context__
    assert saved_counters(connection) == []


def test_failed_flush_rolls_back_both_counter_increments(limited_db, monkeypatch):
    connection, db, _ = limited_db
    throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    before = saved_counters(connection)
    original_flush = db.flush
    def fail_dirty_flush(*args, **kwargs):
        if db.dirty:
            raise OperationalError("private SQL", {}, Exception("write failed"))
        return original_flush(*args, **kwargs)
    monkeypatch.setattr(db, "flush", fail_dirty_flush)
    with pytest.raises(throttle.LoginThrottleStorageError):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    assert saved_counters(connection) == before


def test_lost_commit_confirmation_does_not_retry_or_start_login(limited_db, monkeypatch):
    connection, db, _ = limited_db
    original_begin = db.begin
    calls = []
    @contextmanager
    def uncertain_begin():
        calls.append("reserve")
        with original_begin():
            yield
        raise OperationalError("private SQL", {}, Exception("lost confirmation"))
    monkeypatch.setattr(db, "begin", uncertain_begin)
    monkeypatch.setattr(throttle, "login_owner", lambda *args, **kwargs: calls.append("login"))
    with pytest.raises(throttle.LoginThrottleStorageError) as error:
        throttle.login_owner_with_limits(db, "owner", DEMO_PASSWORD,
            client_type="native", client_address=DEMO_ADDRESS)
    assert calls == ["reserve"]
    assert "not confirmed" in str(error.value)
    assert all(row["attempt_count"] == 1 for row in counters(connection).values())


def test_wrapper_reserves_before_checking_password(monkeypatch):
    calls = []
    db = object()
    expected = object()
    def reserve(given_db, address):
        assert given_db is db and address == DEMO_ADDRESS
        calls.append("reserve")
    def login(given_db, username, password, *, client_type):
        assert given_db is db and username == "owner" and password == DEMO_PASSWORD
        assert client_type == "native"
        calls.append("login")
        return expected
    monkeypatch.setattr(throttle, "reserve_login_attempt", reserve)
    monkeypatch.setattr(throttle, "login_owner", login)
    assert throttle.login_owner_with_limits(db, "owner", DEMO_PASSWORD,
        client_type="native", client_address=DEMO_ADDRESS) is expected
    assert calls == ["reserve", "login"]


def test_wrapper_never_checks_password_when_limited(limited_db, monkeypatch):
    _, db, _ = limited_db
    for _ in range(5):
        throttle.reserve_login_attempt(db, DEMO_ADDRESS)
    called = []
    monkeypatch.setattr(throttle, "login_owner", lambda *args, **kwargs: called.append(True))
    with pytest.raises(throttle.LoginRateLimitedError):
        throttle.login_owner_with_limits(db, "owner", DEMO_PASSWORD,
            client_type="web", client_address=DEMO_ADDRESS)
    assert called == []


@pytest.mark.parametrize("client_type", [None, "", "browser", "WEB", True])
def test_wrapper_rejects_unsupported_client_type_before_spending_capacity(client_type):
    with pytest.raises(ValueError, match="Client type must be web or native"):
        throttle.login_owner_with_limits(object(), "owner", DEMO_PASSWORD,
            client_type=client_type, client_address=DEMO_ADDRESS)


def add_private_owner_tables(connection):
    schema = connection.info["login_throttle_test_schema"]
    Account.__table__.create(connection)
    AuthSession.__table__.create(connection)
    for name in ("accounts", "auth_sessions"):
        assert connection.scalar(text("""
            SELECT n.nspname = :schema FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = to_regclass(:name)
        """), {"schema": schema, "name": name}) is True


def test_real_wrong_password_cannot_roll_back_committed_reservation(limited_db):
    connection, db, _ = limited_db
    add_private_owner_tables(connection)
    create_owner_account(db, "owner", DEMO_PASSWORD)
    with pytest.raises(InvalidCredentialsError):
        throttle.login_owner_with_limits(db, "owner", "incorrect password",
            client_type="native", client_address=DEMO_ADDRESS)
    assert all(row["attempt_count"] == 1 for row in counters(connection).values())
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_real_successful_logins_do_not_reset_request_counters(limited_db):
    connection, db, _ = limited_db
    add_private_owner_tables(connection)
    create_owner_account(db, "owner", DEMO_PASSWORD)
    first = throttle.login_owner_with_limits(db, "owner", DEMO_PASSWORD,
        client_type="native", client_address=DEMO_ADDRESS)
    second = throttle.login_owner_with_limits(db, " OWNER ", DEMO_PASSWORD,
        client_type="web", client_address=DEMO_ADDRESS)
    assert first.identity.account_id == second.identity.account_id == 1
    assert first.token != second.token
    assert all(row["attempt_count"] == 2 for row in counters(connection).values())
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 2


@pytest.fixture
def parallel_throttle_sessions():
    """Commit only a generated private schema; remove it after workers finish."""
    schema = "wf_login_throttle_parallel_" + uuid4().hex
    with engine.begin() as connection:
        connection = connection.execution_options(schema_translate_map={None: schema})
        connection.execute(CreateSchema(schema))
        AuthLoginThrottle.__table__.create(connection)

    @contextmanager
    def private_session():
        with engine.connect() as connection:
            connection = connection.execution_options(schema_translate_map={None: schema})
            with connection.begin():
                connection.execute(text("SELECT set_config('search_path', :path, true)"),
                    {"path": f'"{schema}", pg_catalog'})
                assert connection.scalar(text("""
                    SELECT n.nspname = :schema FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.oid = to_regclass('auth_login_throttles')
                """), {"schema": schema}) is True
                with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as db:
                    yield db
    try:
        yield private_session
    finally:
        assert re.fullmatch(r"wf_login_throttle_parallel_[0-9a-f]{32}", schema)
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))


def test_simultaneous_first_attempts_cannot_exceed_source_limit(parallel_throttle_sessions):
    barrier = Barrier(8)
    def reserve(number):
        barrier.wait(timeout=10)
        with parallel_throttle_sessions() as db:
            try:
                throttle.reserve_login_attempt(db, DEMO_ADDRESS)
                return "allowed"
            except throttle.LoginRateLimitedError:
                return "blocked"
    with ThreadPoolExecutor(max_workers=8) as workers:
        results = list(workers.map(reserve, range(8)))
    assert results.count("allowed") == 5 and results.count("blocked") == 3
    with parallel_throttle_sessions() as db:
        rows = db.scalars(select(AuthLoginThrottle)).all()
        assert len(rows) == 2 and all(row.attempt_count == 5 for row in rows)


def test_different_simultaneous_sources_cannot_exceed_instance_limit(parallel_throttle_sessions, monkeypatch):
    monkeypatch.setattr(throttle, "INSTANCE_ATTEMPT_LIMIT", 3)
    barrier = Barrier(8)
    def reserve(number):
        barrier.wait(timeout=10)
        with parallel_throttle_sessions() as db:
            try:
                throttle.reserve_login_attempt(db, f"192.0.2.{number + 1}")
                return "allowed"
            except throttle.LoginRateLimitedError:
                return "blocked"
    with ThreadPoolExecutor(max_workers=8) as workers:
        results = list(workers.map(reserve, range(8)))
    assert results.count("allowed") == 3 and results.count("blocked") == 5
    with parallel_throttle_sessions() as db:
        rows = db.scalars(select(AuthLoginThrottle)).all()
        assert len(rows) == 4
        assert next(row for row in rows if row.bucket_key == "instance").attempt_count == 3
        assert all(row.attempt_count == 1 for row in rows if row.bucket_key != "instance")
