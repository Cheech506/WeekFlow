"""Validation schemas for Goal API requests and responses."""

from datetime import date, datetime
from typing import Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


class GoalCreate(BaseModel):
    """Validate a new goal and its optional planning-cycle link."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str = Field(min_length=1)
    start_date: date
    end_date: date

    # Use the PostgreSQL cycle ID, not its original SQLite source ID.
    cycle_id: int | None = Field(
        default=None,
        gt=0,
        le=2_147_483_647,
        strict=True,
    )

    reward: str | None = Field(default=None, max_length=200)
    purpose: str | None = Field(default=None, max_length=500)
    success_definition: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2_000)

    @field_validator("reward", "purpose", "success_definition", "notes")
    @classmethod
    def convert_blank_text_to_none(cls, value: str | None) -> str | None:
        """Store empty optional text as null."""
        return value or None

    @model_validator(mode="after")
    def validate_date_order(self) -> Self:
        """A goal cannot end before it starts."""
        if self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self


class GoalUpdate(BaseModel):
    """Validate supplied changes to a goal's planning details."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str | None = Field(default=None, min_length=1)
    start_date: date | None = None
    end_date: date | None = None

    reward: str | None = Field(default=None, max_length=200)
    purpose: str | None = Field(default=None, max_length=500)
    success_definition: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2_000)

    @field_validator("title", "start_date", "end_date")
    @classmethod
    def reject_null_for_required_fields(cls, value):
        """Allow omission, but do not erase required database values."""
        if value is None:
            raise ValueError("value cannot be null")
        return value

    @field_validator("reward", "purpose", "success_definition", "notes")
    @classmethod
    def convert_blank_text_to_none(cls, value: str | None) -> str | None:
        """Store empty optional text as null."""
        return value or None

    @model_validator(mode="after")
    def validate_supplied_date_order(self) -> Self:
        """Check the range when both dates are supplied."""
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date cannot be before start_date")
        # The route also checks a single changed date against the saved date.
        return self


class GoalRead(BaseModel):
    """Return goal details, original identity, and saved completion history."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_goal_id: int | None
    cycle_id: int | None

    title: str
    start_date: date
    end_date: date
    reward: str | None
    purpose: str | None
    success_definition: str | None
    notes: str | None

    completed: bool
    created_at: datetime
    completed_at: datetime | None

    completion_what_helped: str | None
    completion_hardest_part: str | None
    completion_learned: str | None
    completion_do_differently: str | None
    completion_task_total: int | None
    completion_task_completed: int | None
    completion_milestone_total: int | None
    completion_milestone_completed: int | None
    completion_high_priority_completed: int | None
