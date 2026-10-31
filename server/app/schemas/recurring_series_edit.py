"""Validate editing a schedule and rebuilding its unfinished future tasks."""

from datetime import date
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.recurrence_generation import PostgresId, RecurrenceGenerationRead
from app.schemas.recurring_rule import RecurringRuleCreate, RecurringRuleRead
from app.schemas.recurring_task_workflow import RecurringEditFromOccurrenceRequest


class RecurringSeriesEditRequest(RecurringEditFromOccurrenceRequest):
    """Accept the full schedule editor form and the device's current date.

    Reuse the existing validation for title, notes, priority, goal, frequency,
    weekdays, current_date, and horizon_days. Unlike an edit anchored to a
    selected occurrence, the schedule editor supplies its own start_date.

    This action preserves the schedule's saved active/paused state. The client
    cannot change active here; pausing and resuming remain separate actions.
    """

    start_date: date

    @model_validator(mode="after")
    def validate_schedule_dates(self) -> Self:
        """Reject an end date earlier than the editor's selected start date."""

        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        return self

    def schedule_for_series(self, *, active: bool) -> RecurringRuleCreate:
        """Validate a complete schedule while retaining its stored active state."""

        return RecurringRuleCreate.model_validate({
            **self.model_dump(exclude={"current_date", "horizon_days"}),
            "active": active,
        })


class RecurringSeriesEditRead(BaseModel):
    """Return the saved schedule and the exact task IDs affected by rebuilding.

    Completed task history is never included in the deleted or updated lists.
    The service retains earlier unfinished tasks and their placement, updates
    their editable details, and rebuilds future unfinished occurrences using
    their ORIGINAL occurrence dates rather than their current due dates.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    rule: RecurringRuleRead
    generation: RecurrenceGenerationRead
    deleted_task_ids: list[PostgresId]
    updated_task_ids: list[PostgresId]

    @model_validator(mode="after")
    def validate_rebuild_summary(self) -> Self:
        """Require one schedule and distinct, non-overlapping task-ID lists."""

        if self.generation.rules_checked != 1:
            raise ValueError("A series edit must generate for exactly one schedule")

        deleted = set(self.deleted_task_ids)
        updated = set(self.updated_task_ids)
        created = set(self.generation.created_task_ids)

        if len(deleted) != len(self.deleted_task_ids):
            raise ValueError("deleted_task_ids cannot contain duplicates")
        if len(updated) != len(self.updated_task_ids):
            raise ValueError("updated_task_ids cannot contain duplicates")
        if deleted & updated or deleted & created or updated & created:
            raise ValueError("Deleted, updated, and created task IDs must be distinct")

        return self
