"""Server-side login sessions for WeekFlow's owner account."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuthSession(Base):
    """One login on one client, with expiration and explicit revocation."""

    __tablename__ = "auth_sessions"

    __table_args__ = (
        UniqueConstraint(
            "token_hash",
            name="uq_auth_sessions_token_hash",
        ),
        CheckConstraint(
            "token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_auth_sessions_token_hash_format",
        ),
        CheckConstraint(
            "client_type IN ('web', 'native')",
            name="ck_auth_sessions_client_type",
        ),
        CheckConstraint(
            "csrf_token_hash IS NULL "
            "OR csrf_token_hash ~ '^[0-9a-f]{64}$'",
            name="ck_auth_sessions_csrf_hash_format",
        ),
        # Browser cookies need protection against forged browser requests.
        # Native clients authenticate with a token in an explicit header.
        CheckConstraint(
            "(client_type = 'web' AND csrf_token_hash IS NOT NULL) "
            "OR (client_type = 'native' AND csrf_token_hash IS NULL)",
            name="ck_auth_sessions_csrf_client_pair",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="ck_auth_sessions_expiration_after_creation",
        ),
        CheckConstraint(
            "last_seen_at >= created_at AND last_seen_at < expires_at",
            name="ck_auth_sessions_last_seen_range",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name="ck_auth_sessions_revocation_after_creation",
        ),
        Index(
            "ix_auth_sessions_account_id",
            "account_id",
        ),
        Index(
            "ix_auth_sessions_expires_at",
            "expires_at",
        ),
    )

    # This identifies a session record. It is NOT the secret login token.
    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    account_id: Mapped[int] = mapped_column(
        SmallInteger,
        ForeignKey(
            "accounts.id",
            name="fk_auth_sessions_account_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )

    # Store SHA-256 of a cryptographically random, high-entropy token.
    # Raw tokens belong in the client's secure storage/cookie, not this table.
    # Passwords use a password-hashing library instead of this token scheme.
    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    client_type: Mapped[str] = mapped_column(
        String(6),
        nullable=False,
    )

    # The browser sends a separate CSRF token for state-changing requests.
    # The service must verify it; storing a hash alone does not protect routes.
    csrf_token_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # An absolute deadline set by the service. Using a session must not
    # silently extend this deadline forever.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Updated explicitly after successful authentication. The service will
    # also use this value to enforce its inactivity timeout.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # NULL means not explicitly revoked; it does NOT prove a session is valid.
    # The service must also check expiration, inactivity, and account status.
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
