"""Verify owner sessions using disposable PostgreSQL auth tables."""

from contextlib import contextmanager
from dataclasses import FrozenInstanceError, asdict
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models import Account, AuthSession
from app.services import passwords, sessions
from app.services.session_tokens import generate_token, hash_token, verify_token
from test_auth_models import add_account, assert_temporary, migrated_auth


DEMO_PASSWORD = "a temporary session test passphrase"


@pytest.fixture(scope="module")
def owner_hash():
    return passwords.hash_password(DEMO_PASSWORD)


@pytest.fixture
def session_db(migrated_auth, monkeypatch, owner_hash):
    connection, _ = migrated_auth
    add_account(connection, password_hash=owner_hash)
    clock = {"now": connection.scalar(select(func.clock_timestamp())) + timedelta(seconds=1)}
    monkeypatch.setattr(sessions, "_database_now", lambda db: clock["now"])
    with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as db:
        yield connection, db, clock


def login(db, client_type="native", **changes):
    values = {"username": "owner", "password": DEMO_PASSWORD, **changes}
    return sessions.login_owner(db, **values, client_type=client_type)


def stored_sessions(connection):
    assert_temporary(connection, "auth_sessions")
    return [dict(row) for row in connection.execute(
        select(AuthSession.__table__).order_by(AuthSession.created_at, AuthSession.id)
    ).mappings()]


def record_for(connection, issued):
    return next(row for row in stored_sessions(connection) if row["id"] == issued.identity.session_id)


def test_native_login_saves_only_token_hash_and_returns_safe_identity(session_db):
    connection, db, clock = session_db
    issued = login(db)
    row = record_for(connection, issued)
    assert isinstance(issued.identity.session_id, UUID)
    assert issued.identity.account_id == 1
    assert issued.identity.username == "owner"
    assert issued.identity.client_type == "native"
    assert issued.csrf_token is None and row["csrf_token_hash"] is None
    assert row["token_hash"] == hash_token(issued.token, purpose="session")
    assert issued.token not in repr(row)
    assert DEMO_PASSWORD not in repr(row)
    assert issued.token not in repr(issued)
    assert row["created_at"] == row["last_seen_at"] == clock["now"]
    assert row["expires_at"] == clock["now"] + timedelta(hours=8)
    assert row["revoked_at"] is None
    assert db.in_transaction() is False
    assert set(asdict(issued.identity)) == {"session_id", "account_id", "username", "client_type", "expires_at"}
    with pytest.raises(FrozenInstanceError):
        issued.identity.username = "someone-else"


def test_browser_login_generates_an_independent_csrf_secret(session_db):
    connection, db, _ = session_db
    issued = login(db, "web")
    row = record_for(connection, issued)
    assert issued.csrf_token is not None
    assert issued.csrf_token != issued.token
    assert row["client_type"] == "web"
    assert verify_token(issued.csrf_token, row["csrf_token_hash"], purpose="csrf")
    assert not verify_token(issued.token, row["csrf_token_hash"], purpose="csrf")
    assert issued.csrf_token not in repr(issued)
    assert issued.csrf_token not in repr(row)


def test_each_login_creates_its_own_session(session_db):
    connection, db, _ = session_db
    first, second = login(db), login(db)
    assert first.token != second.token
    assert first.identity.session_id != second.identity.session_id
    assert len(stored_sessions(connection)) == 2


def test_login_normalizes_username_but_preserves_password_exactly(session_db):
    _, db, _ = session_db
    assert login(db, username=" OWNER ").identity.username == "owner"
    with pytest.raises(sessions.InvalidCredentialsError):
        login(db, password=" " + DEMO_PASSWORD)


@pytest.mark.parametrize("username,password", [
    ("unknown", DEMO_PASSWORD), ("owner", "wrong password"),
    ("bad username", DEMO_PASSWORD), (None, DEMO_PASSWORD),
    ("owner", ""), ("owner", "x" * 129), ("owner", None),
    ("owner", "\ud800"),
])
def test_bad_credentials_have_one_safe_error_and_create_no_session(session_db, username, password):
    connection, db, _ = session_db
    with pytest.raises(sessions.InvalidCredentialsError) as error:
        login(db, username=username, password=password)
    assert str(error.value) == "Username or password is incorrect."
    assert stored_sessions(connection) == []
    assert db.in_transaction() is False


