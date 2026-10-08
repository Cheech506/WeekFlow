"""Validation schemas for planning-cycle API requests and responses."""

from datetime import date, datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


class PlanningCycleCreate(BaseModel):
    """Validate a request to start a new planning cycle."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    start_date: date

    name: str | None = Field(
        default=None,
        max_length=80,
    )

    primary_focus: str | None = Field(
        default=None,
        max_length=300,
    )

    theme: str | None = Field(
        default=None,
        max_length=120,
    )

    @field_validator(
        "name",
        "primary_focus",
        "theme",
    )
    @classmethod
    def convert_blank_text_to_none(
        cls,
        value: str | None,
    ) -> str | None:
        """Store empty optional text as null."""

        return value or None


class PlanningCycleUpdate(BaseModel):
    """Validate changes to an active planning cycle."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    start_date: date | None = None

    name: str | None = Field(
        default=None,
        max_length=80,
    )

    primary_focus: str | None = Field(
        default=None,
        max_length=300,
    )

    theme: str | None = Field(
        default=None,
        max_length=120,
    )

    @field_validator("start_date")
    @classmethod
    def reject_null_start_date(
        cls,
        value: date | None,
    ) -> date:
        """Allow start_date to be omitted but not erased."""

        if value is None:
            raise ValueError(
                "start_date cannot be null"
            )

        return value

    @field_validator(
        "name",
        "primary_focus",
        "theme",
    )
    @classmethod
    def convert_blank_text_to_none(
        cls,
        value: str | None,
    ) -> str | None:
        """Store empty optional text as null."""

        return value or None


class PlanningCycleRead(BaseModel):
    """Describe a planning cycle returned by the API."""

    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    source_planning_cycle_id: int | None

    name: str | None
    primary_focus: str | None
    theme: str | None

    start_date: date
    end_date: date
    active: bool

    created_at: datetime
    completed_at: datetime | None