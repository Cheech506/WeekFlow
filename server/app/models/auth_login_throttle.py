"""Shared database counters for limiting password-login attempts."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuthLoginThrottle(Base):
    """One attempt counter for one fixed time window and server-chosen scope.

    The service will reserve an attempt before expensive password checking.
    Counters include successful attempts as well as failures. They are not
    login history and must never contain passwords or session tokens.

    This model only describes storage. The service must lock/check/update
    counters atomically; declaring this table does not enforce a limit.
    """

    __tablename__ = "auth_login_throttles"

    __table_args__ = (
        CheckConstraint(
            "bucket_key = 'instance' OR bucket_key ~ '^ip:[0-9a-f]{64}$'",
            name="ck_auth_login_throttles_bucket_format",
        ),
        CheckConstraint(
            "attempt_count >= 0",
            name="ck_auth_login_throttles_count_nonnegative",
        ),
        CheckConstraint(
            "window_ends_at > window_started_at",
            name="ck_auth_login_throttles_window_order",
        ),
        Index(
            "ix_auth_login_throttles_window_ends_at",
            "window_ends_at",
        ),
    )

    # 'instance' covers this installation's single owner across all sources
    # and submitted usernames. 'ip:<SHA-256>' adds a separate source counter.
    # Only server code derives these keys from a trusted client address.
    # An address hash is pseudonymous, not proof that the source is anonymous.
    bucket_key: Mapped[str] = mapped_column(
        String(67),
        primary_key=True,
        autoincrement=False,
    )

    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # No automatic/unlimited deadline. The service chooses each bounded
    # window and replaces expired windows under the same row lock.
    window_ends_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # An atomic reservation counts even if the password is wrong, the client
    # disconnects, or a later login operation fails. A restart must not reset it.
    # Actual limits belong in service policy, not hard-coded table constraints.
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
