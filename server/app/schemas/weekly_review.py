"""Validation schemas for saved weekly reviews and frozen analytics."""

from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PostgresId = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
SnapshotCount = Annotated[int, Field(strict=True, ge=0, le=2_147_483_647)]
Weekday = Literal[
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]


class WeeklyReviewSnapshot(BaseModel):
    """Validate the calculated numbers supplied when a review is first saved.

    These checks enforce consistency, not independent recalculation from tasks.
    The saved snapshot remains fixed when the written reflection is edited.
    """

    model_config = ConfigDict(extra="forbid")

    completed_count: SnapshotCount
    unfinished_count: SnapshotCount
    overdue_count: SnapshotCount
    completion_rate: Annotated[int, Field(strict=True, ge=0, le=100)]
    goals_progressed_count: SnapshotCount
    best_day: Weekday | None
    best_day_count: SnapshotCount
    archived_brain_dump_count: SnapshotCount
    high_priority_completed_count: SnapshotCount
    recurring_completed_count: SnapshotCount

    @model_validator(mode="after")
    def require_consistent_analytics(self) -> Self:
        """Match the app's rounding and the PostgreSQL snapshot constraints."""

        total = self.completed_count + self.unfinished_count
        # PostgreSQL evaluates this sum using its 32-bit integer columns.
        if total > 2_147_483_647:
            raise ValueError("The combined task count exceeds the database limit")

        # Round half upward, matching JavaScript Math.round and PostgreSQL
        # ROUND(numeric). Python round() would round some ties downward.
        expected_rate = (
            0 if total == 0
            else (2 * self.completed_count * 100 + total) // (2 * total)
        )
        if self.completion_rate != expected_rate:
            raise ValueError("completion_rate does not match the task counts")

        if self.overdue_count > self.unfinished_count:
            raise ValueError("overdue_count cannot exceed unfinished_count")

        for field in (
            "goals_progressed_count", "best_day_count",
            "high_priority_completed_count", "recurring_completed_count",
        ):
            if getattr(self, field) > self.completed_count:
                raise ValueError(f"{field} cannot exceed completed_count")

        if (self.best_day is None) != (self.best_day_count == 0):
            raise ValueError("best_day requires a positive best_day_count, or both must be empty")

        return self


class WeeklyReviewReflection(BaseModel):
    """Written responses shared by create and partial-update requests."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    what_went_well: str | None = Field(default=None, max_length=2000)
    what_caused_problems: str | None = Field(default=None, max_length=2000)
    what_learned: str | None = Field(default=None, max_length=2000)
    what_change_next_week: str | None = Field(default=None, max_length=2000)
    next_week_focus: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "what_went_well", "what_caused_problems", "what_learned",
        "what_change_next_week", "next_week_focus",
    )
    @classmethod
    def blank_response_to_none(cls, value: str | None) -> str | None:
        """Allow a response to be cleared with blank text or explicit null."""

        return value or None


class WeeklyReviewCreate(WeeklyReviewReflection):
    """Save a Monday-based week's reflection and its initial snapshot."""

    week_start: date
    cycle_id: PostgresId | None = None
    snapshot: WeeklyReviewSnapshot

    @field_validator("week_start")
    @classmethod
    def require_monday(cls, value: date) -> date:
        if value.weekday() != 0:
            raise ValueError("week_start must be a Monday")
        return value


class WeeklyReviewUpdate(WeeklyReviewReflection):
    """Edit responses or the cycle link while preserving the original snapshot.

    Omitted fields retain their values. Null clears a response or cycle link.
    The router must use model_dump(exclude_unset=True) for partial updates.
    Week identity, source IDs, timestamps, and snapshot values are read-only.
    """

    cycle_id: PostgresId | None = None


class WeeklyReviewRead(BaseModel):
    """Return all saved review fields, including its frozen historical numbers."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_weekly_review_id: int | None
    week_start: date
    cycle_id: int | None

    what_went_well: str | None
    what_caused_problems: str | None
    what_learned: str | None
    what_change_next_week: str | None
    next_week_focus: str | None

    snapshot_completed_count: int
    snapshot_unfinished_count: int
    snapshot_overdue_count: int
    snapshot_completion_rate: int
    snapshot_goals_progressed_count: int
    snapshot_best_day: str | None
    snapshot_best_day_count: int
    snapshot_archived_brain_dump_count: int
    snapshot_high_priority_completed_count: int
    snapshot_recurring_completed_count: int

    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime
