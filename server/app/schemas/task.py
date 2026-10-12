"""Validation schemas for task requests and responses."""

from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


PostgresId = Annotated[
    int,
    Field(
        strict=True,
        gt=0,
        le=2_147_483_647,
    ),
]


class TaskCreate(BaseModel):
    """Validate information supplied when creating a task."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str = Field(min_length=1)
    due_date: date | None = None
    notes: str | None = None

    priority: int = Field(
        default=0,
        ge=0,
        le=2,
    )

    goal_id: PostgresId | None = None
    recurring_rule_id: PostgresId | None = None
    recurrence_occurrence_date: date | None = None

    @model_validator(mode="after")
    def require_recurring_identity_pair(self) -> Self:
        """Require a schedule and original occurrence date together."""

        has_rule = self.recurring_rule_id is not None
        has_date = self.recurrence_occurrence_date is not None

        if has_rule != has_date:
            raise ValueError(
                "recurring_rule_id and recurrence_occurrence_date "
                "must be supplied together"
            )

        return self


class TaskUpdate(BaseModel):
    """Validate a partial update to an existing task."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str | None = Field(
        default=None,
        min_length=1,
    )

    due_date: date | None = None
    notes: str | None = None

    priority: int | None = Field(
        default=None,
        ge=0,
        le=2,
    )

    completed: bool | None = None

    # Omit to retain the goal; send null to unlink it.
    goal_id: PostgresId | None = None

    @field_validator(
        "title",
        "priority",
        "completed",
    )
    @classmethod
    def reject_null_for_required_database_fields(cls, value):
        """Allow omission without allowing required values to be erased."""

        if value is None:
            raise ValueError("value cannot be null")

        return value


class TaskRead(BaseModel):
    """Describe a task returned by the API."""

    model_config = ConfigDict(
        from_attributes=True,
    )

    id: int
    title: str
    day: str

    due_date: date | None
    notes: str | None
    priority: int

    completed: bool
    created_at: datetime
    completed_at: datetime | None

    goal_id: int | None = None
    recurring_rule_id: int | None = None

    source_task_id: int | None = None
    source_goal_id: int | None = None
    source_recurring_rule_id: int | None = None

    recurrence_occurrence_date: date | None = None