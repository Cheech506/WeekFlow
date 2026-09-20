"""Validation schemas for importing SQLite tasks into PostgreSQL."""

from datetime import date, datetime
from typing import Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


# JavaScript and TypeScript can represent integers exactly through this value.
MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991

TaskDay = Literal[
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Inbox",
]

TaskImportStatus = Literal[
    "created",
    "unchanged",
]


class TaskImportItem(BaseModel):
    """Validate one task taken directly from a WeekFlow backup."""

    model_config = ConfigDict(
        extra="forbid",
    )

    # Pydantic aliases map the backup's camelCase fields to the names used
    # by the PostgreSQL Task model.
    source_task_id: int = Field(
        alias="id",
        gt=0,
        le=MAX_JS_SAFE_INTEGER,
    )
    title: str
    day: TaskDay
    due_date: date | None = Field(
        alias="dueDate",
    )
    notes: str | None
    priority: int = Field(
        ge=0,
        le=2,
    )
    source_goal_id: int | None = Field(
        alias="goalId",
        gt=0,
        le=MAX_JS_SAFE_INTEGER,
    )
    completed: bool
    created_at: datetime = Field(
        alias="createdAt",
    )
    completed_at: datetime | None = Field(
        alias="completedAt",
    )
    source_recurring_rule_id: int | None = Field(
        alias="recurringRuleId",
        gt=0,
        le=MAX_JS_SAFE_INTEGER,
    )
    recurrence_occurrence_date: date | None = Field(
        alias="recurrenceOccurrenceDate",
    )

    @field_validator("title")
    @classmethod
    def reject_blank_title(cls, value: str) -> str:
        """Require at least one visible character without changing the title."""

        if not value.strip():
            raise ValueError("title cannot be blank")

        return value

    @field_validator(
        "created_at",
        "completed_at",
    )
    @classmethod
    def require_timezone(
        cls,
        value: datetime | None,
    ) -> datetime | None:
        """Require timestamps that identify an exact moment in time."""

        if value is not None and value.utcoffset() is None:
            raise ValueError("timestamp must include a timezone")

        return value

    @model_validator(mode="after")
    def validate_linked_values(self) -> Self:
        """Check relationships that depend on more than one field."""

        has_completion_time = self.completed_at is not None

        if self.completed != has_completion_time:
            raise ValueError(
                "completed and completedAt must describe the same state"
            )

        has_recurring_rule = self.source_recurring_rule_id is not None
        has_occurrence_date = (
            self.recurrence_occurrence_date is not None
        )

        if has_recurring_rule != has_occurrence_date:
            raise ValueError(
                "recurringRuleId and recurrenceOccurrenceDate "
                "must both be present or both be null"
            )

        return self


class TaskImportRequest(BaseModel):
    """Validate one transactional batch of SQLite tasks."""

    model_config = ConfigDict(
        extra="forbid",
    )

    tasks: list[TaskImportItem] = Field(
        min_length=1,
        max_length=1_000,
    )

    @model_validator(mode="after")
    def reject_duplicate_identities(self) -> Self:
        """Reject duplicate task or recurring identities within one batch."""

        source_task_ids = [
            task.source_task_id
            for task in self.tasks
        ]

        if len(source_task_ids) != len(set(source_task_ids)):
            raise ValueError(
                "tasks contain duplicate source task IDs"
            )

        recurring_identities = [
            (
                task.source_recurring_rule_id,
                task.recurrence_occurrence_date,
            )
            for task in self.tasks
            if task.source_recurring_rule_id is not None
        ]

        if len(recurring_identities) != len(
            set(recurring_identities)
        ):
            raise ValueError(
                "tasks contain duplicate recurring occurrence identities"
            )

        return self


class TaskImportMapping(BaseModel):
    """Connect one original SQLite task ID to its PostgreSQL ID."""

    source_task_id: int
    task_id: int
    status: TaskImportStatus


class TaskImportResult(BaseModel):
    """Summarize one completed task-import request."""

    received_count: int = Field(ge=0)
    created_count: int = Field(ge=0)
    unchanged_count: int = Field(ge=0)
    mappings: list[TaskImportMapping]


class TaskImportPreviewResult(BaseModel):
    """Describe a task migration without changing PostgreSQL."""

    received_count: int = Field(ge=0)
    would_create_count: int = Field(ge=0)
    already_imported_count: int = Field(ge=0)
    conflict_count: int = Field(ge=0)
    conflict_source_task_ids: list[int]
    goal_linked_count: int = Field(ge=0)
    recurring_count: int = Field(ge=0)
    completed_count: int = Field(ge=0)
    can_import: bool

    # Literal[False] guarantees that a preview can never claim it
    # changed the database.
    database_changed: Literal[False] = False