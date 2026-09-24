"""SQLAlchemy model for a WeekFlow Brain Dump note."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BrainDump(Base):
    """A Brain Dump note stored in PostgreSQL."""

    __tablename__ = "brain_dumps"

    __table_args__ = (
        UniqueConstraint(
            "source_brain_dump_id",
            name="uq_brain_dumps_source_brain_dump_id",
        ),
        CheckConstraint(
            """
            source_brain_dump_id IS NULL
            OR source_brain_dump_id > 0
            """,
            name="ck_brain_dumps_source_id_positive",
        ),
        CheckConstraint(
            "btrim(body) <> ''",
            name="ck_brain_dumps_body_not_blank",
        ),
        CheckConstraint(
            """
            (
                archived IS TRUE
                AND archived_at IS NOT NULL
            )
            OR
            (
                archived IS FALSE
                AND archived_at IS NULL
            )
            """,
            name="ck_brain_dumps_archive_pair",
        ),
        Index(
            "ix_brain_dumps_archived_created_at",
            "archived",
            "created_at",
        ),
    )

    # PostgreSQL creates its own internal ID.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserve the original SQLite Brain Dump ID.
    source_brain_dump_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    archived: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )