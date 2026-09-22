"""SQLAlchemy model for a skipped recurring occurrence."""

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RecurringOccurrenceException(Base):
    """A recurring occurrence that should not generate a task."""

    __tablename__ = "recurring_occurrence_exceptions"

    __table_args__ = (
        Index(
            "ix_recurring_occurrence_exceptions_occurrence_date",
            "occurrence_date",
        ),
    )

    # Together, these two columns are the exception's identity.
    recurring_rule_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "recurring_rules.id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )

    occurrence_date: Mapped[date] = mapped_column(
        Date,
        primary_key=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )