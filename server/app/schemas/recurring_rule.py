"""Validation schemas for recurring-schedule API requests and responses."""

from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


RecurrenceFrequency = Literal[
    "daily",
    "weekly",
    "everyTwoWeeks",
    "certainDays",
    "monthly",
]

# Match JavaScript's getDay(): Sunday = 0 through Saturday = 6.
WeekdayIndex = Annotated[int, Field(strict=True, ge=0, le=6)]


def validate_weekdays(weekdays: list[int]) -> list[int]:
    """Reject duplicate weekdays and store a predictable ordering."""

    if len(weekdays) != len(set(weekdays)):
        raise ValueError("weekdays cannot contain duplicates")

    return sorted(weekdays)


class RecurringRuleCreate(BaseModel):
    """Validate a new schedule using PostgreSQL parent IDs."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str = Field(min_length=1)
    notes: str | None = None
    priority: int = Field(default=0, ge=0, le=2, strict=True)

    # This references goals.id, not the original SQLite source_goal_id.
    goal_id: int | None = Field(
        default=None,
        gt=0,
        le=2_147_483_647,
        strict=True,
    )

    frequency: RecurrenceFrequency
    start_date: date
    end_date: date | None = None
    weekdays: list[WeekdayIndex] = Field(
        default_factory=list,
        max_length=7,
    )
    active: bool = Field(default=True, strict=True)

    @field_validator("notes")
    @classmethod
    def convert_blank_notes_to_none(cls, value: str | None) -> str | None:
        """Store empty optional notes as null."""

        return value or None

    @field_validator("weekdays")
    @classmethod
    def normalize_weekdays(cls, value: list[int]) -> list[int]:
        """Validate selected weekdays without silently discarding errors."""

        return validate_weekdays(value)

    @model_validator(mode="after")
    def validate_schedule(self) -> Self:
        """Check the date range and required selected weekdays."""

        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")

        if self.frequency == "certainDays" and not self.weekdays:
            raise ValueError("certainDays requires at least one weekday")

        return self


class RecurringRuleUpdate(BaseModel):
    """Validate supplied edits while distinguishing omission from null.

    The router must merge these changes with the saved schedule and
    validate the resulting values with RecurringRuleCreate before saving.
    This catches changes that become invalid only with existing values.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str | None = Field(default=None, min_length=1)
    notes: str | None = None
    priority: int | None = Field(default=None, ge=0, le=2, strict=True)

    # Omit to keep the current goal; supply null to unlink the schedule.
    goal_id: int | None = Field(
        default=None,
        gt=0,
        le=2_147_483_647,
        strict=True,
    )

    frequency: RecurrenceFrequency | None = None
    start_date: date | None = None
    # Null removes the end date, allowing an open-ended schedule.
    end_date: date | None = None
    weekdays: list[WeekdayIndex] | None = Field(
        default=None,
        max_length=7,
    )
    active: bool | None = Field(default=None, strict=True)

    @field_validator(
        "title",
        "priority",
        "frequency",
        "start_date",
        "weekdays",
        "active",
    )
    @classmethod
    def reject_null_for_required_fields(cls, value):
        """Allow omission without erasing a required database value."""

        if value is None:
            raise ValueError("value cannot be null")

        return value

    @field_validator("notes")
    @classmethod
    def convert_blank_notes_to_none(cls, value: str | None) -> str | None:
        """Allow optional notes to be cleared."""

        return value or None

    @field_validator("weekdays")
    @classmethod
    def normalize_weekdays(cls, value: list[int]) -> list[int]:
        """Reject duplicate weekdays and sort supplied selections."""

        return validate_weekdays(value)

    @model_validator(mode="after")
    def validate_supplied_schedule(self) -> Self:
        """Check related fields when both are present in this request."""

        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date cannot be before start_date")

        if self.frequency == "certainDays" and self.weekdays == []:
            raise ValueError("certainDays requires at least one weekday")

        return self


class RecurringRuleRead(BaseModel):
    """Describe a stored schedule returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_recurring_rule_id: int | None
    goal_id: int | None

    title: str
    notes: str | None
    priority: int
    frequency: RecurrenceFrequency
    start_date: date
    end_date: date | None
    weekdays: list[WeekdayIndex]
    active: bool
    created_at: datetime
