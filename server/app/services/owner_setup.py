"""Local setup-code issuance and atomic first-run owner creation.

Only a trusted server command/startup process may call issue_setup_code.
The browser endpoint will call create_owner_with_setup_code instead.
This module does not expose HTTP routes or create login sessions.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from hashlib import sha256
from math import ceil
import re
import secrets

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Account, OwnerSetupCode
from app.services.accounts import CreatedOwner, normalize_username
from app.services.passwords import hash_password


SETUP_CODE_LIFETIME = timedelta(minutes=30)
SETUP_BLOCK_DURATION = timedelta(minutes=5)
SETUP_MAX_FAILED_ATTEMPTS = 5
_CODE_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}", flags=re.ASCII)


class OwnerSetupError(RuntimeError):
    """A safe, credential-free owner-setup failure."""


class OwnerSetupClosedError(OwnerSetupError):
    """Setup is permanently closed for an existing owner or consumed code."""


class SetupCodeAlreadyIssuedError(OwnerSetupError):
    """A live code exists; only explicit local rotation may replace it."""


class InvalidSetupCodeError(OwnerSetupError):
    """The supplied code is invalid, expired, missing, or unavailable."""


class SetupCodeBlockedError(OwnerSetupError):
    """Setup-code attempts are temporarily blocked across all workers."""

    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = max(1, retry_after_seconds)
        super().__init__("Owner setup is temporarily blocked. Try again later.")


class OwnerSetupStorageError(OwnerSetupError):
    """The database operation was refused or its outcome was not confirmed."""


@dataclass(frozen=True)
class IssuedSetupCode:
    """Secret result for the local operator only; never serialize to an API."""

    code: str = field(repr=False)
    expires_at: datetime


@dataclass(frozen=True)
class OwnerSetupStatus:
    """Safe information for choosing setup versus login in the frontend."""

    owner_exists: bool
    setup_ready: bool


def _require_fresh_session(db: Session) -> None:
    if db.in_transaction():
        raise OwnerSetupStorageError("Owner setup requires a fresh database session.")


def _database_now(db: Session) -> datetime:
    # PostgreSQL now() is fixed at transaction start. clock_timestamp() sees
    # real elapsed time, including time spent waiting for locks or hashing.
    return db.scalar(select(func.clock_timestamp()))


def _owner_exists(db: Session) -> bool:
    return db.scalar(select(Account.id).limit(1)) is not None


def _lock_setup_writes(db: Session) -> None:
    # Lock accounts first in every setup write workflow. This serializes code
    # issuance even when the singleton code row does not exist yet, and also
    # conflicts with a simultaneous terminal account INSERT. Ordinary reads
    # remain possible. Bound waits rather than hanging a browser indefinitely.
    db.execute(text("SET LOCAL lock_timeout = '5s'"))
    db.execute(text("LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE"))


def _locked_code(db: Session) -> OwnerSetupCode | None:
    return db.scalar(select(OwnerSetupCode).where(
        OwnerSetupCode.id == 1
    ).with_for_update().execution_options(populate_existing=True))


def _code_digest(code: object) -> str | None:
    if not isinstance(code, str) or _CODE_PATTERN.fullmatch(code) is None:
        return None
    return sha256(code.encode("ascii")).hexdigest()


def _closed() -> OwnerSetupClosedError:
    return OwnerSetupClosedError("Owner setup is closed. Use login or local administrator recovery.")


def _invalid() -> InvalidSetupCodeError:
    return InvalidSetupCodeError("The setup code is invalid, expired, or unavailable.")


def _storage_error() -> OwnerSetupStorageError:
    # A lost commit response is uncertain. Do not claim that nothing was saved,
    # repeat a write automatically, or expose SQL parameters/hash values.
    return OwnerSetupStorageError(
        "Owner setup was not confirmed. Check the server state before retrying."
    )


def issue_setup_code(db: Session, *, rotate: bool = False) -> IssuedSetupCode:
    """Issue a 30-minute random code through a trusted local operation.

    A live code survives restarts. This method will not silently replace it;
    the operator must explicitly request rotation if its raw value was lost.
    Expired codes may be replaced, but consumed setup is never reopened.
    """

    _require_fresh_session(db)
    if not isinstance(rotate, bool):
        raise ValueError("rotate must be a boolean.")
    try:
        with db.begin():
            _lock_setup_writes(db)
            if _owner_exists(db):
                raise _closed()
            record = _locked_code(db)
            now = _database_now(db)
            if record is not None:
                if record.consumed_at is not None:
                    raise _closed()
                if record.expires_at > now and not rotate:
                    raise SetupCodeAlreadyIssuedError(
                        "An unused setup code is already active. Use explicit local rotation to replace it."
                    )

            raw_code = secrets.token_urlsafe(32)
            digest = sha256(raw_code.encode("ascii")).hexdigest()
            expires = now + SETUP_CODE_LIFETIME
            if record is None:
                record = OwnerSetupCode(id=1, code_hash=digest, created_at=now, expires_at=expires)
                db.add(record)
            else:
                record.code_hash = digest
                record.created_at = now
                record.expires_at = expires
                record.consumed_at = None
            record.failed_attempts = 0
            record.blocked_until = None
            db.flush()
            issued = IssuedSetupCode(code=raw_code, expires_at=expires)
        return issued
    except SQLAlchemyError:
        raise _storage_error() from None


def get_owner_setup_status(db: Session) -> OwnerSetupStatus:
    """Read a non-secret setup status; creation always rechecks under locks."""

    _require_fresh_session(db)
    try:
        with db.begin():
            exists = _owner_exists(db)
            if exists:
                return OwnerSetupStatus(owner_exists=True, setup_ready=False)
            record = db.get(OwnerSetupCode, 1, populate_existing=True)
            now = _database_now(db)
            ready = (
                record is not None
                and record.consumed_at is None
                and record.expires_at > now
                and (record.blocked_until is None or record.blocked_until <= now)
            )
            return OwnerSetupStatus(owner_exists=False, setup_ready=ready)
    except SQLAlchemyError:
        raise _storage_error() from None


def create_owner_with_setup_code(
    db: Session,
    setup_code: str,
    username: str,
    password: str,
) -> CreatedOwner:
    """Validate setup and commit owner creation plus consumption atomically.

    Wrong-code counters commit before their rejection is raised. Validation
    or storage failures during a valid-code setup roll back both the owner
    INSERT and code consumption. The caller must not automatically retry.
    """

    _require_fresh_session(db)
    supplied_digest = _code_digest(setup_code)
    rejection: OwnerSetupError | None = None
    result: CreatedOwner | None = None
    try:
        with db.begin():
            _lock_setup_writes(db)
            if _owner_exists(db):
                raise _closed()
            record = _locked_code(db)
            now = _database_now(db)
            if record is not None and record.consumed_at is not None:
                rejection = _closed()
            elif record is None or record.expires_at <= now:
                rejection = _invalid()
            elif record.blocked_until is not None and record.blocked_until > now:
                rejection = SetupCodeBlockedError(ceil((record.blocked_until - now).total_seconds()))
            elif supplied_digest is None or not secrets.compare_digest(supplied_digest, record.code_hash):
                if record.blocked_until is not None:
                    # The prior block has ended. Start a new attempt window.
                    record.failed_attempts = 0
                    record.blocked_until = None
                record.failed_attempts += 1
                if record.failed_attempts >= SETUP_MAX_FAILED_ATTEMPTS:
                    record.blocked_until = now + SETUP_BLOCK_DURATION
                    rejection = SetupCodeBlockedError(int(SETUP_BLOCK_DURATION.total_seconds()))
                else:
                    rejection = _invalid()
            else:
                normalized_username = normalize_username(username)
                # Do expensive password work only after the setup code passes.
                stored_hash = hash_password(password)
                completed_at = _database_now(db)
                if completed_at >= record.expires_at:
                    rejection = _invalid()
                else:
                    db.add(Account(
                        id=1, username=normalized_username,
                        password_hash=stored_hash, is_active=True,
                    ))
                    record.consumed_at = completed_at
                    record.failed_attempts = 0
                    record.blocked_until = None
                    db.flush()
                    result = CreatedOwner(id=1, username=normalized_username)

        # Raising inside db.begin() would roll back failed-attempt counters.
        if rejection is not None:
            raise rejection
        if result is None:
            raise _storage_error()
        return result
    except IntegrityError as error:
        diagnostic = getattr(error.orig, "diag", None)
        if getattr(error.orig, "sqlstate", None) == "23505" and getattr(
            diagnostic, "constraint_name", None
        ) in {"accounts_pkey", "uq_accounts_username"}:
            raise _closed() from None
        raise _storage_error() from None
    except SQLAlchemyError:
        raise _storage_error() from None