@pytest.mark.parametrize("state", ["missing", "inactive"])
def test_unavailable_account_uses_dummy_password_work_and_cannot_login(session_db, monkeypatch, state):
    connection, db, _ = session_db
    assert_temporary(connection, "accounts")
    if state == "missing":
        connection.execute(Account.__table__.delete())
    else:
        connection.execute(Account.__table__.update().values(is_active=False))
    calls = []
    def fake_verify(password, stored_hash):
        calls.append((password, stored_hash))
        return True, None  # Even a dummy match cannot authorize a login.
    monkeypatch.setattr(sessions, "verify_and_update_password", fake_verify)
    with pytest.raises(sessions.InvalidCredentialsError):
        login(db)
    assert calls == [(DEMO_PASSWORD, None)]
    assert stored_sessions(connection) == []


def test_unknown_username_does_not_verify_against_owners_real_hash(session_db, monkeypatch):
    _, db, _ = session_db
    observed = []
    def fake_verify(password, stored_hash):
        observed.append(stored_hash)
        return False, None
    monkeypatch.setattr(sessions, "verify_and_update_password", fake_verify)
    with pytest.raises(sessions.InvalidCredentialsError):
        login(db, username="unknown")
    assert observed == [None]


def test_login_rechecks_password_state_after_verification(session_db, monkeypatch):
    connection, db, _ = session_db
    original_verify = sessions.verify_and_update_password
    def account_changed(password, stored_hash):
        result = original_verify(password, stored_hash)
        # Simulate the account changing after the initial credential snapshot.
        connection.execute(Account.__table__.update().values(password_hash="replacement-test-hash"))
        return result
    monkeypatch.setattr(sessions, "verify_and_update_password", account_changed)
    with pytest.raises(sessions.InvalidCredentialsError):
        login(db)
    assert stored_sessions(connection) == []


def test_hash_upgrade_keeps_password_change_time_and_other_sessions(session_db, monkeypatch):
    connection, db, _ = session_db
    first = login(db)
    before = connection.scalar(select(Account.password_changed_at))
    upgraded = passwords.hash_password(DEMO_PASSWORD)
    monkeypatch.setattr(sessions, "verify_and_update_password", lambda password, stored: (True, upgraded))
    second = login(db)
    assert connection.scalar(select(Account.password_hash)) == upgraded
    assert connection.scalar(select(Account.password_changed_at)) == before
    assert sessions.authenticate_session(db, first.token, client_type="native") == first.identity
    assert record_for(connection, second)["revoked_at"] is None


def test_successful_authentication_updates_activity_not_absolute_expiration(session_db):
    connection, db, clock = session_db
    issued = login(db)
    clock["now"] += timedelta(minutes=10)
    identity = sessions.authenticate_session(db, issued.token, client_type="native")
    row = record_for(connection, issued)
    assert identity == issued.identity
    assert row["last_seen_at"] == clock["now"]
    assert row["expires_at"] == issued.identity.expires_at
    assert db.in_transaction() is False


@pytest.mark.parametrize("elapsed,allowed", [
    (timedelta(minutes=30) - timedelta(microseconds=1), True),
    (timedelta(minutes=30), False), (timedelta(minutes=31), False),
])
def test_idle_timeout_boundary_is_enforced(session_db, elapsed, allowed):
    connection, db, clock = session_db
    issued = login(db)
    before = record_for(connection, issued)
    clock["now"] += elapsed
    if allowed:
        assert sessions.authenticate_session(db, issued.token, client_type="native") == issued.identity
    else:
        with pytest.raises(sessions.InvalidSessionError):
            sessions.authenticate_session(db, issued.token, client_type="native")
        assert record_for(connection, issued) == before


def test_recent_activity_cannot_extend_absolute_deadline(session_db):
    connection, db, clock = session_db
    issued = login(db)
    deadline = issued.identity.expires_at
    connection.execute(AuthSession.__table__.update().values(last_seen_at=deadline - timedelta(minutes=1)))
    clock["now"] = deadline
    before = record_for(connection, issued)
    with pytest.raises(sessions.InvalidSessionError):
        sessions.authenticate_session(db, issued.token, client_type="native")
    assert record_for(connection, issued) == before


