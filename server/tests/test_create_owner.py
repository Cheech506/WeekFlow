"""Check secure local prompts and owner creation without touching real data."""

from contextlib import contextmanager
import getpass
from pathlib import Path
import subprocess
import sys
import warnings

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app import create_owner, database
from app.models import Account, AuthSession
from app.services import accounts
from app.services.passwords import PasswordValidationError, verify_password
from test_auth_models import add_account, migrated_auth


DEMO_PASSWORD = "a temporary owner test passphrase"


@pytest.fixture
def mocked_cli(monkeypatch):
    state = {"sessions": [], "writes": [], "existing": None}
    class FakeSession:
        def __enter__(self):
            state["sessions"].append("open")
            return self
        def __exit__(self, *args):
            state["sessions"].append("close")
        def scalar(self, statement):
            return state["existing"]
    def create(db, username, password):
        state["writes"].append((username, password))
        return accounts.CreatedOwner(id=1, username=username)
    monkeypatch.setattr(create_owner, "_has_interactive_terminal", lambda: True)
    monkeypatch.setattr(database, "SessionLocal", FakeSession)
    monkeypatch.setattr(accounts, "create_owner_account", create)
    monkeypatch.setattr("builtins.input", lambda prompt: " COREY ")
    monkeypatch.setattr(getpass, "getpass", lambda prompt: DEMO_PASSWORD)
    return state


def test_help_exits_without_checking_database_or_prompting(mocked_cli, capsys):
    with pytest.raises(SystemExit) as exit_result:
        create_owner.main(["--help"])
    assert exit_result.value.code == 0
    assert "hidden password prompts" in capsys.readouterr().out
    assert mocked_cli["sessions"] == []
    assert mocked_cli["writes"] == []


