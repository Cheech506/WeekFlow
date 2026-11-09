"""Create the single owner account from a trusted local setup command."""

from dataclasses import dataclass
import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Account
from app.services.passwords import hash_password


_USERNAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_.-]{2,63}", flags=re.ASCII)


class AccountValidationError(ValueError):
    """The supplied account identity is not supported."""


class AccountSetupError(RuntimeError):
    """Account creation was refused or could not be confirmed."""


class OwnerAlreadyExistsError(AccountSetupError):
    """Setup must never replace an existing owner's credentials."""


@dataclass(frozen=True)
class CreatedOwner:
    """Safe setup result; deliberately excludes hashes and credentials."""

    id: int
    username: str


def normalize_username(username: str) -> str:
    """Produce the same canonical username for setup and future login."""

    if not isinstance(username, str):
        raise AccountValidationError("Username must be text.")

    # Only the username is normalized. Never normalize the password here.
    value = username.strip()
    if not value.isascii():
        raise AccountValidationError(
            "Username must use ASCII letters, numbers, dots, underscores, or hyphens."
        )
    value = value.lower()
    if _USERNAME_PATTERN.fullmatch(value) is None:
        raise AccountValidationError(
            "Username must be 3-64 characters, start with a letter or number, "
            "and contain only letters, numbers, dots, underscores, or hyphens."
        )
    return value


def _owner_exists_error() -> OwnerAlreadyExistsError:
    return OwnerAlreadyExistsError(
        "An owner account already exists. Setup will not replace or reactivate it."
    )


def create_owner_account(
    db: Session,
    username: str,
    password: str,
) -> CreatedOwner:
    """Hash credentials and create the owner in one dedicated transaction.

    Use a fresh Session. This function owns its commit/rollback and must not
    commit unrelated pending work from another workflow. Only a trusted local
    setup command should call it; it is not a public registration endpoint.
    """

    if db.in_transaction():
        raise AccountSetupError("Owner setup requires a fresh database session.")

    normalized_username = normalize_username(username)
    # Hash before starting the database transaction. Passwords never belong
    # in SQL parameters, logs, command arguments, or the returned result.
    stored_hash = hash_password(password)

    try:
        with db.begin():
            if db.scalar(select(Account.id).limit(1)) is not None:
                raise _owner_exists_error()

            db.add(Account(
                id=1,
                username=normalized_username,
                password_hash=stored_hash,
                is_active=True,
            ))
            db.flush()

        # Return only after the transaction has successfully committed.
        return CreatedOwner(id=1, username=normalized_username)

    except IntegrityError as error:
        # Two setup commands can both observe an empty table. The fixed
        # primary key still permits only one insert, without an upsert or
        # changing the winning owner's password. PostgreSQL is the arbiter.
        sqlstate = getattr(error.orig, "sqlstate", None)
        diagnostic = getattr(error.orig, "diag", None)
        constraint = getattr(diagnostic, "constraint_name", None)
        if sqlstate == "23505" and constraint in {
            "accounts_pkey",
            "uq_accounts_username",
        }:
            raise _owner_exists_error() from None
        raise AccountSetupError(
            "Owner creation was not confirmed because a database constraint failed."
        ) from None

    except SQLAlchemyError:
        # A lost response during commit can mean creation actually succeeded.
        # Do not claim that nothing was saved or automatically repeat a write.
        # A later manual attempt will refuse to replace an existing owner.
        raise AccountSetupError(
            "Owner creation was not confirmed. Check PostgreSQL and apply the "
            "database migrations if needed. A later setup attempt will not "
            "replace an existing owner."
        ) from None
