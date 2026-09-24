"""Validation schemas for historical WeekFlow backup records."""

from datetime import date, timedelta
from math import floor
from typing import Self

from pydantic import Field, field_validator, model_validator

from app.schemas.backup_common import (
    BackupBoolean,
    BackupDate,
    BackupSchema,
    BackupTimestamp,
    CycleWeekNumber,
    CycleGoalOutcomeAction,
    NonNegativeInt,
    Percentage,
    SourceId,
    WeekdayName,
    WeeklyTaskDecisionAction,
    completion_pair_matches,
    require_visible_text,
)


class BackupWeeklyReviewItem(BackupSchema):
    """Validate one saved weekly review."""

    source_weekly_review_id: SourceId = Field(alias="id")
    week_start: BackupDate = Field(alias="weekStart")
    source_cycle_id: SourceId | None = Field(alias="cycleId")

    what_went_well: str | None = Field(
        alias="whatWentWell",
        max_length=2_000,
    )
    what_caused_problems: str | None = Field(
        alias="whatCausedProblems",
        max_length=2_000,
    )
    what_learned: str | None = Field(
        alias="whatLearned",
        max_length=2_000,
    )
    what_change_next_week: str | None = Field(
        alias="whatChangeNextWeek",
        max_length=2_000,
    )
    next_week_focus: str | None = Field(
        alias="nextWeekFocus",
        max_length=2_000,
    )

    snapshot_completed_count: NonNegativeInt = Field(
        alias="completedCount",
    )
    snapshot_unfinished_count: NonNegativeInt = Field(
        alias="unfinishedCount",
    )
    snapshot_overdue_count: NonNegativeInt = Field(
        alias="overdueCount",
    )
    snapshot_completion_rate: Percentage = Field(
        alias="completionRate",
    )
    snapshot_goals_progressed_count: NonNegativeInt = Field(
        alias="goalsProgressedCount",
    )
    snapshot_best_day: WeekdayName | None = Field(
        alias="bestDay",
    )
    snapshot_best_day_count: NonNegativeInt = Field(
        alias="bestDayCount",
    )
    snapshot_archived_brain_dump_count: NonNegativeInt = Field(
        alias="archivedBrainDumpCount",
    )
    snapshot_high_priority_completed_count: NonNegativeInt = Field(
        alias="highPriorityCompletedCount",
    )
    snapshot_recurring_completed_count: NonNegativeInt = Field(
        alias="recurringCompletedCount",
    )

    created_at: BackupTimestamp = Field(alias="createdAt")
    updated_at: BackupTimestamp = Field(alias="updatedAt")
    reviewed_at: BackupTimestamp = Field(alias="reviewedAt")

    @field_validator("week_start")
    @classmethod
    def require_monday(cls, value: date) -> date:
        """Weekly reviews must start on Monday."""

        if value.weekday() != 0:
            raise ValueError("weekStart must be a Monday")

        return value

    @model_validator(mode="after")
    def validate_snapshot(self) -> Self:
        """Validate the frozen weekly analytics."""

        total = (
            self.snapshot_completed_count
            + self.snapshot_unfinished_count
        )

        # Match JavaScript Math.round instead of Python's round().
        expected_rate = (
            0
            if total == 0
            else floor(
                (
                    self.snapshot_completed_count
                    / total
                    * 100
                )
                + 0.5
            )
        )

        if self.snapshot_completion_rate != expected_rate:
            raise ValueError(
                "completionRate does not match the saved counts"
            )

        if (
            self.snapshot_overdue_count
            > self.snapshot_unfinished_count
        ):
            raise ValueError(
                "overdueCount cannot exceed unfinishedCount"
            )

        completed_related_counts = [
            self.snapshot_goals_progressed_count,
            self.snapshot_best_day_count,
            self.snapshot_high_priority_completed_count,
            self.snapshot_recurring_completed_count,
        ]

        if any(
            count > self.snapshot_completed_count
            for count in completed_related_counts
        ):
            raise ValueError(
                "a completed-item snapshot count exceeds "
                "completedCount"
            )

        has_best_day = self.snapshot_best_day is not None
        has_best_day_count = self.snapshot_best_day_count > 0

        if has_best_day != has_best_day_count:
            raise ValueError(
                "bestDay and bestDayCount must describe "
                "the same state"
            )

        return self


class BackupWeeklyCommitmentItem(BackupSchema):
    """Validate one saved weekly commitment."""

    source_weekly_commitment_id: SourceId = Field(alias="id")
    week_start: BackupDate = Field(alias="weekStart")
    source_cycle_id: SourceId | None = Field(alias="cycleId")
    source_task_id: SourceId | None = Field(alias="taskId")

    title: str
    completed: BackupBoolean

    created_at: BackupTimestamp = Field(alias="createdAt")
    completed_at: BackupTimestamp | None = Field(alias="completedAt")

    @field_validator("week_start")
    @classmethod
    def require_monday(cls, value: date) -> date:
        """Weekly commitments must start on Monday."""

        if value.weekday() != 0:
            raise ValueError("weekStart must be a Monday")

        return value

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        """Reject blank or oversized commitment titles."""

        return require_visible_text(
            value,
            "weekly commitment title",
            max_length=180,
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
                "the same commitment state"
            )

        return self


