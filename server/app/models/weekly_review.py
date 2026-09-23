"""SQLAlchemy model for a saved WeekFlow weekly review."""

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
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WeeklyReview(Base):
    """A guided weekly reflection with a saved analytics snapshot."""

    __tablename__ = "weekly_reviews"

    __table_args__ = (
        UniqueConstraint(
            "source_weekly_review_id",
            name="uq_weekly_reviews_source_weekly_review_id",
        ),
        UniqueConstraint(
            "week_start",
            name="uq_weekly_reviews_week_start",
        ),
        CheckConstraint(
            """
            source_weekly_review_id IS NULL
            OR source_weekly_review_id > 0
            """,
            name="ck_weekly_reviews_source_id_positive",
        ),
        CheckConstraint(
            "EXTRACT(ISODOW FROM week_start) = 1",
            name="ck_weekly_reviews_week_starts_monday",
        ),
        CheckConstraint(
            """
            (what_went_well IS NULL
                OR char_length(what_went_well) <= 2000)
            AND
            (what_caused_problems IS NULL
                OR char_length(what_caused_problems) <= 2000)
            AND
            (what_learned IS NULL
                OR char_length(what_learned) <= 2000)
            AND
            (what_change_next_week IS NULL
                OR char_length(what_change_next_week) <= 2000)
            AND
            (next_week_focus IS NULL
                OR char_length(next_week_focus) <= 2000)
            """,
            name="ck_weekly_reviews_response_lengths",
        ),
        CheckConstraint(
            """
            snapshot_completed_count >= 0
            AND snapshot_unfinished_count >= 0
            AND snapshot_overdue_count >= 0
            AND snapshot_goals_progressed_count >= 0
            AND snapshot_best_day_count >= 0
            AND snapshot_archived_brain_dump_count >= 0
            AND snapshot_high_priority_completed_count >= 0
            AND snapshot_recurring_completed_count >= 0
            """,
            name="ck_weekly_reviews_snapshot_counts_nonnegative",
        ),
        CheckConstraint(
            "snapshot_completion_rate BETWEEN 0 AND 100",
            name="ck_weekly_reviews_completion_rate_range",
        ),
        CheckConstraint(
            """
            snapshot_completion_rate =
                CASE
                    WHEN (
                        snapshot_completed_count
                        + snapshot_unfinished_count
                    ) = 0
                    THEN 0
                    ELSE CAST(
                        ROUND(
                            (
                                CAST(
                                    snapshot_completed_count
                                    AS numeric
                                ) * 100
                            )
                            / (
                                snapshot_completed_count
                                + snapshot_unfinished_count
                            )
                        )
                        AS integer
                    )
                END
            """,
            name="ck_weekly_reviews_completion_rate_consistent",
        ),
        CheckConstraint(
            "snapshot_overdue_count <= snapshot_unfinished_count",
            name="ck_weekly_reviews_overdue_count_consistent",
        ),
        CheckConstraint(
            """
            snapshot_goals_progressed_count
                <= snapshot_completed_count
            AND snapshot_best_day_count
                <= snapshot_completed_count
            AND snapshot_high_priority_completed_count
                <= snapshot_completed_count
            AND snapshot_recurring_completed_count
                <= snapshot_completed_count
            """,
            name="ck_weekly_reviews_completed_counts_consistent",
        ),
        CheckConstraint(
            """
            (
                snapshot_best_day IS NULL
                AND snapshot_best_day_count = 0
            )
            OR
            (
                snapshot_best_day IS NOT NULL
                AND snapshot_best_day IN (
                    'Monday',
                    'Tuesday',
                    'Wednesday',
                    'Thursday',
                    'Friday',
                    'Saturday',
                    'Sunday'
                )
                AND snapshot_best_day_count > 0
            )
            """,
            name="ck_weekly_reviews_best_day_consistent",
        ),
        Index(
            "ix_weekly_reviews_cycle_id",
            "cycle_id",
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Original SQLite identity used for safe repeat imports.
    source_weekly_review_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    week_start: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    # Deleting a cycle must not delete its historical review.
    cycle_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "planning_cycles.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    what_went_well: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_caused_problems: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_learned: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_change_next_week: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    next_week_focus: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )

    # These values become the frozen historical snapshot for the week.
    snapshot_completed_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_unfinished_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_overdue_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_completion_rate: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_goals_progressed_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_best_day: Mapped[str | None] = mapped_column(
        String(9),
        nullable=True,
    )
    snapshot_best_day_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_archived_brain_dump_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_high_priority_completed_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_recurring_completed_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
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
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )