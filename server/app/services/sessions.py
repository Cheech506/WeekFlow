"""Owner login, session checks, and logout using PostgreSQL.

These functions own their transactions and require a fresh database Session.
HTTP routes will handle HTTPS, cookies, bearer headers, browser origins,
safe response schemas, and login throttling before exposing this service.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import Account, AuthSession
from app.services.accounts import AccountValidationError, normalize_username
from app.services.passwords import verify_and_update_password
from app.services.session_tokens import (
    TokenValidationError,
    generate_token,
    hash_token,
    verify_token,
)


ClientType = Literal["web", "native"]
SESSION_LIFETIME = timedelta(hours=8)
SESSION_IDLE_TIMEOUT = timedelta(minutes=30)


class SessionServiceError(RuntimeError):
    """A session operation was refused or could not be confirmed."""


class InvalidCredentialsError(SessionServiceError):
    """Login failed without revealing which credential was wrong."""


class InvalidSessionError(SessionServiceError):
    """A session is missing, unavailable, or no longer valid."""


class InvalidCsrfTokenError(SessionServiceError):
    """A browser request failed its separate CSRF-token check."""


class SessionStorageError(SessionServiceError):
    """The database operation was refused or its outcome is uncertain."""


@dataclass(frozen=True)
class AuthenticatedSession:
    """Safe identity information, without credentials or stored hashes."""

    session_id: UUID
    account_id: int
    username: str
    client_type: str
    expires_at: datetime


@dataclass(frozen=True)
class IssuedSession:
    """Internal login result; never serialize the whole object to a response.

    The web route will place token in an HttpOnly cookie. The native route
    will deliver it for secure device storage. CSRF is a separate browser
    secret. Only their hashes are saved in the database.
    """

    identity: AuthenticatedSession
    token: str = field(repr=False)
    csrf_token: str | None = field(repr=False)


def _require_fresh_session(db: Session) -> None:
    if db.in_transaction():
        raise SessionStorageError("Authentication requires a fresh database session.")


def _check_client_type(client_type: ClientType) -> None:
    if client_type not in ("web", "native"):
        raise ValueError("Client type must be web or native.")


def _storage_error() -> SessionStorageError:
    # A connection loss during COMMIT may mean the write succeeded. Do not
    # claim nothing was saved, expose database details, or automatically retry.
    return SessionStorageError(
        "The session operation was not confirmed. Check server state before retrying."
    )


def _invalid_credentials() -> InvalidCredentialsError:
    return InvalidCredentialsError("Username or password is incorrect.")


def _invalid_session() -> InvalidSessionError:
    return InvalidSessionError("The login session is unavailable or no longer valid.")


def _database_now(db: Session) -> datetime:
    # Read the current database time after locking. PostgreSQL now() would
    # remain fixed at transaction start, ignoring time spent waiting for locks.
    return db.scalar(select(func.clock_timestamp()))


def _bound_lock_wait(db: Session) -> None:
    db.execute(text("SET LOCAL lock_timeout = '5s'"))


def _locked_owner(db: Session) -> Account | None:
    # Always lock account before session. Refresh an object that might still
    # be in this Session's identity map from a previously completed operation.
    return db.scalar(
        select(Account).where(Account.id == 1).with_for_update()
        .execution_options(populate_existing=True)
    )


def _identity(owner: Account, record: AuthSession) -> AuthenticatedSession:
    return AuthenticatedSession(
        session_id=record.id,
        account_id=owner.id,
        username=owner.username,
        client_type=record.client_type,
        expires_at=record.expires_at,
    )


def login_owner(
    db: Session,
    username: str,
    password: str,
    *,
    client_type: ClientType,
) -> IssuedSession:
    """Check the owner's password and commit a new independent login.

    Call only through a throttled login workflow. This function does not
    create an HTTP endpoint or impose a distributed login-attempt limit.
    No client-supplied token is accepted when creating the session.
    """
    _require_fresh_session(db)
    _check_client_type(client_type)
    try:
        normalized = normalize_username(username)
    except AccountValidationError:
        normalized = None

    try:
        with db.begin():
            _bound_lock_wait(db)
            # Read scalar values rather than a possibly cached ORM object.
            snapshot = db.execute(select(
                Account.username, Account.password_hash, Account.is_active,
            ).where(Account.id == 1)).one_or_none()
            stored_hash = None
            if snapshot is not None and snapshot.is_active and snapshot.username == normalized:
                stored_hash = snapshot.password_hash

            # Missing/inactive accounts and unknown usernames use the password
            # service's dummy hash. This reduces obvious timing differences;
            # it does not replace throttling or guarantee identical timing.
            valid, replacement = verify_and_update_password(password, stored_hash)
            if not valid or stored_hash is None:
                raise _invalid_credentials()

            # Password verification is expensive, so do it before row locking.
            # Re-read under the lock: a password/account change during that
            # calculation must not authorize a session with stale credentials.
            owner = _locked_owner(db)
            if (
                owner is None or not owner.is_active
                or owner.username != normalized or owner.password_hash != stored_hash
            ):
                raise _invalid_credentials()

            token = generate_token()
            csrf = generate_token() if client_type == "web" else None
            now = _database_now(db)
            if now < owner.password_changed_at:
                raise SessionStorageError("The account timestamp cannot be confirmed.")
            record = AuthSession(
                account_id=owner.id,
                token_hash=hash_token(token, purpose="session"),
                client_type=client_type,
                csrf_token_hash=hash_token(csrf, purpose="csrf") if csrf is not None else None,
                created_at=now,
                expires_at=now + SESSION_LIFETIME,
                last_seen_at=now,
            )
            db.add(record)
            if replacement is not None:
                # Upgrading Argon2 settings is not a password change and must
                # not move password_changed_at or invalidate other logins.
                owner.password_hash = replacement
            db.flush()
            result = IssuedSession(identity=_identity(owner, record), token=token, csrf_token=csrf)
        # Do not deliver a usable token until its database commit is confirmed.
        return result
    except SQLAlchemyError:
        raise _storage_error() from None


def _session_digest(token: str) -> str:
    try:
        return hash_token(token, purpose="session")
    except TokenValidationError:
        raise _invalid_session() from None


def _active_locked_session(
    db: Session,
    digest: str,
    *,
    client_type: ClientType,
    csrf_token: str | None,
    require_csrf: bool,
) -> tuple[Account, AuthSession, datetime]:
    """Load and check current state inside the caller's transaction."""
    owner = _locked_owner(db)
    if owner is None or not owner.is_active:
        raise _invalid_session()
    record = db.scalar(
        select(AuthSession).where(
            AuthSession.account_id == owner.id,
            AuthSession.token_hash == digest,
        ).with_for_update().execution_options(populate_existing=True)
    )
    now = _database_now(db)
    if (
        record is None or record.revoked_at is not None
        or record.client_type != client_type
        or now < record.created_at or now < record.last_seen_at
        or now >= record.expires_at
        or now - record.last_seen_at >= SESSION_IDLE_TIMEOUT
        or record.created_at < owner.password_changed_at
    ):
        raise _invalid_session()
    if client_type == "web" and require_csrf:
        if not verify_token(csrf_token, record.csrf_token_hash, purpose="csrf"):
            raise InvalidCsrfTokenError("The browser request could not be verified.")
    return owner, record, now


def authenticate_session(
    db: Session,
    token: str,
    *,
    client_type: ClientType,
    csrf_token: str | None = None,
    require_csrf: bool = True,
) -> AuthenticatedSession:
    """Check a login and update activity without extending its deadline.

    The HTTP dependency must derive client_type from the credential transport:
    cookie for web, bearer header for native. A web token must not bypass CSRF
    by being presented as a native token. CSRF checking defaults to on; only
    safe read requests may explicitly disable it in the future HTTP layer.

    This authorizes this check at this point in time. A later logout does not
    cancel an already authorized request that is executing business work.
    """
    _require_fresh_session(db)
    _check_client_type(client_type)
    if not isinstance(require_csrf, bool):
        raise ValueError("require_csrf must be a boolean.")
    digest = _session_digest(token)
    try:
        with db.begin():
            _bound_lock_wait(db)
            owner, record, now = _active_locked_session(
                db, digest, client_type=client_type,
                csrf_token=csrf_token, require_csrf=require_csrf,
            )
            record.last_seen_at = now
            db.flush()
            result = _identity(owner, record)
        return result
    except SQLAlchemyError:
        raise _storage_error() from None


def revoke_session(
    db: Session,
    token: str,
    *,
    client_type: ClientType,
    csrf_token: str | None = None,
) -> None:
    """Log out this session while keeping the owner's other devices logged in.

    Browser logout requires its CSRF token. The future HTTP route must also
    clear the browser cookie or device token. An expired/already revoked
    token raises InvalidSessionError; it never becomes valid again here.
    """
    _require_fresh_session(db)
    _check_client_type(client_type)
    digest = _session_digest(token)
    try:
        with db.begin():
            _bound_lock_wait(db)
            _, record, now = _active_locked_session(
                db, digest, client_type=client_type,
                csrf_token=csrf_token, require_csrf=True,
            )
            record.revoked_at = now
            db.flush()
    except SQLAlchemyError:
        raise _storage_error() from None