class BackupWeeklyTaskDecisionItem(BackupSchema):
    """Validate one historical unfinished-task decision."""

    source_weekly_task_decision_id: SourceId = Field(alias="id")
    week_start: BackupDate = Field(alias="weekStart")
    source_task_id: SourceId | None = Field(alias="taskId")

    task_title: str = Field(alias="taskTitle")
    original_due_date: BackupDate = Field(alias="originalDueDate")
    action: WeeklyTaskDecisionAction
    resolved_due_date: BackupDate | None = Field(alias="resolvedDueDate")

    source_recurring_rule_id: SourceId | None = Field(
        alias="recurringRuleId",
    )
    recurrence_occurrence_date: BackupDate | None = Field(
        alias="recurrenceOccurrenceDate",
    )

    decided_at: BackupTimestamp = Field(alias="decidedAt")

    @field_validator("week_start")
    @classmethod
    def require_monday(cls, value: date) -> date:
        """Weekly decisions must start on Monday."""

        if value.weekday() != 0:
            raise ValueError("weekStart must be a Monday")

        return value

    @field_validator("task_title")
    @classmethod
    def validate_task_title(cls, value: str) -> str:
        """Require a preserved task title."""

        return require_visible_text(
            value,
            "weekly decision task title",
        )

    @model_validator(mode="after")
    def validate_decision(self) -> Self:
        """Validate dates, actions, and recurring identity."""

        week_end = self.week_start + timedelta(days=7)

        if not (
            self.week_start
            <= self.original_due_date
            < week_end
        ):
            raise ValueError(
                "originalDueDate must fall inside its review week"
            )

        action_moves_task = self.action in {
            "nextWeek",
            "reschedule",
        }

        if action_moves_task != (
            self.resolved_due_date is not None
        ):
            raise ValueError(
                "resolvedDueDate does not match the selected action"
            )

        if (
            self.action == "nextWeek"
            and self.resolved_due_date
            != self.original_due_date + timedelta(days=7)
        ):
            raise ValueError(
                "nextWeek must preserve the original weekday"
            )

        if (
            self.action == "delete"
            and self.source_task_id is not None
        ):
            raise ValueError(
                "a deleted task decision cannot keep taskId"
            )

        has_recurring_rule = (
            self.source_recurring_rule_id is not None
        )
        has_occurrence_date = (
            self.recurrence_occurrence_date is not None
        )

        if has_recurring_rule != has_occurrence_date:
            raise ValueError(
                "recurringRuleId and recurrenceOccurrenceDate "
                "must both be present or both be null"
            )

        return self


