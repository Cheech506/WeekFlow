"""Request and response validation for recurring-task generation."""

from datetime import date, timedelta
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


PostgresId = Annotated[
    int,
    Field(strict=True, gt=0, le=2_147_483_647),
]
NonNegativeCount = Annotated[int, Field(strict=True, ge=0)]


def validated_window_end(current_date: date, horizon_days: int) -> date:
    """Reject windows that exceed Python and PostgreSQL API date support."""

    try:
        return current_date + timedelta(days=horizon_days)
    except OverflowError as error:
        raise ValueError("The generation window exceeds the supported date range") from error


class RecurrenceGenerationRequest(BaseModel):
    """Generate occurrences from an explicit user-local calendar date."""

    model_config = ConfigDict(extra="forbid")

    current_date: date

    # Match the date service: today plus up to 366 following calendar days.
    horizon_days: int = Field(default=30, strict=True, ge=0, le=366)

    # Omit or supply null to process all schedules. Paused schedules create
    # nothing. This is recurring_rules.id, not a SQLite source identifier.
    recurring_rule_id: PostgresId | None = None

    @model_validator(mode="after")
    def validate_window(self) -> Self:
        """Ensure even a valid horizon fits the supplied calendar date."""

        validated_window_end(self.current_date, self.horizon_days)
        return self


class RecurrenceGenerationRead(BaseModel):
    """Return the completed generation summary and newly created task IDs."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    current_date: date
    horizon_days: int = Field(strict=True, ge=0, le=366)
    window_end: date

    rules_checked: NonNegativeCount
    candidate_count: NonNegativeCount
    created_count: NonNegativeCount
    existing_count: NonNegativeCount
    skipped_count: NonNegativeCount

    created_task_ids: list[PostgresId]
    database_changed: bool = Field(strict=True)

    @model_validator(mode="after")
    def validate_summary(self) -> Self:
        """Keep response totals, identifiers, and change status consistent."""

        if self.window_end != validated_window_end(self.current_date, self.horizon_days):
            raise ValueError("window_end does not match the requested generation window")

        if self.candidate_count != self.created_count + self.existing_count + self.skipped_count:
            raise ValueError("candidate_count must equal created, existing, and skipped counts")

        if len(self.created_task_ids) != self.created_count:
            raise ValueError("created_task_ids must match created_count")

        if len(self.created_task_ids) != len(set(self.created_task_ids)):
            raise ValueError("created_task_ids cannot contain duplicates")

        if self.database_changed != (self.created_count > 0):
            raise ValueError("database_changed must agree with created_count")

        return self
