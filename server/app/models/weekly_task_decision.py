"""SQLAlchemy model for a historical weekly task decision."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WeeklyTaskDecision(Base):
    """A historical record of how unfinished work was handled."""

    __tablename__ = "weekly_task_decisions"

    __table_args__ = (
        UniqueConstraint(
            "source_weekly_task_decision_id",
            name=(
                "uq_weekly_task_decisions_"
                "source_weekly_task_decision_id"
            ),
        ),
        CheckConstraint(
            """
            source_weekly_task_decision_id IS NULL
            OR source_weekly_task_decision_id > 0
            """,
            name="ck_weekly_task_decisions_source_id_positive",
        ),
        CheckConstraint(
            "EXTRACT(ISODOW FROM week_start) = 1",
            name="ck_weekly_task_decisions_week_starts_monday",
        ),
        CheckConstraint(
            "btrim(task_title) <> ''",
            name="ck_weekly_task_decisions_title_not_blank",
        ),
        CheckConstraint(
            """
            original_due_date >= week_start
            AND original_due_date < week_start + 7
            """,
            name="ck_weekly_task_decisions_original_date_in_week",
        ),
        CheckConstraint(
            """
            action IN (
                'nextWeek',
                'inbox',
                'reschedule',
                'keep',
                'delete'
            )
            """,
            name="ck_weekly_task_decisions_action",
        ),
        CheckConstraint(
            """
            (
                action IN ('nextWeek', 'reschedule')
                AND resolved_due_date IS NOT NULL
            )
            OR
            (
                action IN ('inbox', 'keep', 'delete')
                AND resolved_due_date IS NULL
            )
            """,
            name="ck_weekly_task_decisions_resolved_date_action",
        ),
        CheckConstraint(
            """
            action <> 'nextWeek'
            OR resolved_due_date = original_due_date + 7
            """,
            name="ck_weekly_task_decisions_next_week_date",
        ),
        CheckConstraint(
            "action <> 'delete' OR task_id IS NULL",
            name="ck_weekly_task_decisions_deleted_task_unlinked",
        ),
        CheckConstraint(
            """
            recurring_rule_id IS NULL
            OR recurring_rule_id > 0
            """,
            name=(
                "ck_weekly_task_decisions_"
                "recurring_rule_id_positive"
            ),
        ),
        CheckConstraint(
            """
            source_recurring_rule_id IS NULL
            OR source_recurring_rule_id > 0
            """,
            name=(
                "ck_weekly_task_decisions_"
                "source_recurring_rule_id_positive"
            ),
        ),
        CheckConstraint(
            """
            (
                recurring_rule_id IS NULL
                AND source_recurring_rule_id IS NULL
                AND recurrence_occurrence_date IS NULL
            )
            OR
            (
                recurrence_occurrence_date IS NOT NULL
                AND (
                    recurring_rule_id IS NOT NULL
                    OR source_recurring_rule_id IS NOT NULL
                )
            )
            """,
            name="ck_weekly_task_decisions_recurrence_identity",
        ),
        Index(
            "ix_weekly_task_decisions_week_decided_at",
            "week_start",
            "decided_at",
        ),
        Index(
            "uq_weekly_task_decisions_task_identity",
            "week_start",
            "task_id",
            "original_due_date",
            unique=True,
            postgresql_where=text("task_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    source_weekly_task_decision_id: Mapped[int | None] = (
        mapped_column(
            BigInteger,
            nullable=True,
        )
    )

    week_start: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    # The link is cleared if the task is deleted. The title, dates, action,
    # and recurring identity remain preserved in this record.
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "tasks.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    task_title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    original_due_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )
    action: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )
    resolved_due_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    # PostgreSQL identity for new server-created decisions.
    #
    # This deliberately has no foreign key. It is historical information,
    # so deleting a recurring rule must not erase it.
    recurring_rule_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    # Original SQLite recurring-rule identity for imported decisions.
    source_recurring_rule_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    recurrence_occurrence_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )