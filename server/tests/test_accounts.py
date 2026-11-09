"""Check safe local owner setup, using disposable PostgreSQL tables."""

from contextlib import contextmanager
from dataclasses import FrozenInstanceError, asdict

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.models import Account, AuthSession
from app.services import accounts
from app.services.passwords import PasswordValidationError, verify_password
from test_auth_models import add_account, add_session, migrated_auth


DEMO_PASSWORD = "a temporary owner test passphrase"


@pytest.fixture
def owner_db(migrated_auth):
    connection, _ = migrated_auth
    with Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    ) as session:
        yield connection, session


@pytest.mark.parametrize("supplied,expected", [
    ("corey", "corey"), (" COREY ", "corey"),
    ("Owner.Name_01", "owner.name_01"),
    ("owner-name", "owner-name"), ("a" * 64, "a" * 64),
])
def test_username_normalization(supplied, expected):
    assert accounts.normalize_username(supplied) == expected


@pytest.mark.parametrize("supplied", [
    None, False, 123, b"owner", "", "   ", "ab", "a" * 65,
    "owner name", "owner@host", ".owner", "owner/", "owner\nname",
    "\u212aorey", "caf\u00e9",
])
def test_invalid_usernames_are_rejected(supplied):
    with pytest.raises(accounts.AccountValidationError):
        accounts.normalize_username(supplied)


def test_validation_error_does_not_echo_invalid_input():
    supplied = "private-invalid-input@"
    with pytest.raises(accounts.AccountValidationError) as error:
        accounts.normalize_username(supplied)
    assert supplied not in str(error.value)


def test_creates_owner_with_a_real_hash_and_safe_result(owner_db):
    connection, db = owner_db
    result = accounts.create_owner_account(db, " COREY ", DEMO_PASSWORD)
    assert asdict(result) == {"id": 1, "username": "corey"}
    assert DEMO_PASSWORD not in repr(result)
    with pytest.raises(FrozenInstanceError):
        result.username = "changed"
    row = connection.execute(select(Account.__table__)).mappings().one()
    assert row["id"] == 1
    assert row["username"] == "corey"
    assert row["is_active"] is True
    assert row["password_hash"] != DEMO_PASSWORD
    assert verify_password(DEMO_PASSWORD, row["password_hash"]) is True
    assert verify_password("a different test passphrase", row["password_hash"]) is False
    for name in ("created_at", "updated_at", "password_changed_at"):
        assert row[name].utcoffset() is not None
    assert db.in_transaction() is False


def test_setup_does_not_create_a_login_session(owner_db):
    connection, db = owner_db
    accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 0


@pytest.mark.parametrize("active", [True, False])
def test_existing_owner_and_sessions_are_never_replaced(owner_db, active):
    connection, db = owner_db
    original = add_account(connection, is_active=active)
    login = add_session(connection)
    with pytest.raises(accounts.OwnerAlreadyExistsError):
        accounts.create_owner_account(db, "another-owner", DEMO_PASSWORD)
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == original
    assert dict(connection.execute(select(AuthSession.__table__)).mappings().one()) == login
    assert db.in_transaction() is False


def test_a_manual_repeat_refuses_to_replace_the_original_password(owner_db):
    connection, db = owner_db
    accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    before = dict(connection.execute(select(Account.__table__)).mappings().one())
    with pytest.raises(accounts.OwnerAlreadyExistsError):
        accounts.create_owner_account(db, "new-owner", "a new temporary test passphrase")
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == before


def test_singleton_constraint_handles_a_setup_race(owner_db, monkeypatch):
    connection, db = owner_db
    original = add_account(connection)
    # Simulate another setup winning after our empty-table observation.
    # The INSERT still executes against PostgreSQL and must hit its real PK.
    monkeypatch.setattr(db, "scalar", lambda statement: None)
    with pytest.raises(accounts.OwnerAlreadyExistsError):
        accounts.create_owner_account(db, "racing-owner", DEMO_PASSWORD)
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == original
    assert db.in_transaction() is False


