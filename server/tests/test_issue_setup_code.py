"""Check local setup-code display and rotation without changing real data."""

from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
import re
import subprocess
import sys

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import database, issue_setup_code
from app.models import Account
from app.services import owner_setup
from test_owner_setup import setup_service_db
from test_owner_setup_code_model import saved_code, setup_db


DEMO_CODE = "a" * 43


@pytest.fixture
def mocked_command(monkeypatch):
    state = {"sessions": [], "calls": []}
    class FakeSession:
        def __enter__(self):
            state["sessions"].append("open")
            return self
        def __exit__(self, *args):
            state["sessions"].append("close")
    def issue(db, *, rotate=False):
        state["calls"].append(rotate)
        return owner_setup.IssuedSetupCode(
            code=DEMO_CODE, expires_at=datetime(2026, 11, 3, 18, 30, tzinfo=UTC),
        )
    monkeypatch.setattr(issue_setup_code, "_has_private_terminal", lambda: True)
    monkeypatch.setattr(database, "SessionLocal", FakeSession)
    monkeypatch.setattr(owner_setup, "issue_setup_code", issue)
    return state


def test_help_needs_no_database_or_terminal(mocked_command, monkeypatch, capsys):
    monkeypatch.setattr(issue_setup_code, "_has_private_terminal", lambda: False)
    with pytest.raises(SystemExit) as result:
        issue_setup_code.main(["--help"])
    assert result.value.code == 0
    assert "--rotate" in capsys.readouterr().out
    assert mocked_command["calls"] == []
    assert mocked_command["sessions"] == []


def test_help_works_in_a_separate_process_without_backend_imports():
    result = subprocess.run(
        [sys.executable, str(Path(issue_setup_code.__file__).resolve()), "--help"],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0
    assert "--rotate" in result.stdout
    assert result.stderr == ""


@pytest.mark.parametrize("arguments", [["--code", DEMO_CODE], ["--password", DEMO_CODE], ["--rot"]])
def test_unknown_or_abbreviated_arguments_are_rejected_without_echoing_secrets(mocked_command, capsys, arguments):
    with pytest.raises(SystemExit) as result:
        issue_setup_code.main(arguments)
    assert result.value.code == 2
    output = capsys.readouterr()
    assert DEMO_CODE not in output.out + output.err
    assert "Only --help and --rotate" in output.err
    assert mocked_command["calls"] == []


def test_redirected_output_is_refused_before_database_access(mocked_command, monkeypatch, capsys):
    monkeypatch.setattr(issue_setup_code, "_has_private_terminal", lambda: False)
    assert issue_setup_code.main([]) == 1
    output = capsys.readouterr()
    assert "interactive server terminal" in output.err
    assert DEMO_CODE not in output.out + output.err
    assert mocked_command["sessions"] == []


@pytest.mark.parametrize("arguments,rotate", [([], False), (["--rotate"], True)])
def test_success_displays_code_once_after_the_session_closes(mocked_command, capsys, arguments, rotate):
    assert issue_setup_code.main(arguments) == 0
    assert mocked_command["calls"] == [rotate]
    assert mocked_command["sessions"] == ["open", "close"]
    output = capsys.readouterr()
    assert output.out.count(DEMO_CODE) == 1
    assert "2026-11-03 18:30:00 UTC" in output.out
    assert "Keep this code private" in output.out
    assert sha256(DEMO_CODE.encode("ascii")).hexdigest() not in output.out
    assert output.err == ""


@pytest.mark.parametrize("error", [
    owner_setup.SetupCodeAlreadyIssuedError("An unused code is already active."),
    owner_setup.OwnerSetupClosedError("Owner setup is closed."),
    owner_setup.OwnerSetupStorageError("Setup was not confirmed."),
])
def test_service_rejections_display_no_code_and_do_not_retry(mocked_command, monkeypatch, capsys, error):
    calls = []
    def rejected(*args, **kwargs):
        calls.append(True)
        raise error
    monkeypatch.setattr(owner_setup, "issue_setup_code", rejected)
    assert issue_setup_code.main([]) == 1
    assert len(calls) == 1
    output = capsys.readouterr()
    assert str(error) in output.err
    assert DEMO_CODE not in output.out + output.err


def test_configuration_failure_does_not_expose_internal_information(mocked_command, monkeypatch, capsys):
    original_import = __import__
    def broken_import(name, *args, **kwargs):
        if name == "app.database":
            raise RuntimeError(f"private config: {DEMO_CODE}")
        return original_import(name, *args, **kwargs)
    monkeypatch.setattr("builtins.__import__", broken_import)
    assert issue_setup_code.main([]) == 1
    output = capsys.readouterr()
    assert "Could not load backend configuration" in output.err
    assert DEMO_CODE not in output.out + output.err


def test_connection_failure_has_a_safe_message(mocked_command, monkeypatch, capsys):
    def unavailable():
        raise RuntimeError(f"private connection: {DEMO_CODE}")
    monkeypatch.setattr(database, "SessionLocal", unavailable)
    assert issue_setup_code.main([]) == 1
    output = capsys.readouterr()
    assert "not confirmed" in output.err
    assert DEMO_CODE not in output.out + output.err


def test_unexpected_service_error_does_not_print_a_traceback_or_secret(mocked_command, monkeypatch, capsys):
    calls = []
    def failed(*args, **kwargs):
        calls.append(True)
        raise RuntimeError(f"private error: {DEMO_CODE}")
    monkeypatch.setattr(owner_setup, "issue_setup_code", failed)
    assert issue_setup_code.main(["--rotate"]) == 1
    assert len(calls) == 1
    output = capsys.readouterr()
    assert DEMO_CODE not in output.out + output.err
    assert "Traceback" not in output.out + output.err


def test_interruption_during_issuance_reports_uncertainty(mocked_command, monkeypatch, capsys):
    calls = []
    def interrupted(*args, **kwargs):
        calls.append(True)
        raise KeyboardInterrupt
    monkeypatch.setattr(owner_setup, "issue_setup_code", interrupted)
    assert issue_setup_code.main([]) == 130
    assert len(calls) == 1
    output = capsys.readouterr()
    assert "not confirmed" in output.err
    assert DEMO_CODE not in output.out + output.err


@pytest.mark.parametrize("error,exit_code", [(OSError("display failed"), 1), (KeyboardInterrupt(), 130)])
def test_display_failure_does_not_repeat_or_rotate_an_issued_code(mocked_command, monkeypatch, capsys, error, exit_code):
    original_print = print
    def failed_print(*args, **kwargs):
        if args and args[0] == DEMO_CODE:
            raise error
        return original_print(*args, **kwargs)
    monkeypatch.setattr("builtins.print", failed_print)
    assert issue_setup_code.main([]) == exit_code
    assert mocked_command["calls"] == [False]
    output = capsys.readouterr()
    assert "--rotate" in output.err
    assert DEMO_CODE not in output.out + output.err


@pytest.fixture
def postgres_command(setup_service_db, monkeypatch):
    connection, _ = setup_service_db
    def sessions():
        return Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
    monkeypatch.setattr(database, "SessionLocal", sessions)
    monkeypatch.setattr(issue_setup_code, "_has_private_terminal", lambda: True)
    return connection


def test_postgres_command_issues_once_and_explicit_rotation_replaces_it(postgres_command, capsys):
    assert issue_setup_code.main([]) == 0
    first_output = capsys.readouterr()
    first_code = first_output.out.splitlines()[1]
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", first_code)
    first_row = saved_code(postgres_command)
    assert first_row["code_hash"] == sha256(first_code.encode("ascii")).hexdigest()
    assert issue_setup_code.main([]) == 1
    repeated_output = capsys.readouterr()
    assert "already active" in repeated_output.err
    assert repeated_output.out == ""
    assert saved_code(postgres_command) == first_row
    assert issue_setup_code.main(["--rotate"]) == 0
    second_code = capsys.readouterr().out.splitlines()[1]
    assert second_code != first_code
    assert saved_code(postgres_command)["code_hash"] == sha256(second_code.encode("ascii")).hexdigest()


@pytest.mark.parametrize("active", [True, False])
def test_postgres_command_cannot_issue_a_code_after_owner_creation(postgres_command, capsys, active):
    postgres_command.execute(Account.__table__.insert().values(
        username="existing-owner", password_hash="test-only-placeholder", is_active=active,
    ))
    before = dict(postgres_command.execute(select(Account.__table__)).mappings().one())
    assert issue_setup_code.main(["--rotate"]) == 1
    output = capsys.readouterr()
    assert "setup is closed" in output.err
    assert output.out == ""
    assert dict(postgres_command.execute(select(Account.__table__)).mappings().one()) == before
