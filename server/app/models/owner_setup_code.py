"""Persistent state for a single current first-run owner setup code."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Integer,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OwnerSetupCode(Base):
    """A locally issued setup credential, never a public registration code."""

    __tablename__ = "owner_setup_codes"

    __table_args__ = (
        CheckConstraint(
            "id = 1",
            name="ck_owner_setup_codes_singleton",
        ),
        CheckConstraint(
            "code_hash ~ '^[0-9a-f]{64}$'",
            name="ck_owner_setup_codes_hash_format",
        ),
        CheckConstraint(
            "expires_at > created_at",
            name="ck_owner_setup_codes_expiration_after_creation",
        ),
        CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="ck_owner_setup_codes_consumption_after_creation",
        ),
        CheckConstraint(
            "failed_attempts >= 0",
            name="ck_owner_setup_codes_attempts_nonnegative",
        ),
        CheckConstraint(
            "blocked_until IS NULL OR blocked_until >= created_at",
            name="ck_owner_setup_codes_block_after_creation",
        ),
    )

    # One current code per installation. The trusted issuing service may
    # rotate it before owner creation, invalidating the previous code.
    id: Mapped[int] = mapped_column(
        SmallInteger,
        primary_key=True,
        autoincrement=False,
        default=1,
        server_default="1",
    )

    # SHA-256 of a long cryptographically random code (at least 32 random
    # bytes), not a user-chosen password or a short numeric PIN. Passwords
    # still use Argon2. Never store the raw setup code in this table.
    code_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # The issuing service must explicitly choose a bounded lifetime.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Owner creation and code consumption must commit in one transaction.
    # NULL alone does not establish validity: the service must also check
    # expiration, blocking, and the absence of an existing owner account.
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Database-backed state lets workers share failed-attempt restrictions.
    # The service must increment/check these fields under a row lock; model
    # declarations alone do not rate-limit requests.
    failed_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )

    blocked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
