"""SQLAlchemy model for a WeekFlow task."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Task(Base):
    """A task stored in the WeekFlow PostgreSQL database."""

    __tablename__ = "tasks"

    __table_args__ = (
        CheckConstraint(
            "priority BETWEEN 0 AND 2",
            name="ck_tasks_priority_range",
        ),

        # Ordinary tasks have no recurring identity.
        # Recurring tasks need a rule ID and their original date.
        # Imported tasks may temporarily have only the source rule ID.
        CheckConstraint(
            """
            (
                recurring_rule_id IS NULL
                AND source_recurring_rule_id IS NULL
                AND recurrence_occurrence_date IS NULL
            )
            OR
            (
                (
                    recurring_rule_id IS NOT NULL
                    OR source_recurring_rule_id IS NOT NULL
                )
                AND recurrence_occurrence_date IS NOT NULL
            )
            """,
            name="ck_tasks_recurring_source_pair",
        ),

        UniqueConstraint(
            "source_task_id",
            name="uq_tasks_source_task_id",
        ),

        # Prevent duplicate imported occurrences.
        UniqueConstraint(
            "source_recurring_rule_id",
            "recurrence_occurrence_date",
            name="uq_tasks_source_recurring_occurrence",
        ),

        # Prevent duplicate native PostgreSQL occurrences.
        UniqueConstraint(
            "recurring_rule_id",
            "recurrence_occurrence_date",
            name="uq_tasks_recurring_occurrence",
        ),
    )

    # PostgreSQL generates the task's primary key.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserved SQLite identity used during migration.
    source_task_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # Each task stores its own PostgreSQL goal relationship.
    # Deleting a goal clears this link while keeping the task.
    goal_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "goals.id",
            name="fk_tasks_goal_id_goals",
            ondelete="SET NULL",
        ),
        nullable=True,
        index=True,
    )

    source_goal_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # PostgreSQL schedule that generated this occurrence.
    # RESTRICT prevents deleting a referenced schedule accidentally.
    # A schedule deletion service must first detach retained tasks.
    recurring_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "recurring_rules.id",
            name="fk_tasks_recurring_rule_id_recurring_rules",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )

    source_recurring_rule_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # Original occurrence date stays unchanged when rescheduling.
    recurrence_occurrence_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    day: Mapped[str] = mapped_column(
        String(9),
        nullable=False,
        default="Inbox",
        server_default="Inbox",
    )

    due_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
        index=True,
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    priority: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=0,
        server_default="0",
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