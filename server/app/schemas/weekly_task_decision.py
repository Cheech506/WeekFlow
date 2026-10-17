"""Validation schemas for handling unfinished tasks during a weekly review."""

from datetime import date, datetime, timedelta
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PostgresId = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
WeeklyTaskDecisionAction = Literal["nextWeek", "inbox", "reschedule", "keep", "delete"]


class WeeklyTaskDecisionCreate(BaseModel):
    """Request a task action and record its history in the same transaction.

    task_id always identifies the existing PostgreSQL task, including when
    action is delete. The server copies the task's title and recurring
    identity before changing or deleting it. original_due_date lets the
    router reject a stale request if the task has already been moved.
    """

    model_config = ConfigDict(extra="forbid")

    week_start: date
    task_id: PostgresId
    original_due_date: date
    action: WeeklyTaskDecisionAction
    resolved_due_date: date | None = None

    @field_validator("week_start")
    @classmethod
    def require_monday(cls, value: date) -> date:
        if value.weekday() != 0:
            raise ValueError("week_start must be a Monday")
        return value

    @model_validator(mode="after")
    def validate_action_dates(self) -> Self:
        """Keep the original date in the review week and validate the action."""

        days_into_week = (self.original_due_date - self.week_start).days
        if not 0 <= days_into_week < 7:
            raise ValueError("original_due_date must belong to the selected review week")

        if self.action == "nextWeek":
            try:
                expected = self.original_due_date + timedelta(days=7)
            except OverflowError as error:
                raise ValueError("The next-week date exceeds the supported calendar") from error

            if self.resolved_due_date is not None and self.resolved_due_date != expected:
                raise ValueError("nextWeek must move the task exactly seven days forward")
            self.resolved_due_date = expected

        elif self.action == "reschedule":
            if self.resolved_due_date is None:
                raise ValueError("reschedule requires resolved_due_date")

        elif self.resolved_due_date is not None:
            raise ValueError("inbox, keep, and delete must not include a resolved date")

        return self


class WeeklyTaskDecisionRead(BaseModel):
    """Return the saved decision even after its task or schedule is deleted.

    Deleted tasks have task_id=null. The saved title, dates, action, and
    recurring identity remain as history. Source IDs are migration metadata
    and cannot be supplied through the normal create endpoint.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_weekly_task_decision_id: int | None
    week_start: date
    task_id: int | None
    task_title: str
    original_due_date: date
    action: WeeklyTaskDecisionAction
    resolved_due_date: date | None
    recurring_rule_id: int | None
    source_recurring_rule_id: int | None
    recurrence_occurrence_date: date | None
    decided_at: datetime
