"""Validation schemas for skipped recurring-occurrence API requests."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class RecurringExceptionCreate(BaseModel):
    """Identify the original occurrence that should be skipped."""

    model_config = ConfigDict(extra="forbid")

    # Use recurring_rules.id in PostgreSQL, not its SQLite source ID.
    recurring_rule_id: int = Field(
        gt=0,
        le=2_147_483_647,
        strict=True,
    )

    # This stays the original occurrence date even if a task was moved.
    occurrence_date: date


class RecurringExceptionRead(BaseModel):
    """Return a skip record and its database-generated timestamp."""

    model_config = ConfigDict(from_attributes=True)

    # The schedule ID and date together identify the record.
    recurring_rule_id: int
    occurrence_date: date
    created_at: datetime
