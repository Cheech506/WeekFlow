"""Validate converting tasks and editing a recurring series from an occurrence."""

from datetime import date
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.recurrence_generation import (
    PostgresId,
    RecurrenceGenerationRead,
    validated_window_end,
)
from app.schemas.recurring_rule import (
    RecurrenceFrequency,
    RecurringRuleCreate,
    RecurringRuleRead,
    WeekdayIndex,
    validate_weekdays,
)
from app.schemas.task import TaskRead


class _GenerationWindow(BaseModel):
    """Use the device's calendar date when rebuilding upcoming occurrences."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # Never infer the user's calendar date from the server's timezone.
    current_date: date
    horizon_days: int = Field(default=30, strict=True, ge=0, le=366)

    @model_validator(mode="after")
    def validate_generation_window(self) -> Self:
        """Reject a window that would extend beyond the supported dates."""

        validated_window_end(self.current_date, self.horizon_days)
        return self


class TaskConvertToRecurringRequest(RecurringRuleCreate, _GenerationWindow):
    """Turn an unfinished standalone task into a schedule's first occurrence.

    The selected task receives these schedule details and start date. Its
    PostgreSQL ID, original source_task_id, and created_at are preserved.
    Creating the rule, linking the task, and generating upcoming tasks must
    be handled together by the service in one database transaction.
    """

    @model_validator(mode="after")
    def validate_first_occurrence(self) -> Self:
        """A new series starts active and includes its selected first date."""

        if not self.active:
            raise ValueError("A converted recurring schedule must start active")

        # Python uses Monday=0; WeekFlow uses Sunday=0.
        weekday = (self.start_date.weekday() + 1) % 7
        if self.frequency == "certainDays" and weekday not in self.weekdays:
            raise ValueError(
                "The first scheduled date must be one of the selected weekdays"
            )

        return self


class RecurringEditFromOccurrenceRequest(_GenerationWindow):
    """Replace a series' editable details from a selected task onward.

    This is a complete edit form, not a PATCH. Omitted optional values use
    their defaults: notes and goal are cleared, priority becomes zero, and
    no end date means an open-ended schedule. The app should send its full
    edit form, including values it wants to retain.

    The service reads the start date from the selected task's ORIGINAL
    recurrence_occurrence_date. The task's due date or Inbox placement can
    differ and must be preserved. The schedule's active state is preserved.
    """

    title: str = Field(min_length=1)
    notes: str | None = None
    priority: int = Field(default=0, strict=True, ge=0, le=2)
    goal_id: PostgresId | None = None
    frequency: RecurrenceFrequency
    end_date: date | None = None
    weekdays: list[WeekdayIndex] = Field(default_factory=list, max_length=7)

    @field_validator("notes")
    @classmethod
    def convert_blank_notes_to_none(cls, value: str | None) -> str | None:
        """Allow the edit form to clear optional notes."""

        return value or None

    @field_validator("weekdays")
    @classmethod
    def normalize_weekdays(cls, value: list[int]) -> list[int]:
        """Reject duplicate selections and store Sunday-to-Saturday order."""

        return validate_weekdays(value)

    @model_validator(mode="after")
    def validate_selected_weekdays(self) -> Self:
        """A selected-days pattern must include at least one weekday."""

        if self.frequency == "certainDays" and not self.weekdays:
            raise ValueError("certainDays requires at least one weekday")

        return self

    def schedule_for_occurrence(
        self,
        occurrence_date: date,
        *,
        active: bool,
    ) -> RecurringRuleCreate:
        """Validate the complete schedule after loading the selected task.

        Only the service knows the saved occurrence date and active state.
        Reuse the existing schedule schema to check end_date >= start_date.
        A selected task can remain even when its date is outside a newly
        selected weekday pattern; later tasks follow the revised pattern.
        """

        return RecurringRuleCreate.model_validate({
            **self.model_dump(exclude={"current_date", "horizon_days"}),
            "start_date": occurrence_date,
            "active": active,
        })


class RecurringTaskWorkflowRead(BaseModel):
    """Return the retained task, saved schedule, and rebuild summary."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    task: TaskRead
    rule: RecurringRuleRead
    # These counts describe generation only. The retained selected task is
    # not a newly created task, even when it has just joined a new schedule.
    generation: RecurrenceGenerationRead
    # Only later unfinished tasks may be removed by a series edit.
    # Conversion always returns an empty list here.
    deleted_task_ids: list[PostgresId]

    @model_validator(mode="after")
    def validate_retained_task(self) -> Self:
        """Keep the returned relationships and generated/deleted IDs coherent."""

        if self.task.recurring_rule_id != self.rule.id:
            raise ValueError("The retained task must link to the returned schedule")
        if self.task.recurrence_occurrence_date != self.rule.start_date:
            raise ValueError("The selected occurrence must anchor the saved schedule")
        if self.task.completed:
            raise ValueError("The selected task must remain unfinished")
        if self.generation.rules_checked != 1:
            raise ValueError("A task workflow must generate for exactly one schedule")

        deleted = set(self.deleted_task_ids)
        created = set(self.generation.created_task_ids)
        if len(deleted) != len(self.deleted_task_ids):
            raise ValueError("deleted_task_ids cannot contain duplicates")
        if self.task.id in deleted or self.task.id in created:
            raise ValueError("The retained task cannot be deleted or newly generated")
        if deleted & created:
            raise ValueError("A task cannot be both deleted and newly generated")

        return self
