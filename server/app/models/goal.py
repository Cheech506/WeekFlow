"""SQLAlchemy model for a WeekFlow goal."""

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
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Goal(Base):
    """A WeekFlow goal stored in PostgreSQL."""

    __tablename__ = "goals"

    __table_args__ = (
        UniqueConstraint(
            "source_goal_id",
            name="uq_goals_source_goal_id",
        ),
        CheckConstraint(
            """
            source_goal_id IS NULL
            OR source_goal_id > 0
            """,
            name="ck_goals_source_id_positive",
        ),
        CheckConstraint(
            "btrim(title) <> ''",
            name="ck_goals_title_not_blank",
        ),
        CheckConstraint(
            "end_date >= start_date",
            name="ck_goals_date_order",
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
            name="ck_goals_completion_pair",
        ),
        CheckConstraint(
            """
            (
                completion_task_total IS NULL
                OR completion_task_total >= 0
            )
            AND
            (
                completion_task_completed IS NULL
                OR completion_task_completed >= 0
            )
            AND
            (
                completion_milestone_total IS NULL
                OR completion_milestone_total >= 0
            )
            AND
            (
                completion_milestone_completed IS NULL
                OR completion_milestone_completed >= 0
            )
            AND
            (
                completion_high_priority_completed IS NULL
                OR completion_high_priority_completed >= 0
            )
            """,
            name="ck_goals_completion_counts_nonnegative",
        ),
        CheckConstraint(
            """
            completion_task_total IS NULL
            OR completion_task_completed IS NULL
            OR completion_task_completed <= completion_task_total
            """,
            name="ck_goals_task_snapshot_counts",
        ),
        CheckConstraint(
            """
            completion_milestone_total IS NULL
            OR completion_milestone_completed IS NULL
            OR completion_milestone_completed
                <= completion_milestone_total
            """,
            name="ck_goals_milestone_snapshot_counts",
        ),
        CheckConstraint(
            """
            completion_task_completed IS NULL
            OR completion_high_priority_completed IS NULL
            OR completion_high_priority_completed
                <= completion_task_completed
            """,
            name="ck_goals_high_priority_snapshot_count",
        ),
        Index(
            "ix_goals_cycle_id",
            "cycle_id",
        ),
    )

    # PostgreSQL generates its own Goal ID.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserve the original SQLite Goal ID.
    source_goal_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # This is the real PostgreSQL relationship to planning_cycles.id.
    cycle_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "planning_cycles.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(
        Text,
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

    # Goal dates represent calendar dates.
    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    end_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    reward: Mapped[str | None] = mapped_column(
        String(200),
        nullable=True,
    )

    purpose: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    success_definition: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    notes: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )

    completion_what_helped: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    completion_hardest_part: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    completion_learned: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    completion_do_differently: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    completion_task_total: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    completion_task_completed: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    completion_milestone_total: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    completion_milestone_completed: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    completion_high_priority_completed: Mapped[int | None] = (
        mapped_column(
            Integer,
            nullable=True,
        )
    )