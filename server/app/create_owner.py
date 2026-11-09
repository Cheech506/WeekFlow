"""Create WeekFlow's owner from a trusted, interactive server terminal.

Run from server/: python -m app.create_owner
Credentials are prompted for; password arguments and piped input are refused.
"""

import argparse
from collections.abc import Sequence
import getpass
import sys
import warnings


class _SafeArgumentParser(argparse.ArgumentParser):
    """Never echo unknown arguments that might accidentally contain a secret."""

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(
            2,
            "This command accepts only --help. Run without arguments to enter "
            "credentials interactively; never put a password on the command line.\n",
        )


def _has_interactive_terminal() -> bool:
    return bool(
        sys.stdin is not None
        and sys.stderr is not None
        and sys.stdin.isatty()
        and sys.stderr.isatty()
    )


def _hidden_password(prompt: str) -> str:
    # getpass normally warns and falls back to echoed input when hiding is
    # unavailable. Turn that warning into an error before it reads a password.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass(prompt)


def _error(message: str) -> None:
    print(message, file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _SafeArgumentParser(
        prog="python -m app.create_owner",
        description="Create the single WeekFlow owner using hidden password prompts.",
        epilog="Run on the server after applying migrations. Existing owners are never replaced.",
        allow_abbrev=False,
    )
    parser.parse_args(argv)

    if not _has_interactive_terminal():
        _error(
            "Use an interactive server terminal with hidden password input. "
            "Piped or redirected setup input is not supported."
        )
        return 1

    # Keep --help independent of database configuration and optional packages.
    try:
        from sqlalchemy import select
        from app.database import SessionLocal
        from app.models import Account
        from app.services.accounts import (
            AccountSetupError,
            AccountValidationError,
            OwnerAlreadyExistsError,
            create_owner_account,
            normalize_username,
        )
        from app.services.passwords import (
            MAX_PASSWORD_LENGTH,
            MIN_PASSWORD_LENGTH,
            PasswordValidationError,
        )
    except Exception:
        _error("Could not load backend configuration. Check server/.env and installed requirements.")
        return 1

    # Finish this read-only transaction before waiting for human input.
    # The service repeats the check when it inserts, protecting against races.
    try:
        with SessionLocal() as db:
            existing_owner = db.scalar(select(Account.id).limit(1))
    except KeyboardInterrupt:
        _error("Owner check cancelled.")
        return 130
    except Exception:
        _error("Could not check owner status. Check PostgreSQL and apply the database migrations.")
        return 1

    if existing_owner is not None:
        _error("An owner account already exists. Setup will not replace or reactivate it.")
        return 1

    try:
        username = normalize_username(input("Username: "))
        print(f"Owner username: {username}")
        print(f"Choose a {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} character password.")
        print("Password input is hidden; no characters will appear while you type.")
        password = _hidden_password("Password: ")
        confirmation = _hidden_password("Confirm password: ")
    except AccountValidationError as error:
        _error(str(error))
        return 1
    except getpass.GetPassWarning:
        _error("Password input could not be hidden. Setup stopped; use an interactive terminal.")
        return 1
    except EOFError:
        _error("Input ended before setup completed.")
        return 1
    except KeyboardInterrupt:
        _error("Setup cancelled.")
        return 130
    except Exception:
        _error("Could not read credentials securely. Setup stopped.")
        return 1

    if password != confirmation:
        _error("Passwords did not match. No account was created.")
        return 1

    try:
        with SessionLocal() as db:
            result = create_owner_account(db, username, password)
    except (AccountValidationError, PasswordValidationError, OwnerAlreadyExistsError) as error:
        _error(str(error))
        return 1
    except AccountSetupError as error:
        _error(str(error))
        return 1
    except KeyboardInterrupt:
        # Interruption during commit does not establish whether it succeeded.
        _error("Setup was interrupted; creation was not confirmed. Re-running will not replace an existing owner.")
        return 130
    except Exception:
        # Never print SQL, connection parameters, hashes, or a credential-bearing
        # traceback. An uncertain write must not be automatically repeated.
        _error("Owner creation was not confirmed. Check the server; re-running will not replace an existing owner.")
        return 1

    print(f"Owner account '{result.username}' created.")
    print("Account setup is complete. API login and access checks must be connected separately.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
