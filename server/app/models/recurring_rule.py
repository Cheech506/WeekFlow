"""SQLAlchemy model for a WeekFlow recurring rule."""

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
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecurringRule(Base):
    """A recurring task schedule stored in PostgreSQL."""

    __tablename__ = "recurring_rules"

    __table_args__ = (
        UniqueConstraint(
            "source_recurring_rule_id",
            name=(
                "uq_recurring_rules_"
                "source_recurring_rule_id"
            ),
        ),
        CheckConstraint(
            """
            source_recurring_rule_id IS NULL
            OR source_recurring_rule_id > 0
            """,
            name="ck_recurring_rules_source_id_positive",
        ),
        CheckConstraint(
            "btrim(title) <> ''",
            name="ck_recurring_rules_title_not_blank",
        ),
        CheckConstraint(
            "priority BETWEEN 0 AND 2",
            name="ck_recurring_rules_priority_range",
        ),
        CheckConstraint(
            """
            frequency IN (
                'daily',
                'weekly',
                'everyTwoWeeks',
                'certainDays',
                'monthly'
            )
            """,
            name="ck_recurring_rules_frequency",
        ),
        CheckConstraint(
            """
            end_date IS NULL
            OR end_date >= start_date
            """,
            name="ck_recurring_rules_date_order",
        ),
        CheckConstraint(
            """
            array_position(weekdays, NULL) IS NULL
            AND weekdays
                <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
            """,
            name="ck_recurring_rules_weekday_values",
        ),
        CheckConstraint(
            """
            frequency <> 'certainDays'
            OR cardinality(weekdays) > 0
            """,
            name=(
                "ck_recurring_rules_"
                "certain_days_weekdays"
            ),
        ),
        CheckConstraint(
            """
            cardinality(weekdays) =
                (CASE WHEN 0 = ANY(weekdays) THEN 1 ELSE 0 END)
                + (CASE WHEN 1 = ANY(weekdays) THEN 1 ELSE 0 END)
                + (CASE WHEN 2 = ANY(weekdays) THEN 1 ELSE 0 END)
                + (CASE WHEN 3 = ANY(weekdays) THEN 1 ELSE 0 END)
                + (CASE WHEN 4 = ANY(weekdays) THEN 1 ELSE 0 END)
                + (CASE WHEN 5 = ANY(weekdays) THEN 1 ELSE 0 END)
                + (CASE WHEN 6 = ANY(weekdays) THEN 1 ELSE 0 END)
            """,
            name="ck_recurring_rules_weekdays_unique",
        ),
        Index(
            "ix_recurring_rules_goal_id",
            "goal_id",
        ),
        Index(
            "ix_recurring_rules_active",
            "active",
        ),
    )

    # PostgreSQL creates its own internal ID.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserve the original SQLite recurring-rule ID.
    source_recurring_rule_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # A deleted Goal unlinks the schedule without deleting it.
    goal_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "goals.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
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

    frequency: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
    )

    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    end_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    weekdays: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger),
        nullable=False,
        default=list,
        server_default=text("'{}'::smallint[]"),
    )

    active: Mapped[bool] = mapped_column(
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