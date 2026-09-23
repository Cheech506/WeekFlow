"""SQLAlchemy model for a saved cycle goal outcome."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
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


class CycleGoalOutcome(Base):
    """The historical decision for one goal in a cycle review."""

    __tablename__ = "cycle_goal_outcomes"

    __table_args__ = (
        UniqueConstraint(
            "source_cycle_goal_outcome_id",
            name="uq_cycle_goal_outcomes_source_id",
        ),
        CheckConstraint(
            """
            source_cycle_goal_outcome_id IS NULL
            OR source_cycle_goal_outcome_id > 0
            """,
            name="ck_cycle_goal_outcomes_source_id_positive",
        ),
        CheckConstraint(
            "btrim(goal_title) <> ''",
            name="ck_cycle_goal_outcomes_title_not_blank",
        ),
        CheckConstraint(
            """
            action IN (
                'complete',
                'carryForward',
                'archive',
                'replace'
            )
            """,
            name="ck_cycle_goal_outcomes_action",
        ),
        CheckConstraint(
            """
            (
                action = 'replace'
                AND replacement_title IS NOT NULL
                AND btrim(replacement_title) <> ''
            )
            OR
            (
                action <> 'replace'
                AND replacement_title IS NULL
            )
            """,
            name="ck_cycle_goal_outcomes_replacement_action",
        ),
        Index(
            "ix_cycle_goal_outcomes_review_id",
            "cycle_review_id",
            "id",
        ),
        Index(
            "uq_cycle_goal_outcomes_review_goal",
            "cycle_review_id",
            "goal_id",
            unique=True,
            postgresql_where=text("goal_id IS NOT NULL"),
        ),
        Index(
            "ix_cycle_goal_outcomes_destination_id",
            "destination_goal_id",
        ),
    )

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Original SQLite outcome ID.
    source_cycle_goal_outcome_id: Mapped[int | None] = (
        mapped_column(
            BigInteger,
            nullable=True,
        )
    )

    # Deleting a cycle review removes its child goal outcomes.
    cycle_review_id: Mapped[int] = mapped_column(
        ForeignKey(
            "cycle_reviews.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    # If the original goal is deleted, its saved title remains below.
    goal_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "goals.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    goal_title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    action: Mapped[str] = mapped_column(
        String(12),
        nullable=False,
    )

    replacement_title: Mapped[str | None] = mapped_column(
        String(180),
        nullable=True,
    )

    # For carry-forward and replacement actions, this points to the goal
    # created in the next planning cycle.
    destination_goal_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "goals.id",
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
    