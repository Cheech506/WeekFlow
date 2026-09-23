"""SQLAlchemy model for a WeekFlow weekly commitment."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WeeklyCommitment(Base):
    """A task or standalone promise selected for one week."""

    __tablename__ = "weekly_commitments"

    __table_args__ = (
        UniqueConstraint(
            "source_weekly_commitment_id",
            name=(
                "uq_weekly_commitments_"
                "source_weekly_commitment_id"
            ),
        ),
        CheckConstraint(
            """
            source_weekly_commitment_id IS NULL
            OR source_weekly_commitment_id > 0
            """,
            name="ck_weekly_commitments_source_id_positive",
        ),
        CheckConstraint(
            "EXTRACT(ISODOW FROM week_start) = 1",
            name="ck_weekly_commitments_week_starts_monday",
        ),
        CheckConstraint(
            "btrim(title) <> '' AND char_length(title) <= 180",
            name="ck_weekly_commitments_title_valid",
        ),
        CheckConstraint(
            """
            (
                completed IS TRUE
                AND completed_at IS NOT NULL
            )
            OR
            (
                completed IS FALSE
                AND completed_at IS NULL
            )
            """,
            name="ck_weekly_commitments_completion_pair",
        ),
        Index(
            "ix_weekly_commitments_week_start",
            "week_start",
            "completed",
            "id",
        ),
        Index(
            "ix_weekly_commitments_cycle_id",
            "cycle_id",
        ),
        Index(
            "uq_weekly_commitments_week_task",
            "week_start",
            "task_id",
            unique=True,
            postgresql_where=text("task_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    source_weekly_commitment_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    week_start: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    # Deleting a cycle unlinks this row without deleting its history.
    cycle_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "planning_cycles.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    # Deleting the task clears this link. The saved title and completion
    # fields below remain as the historical record.
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "tasks.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(
        String(180),
        nullable=False,
    )
    completed: Mapped[bool] = mapped_column(
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
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )