"""Validation schemas for weekly-commitment API requests and responses."""

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
    Field(strict=True, gt=0, le=2_147_483_647),
]


class WeeklyCommitmentCreate(BaseModel):
    """Create a standalone promise or select an existing PostgreSQL task."""

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    week_start: date
    cycle_id: PostgresId | None = None
    task_id: PostgresId | None = None

    # Standalone commitments require a title. Task-linked commitments copy
    # their title and completion state from the task in the router.
    title: str | None = Field(default=None, min_length=1, max_length=180)

    @field_validator("week_start")
    @classmethod
    def require_monday(cls, value: date) -> date:
        """Store the Monday identifying the selected week."""

        if value.weekday() != 0:
            raise ValueError("week_start must be a Monday")

        return value

    @model_validator(mode="after")
    def validate_commitment_type(self) -> Self:
        """Require a title for a promise and use task details for a task."""

        if self.task_id is None and self.title is None:
            raise ValueError("A standalone commitment requires a title")

        if self.task_id is not None and self.title is not None:
            raise ValueError("Omit title for a task-linked commitment; the server copies it from the task")

        return self


class WeeklyCommitmentUpdate(BaseModel):
    """Edit a standalone title or complete/reopen a commitment.

    The week and parent links are fixed after creation. The router rejects
    title edits on task-linked commitments, whose title follows the task.
    Completion changes on a linked commitment also update its live task.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str | None = Field(default=None, min_length=1, max_length=180)
    completed: bool | None = Field(default=None, strict=True)

    @field_validator("title", "completed")
    @classmethod
    def reject_null_for_required_fields(cls, value):
        """Allow omission without erasing required database values."""

        if value is None:
            raise ValueError("value cannot be null")

        return value


class WeeklyCommitmentRead(BaseModel):
    """Return commitment identity, parent links, and displayed task state.

    The router uses the task's current title and completion fields while
    its link exists. Stored commitment values provide the fallback when
    the task has been deleted and the foreign key has been cleared.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_weekly_commitment_id: int | None
    week_start: date
    cycle_id: int | None
    task_id: int | None

    title: str
    completed: bool
    created_at: datetime
    completed_at: datetime | None
