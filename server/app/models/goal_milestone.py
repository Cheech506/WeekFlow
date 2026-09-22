"""SQLAlchemy model for a WeekFlow Goal milestone."""

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
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GoalMilestone(Base):
    """A milestone belonging to a PostgreSQL Goal."""

    __tablename__ = "goal_milestones"

    __table_args__ = (
        UniqueConstraint(
            "source_goal_milestone_id",
            name="uq_goal_milestones_source_id",
        ),
        CheckConstraint(
            """
            source_goal_milestone_id IS NULL
            OR source_goal_milestone_id > 0
            """,
            name="ck_goal_milestones_source_id_positive",
        ),
        CheckConstraint(
            "btrim(title) <> ''",
            name="ck_goal_milestones_title_not_blank",
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
            name="ck_goal_milestones_completion_pair",
        ),
        Index(
            "ix_goal_milestones_goal_id",
            "goal_id",
        ),
    )

    # PostgreSQL generates its own milestone ID.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserve the original SQLite milestone ID.
    source_goal_milestone_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # A milestone cannot exist without its Goal.
    goal_id: Mapped[int] = mapped_column(
        ForeignKey(
            "goals.id",
            ondelete="CASCADE",
        ),
        nullable=False,
    )

    title: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )

    notes: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    target_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
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