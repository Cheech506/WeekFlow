"""Validation schemas for core records in a WeekFlow backup."""

from datetime import timedelta
from typing import Self

from pydantic import Field, field_validator, model_validator

from app.schemas.backup_common import (
    BackupBoolean,
    BackupDate,
    BackupSchema,
    BackupTimestamp,
    NonNegativeInt,
    Priority,
    RecurrenceFrequency,
    SourceId,
    WeekdayIndex,
    completion_pair_matches,
    require_visible_text,
)


class BackupGoalItem(BackupSchema):
    """Validate one Goal from a WeekFlow backup."""

    source_goal_id: SourceId = Field(alias="id")
    source_cycle_id: SourceId | None = Field(alias="cycleId")

    title: str
    completed: BackupBoolean

    created_at: BackupTimestamp = Field(alias="createdAt")
    completed_at: BackupTimestamp | None = Field(alias="completedAt")

    # SQLite stores these Goal values as full ISO timestamps.
    start_date: BackupTimestamp = Field(alias="startDate")
    end_date: BackupTimestamp = Field(alias="endDate")

    reward: str | None = Field(max_length=200)
    purpose: str | None = Field(max_length=500)
    success_definition: str | None = Field(
        alias="successDefinition",
        max_length=500,
    )
    notes: str | None = Field(max_length=2_000)

    completion_what_helped: str | None = Field(
        alias="completionWhatHelped",
        max_length=1_000,
    )
    completion_hardest_part: str | None = Field(
        alias="completionHardestPart",
        max_length=1_000,
    )
    completion_learned: str | None = Field(
        alias="completionLearned",
        max_length=1_000,
    )
    completion_do_differently: str | None = Field(
        alias="completionDoDifferently",
        max_length=1_000,
    )

    completion_task_total: NonNegativeInt | None = Field(
        alias="completionTaskTotal",
    )
    completion_task_completed: NonNegativeInt | None = Field(
        alias="completionTaskCompleted",
    )
    completion_milestone_total: NonNegativeInt | None = Field(
        alias="completionMilestoneTotal",
    )
    completion_milestone_completed: NonNegativeInt | None = Field(
        alias="completionMilestoneCompleted",
    )
    completion_high_priority_completed: (
        NonNegativeInt | None
    ) = Field(
        alias="completionHighPriorityCompleted",
    )

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """Reject an empty Goal title."""

        return require_visible_text(
            value,
            "goal title",
        )

    @model_validator(mode="after")
    def validate_goal_state(self) -> Self:
        """Validate Goal dates, completion state, and snapshots."""

        if not completion_pair_matches(
            self.completed,
            self.completed_at,
        ):
            raise ValueError(
                "completed and completedAt must describe "
                "the same Goal state"
            )

        if self.end_date < self.start_date:
            raise ValueError(
                "endDate cannot be before startDate"
            )

        if (
            self.completion_task_total is not None
            and self.completion_task_completed is not None
            and self.completion_task_completed
            > self.completion_task_total
        ):
            raise ValueError(
                "completed task count cannot exceed task total"
            )

        if (
            self.completion_milestone_total is not None
            and self.completion_milestone_completed is not None
            and self.completion_milestone_completed
            > self.completion_milestone_total
        ):
            raise ValueError(
                "completed milestone count cannot exceed "
                "milestone total"
            )

        if (
            self.completion_task_completed is not None
            and self.completion_high_priority_completed
            is not None
            and self.completion_high_priority_completed
            > self.completion_task_completed
        ):
            raise ValueError(
                "high-priority completion count cannot exceed "
                "completed task count"
            )

        return self


class BackupGoalMilestoneItem(BackupSchema):
    """Validate one Goal milestone from a backup."""

    source_goal_milestone_id: SourceId = Field(alias="id")
    source_goal_id: SourceId = Field(alias="goalId")

    title: str
    notes: str | None = Field(max_length=500)
    target_date: BackupDate | None = Field(alias="targetDate")

    completed: BackupBoolean
    created_at: BackupTimestamp = Field(alias="createdAt")
    completed_at: BackupTimestamp | None = Field(alias="completedAt")

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """Reject blank or oversized milestone titles."""

        return require_visible_text(
            value,
            "milestone title",
            max_length=160,
        )

    @model_validator(mode="after")
    def validate_completion_state(self) -> Self:
        """Require completion status and time to agree."""

        if not completion_pair_matches(
            self.completed,
            self.completed_at,
        ):
            raise ValueError(
                "completed and completedAt must describe "
                "the same milestone state"
            )

        return self