class BackupCycleReviewItem(BackupSchema):
    """Validate one saved Week 13 planning-cycle review."""

    source_cycle_review_id: SourceId = Field(alias="id")
    source_cycle_id: SourceId = Field(alias="cycleId")

    biggest_accomplishment: str | None = Field(
        alias="biggestAccomplishment",
        max_length=2_000,
    )
    biggest_challenge: str | None = Field(
        alias="biggestChallenge",
        max_length=2_000,
    )
    what_worked_well: str | None = Field(
        alias="whatWorkedWell",
        max_length=2_000,
    )
    what_change_next_cycle: str | None = Field(
        alias="whatChangeNextCycle",
        max_length=2_000,
    )
    what_stop_doing: str | None = Field(
        alias="whatStopDoing",
        max_length=2_000,
    )
    what_continue_doing: str | None = Field(
        alias="whatContinueDoing",
        max_length=2_000,
    )
    what_learned: str | None = Field(
        alias="whatLearned",
        max_length=2_000,
    )

    snapshot_goal_total: NonNegativeInt = Field(
        alias="goalTotal",
    )
    snapshot_goal_completed: NonNegativeInt = Field(
        alias="goalCompleted",
    )
    snapshot_task_completed: NonNegativeInt = Field(
        alias="taskCompleted",
    )
    snapshot_milestone_total: NonNegativeInt = Field(
        alias="milestoneTotal",
    )
    snapshot_milestone_completed: NonNegativeInt = Field(
        alias="milestoneCompleted",
    )
    snapshot_weekly_reviews_completed: NonNegativeInt = Field(
        alias="weeklyReviewsCompleted",
    )
    snapshot_longest_streak: NonNegativeInt = Field(
        alias="longestStreak",
    )
    snapshot_best_week_number: CycleWeekNumber | None = Field(
        alias="bestWeekNumber",
    )
    snapshot_best_week_count: NonNegativeInt = Field(
        alias="bestWeekCount",
    )
    snapshot_best_day: str | None = Field(alias="bestDay")
    snapshot_best_day_count: NonNegativeInt = Field(
        alias="bestDayCount",
    )
    snapshot_high_priority_completed: NonNegativeInt = Field(
        alias="highPriorityCompleted",
    )
    snapshot_recurring_completed: NonNegativeInt = Field(
        alias="recurringCompleted",
    )
    snapshot_rewards_unlocked: NonNegativeInt = Field(
        alias="rewardsUnlocked",
    )
    snapshot_brain_dumps_archived: NonNegativeInt = Field(
        alias="brainDumpsArchived",
    )

    next_cycle_name: str | None = Field(
        alias="nextCycleName",
        max_length=80,
    )
    next_cycle_primary_focus: str | None = Field(
        alias="nextCyclePrimaryFocus",
        max_length=300,
    )
    next_cycle_theme: str | None = Field(
        alias="nextCycleTheme",
        max_length=120,
    )
    next_cycle_start_date: BackupDate | None = Field(
        alias="nextCycleStartDate",
    )
    next_cycle_first_commitments: list[str] = Field(
        alias="nextCycleFirstWeekCommitments",
        max_length=5,
    )
    source_next_cycle_id: SourceId | None = Field(
        alias="nextCycleId",
    )

    created_at: BackupTimestamp = Field(alias="createdAt")
    updated_at: BackupTimestamp = Field(alias="updatedAt")
    finalized_at: BackupTimestamp | None = Field(alias="finalizedAt")

    @field_validator("next_cycle_first_commitments")
    @classmethod
    def validate_first_commitments(
        cls,
        value: list[str],
    ) -> list[str]:
        """Validate the first commitments for the next cycle."""

        for commitment in value:
            require_visible_text(
                commitment,
                "first-week commitment",
                max_length=180,
            )

        normalized = [
            commitment.strip().lower()
            for commitment in value
        ]

        if len(normalized) != len(set(normalized)):
            raise ValueError(
                "first-week commitments cannot contain duplicates"
            )

        return value

    @model_validator(mode="after")
    def validate_review(self) -> Self:
        """Validate frozen analytics and finalization state."""

        if (
            self.snapshot_goal_completed
            > self.snapshot_goal_total
        ):
            raise ValueError(
                "goalCompleted cannot exceed goalTotal"
            )

        if (
            self.snapshot_milestone_completed
            > self.snapshot_milestone_total
        ):
            raise ValueError(
                "milestoneCompleted cannot exceed milestoneTotal"
            )

        task_related_counts = [
            self.snapshot_high_priority_completed,
            self.snapshot_recurring_completed,
            self.snapshot_best_week_count,
            self.snapshot_best_day_count,
        ]

        if any(
            count > self.snapshot_task_completed
            for count in task_related_counts
        ):
            raise ValueError(
                "a task snapshot count exceeds taskCompleted"
            )

        if (
            self.snapshot_rewards_unlocked
            > self.snapshot_goal_completed
        ):
            raise ValueError(
                "rewardsUnlocked cannot exceed goalCompleted"
            )

        if (
            self.finalized_at is not None
            and self.next_cycle_start_date is None
        ):
            raise ValueError(
                "a finalized cycle review requires "
                "nextCycleStartDate"
            )

        return self


class BackupCycleGoalOutcomeItem(BackupSchema):
    """Validate one saved Goal decision from a cycle review."""

    source_cycle_goal_outcome_id: SourceId = Field(alias="id")
    source_cycle_review_id: SourceId = Field(
        alias="cycleReviewId",
    )
    source_goal_id: SourceId | None = Field(alias="goalId")

    goal_title: str = Field(alias="goalTitle")
    action: CycleGoalOutcomeAction
    replacement_title: str | None = Field(
        alias="replacementTitle",
        max_length=180,
    )

    source_destination_goal_id: SourceId | None = Field(
        alias="destinationGoalId",
    )

    created_at: BackupTimestamp = Field(alias="createdAt")
    updated_at: BackupTimestamp = Field(alias="updatedAt")

    @field_validator("goal_title")
    @classmethod
    def validate_goal_title(cls, value: str) -> str:
        """Require the preserved historical Goal title."""

        return require_visible_text(
            value,
            "cycle outcome goal title",
        )

    @model_validator(mode="after")
    def validate_replacement(self) -> Self:
        """Require replacement text only for replace actions."""

        if self.action == "replace":
            if self.replacement_title is None:
                raise ValueError(
                    "replace requires replacementTitle"
                )

            require_visible_text(
                self.replacement_title,
                "replacement title",
                max_length=180,
            )

        elif self.replacement_title is not None:
            raise ValueError(
                "replacementTitle is only valid for replace"
            )

        return self
