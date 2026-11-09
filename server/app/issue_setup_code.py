"""Display a first-run setup code only in a trusted local terminal.

Run from server/: python -m app.issue_setup_code
Use --rotate to explicitly replace a still-active code whose raw value is lost.
"""

import argparse
from collections.abc import Sequence
from datetime import UTC
import sys


class _SafeArgumentParser(argparse.ArgumentParser):
    """Reject unsupported arguments without echoing possible secrets."""

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        self.exit(
            2,
            "Only --help and --rotate are supported. "
            "Do not supply passwords or setup codes as command arguments.\n",
        )


def _has_private_terminal() -> bool:
    # This is protection against accidental redirection, not proof that a
    # terminal is private. Access to the server shell remains an admin boundary.
    return bool(
        sys.stdout is not None
        and sys.stderr is not None
        and sys.stdout.isatty()
        and sys.stderr.isatty()
    )


def _error(message: str) -> None:
    print(message, file=sys.stderr)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _SafeArgumentParser(
        prog="python -m app.issue_setup_code",
        description="Issue a one-time owner setup code in an interactive server terminal.",
        epilog="Existing owners are never replaced. Active codes require explicit rotation.",
        allow_abbrev=False,
    )
    parser.add_argument(
        "--rotate",
        action="store_true",
        help="replace an existing unused code, invalidating its previous value",
    )
    args = parser.parse_args(argv)

    if not _has_private_terminal():
        _error(
            "Use an interactive server terminal. Setup codes will not be "
            "printed to redirected output or logs."
        )
        return 1

    # Help and argument validation need no database configuration or packages.
    try:
        from app.database import SessionLocal
        from app.services.owner_setup import OwnerSetupError, issue_setup_code
    except Exception:
        _error("Could not load backend configuration. Check server/.env and installed requirements.")
        return 1

    try:
        with SessionLocal() as db:
            issued = issue_setup_code(db, rotate=args.rotate)
        # Format metadata before revealing the credential, and only after
        # the service's transaction and session have successfully finished.
        expires = issued.expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    except OwnerSetupError as error:
        _error(str(error))
        return 1
    except KeyboardInterrupt:
        _error(
            "Issuance was interrupted and was not confirmed. "
            "Check server state before explicitly rotating a code."
        )
        return 130
    except Exception:
        _error(
            "Setup code issuance was not confirmed. Check PostgreSQL and "
            "database migrations before explicitly retrying."
        )
        return 1

    try:
        print("One-time WeekFlow owner setup code:")
        print(issued.code)
        print(f"Expires: {expires}")
        print("Keep this code private. Enter it only in your WeekFlow first-run setup page.")
    except KeyboardInterrupt:
        _error(
            "Display was interrupted after code issuance. "
            "If the code was lost, use --rotate from an interactive terminal."
        )
        return 130
    except OSError:
        _error(
            "The code was issued but could not be fully displayed. "
            "Use --rotate from an interactive terminal if its value was lost."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