def test_help_works_in_a_separate_process_without_backend_imports():
    # Launching the module's file directly gives the child only app/ or the
    # staged file's directory as its import root. --help must need no backend.
    result = subprocess.run(
        [sys.executable, str(Path(create_owner.__file__).resolve()), "--help"],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0
    assert "hidden password prompts" in result.stdout
    assert result.stderr == ""


def test_unknown_arguments_do_not_echo_a_supplied_secret(mocked_cli, capsys):
    with pytest.raises(SystemExit) as exit_result:
        create_owner.main(["--password", DEMO_PASSWORD])
    assert exit_result.value.code == 2
    output = capsys.readouterr()
    assert DEMO_PASSWORD not in output.out + output.err
    assert "never put a password on the command line" in output.err
    assert mocked_cli["writes"] == []


def test_noninteractive_input_is_refused_before_database_access(mocked_cli, monkeypatch, capsys):
    monkeypatch.setattr(create_owner, "_has_interactive_terminal", lambda: False)
    assert create_owner.main([]) == 1
    assert "interactive server terminal" in capsys.readouterr().err
    assert mocked_cli["sessions"] == []


def test_success_uses_two_separate_sessions_and_never_prints_the_password(mocked_cli, capsys):
    assert create_owner.main([]) == 0
    assert mocked_cli["writes"] == [("corey", DEMO_PASSWORD)]
    assert mocked_cli["sessions"] == ["open", "close", "open", "close"]
    output = capsys.readouterr()
    assert "Owner account 'corey' created." in output.out
    assert DEMO_PASSWORD not in output.out + output.err


def test_existing_owner_stops_before_asking_for_credentials(mocked_cli, monkeypatch, capsys):
    mocked_cli["existing"] = 1
    monkeypatch.setattr("builtins.input", lambda prompt: pytest.fail("Must not ask for credentials"))
    assert create_owner.main([]) == 1
    assert "already exists" in capsys.readouterr().err
    assert mocked_cli["writes"] == []


def test_database_status_failure_has_a_safe_message(mocked_cli, monkeypatch, capsys):
    def unavailable():
        raise OperationalError("private SQL", {"secret": DEMO_PASSWORD}, RuntimeError("offline"))
    monkeypatch.setattr(database, "SessionLocal", unavailable)
    assert create_owner.main([]) == 1
    output = capsys.readouterr()
    assert "Could not check owner status" in output.err
    assert DEMO_PASSWORD not in output.out + output.err
    assert "private SQL" not in output.out + output.err


def test_invalid_username_stops_before_password_entry(mocked_cli, monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt: "bad username")
    monkeypatch.setattr(getpass, "getpass", lambda prompt: pytest.fail("Must not ask for a password"))
    assert create_owner.main([]) == 1
    assert "Username must" in capsys.readouterr().err
    assert mocked_cli["writes"] == []


def test_password_confirmation_must_match_exactly(mocked_cli, monkeypatch, capsys):
    entries = iter([DEMO_PASSWORD, DEMO_PASSWORD + " "])
    monkeypatch.setattr(getpass, "getpass", lambda prompt: next(entries))
    assert create_owner.main([]) == 1
    assert "Passwords did not match" in capsys.readouterr().err
    assert mocked_cli["writes"] == []


def test_no_echo_warning_stops_instead_of_reading_an_exposed_password(mocked_cli, monkeypatch, capsys):
    calls = []
    def no_hidden_input(prompt):
        calls.append(prompt)
        warnings.warn("Input could be echoed", getpass.GetPassWarning)
        pytest.fail("Must stop before fallback input")
    monkeypatch.setattr(getpass, "getpass", no_hidden_input)
    assert create_owner.main([]) == 1
    assert "could not be hidden" in capsys.readouterr().err
    assert len(calls) == 1
    assert mocked_cli["writes"] == []


@pytest.mark.parametrize("stage", ["username", "password"])
def test_ended_input_does_not_create_an_account(mocked_cli, monkeypatch, capsys, stage):
    def ended(prompt):
        raise EOFError
    monkeypatch.setattr("builtins.input" if stage == "username" else "getpass.getpass", ended)
    assert create_owner.main([]) == 1
    assert "Input ended" in capsys.readouterr().err
    assert mocked_cli["writes"] == []


@pytest.mark.parametrize("stage", ["status", "username", "password", "write"])
def test_interruptions_have_no_traceback_or_automatic_retry(mocked_cli, monkeypatch, capsys, stage):
    calls = []
    def interrupted(*args, **kwargs):
        calls.append(True)
        raise KeyboardInterrupt
    if stage == "status":
        monkeypatch.setattr(database, "SessionLocal", interrupted)
    elif stage == "username":
        monkeypatch.setattr("builtins.input", interrupted)
    elif stage == "password":
        monkeypatch.setattr(getpass, "getpass", interrupted)
    else:
        monkeypatch.setattr(accounts, "create_owner_account", interrupted)
    assert create_owner.main([]) == 130
    assert len(calls) == 1
    output = capsys.readouterr()
    assert "Traceback" not in output.out + output.err
    assert "created." not in output.out
    if stage == "write":
        assert "not confirmed" in output.err


@pytest.mark.parametrize("error", [
    accounts.OwnerAlreadyExistsError("An owner already exists."),
    accounts.AccountValidationError("Invalid username."),
    PasswordValidationError("Password too short."),
    accounts.AccountSetupError("Owner creation was not confirmed."),
])
def test_service_rejections_are_reported_without_success(mocked_cli, monkeypatch, capsys, error):
    def rejected(*args):
        raise error
    monkeypatch.setattr(accounts, "create_owner_account", rejected)
    assert create_owner.main([]) == 1
    output = capsys.readouterr()
    assert str(error) in output.err
    assert "created." not in output.out


def test_unexpected_write_error_does_not_leak_credentials(mocked_cli, monkeypatch, capsys):
    calls = []
    def failed(*args):
        calls.append(True)
        raise RuntimeError(f"internal information: {DEMO_PASSWORD}")
    monkeypatch.setattr(accounts, "create_owner_account", failed)
    assert create_owner.main([]) == 1
    assert len(calls) == 1
    output = capsys.readouterr()
    assert "not confirmed" in output.err
    assert DEMO_PASSWORD not in output.out + output.err


@pytest.fixture
def postgres_cli(migrated_auth, monkeypatch):
    connection, _ = migrated_auth
    def sessions():
        return Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
    monkeypatch.setattr(database, "SessionLocal", sessions)
    monkeypatch.setattr(create_owner, "_has_interactive_terminal", lambda: True)
    monkeypatch.setattr("builtins.input", lambda prompt: " COREY ")
    monkeypatch.setattr(getpass, "getpass", lambda prompt: DEMO_PASSWORD)
    return connection


def test_postgres_command_creates_only_an_owner_hash_and_refuses_a_repeat(postgres_cli, capsys):
    connection = postgres_cli
    assert create_owner.main([]) == 0
    before = dict(connection.execute(select(Account.__table__)).mappings().one())
    assert before["username"] == "corey"
    assert verify_password(DEMO_PASSWORD, before["password_hash"]) is True
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 0
    assert create_owner.main([]) == 1
    assert dict(connection.execute(select(Account.__table__)).mappings().one()) == before
    output = capsys.readouterr()
    assert DEMO_PASSWORD not in output.out + output.err
    assert before["password_hash"] not in output.out + output.err


def test_postgres_command_refuses_a_disabled_existing_owner(postgres_cli, capsys):
    before = add_account(postgres_cli, is_active=False)
    assert create_owner.main([]) == 1
    assert dict(postgres_cli.execute(select(Account.__table__)).mappings().one()) == before
    assert "already exists" in capsys.readouterr().err
