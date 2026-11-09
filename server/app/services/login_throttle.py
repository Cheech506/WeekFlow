"""Reserve shared login-attempt capacity before checking a password.

HTTP routes must call login_owner_with_limits, using the server's trusted
client address. Never let JSON, a query parameter, or an untrusted forwarded
header select the source address or counter key.
"""

from datetime import datetime, timedelta
from hashlib import sha256
from ipaddress import IPv6Address, ip_address
from math import ceil

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import AuthLoginThrottle
from app.services.sessions import ClientType, IssuedSession, login_owner


INSTANCE_ATTEMPT_LIMIT = 20
INSTANCE_WINDOW = timedelta(minutes=5)
SOURCE_ATTEMPT_LIMIT = 5
SOURCE_WINDOW = timedelta(minutes=1)


class LoginThrottleError(RuntimeError):
    """A safe login-limit failure without credentials or network addresses."""


class InvalidLoginSourceError(LoginThrottleError):
    """A trustworthy client address could not be established."""


class LoginRateLimitedError(LoginThrottleError):
    """The caller must wait before attempting another password check."""

    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = max(1, retry_after_seconds)
        super().__init__("Too many login attempts. Try again later.")


class LoginThrottleStorageError(LoginThrottleError):
    """Reservation was refused or its database outcome is uncertain."""


def _require_fresh_session(db: Session) -> None:
    if db.in_transaction():
        raise LoginThrottleStorageError("Login limiting requires a fresh database session.")


def _source_key(client_address: str) -> str:
    # Require one literal IP, not a hostname, URL, port, scoped address, or a
    # comma-separated forwarded-header list. No DNS lookup is performed.
    if (
        not isinstance(client_address, str) or not 1 <= len(client_address) <= 45
        or client_address != client_address.strip() or "%" in client_address
    ):
        raise InvalidLoginSourceError("The login source could not be verified.")
    try:
        address = ip_address(client_address)
    except ValueError:
        raise InvalidLoginSourceError("The login source could not be verified.") from None
    if isinstance(address, IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    canonical = str(address).encode("ascii")
    # This avoids storing the raw address, but is not anonymization: IPs can
    # be guessed. It is not a password hash or a credential.
    return "ip:" + sha256(b"weekflow:login-source:v1:" + canonical).hexdigest()


def _database_now(db: Session) -> datetime:
    # Unlike transaction-start now(), this accounts for real lock-wait time.
    return db.scalar(select(func.clock_timestamp()))


def _locked_counter(db: Session, key: str, duration: timedelta) -> AuthLoginThrottle:
    now = _database_now(db)
    # The primary key arbitrates simultaneous first attempts. Never reset an
    # existing counter as part of the insert-conflict handling.
    db.execute(insert(AuthLoginThrottle).values(
        bucket_key=key, window_started_at=now, window_ends_at=now + duration,
        attempt_count=0,
    ).on_conflict_do_nothing(index_elements=[AuthLoginThrottle.bucket_key]))
    record = db.scalar(
        select(AuthLoginThrottle).where(AuthLoginThrottle.bucket_key == key)
        .with_for_update().execution_options(populate_existing=True)
    )
    if record is None:
        raise LoginThrottleStorageError("The login counter could not be confirmed.")
    return record


def _wait_seconds(record: AuthLoginThrottle, now: datetime, limit: int) -> int:
    if now < record.window_started_at:
        # Do not silently reset restrictions if the database clock moves back.
        raise LoginThrottleStorageError("The login-counter clock could not be confirmed.")
    if now >= record.window_ends_at or record.attempt_count < limit:
        return 0
    return max(1, ceil((record.window_ends_at - now).total_seconds()))


def _reserve(record: AuthLoginThrottle, now: datetime, duration: timedelta) -> None:
    if now >= record.window_ends_at:
        record.window_started_at = now
        record.window_ends_at = now + duration
        record.attempt_count = 0
    record.attempt_count += 1


def reserve_login_attempt(db: Session, client_address: str) -> None:
    """Commit one reservation in both counters, or reject the attempt.

    Always lock installation first, then source. Both increments are atomic;
    a source rejection must not spend installation-wide capacity. Rejected
    requests do not keep moving the window's end time into the future.

    These are fixed windows, not an exact rolling-window request history.
    A boundary can allow a burst across two adjacent windows. Limits count
    all reservations, including correct passwords and abandoned requests.
    """
    _require_fresh_session(db)
    source_key = _source_key(client_address)
    try:
        with db.begin():
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            instance = _locked_counter(db, "instance", INSTANCE_WINDOW)
            now = _database_now(db)
            wait = _wait_seconds(instance, now, INSTANCE_ATTEMPT_LIMIT)
            if wait:
                # Do not allocate another source row once the installation
                # has exhausted capacity. This also bounds row creation.
                raise LoginRateLimitedError(wait)

            source = _locked_counter(db, source_key, SOURCE_WINDOW)
            # Refresh time after BOTH locks. A window might have elapsed
            # while waiting. Evaluate the installation counter again too.
            now = _database_now(db)
            wait = max(
                _wait_seconds(instance, now, INSTANCE_ATTEMPT_LIMIT),
                _wait_seconds(source, now, SOURCE_ATTEMPT_LIMIT),
            )
            if wait:
                raise LoginRateLimitedError(wait)
            _reserve(instance, now, INSTANCE_WINDOW)
            _reserve(source, now, SOURCE_WINDOW)
            db.flush()
        # Only return after COMMIT confirms the reserved capacity.
    except SQLAlchemyError:
        # Fail closed if PostgreSQL is unavailable. A lost COMMIT response
        # can mean capacity was already spent; do not automatically retry.
        raise LoginThrottleStorageError(
            "The login-limit operation was not confirmed. Check server state before retrying."
        ) from None


def login_owner_with_limits(
    db: Session,
    username: str,
    password: str,
    *,
    client_type: ClientType,
    client_address: str,
) -> IssuedSession:
    """The entry point for future HTTP login endpoints.

    Reservation commits before password verification starts. The login
    service then owns a separate transaction, using this now-fresh Session.
    A failed password, rollback, or lost login response cannot undo the
    reservation. A successful login does not reset shared request counters.

    Existing authenticated requests and logout do not use these login limits.
    This file does not implement HTTP routes, cookie handling, or proxy trust.
    """
    if client_type not in ("web", "native"):
        raise ValueError("Client type must be web or native.")
    reserve_login_attempt(db, client_address)
    return login_owner(db, username, password, client_type=client_type)