@pytest.mark.parametrize("username,password,error_type", [
    ("bad username", DEMO_PASSWORD, accounts.AccountValidationError),
    ("owner", "short", PasswordValidationError),
    ("owner", "x" * 129, PasswordValidationError),
])
def test_invalid_credentials_do_not_write_an_account(owner_db, username, password, error_type):
    connection, db = owner_db
    with pytest.raises(error_type):
        accounts.create_owner_account(db, username, password)
    assert db.in_transaction() is False
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_setup_refuses_to_commit_an_existing_session_transaction(owner_db):
    connection, db = owner_db
    with db.begin():
        pending = Account(username="existing-work", password_hash="test-only-placeholder")
        db.add(pending)
        with pytest.raises(accounts.AccountSetupError, match="fresh database session"):
            accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
        assert pending in db.new
        assert db.in_transaction() is True
        db.expunge(pending)
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_hashing_failure_does_not_start_a_write(owner_db, monkeypatch):
    connection, db = owner_db
    def unavailable(password):
        raise RuntimeError("Hashing unavailable")
    monkeypatch.setattr(accounts, "hash_password", unavailable)
    with pytest.raises(RuntimeError, match="Hashing unavailable"):
        accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    assert db.in_transaction() is False
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_database_error_has_a_safe_message_and_no_automatic_retry(owner_db, monkeypatch):
    connection, db = owner_db
    calls = []
    def failed_read(statement):
        calls.append(statement)
        raise OperationalError("private SQL", {"secret": DEMO_PASSWORD}, RuntimeError("connection failure"))
    monkeypatch.setattr(db, "scalar", failed_read)
    with pytest.raises(accounts.AccountSetupError, match="not confirmed") as error:
        accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    assert len(calls) == 1
    assert DEMO_PASSWORD not in str(error.value)
    assert "private SQL" not in str(error.value)
    assert error.value.__suppress_context__ is True
    assert db.in_transaction() is False
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_unrelated_constraint_failure_is_not_misreported_as_an_existing_owner(owner_db, monkeypatch):
    connection, db = owner_db
    def failed_read(statement):
        raise IntegrityError("private SQL", {"secret": DEMO_PASSWORD}, RuntimeError("constraint failure"))
    monkeypatch.setattr(db, "scalar", failed_read)
    with pytest.raises(accounts.AccountSetupError, match="constraint failed") as error:
        accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    assert not isinstance(error.value, accounts.OwnerAlreadyExistsError)
    assert DEMO_PASSWORD not in str(error.value)
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_failure_after_insert_rolls_back_the_account(owner_db, monkeypatch):
    connection, db = owner_db
    original_flush = db.flush
    def failed_flush(*args, **kwargs):
        original_flush(*args, **kwargs)
        raise OperationalError("simulated failure after insert", {}, RuntimeError("lost connection"))
    monkeypatch.setattr(db, "flush", failed_flush)
    with pytest.raises(accounts.AccountSetupError, match="not confirmed"):
        accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    assert connection.scalar(select(func.count()).select_from(Account)) == 0
    assert db.in_transaction() is False


def test_lost_commit_confirmation_does_not_claim_nothing_was_saved(owner_db, monkeypatch):
    connection, db = owner_db
    real_begin = db.begin
    @contextmanager
    def lose_commit_response():
        with real_begin():
            yield
        # The savepoint is committed inside the test's outer transaction;
        # simulate losing confirmation afterward. No real data is committed.
        raise OperationalError("commit response lost", {}, RuntimeError("lost connection"))
    monkeypatch.setattr(db, "begin", lose_commit_response)
    with pytest.raises(accounts.AccountSetupError, match="not confirmed") as error:
        accounts.create_owner_account(db, "owner", DEMO_PASSWORD)
    assert "nothing was saved" not in str(error.value)
    before = dict(connection.execute(select(Account.__table__)).mappings().one())
    with pytest.raises(accounts.OwnerAlreadyExistsError):
        accounts.create_owner_account(db, "different-owner", "a different temporary passphrase")
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == before
