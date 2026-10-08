"""Validation schemas for Goal milestone API requests and responses."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GoalMilestoneCreate(BaseModel):
    """Validate a new milestone belonging to one PostgreSQL goal."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    # This is goals.id in PostgreSQL, not source_goal_id from SQLite.
    goal_id: int = Field(gt=0, le=2_147_483_647, strict=True)
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=500)
    target_date: date | None = None

    @field_validator("notes")
    @classmethod
    def convert_blank_notes_to_none(cls, value: str | None) -> str | None:
        """Store blank optional notes as null."""
        return value or None


class GoalMilestoneUpdate(BaseModel):
    """Validate milestone edits, completion, or reopening."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str | None = Field(default=None, min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=500)
    target_date: date | None = None
    completed: bool | None = Field(default=None, strict=True)

    @field_validator("title", "completed")
    @classmethod
    def reject_null_for_required_fields(cls, value):
        """Allow omission, but do not erase required database values."""
        if value is None:
            raise ValueError("value cannot be null")
        return value

    @field_validator("notes")
    @classmethod
    def convert_blank_notes_to_none(cls, value: str | None) -> str | None:
        """Store blank optional notes as null."""
        return value or None


class GoalMilestoneRead(BaseModel):
    """Return the milestone, its goal link, and completion timestamp."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_goal_milestone_id: int | None
    goal_id: int

    title: str
    notes: str | None
    target_date: date | None
    completed: bool
    created_at: datetime
    completed_at: datetime | None
