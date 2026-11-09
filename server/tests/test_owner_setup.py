"""Exercise setup-code issuance, claiming, blocking, and concurrent requests."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict
from datetime import timedelta
from hashlib import sha256
import re
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from app.database import engine
from app.models import Account, OwnerSetupCode
from app.services import owner_setup
from app.services.accounts import (
    AccountValidationError, OwnerAlreadyExistsError, create_owner_account,
)
from app.services.passwords import PasswordValidationError, verify_password
from test_owner_setup_code_model import assert_private_table, saved_code, setup_db


DEMO_PASSWORD = "a temporary owner setup passphrase"


def wrong_code(code):
    return ("A" if code[0] != "A" else "B") + code[1:]


def clock(connection):
    return connection.scalar(select(func.clock_timestamp()))


@pytest.fixture
def setup_service_db(setup_db):
    connection = setup_db
    Account.__table__.create(connection)
    schema = connection.info["owner_setup_test_schema"]
    assert connection.scalar(text("""
        SELECT n.nspname = :schema FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid = to_regclass('accounts')
    """), {"schema": schema}) is True
    with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as db:
        yield connection, db


def expire_code(connection):
    assert_private_table(connection)
    now = clock(connection)
    connection.execute(OwnerSetupCode.__table__.update().values(
        created_at=now - timedelta(hours=2), expires_at=now - timedelta(hours=1),
    ))


def seed_owner(connection, *, active=True):
    connection.execute(Account.__table__.insert().values(
        username="existing-owner", password_hash="test-only-placeholder", is_active=active,
    ))
    return dict(connection.execute(select(Account.__table__)).mappings().one())


def test_issue_returns_a_random_code_and_stores_only_its_digest(setup_service_db):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    row = saved_code(connection)
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", issued.code)
    assert row["code_hash"] == sha256(issued.code.encode("ascii")).hexdigest()
    assert issued.code not in row.values()
    assert issued.code not in repr(issued)
    assert issued.expires_at == row["expires_at"]
    assert row["expires_at"] - row["created_at"] == timedelta(minutes=30)
    assert row["failed_attempts"] == 0 and row["blocked_until"] is None
    assert row["consumed_at"] is None
    assert db.in_transaction() is False


def test_active_code_survives_a_repeat_issuance_attempt(setup_service_db):
    connection, db = setup_service_db
    owner_setup.issue_setup_code(db)
    before = saved_code(connection)
    with pytest.raises(owner_setup.SetupCodeAlreadyIssuedError):
        owner_setup.issue_setup_code(db)
    assert saved_code(connection) == before


def test_explicit_local_rotation_invalidates_the_old_code(setup_service_db):
    connection, db = setup_service_db
    first = owner_setup.issue_setup_code(db)
    second = owner_setup.issue_setup_code(db, rotate=True)
    assert first.code != second.code
    assert saved_code(connection)["code_hash"] == sha256(second.code.encode("ascii")).hexdigest()
    with pytest.raises(owner_setup.InvalidSetupCodeError):
        owner_setup.create_owner_with_setup_code(db, first.code, "owner", DEMO_PASSWORD)
    result = owner_setup.create_owner_with_setup_code(db, second.code, "owner", DEMO_PASSWORD)
    assert result.id == 1


def test_expired_code_can_be_replaced_by_the_local_issuer(setup_service_db):
    connection, db = setup_service_db
    first = owner_setup.issue_setup_code(db)
    expire_code(connection)
    second = owner_setup.issue_setup_code(db)
    assert first.code != second.code
    assert saved_code(connection)["expires_at"] > clock(connection)


def test_consumed_setup_cannot_be_reopened_even_when_account_is_absent(setup_service_db):
    connection, db = setup_service_db
    owner_setup.issue_setup_code(db)
    before = saved_code(connection)
    connection.execute(OwnerSetupCode.__table__.update().values(consumed_at=before["created_at"]))
    consumed = saved_code(connection)
    with pytest.raises(owner_setup.OwnerSetupClosedError):
        owner_setup.issue_setup_code(db, rotate=True)
    assert saved_code(connection) == consumed


@pytest.mark.parametrize("active", [True, False])
def test_local_issuer_refuses_to_replace_an_existing_owner(setup_service_db, active):
    connection, db = setup_service_db
    owner_setup.issue_setup_code(db)
    before_code = saved_code(connection)
    before_owner = seed_owner(connection, active=active)
    with pytest.raises(owner_setup.OwnerSetupClosedError):
        owner_setup.issue_setup_code(db, rotate=True)
    assert saved_code(connection) == before_code
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == before_owner


@pytest.mark.parametrize("state,ready", [
    ("empty", False), ("active", True), ("expired", False),
    ("consumed", False), ("blocked", False),
])
def test_status_exposes_only_readiness_without_secrets(setup_service_db, state, ready):
    connection, db = setup_service_db
    if state != "empty":
        owner_setup.issue_setup_code(db)
        row = saved_code(connection)
        if state == "expired":
            expire_code(connection)
        elif state == "consumed":
            connection.execute(OwnerSetupCode.__table__.update().values(consumed_at=row["created_at"]))
        elif state == "blocked":
            connection.execute(OwnerSetupCode.__table__.update().values(
                failed_attempts=5, blocked_until=clock(connection) + timedelta(minutes=5),
            ))
    assert asdict(owner_setup.get_owner_setup_status(db)) == {
        "owner_exists": False, "setup_ready": ready,
    }


def test_success_creates_owner_and_consumes_code_in_one_transaction(setup_service_db):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    result = owner_setup.create_owner_with_setup_code(db, issued.code, " COREY ", DEMO_PASSWORD)
    assert asdict(result) == {"id": 1, "username": "corey"}
    owner = connection.execute(select(Account.__table__)).mappings().one()
    assert owner["is_active"] is True
    assert verify_password(DEMO_PASSWORD, owner["password_hash"]) is True
    assert saved_code(connection)["consumed_at"] is not None
    assert asdict(owner_setup.get_owner_setup_status(db)) == {"owner_exists": True, "setup_ready": False}
    with pytest.raises(owner_setup.OwnerSetupClosedError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "another-owner", DEMO_PASSWORD)
    assert connection.scalar(select(func.count()).select_from(Account)) == 1


@pytest.mark.parametrize("active", [True, False])
def test_browser_setup_cannot_replace_or_reactivate_an_owner(setup_service_db, active):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    before_code = saved_code(connection)
    before_owner = seed_owner(connection, active=active)
    with pytest.raises(owner_setup.OwnerSetupClosedError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "another-owner", DEMO_PASSWORD)
    assert saved_code(connection) == before_code
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == before_owner


@pytest.mark.parametrize("supplied", [None, False, "", "short", "\ud800", "z" * 43])
def test_bad_codes_commit_an_attempt_without_hashing_a_password(setup_service_db, monkeypatch, supplied):
    connection, db = setup_service_db
    owner_setup.issue_setup_code(db)
    monkeypatch.setattr(owner_setup, "hash_password", lambda password: pytest.fail("Must verify setup code first"))
    with pytest.raises(owner_setup.InvalidSetupCodeError):
        owner_setup.create_owner_with_setup_code(db, supplied, "owner", DEMO_PASSWORD)
    assert saved_code(connection)["failed_attempts"] == 1
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_expired_code_is_rejected_without_changing_its_state(setup_service_db):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    expire_code(connection)
    before = saved_code(connection)
    with pytest.raises(owner_setup.InvalidSetupCodeError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
    assert saved_code(connection) == before


@pytest.mark.parametrize("username,password,error", [
    ("bad username", DEMO_PASSWORD, AccountValidationError),
    ("owner", "short", PasswordValidationError),
    ("owner", "x" * 129, PasswordValidationError),
])
def test_invalid_new_credentials_do_not_consume_a_valid_code(setup_service_db, username, password, error):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    before = saved_code(connection)
    with pytest.raises(error):
        owner_setup.create_owner_with_setup_code(db, issued.code, username, password)
    assert saved_code(connection) == before
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_five_wrong_attempts_block_even_the_correct_code_without_extending_the_block(setup_service_db, monkeypatch):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    for attempt in range(1, 5):
        with pytest.raises(owner_setup.InvalidSetupCodeError):
            owner_setup.create_owner_with_setup_code(db, wrong_code(issued.code), "owner", DEMO_PASSWORD)
        assert saved_code(connection)["failed_attempts"] == attempt
    with pytest.raises(owner_setup.SetupCodeBlockedError) as error:
        owner_setup.create_owner_with_setup_code(db, wrong_code(issued.code), "owner", DEMO_PASSWORD)
    assert error.value.retry_after_seconds == 300
    before = saved_code(connection)
    monkeypatch.setattr(owner_setup, "hash_password", lambda password: pytest.fail("Blocked requests must not hash passwords"))
    with pytest.raises(owner_setup.SetupCodeBlockedError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
    assert saved_code(connection) == before


@pytest.mark.parametrize("valid", [False, True])
def test_expired_block_allows_a_fresh_attempt_window(setup_service_db, monkeypatch, valid):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    row = saved_code(connection)
    connection.execute(OwnerSetupCode.__table__.update().values(
        failed_attempts=5, blocked_until=row["created_at"] + timedelta(minutes=5),
    ))
    future = row["created_at"] + timedelta(minutes=6)
    monkeypatch.setattr(owner_setup, "_database_now", lambda db: future)
    if valid:
        owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
        assert saved_code(connection)["consumed_at"] == future
        assert saved_code(connection)["failed_attempts"] == 0
    else:
        with pytest.raises(owner_setup.InvalidSetupCodeError):
            owner_setup.create_owner_with_setup_code(db, wrong_code(issued.code), "owner", DEMO_PASSWORD)
        assert saved_code(connection)["failed_attempts"] == 1
    assert saved_code(connection)["blocked_until"] is None


def test_password_hashing_cannot_make_an_expired_code_succeed(setup_service_db, monkeypatch):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    row = saved_code(connection)
    moments = iter([issued.expires_at - timedelta(seconds=1), issued.expires_at])
    monkeypatch.setattr(owner_setup, "_database_now", lambda db: next(moments))
    with pytest.raises(owner_setup.InvalidSetupCodeError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
    assert saved_code(connection) == row
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_locked_read_refreshes_previously_cached_state(setup_service_db):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    with db.begin():
        cached = db.get(OwnerSetupCode, 1)
    assert cached.consumed_at is None
    connection.execute(OwnerSetupCode.__table__.update().values(consumed_at=cached.created_at))
    with pytest.raises(owner_setup.OwnerSetupClosedError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
    assert cached.consumed_at is not None


@pytest.mark.parametrize("operation", ["issue", "status", "claim"])
def test_service_does_not_commit_someone_elses_transaction(setup_service_db, operation):
    connection, db = setup_service_db
    with db.begin():
        with pytest.raises(owner_setup.OwnerSetupStorageError, match="fresh database session"):
            if operation == "issue":
                owner_setup.issue_setup_code(db)
            elif operation == "status":
                owner_setup.get_owner_setup_status(db)
            else:
                owner_setup.create_owner_with_setup_code(db, "z" * 43, "owner", DEMO_PASSWORD)
        assert db.in_transaction() is True
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_failed_insert_transaction_rolls_back_owner_and_consumption(setup_service_db):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    before = saved_code(connection)
    saw_insert = []
    def fail_after_account_insert(session, context):
        if any(isinstance(item, Account) for item in session.new):
            saw_insert.append(True)
            raise OperationalError("simulated failure after account insert", {}, RuntimeError("failure"))
    event.listen(db, "after_flush", fail_after_account_insert)
    try:
        with pytest.raises(owner_setup.OwnerSetupStorageError):
            owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
    finally:
        event.remove(db, "after_flush", fail_after_account_insert)
    assert saw_insert == [True]
    assert saved_code(connection) == before
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_lost_commit_confirmation_preserves_single_use_without_auto_retry(setup_service_db, monkeypatch):
    connection, db = setup_service_db
    issued = owner_setup.issue_setup_code(db)
    original_begin = db.begin
    @contextmanager
    def lose_confirmation():
        with original_begin():
            yield
        raise OperationalError("lost commit response", {}, RuntimeError("failure"))
    monkeypatch.setattr(db, "begin", lose_confirmation)
    with pytest.raises(owner_setup.OwnerSetupStorageError, match="not confirmed"):
        owner_setup.create_owner_with_setup_code(db, issued.code, "owner", DEMO_PASSWORD)
    assert saved_code(connection)["consumed_at"] is not None
    with pytest.raises(owner_setup.OwnerSetupClosedError):
        owner_setup.create_owner_with_setup_code(db, issued.code, "another-owner", DEMO_PASSWORD)
    assert connection.scalar(select(func.count()).select_from(Account)) == 1


@pytest.mark.parametrize("operation", ["issue", "status", "claim"])
def test_storage_errors_do_not_expose_sql_credentials_or_retry(setup_service_db, monkeypatch, operation):
    connection, db = setup_service_db
    calls = []
    def failed(*args, **kwargs):
        calls.append(True)
        raise OperationalError("private SQL", {"secret": DEMO_PASSWORD}, RuntimeError("failure"))
    monkeypatch.setattr(db, "execute" if operation != "status" else "scalar", failed)
    with pytest.raises(owner_setup.OwnerSetupStorageError) as error:
        if operation == "issue":
            owner_setup.issue_setup_code(db)
        elif operation == "status":
            owner_setup.get_owner_setup_status(db)
        else:
            owner_setup.create_owner_with_setup_code(db, "z" * 43, "owner", DEMO_PASSWORD)
    assert len(calls) == 1
    assert DEMO_PASSWORD not in str(error.value)
    assert "private SQL" not in str(error.value)
    assert error.value.__suppress_context__ is True


@pytest.fixture
def parallel_setup_sessions():
    """Share a committed private schema across independent DB connections.

    Only this generated schema is committed; cleanup drops it after workers
    finish. Production schemas are excluded from every worker's search path.
    """
    schema = "wf_setup_parallel_" + uuid4().hex
    with engine.begin() as connection:
        connection = connection.execution_options(schema_translate_map={None: schema})
        connection.execute(CreateSchema(schema))
        Account.__table__.create(connection)
        OwnerSetupCode.__table__.create(connection)

    @contextmanager
    def sessions():
        with engine.connect() as connection:
            connection = connection.execution_options(schema_translate_map={None: schema})
            with connection.begin():
                connection.execute(text(f'SET LOCAL search_path TO "{schema}", pg_catalog'))
                for name in ("accounts", "owner_setup_codes"):
                    assert connection.scalar(text("""
                        SELECT n.nspname = :schema FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE c.oid = to_regclass(:name)
                    """), {"schema": schema, "name": name}) is True
                with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as db:
                    yield db
    try:
        yield sessions
    finally:
        assert re.fullmatch(r"wf_setup_parallel_[0-9a-f]{32}", schema)
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))


def test_parallel_local_issuers_do_not_replace_the_winning_code(parallel_setup_sessions):
    barrier = Barrier(2)
    def issue():
        with parallel_setup_sessions() as db:
            barrier.wait(timeout=5)
            try:
                return owner_setup.issue_setup_code(db)
            except owner_setup.SetupCodeAlreadyIssuedError:
                return None
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: issue(), range(2)))
    issued = [result for result in results if result is not None]
    assert len(issued) == 1
    with parallel_setup_sessions() as db:
        row = db.get(OwnerSetupCode, 1)
        assert row.code_hash == sha256(issued[0].code.encode("ascii")).hexdigest()


def test_parallel_browser_claims_create_only_one_owner(parallel_setup_sessions):
    with parallel_setup_sessions() as db:
        issued = owner_setup.issue_setup_code(db)
    barrier = Barrier(2)
    def claim(username):
        with parallel_setup_sessions() as db:
            barrier.wait(timeout=5)
            try:
                return owner_setup.create_owner_with_setup_code(db, issued.code, username, DEMO_PASSWORD).username
            except owner_setup.OwnerSetupClosedError:
                return None
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(claim, ("owner-one", "owner-two")))
    assert sum(result is not None for result in results) == 1
    with parallel_setup_sessions() as db:
        assert db.scalar(select(func.count()).select_from(Account)) == 1
        assert db.get(OwnerSetupCode, 1).consumed_at is not None


def test_terminal_and_browser_setup_cannot_overwrite_each_other(parallel_setup_sessions):
    with parallel_setup_sessions() as db:
        issued = owner_setup.issue_setup_code(db)
    barrier = Barrier(2)
    def claim(browser):
        with parallel_setup_sessions() as db:
            barrier.wait(timeout=5)
            try:
                if browser:
                    return owner_setup.create_owner_with_setup_code(db, issued.code, "browser-owner", DEMO_PASSWORD).username
                return create_owner_account(db, "terminal-owner", DEMO_PASSWORD).username
            except (owner_setup.OwnerSetupClosedError, OwnerAlreadyExistsError):
                return None
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(claim, (True, False)))
    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    with parallel_setup_sessions() as db:
        assert db.scalar(select(Account.username)) == winners[0]
        assert db.scalar(select(func.count()).select_from(Account)) == 1
        if winners[0] == "browser-owner":
            assert db.get(OwnerSetupCode, 1).consumed_at is not None