class BackupBrainDumpItem(BackupSchema):
    """Validate one Brain Dump note from a backup."""

    source_brain_dump_id: SourceId = Field(alias="id")

    body: str
    archived: BackupBoolean

    created_at: BackupTimestamp = Field(alias="createdAt")
    archived_at: BackupTimestamp | None = Field(alias="archivedAt")

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: str) -> str:
        """Reject an empty Brain Dump note."""

        return require_visible_text(
            value,
            "Brain Dump body",
        )

    @model_validator(mode="after")
    def validate_archive_state(self) -> Self:
        """Require archive status and time to agree."""

        if self.archived != (self.archived_at is not None):
            raise ValueError(
                "archived and archivedAt must describe "
                "the same archive state"
            )

        return self


class BackupTaskTemplateItem(BackupSchema):
    """Validate one reusable task template from a backup."""

    source_task_template_id: SourceId = Field(alias="id")
    source_goal_id: SourceId | None = Field(alias="goalId")

    title: str
    notes: str | None
    priority: Priority

    created_at: BackupTimestamp = Field(alias="createdAt")
    updated_at: BackupTimestamp = Field(alias="updatedAt")

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """Reject an empty template title."""

        return require_visible_text(
            value,
            "task template title",
        )


class BackupRecurringRuleItem(BackupSchema):
    """Validate one recurring schedule from a backup."""

    source_recurring_rule_id: SourceId = Field(alias="id")
    source_goal_id: SourceId | None = Field(alias="goalId")

    title: str
    notes: str | None
    priority: Priority
    frequency: RecurrenceFrequency

    start_date: BackupDate = Field(alias="startDate")
    end_date: BackupDate | None = Field(alias="endDate")
    weekdays: list[WeekdayIndex]

    active: BackupBoolean
    created_at: BackupTimestamp = Field(alias="createdAt")

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """Reject an empty recurring schedule title."""

        return require_visible_text(
            value,
            "recurring schedule title",
        )

    @model_validator(mode="after")
    def validate_schedule(self) -> Self:
        """Validate schedule dates and selected weekdays."""

        if (
            self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError(
                "endDate cannot be before startDate"
            )

        if len(self.weekdays) != len(set(self.weekdays)):
            raise ValueError(
                "weekdays cannot contain duplicates"
            )

        if (
            self.frequency == "certainDays"
            and not self.weekdays
        ):
            raise ValueError(
                "certainDays requires at least one weekday"
            )

        return self


class BackupRecurringExceptionItem(BackupSchema):
    """Validate one skipped recurring occurrence."""

    source_recurring_rule_id: SourceId = Field(
        alias="recurringRuleId",
    )
    occurrence_date: BackupDate = Field(alias="occurrenceDate")
    created_at: BackupTimestamp = Field(alias="createdAt")


class BackupPlanningCycleItem(BackupSchema):
    """Validate one twelve-week planning cycle."""

    source_planning_cycle_id: SourceId = Field(alias="id")

    name: str | None = Field(max_length=80)
    primary_focus: str | None = Field(
        alias="primaryFocus",
        max_length=300,
    )
    theme: str | None = Field(max_length=120)

    start_date: BackupDate = Field(alias="startDate")
    end_date: BackupDate = Field(alias="endDate")

    active: BackupBoolean
    created_at: BackupTimestamp = Field(alias="createdAt")
    completed_at: BackupTimestamp | None = Field(alias="completedAt")

    @model_validator(mode="after")
    def validate_cycle(self) -> Self:
        """Validate cycle length and completion state."""

        expected_end_date = (
            self.start_date
            + timedelta(days=83)
        )

        if self.end_date != expected_end_date:
            raise ValueError(
                "planning cycle must contain exactly twelve weeks"
            )

        if self.active == (self.completed_at is not None):
            raise ValueError(
                "active and completedAt must describe "
                "the same planning-cycle state"
            )

        return self