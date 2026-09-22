"""SQLAlchemy model for a WeekFlow planning cycle."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PlanningCycle(Base):
    """A twelve-week planning cycle stored in PostgreSQL."""

    __tablename__ = "planning_cycles"

    __table_args__ = (
        # An imported SQLite planning cycle may be imported only once.
        UniqueConstraint(
            "source_planning_cycle_id",
            name="uq_planning_cycles_source_planning_cycle_id",
        ),

        # SQLite source IDs must be positive when present.
        CheckConstraint(
            """
            source_planning_cycle_id IS NULL
            OR source_planning_cycle_id > 0
            """,
            name="ck_planning_cycles_source_id_positive",
        ),

        # A twelve-week cycle contains 84 inclusive calendar days.
        CheckConstraint(
            "end_date = start_date + 83",
            name="ck_planning_cycles_twelve_weeks",
        ),

        # Current cycles have no completion time. Historical cycles do.
        CheckConstraint(
            """
            (
                active IS TRUE
                AND completed_at IS NULL
            )
            OR
            (
                active IS FALSE
                AND completed_at IS NOT NULL
            )
            """,
            name="ck_planning_cycles_active_completion_pair",
        ),

        # PostgreSQL may contain historical cycles, but only one active cycle.
        Index(
            "uq_planning_cycles_single_active",
            "active",
            unique=True,
            postgresql_where=text("active IS TRUE"),
        ),
    )

    # PostgreSQL generates its own internal ID.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserve the original SQLite planning-cycle ID during migration.
    source_planning_cycle_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    name: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
    )

    primary_focus: Mapped[str | None] = mapped_column(
        String(300),
        nullable=True,
    )

    theme: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
    )

    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    end_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
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

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )