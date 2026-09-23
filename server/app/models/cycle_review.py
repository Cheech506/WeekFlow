"""SQLAlchemy model for a saved WeekFlow planning-cycle review."""

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
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CycleReview(Base):
    """A Week 13 reflection with a frozen planning-cycle snapshot."""

    __tablename__ = "cycle_reviews"

    __table_args__ = (
        UniqueConstraint(
            "source_cycle_review_id",
            name="uq_cycle_reviews_source_cycle_review_id",
        ),
        UniqueConstraint(
            "cycle_id",
            name="uq_cycle_reviews_cycle_id",
        ),
        CheckConstraint(
            """
            source_cycle_review_id IS NULL
            OR source_cycle_review_id > 0
            """,
            name="ck_cycle_reviews_source_id_positive",
        ),
        CheckConstraint(
            """
            (biggest_accomplishment IS NULL
                OR char_length(biggest_accomplishment) <= 2000)
            AND
            (biggest_challenge IS NULL
                OR char_length(biggest_challenge) <= 2000)
            AND
            (what_worked_well IS NULL
                OR char_length(what_worked_well) <= 2000)
            AND
            (what_change_next_cycle IS NULL
                OR char_length(what_change_next_cycle) <= 2000)
            AND
            (what_stop_doing IS NULL
                OR char_length(what_stop_doing) <= 2000)
            AND
            (what_continue_doing IS NULL
                OR char_length(what_continue_doing) <= 2000)
            AND
            (what_learned IS NULL
                OR char_length(what_learned) <= 2000)
            """,
            name="ck_cycle_reviews_response_lengths",
        ),
        CheckConstraint(
            """
            snapshot_goal_total >= 0
            AND snapshot_goal_completed >= 0
            AND snapshot_task_completed >= 0
            AND snapshot_milestone_total >= 0
            AND snapshot_milestone_completed >= 0
            AND snapshot_weekly_reviews_completed >= 0
            AND snapshot_longest_streak >= 0
            AND snapshot_best_week_count >= 0
            AND snapshot_best_day_count >= 0
            AND snapshot_high_priority_completed >= 0
            AND snapshot_recurring_completed >= 0
            AND snapshot_rewards_unlocked >= 0
            AND snapshot_brain_dumps_archived >= 0
            """,
            name="ck_cycle_reviews_snapshot_counts_nonnegative",
        ),
        CheckConstraint(
            """
            snapshot_goal_completed <= snapshot_goal_total
            AND snapshot_milestone_completed
                <= snapshot_milestone_total
            AND snapshot_high_priority_completed
                <= snapshot_task_completed
            AND snapshot_recurring_completed
                <= snapshot_task_completed
            AND snapshot_rewards_unlocked
                <= snapshot_goal_completed
            AND snapshot_best_week_count
                <= snapshot_task_completed
            AND snapshot_best_day_count
                <= snapshot_task_completed
            """,
            name="ck_cycle_reviews_snapshot_counts_consistent",
        ),
        CheckConstraint(
            """
            snapshot_best_week_number IS NULL
            OR snapshot_best_week_number BETWEEN 1 AND 12
            """,
            name="ck_cycle_reviews_best_week_number",
        ),
        CheckConstraint(
            """
            cardinality(next_cycle_first_commitments) <= 5
            AND (
                cardinality(next_cycle_first_commitments) = 0
                OR array_ndims(next_cycle_first_commitments) = 1
            )
            AND array_position(
                next_cycle_first_commitments,
                NULL
            ) IS NULL
            AND coalesce(
                char_length(
                    next_cycle_first_commitments[
                        array_lower(next_cycle_first_commitments, 1)
                    ]
                ),
                0
            ) <= 180
            AND coalesce(
                char_length(
                    next_cycle_first_commitments[
                        array_lower(next_cycle_first_commitments, 1) + 1
                    ]
                ),
                0
            ) <= 180
            AND coalesce(
                char_length(
                    next_cycle_first_commitments[
                        array_lower(next_cycle_first_commitments, 1) + 2
                    ]
                ),
                0
            ) <= 180
            AND coalesce(
                char_length(
                    next_cycle_first_commitments[
                        array_lower(next_cycle_first_commitments, 1) + 3
                    ]
                ),
                0
            ) <= 180
            AND coalesce(
                char_length(
                    next_cycle_first_commitments[
                        array_lower(next_cycle_first_commitments, 1) + 4
                    ]
                ),
                0
            ) <= 180
            """,
            name="ck_cycle_reviews_first_commitments_shape",
        ),
        CheckConstraint(
            """
            finalized_at IS NULL
            OR next_cycle_start_date IS NOT NULL
            """,
            name="ck_cycle_reviews_finalized_plan",
        ),
        Index(
            "ix_cycle_reviews_next_cycle_id",
            "next_cycle_id",
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Original SQLite review ID.
    source_cycle_review_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # Only one cycle review can exist for each planning cycle.
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey(
            "planning_cycles.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    biggest_accomplishment: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    biggest_challenge: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_worked_well: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_change_next_cycle: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_stop_doing: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_continue_doing: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )
    what_learned: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )

    # Frozen statistics from when the review was saved.
    snapshot_goal_total: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_goal_completed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_task_completed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_milestone_total: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_milestone_completed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_weekly_reviews_completed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_longest_streak: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_best_week_number: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    snapshot_best_week_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_best_day: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    snapshot_best_day_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_high_priority_completed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_recurring_completed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_rewards_unlocked: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    snapshot_brain_dumps_archived: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )

    # Saved plan for the next cycle.
    next_cycle_name: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
    )
    next_cycle_primary_focus: Mapped[str | None] = mapped_column(
        String(300),
        nullable=True,
    )
    next_cycle_theme: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
    )
    next_cycle_start_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    # SQLite stores this list as JSON text. PostgreSQL stores it as a
    # typed array with a maximum of five 180-character commitments.
    next_cycle_first_commitments: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        default=list,
        server_default=text("'{}'::text[]"),
    )

    # Deleting the next cycle clears this link while keeping the saved plan.
    next_cycle_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "planning_cycles.id",
            ondelete="SET NULL",
        ),
        nullable=True,
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
    finalized_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )