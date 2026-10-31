"""The owner account for a single-owner WeekFlow instance."""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Account(Base):
    """One owner account; multiple devices will have separate sessions."""

    __tablename__ = "accounts"

    __table_args__ = (
        # Existing WeekFlow records belong to this instance's one owner.
        # Separate users with separate data require ownership checks first.
        CheckConstraint(
            "id = 1",
            name="ck_accounts_single_owner",
        ),
        # Login/setup code will normalize usernames before saving them.
        # Keep the stored identity lowercase, ASCII, and 3-64 characters.
        CheckConstraint(
            "username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'",
            name="ck_accounts_username_format",
        ),
        UniqueConstraint(
            "username",
            name="uq_accounts_username",
        ),
        # This only rejects blank values. The authentication service must
        # generate a real password hash using the password-hashing library.
        CheckConstraint(
            "char_length(btrim(password_hash)) > 0",
            name="ck_accounts_password_hash_not_blank",
        ),
    )

    # A fixed primary key enforces one owner instead of generating user IDs.
    id: Mapped[int] = mapped_column(
        SmallInteger,
        primary_key=True,
        autoincrement=False,
        default=1,
        server_default="1",
    )

    username: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    # Never assign the raw password here or include this field in responses.
    password_hash: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Protected requests must reject inactive accounts, even with a session.
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=true(),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # The password-change service must update this and revoke sessions in
    # the same transaction. Changing this timestamp alone is not revocation.
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