@pytest.mark.parametrize("state", ["revoked", "inactive", "password_changed", "future_creation", "future_activity"])
def test_invalid_database_session_state_is_rejected(session_db, state):
    connection, db, clock = session_db
    issued = login(db)
    if state == "revoked":
        connection.execute(AuthSession.__table__.update().values(revoked_at=clock["now"]))
    elif state == "inactive":
        connection.execute(Account.__table__.update().values(is_active=False))
    elif state == "password_changed":
        connection.execute(Account.__table__.update().values(password_changed_at=clock["now"] + timedelta(seconds=1)))
        clock["now"] += timedelta(seconds=2)
    elif state == "future_creation":
        clock["now"] -= timedelta(seconds=1)
    else:
        connection.execute(AuthSession.__table__.update().values(last_seen_at=clock["now"] + timedelta(seconds=1)))
    before = record_for(connection, issued)
    with pytest.raises(sessions.InvalidSessionError) as error:
        sessions.authenticate_session(db, issued.token, client_type="native")
    assert str(error.value) == "The login session is unavailable or no longer valid."
    assert issued.token not in str(error.value)
    assert record_for(connection, issued) == before


@pytest.mark.parametrize("token", [None, "", "A" * 42, "A" * 44, "A" * 43, "é" * 43])
def test_unknown_or_malformed_tokens_are_rejected(session_db, token):
    _, db, _ = session_db
    with pytest.raises(sessions.InvalidSessionError):
        sessions.authenticate_session(db, token, client_type="native")
    assert db.in_transaction() is False


def test_database_hash_cannot_be_presented_as_a_credential(session_db):
    connection, db, _ = session_db
    issued = login(db)
    digest = record_for(connection, issued)["token_hash"]
    with pytest.raises(sessions.InvalidSessionError):
        sessions.authenticate_session(db, digest, client_type="native")


@pytest.mark.parametrize("issued_type,presented_type", [("web", "native"), ("native", "web")])
def test_client_type_cannot_be_changed_to_bypass_browser_checks(session_db, issued_type, presented_type):
    _, db, _ = session_db
    issued = login(db, issued_type)
    with pytest.raises(sessions.InvalidSessionError):
        sessions.authenticate_session(db, issued.token, client_type=presented_type, require_csrf=False)


def test_web_read_can_explicitly_skip_csrf_but_default_requires_it(session_db):
    connection, db, _ = session_db
    issued = login(db, "web")
    assert sessions.authenticate_session(db, issued.token, client_type="web", require_csrf=False) == issued.identity
    before = record_for(connection, issued)
    with pytest.raises(sessions.InvalidCsrfTokenError):
        sessions.authenticate_session(db, issued.token, client_type="web")
    assert record_for(connection, issued) == before


@pytest.mark.parametrize("csrf_kind", ["correct", "missing", "wrong", "session_token", "stored_hash", "other_session"])
def test_web_csrf_is_bound_to_the_specific_session(session_db, csrf_kind):
    connection, db, _ = session_db
    issued = login(db, "web")
    choices = {
        "correct": issued.csrf_token, "missing": None, "wrong": generate_token(),
        "session_token": issued.token, "stored_hash": record_for(connection, issued)["csrf_token_hash"],
        "other_session": login(db, "web").csrf_token,
    }
    if csrf_kind == "correct":
        assert sessions.authenticate_session(db, issued.token, client_type="web", csrf_token=choices[csrf_kind]) == issued.identity
    else:
        before = record_for(connection, issued)
        with pytest.raises(sessions.InvalidCsrfTokenError) as error:
            sessions.authenticate_session(db, issued.token, client_type="web", csrf_token=choices[csrf_kind])
        assert str(error.value) == "The browser request could not be verified."
        assert record_for(connection, issued) == before


def test_logout_revokes_only_the_presented_session(session_db):
    connection, db, clock = session_db
    first, second = login(db), login(db)
    sessions.revoke_session(db, first.token, client_type="native")
    assert record_for(connection, first)["revoked_at"] == clock["now"]
    assert record_for(connection, second)["revoked_at"] is None
    with pytest.raises(sessions.InvalidSessionError):
        sessions.authenticate_session(db, first.token, client_type="native")
    assert sessions.authenticate_session(db, second.token, client_type="native") == second.identity
    with pytest.raises(sessions.InvalidSessionError):
        sessions.revoke_session(db, first.token, client_type="native")


def test_web_logout_requires_csrf_before_revoking(session_db):
    connection, db, _ = session_db
    issued = login(db, "web")
    with pytest.raises(sessions.InvalidCsrfTokenError):
        sessions.revoke_session(db, issued.token, client_type="web")
    assert record_for(connection, issued)["revoked_at"] is None
    sessions.revoke_session(db, issued.token, client_type="web", csrf_token=issued.csrf_token)
    assert record_for(connection, issued)["revoked_at"] is not None


def test_reused_orm_session_does_not_trust_cached_account_or_session(session_db):
    connection, db, clock = session_db
    issued = login(db)
    with db.begin():
        cached_owner = db.get(Account, 1)
        cached_record = db.get(AuthSession, issued.identity.session_id)
    # Hold strong references so the ORM identity map really contains them.
    assert cached_owner.is_active and cached_record.revoked_at is None
    connection.execute(AuthSession.__table__.update().values(revoked_at=clock["now"]))
    with pytest.raises(sessions.InvalidSessionError):
        sessions.authenticate_session(db, issued.token, client_type="native")


@pytest.mark.parametrize("operation", ["login", "authenticate", "logout"])
def test_service_refuses_to_commit_unrelated_pending_work(session_db, operation):
    _, db, _ = session_db
    with db.begin():
        owner = db.get(Account, 1)
        owner.username = "pending-change"
        with pytest.raises(sessions.SessionStorageError, match="fresh database session"):
            if operation == "login":
                login(db)
            elif operation == "authenticate":
                sessions.authenticate_session(db, "A" * 43, client_type="native")
            else:
                sessions.revoke_session(db, "A" * 43, client_type="native")
        assert db.in_transaction() and owner in db.dirty
        db.expire(owner)


@pytest.mark.parametrize("client_type", [None, "", "browser", "WEB", True])
def test_unsupported_client_type_is_a_programming_error(session_db, client_type):
    _, db, _ = session_db
    with pytest.raises(ValueError, match="Client type must be web or native"):
        login(db, client_type)
    assert db.in_transaction() is False


def test_non_boolean_csrf_switch_is_rejected(session_db):
    _, db, _ = session_db
    with pytest.raises(ValueError, match="require_csrf must be a boolean"):
        sessions.authenticate_session(db, "A" * 43, client_type="web", require_csrf="false")


def test_insert_failure_does_not_return_a_token_or_save_a_session(session_db, monkeypatch):
    connection, db, _ = session_db
    def failed_flush():
        raise IntegrityError("sensitive SQL", {"token": "private-test-data"}, Exception("secret details"))
    monkeypatch.setattr(db, "flush", failed_flush)
    with pytest.raises(sessions.SessionStorageError) as error:
        login(db)
    assert "sensitive" not in str(error.value) and "private" not in str(error.value)
    assert error.value.__suppress_context__
    assert stored_sessions(connection) == []
    assert db.in_transaction() is False


def test_lost_commit_confirmation_is_not_retried_or_reported_as_success(session_db, monkeypatch):
    connection, db, _ = session_db
    original_begin = db.begin
    calls = []
    @contextmanager
    def uncertain_begin():
        calls.append(1)
        with original_begin():
            yield
        raise OperationalError("sensitive SQL", {}, Exception("connection lost"))
    monkeypatch.setattr(db, "begin", uncertain_begin)
    with pytest.raises(sessions.SessionStorageError) as error:
        login(db)
    assert str(error.value) == "The session operation was not confirmed. Check server state before retrying."
    assert calls == [1]
    # The private savepoint did commit, demonstrating why the error must not
    # promise that nothing was saved. The parent test transaction rolls back.
    assert len(stored_sessions(connection)) == 1


def test_random_generation_failure_does_not_create_a_session(session_db, monkeypatch):
    connection, db, _ = session_db
    def unavailable():
        raise RuntimeError("Random generator unavailable")
    monkeypatch.setattr(sessions, "generate_token", unavailable)
    with pytest.raises(RuntimeError, match="Random generator unavailable"):
        login(db)
    assert stored_sessions(connection) == []


def test_hash_verification_failure_propagates_without_authorizing(session_db, monkeypatch):
    connection, db, _ = session_db
    def unavailable(password, stored_hash):
        raise RuntimeError("Password verifier unavailable")
    monkeypatch.setattr(sessions, "verify_and_update_password", unavailable)
    with pytest.raises(RuntimeError, match="Password verifier unavailable"):
        login(db)
    assert stored_sessions(connection) == []
