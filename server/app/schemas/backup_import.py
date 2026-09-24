"""Validation contract for importing a complete WeekFlow backup."""

from typing import Literal, Self

from pydantic import (
    AwareDatetime,
    Field,
    field_validator,
    model_validator,
)

from app.schemas.backup_common import (
    BackupSchema,
    BackupTimestamp,
    NonNegativeInt,
    require_visible_text,
)
from app.schemas.backup_core import (
    BackupBrainDumpItem,
    BackupGoalItem,
    BackupGoalMilestoneItem,
    BackupPlanningCycleItem,
    BackupRecurringExceptionItem,
    BackupRecurringRuleItem,
    BackupTaskTemplateItem,
)
from app.schemas.backup_history import (
    BackupCycleGoalOutcomeItem,
    BackupCycleReviewItem,
    BackupWeeklyCommitmentItem,
    BackupWeeklyReviewItem,
    BackupWeeklyTaskDecisionItem,
)
from app.schemas.task_import import TaskImportItem


def reject_duplicates(
    values: list[object],
    label: str,
) -> None:
    """Reject repeated identities inside one backup."""

    if len(values) != len(set(values)):
        raise ValueError(
            f"backup contains duplicate {label} identities"
        )


class WeekFlowBackupMetadata(BackupSchema):
    """Validate identifying information saved with a backup."""

    app_version: str = Field(alias="appVersion")
    data_model_version: Literal[1] = Field(
        alias="dataModelVersion",
    )

    @field_validator("data_model_version", mode="before")
    @classmethod
    def require_integer_data_model_version(
        cls,
        value: object,
    ) -> object:
        """Reject booleans and floats that merely equal one."""

        if type(value) is not int:
            raise ValueError(
                "dataModelVersion must be an integer"
            )

        return value

    @field_validator("app_version")
    @classmethod
    def validate_app_version(cls, value: str) -> str:
        """Require a visible app version."""

        return require_visible_text(
            value,
            "appVersion",
        )


class WeekFlowBackupData(BackupSchema):
    """Validate every data collection in a version 12 backup."""

    tasks: list[TaskImportItem]
    goals: list[BackupGoalItem]

    goal_milestones: list[
        BackupGoalMilestoneItem
    ] = Field(alias="goalMilestones")

    brain_dumps: list[
        BackupBrainDumpItem
    ] = Field(alias="brainDumps")

    task_templates: list[
        BackupTaskTemplateItem
    ] = Field(alias="taskTemplates")

    recurring_rules: list[
        BackupRecurringRuleItem
    ] = Field(alias="recurringRules")

    recurring_exceptions: list[
        BackupRecurringExceptionItem
    ] = Field(alias="recurringExceptions")

    planning_cycles: list[
        BackupPlanningCycleItem
    ] = Field(alias="planningCycles")

    weekly_reviews: list[
        BackupWeeklyReviewItem
    ] = Field(alias="weeklyReviews")

    weekly_commitments: list[
        BackupWeeklyCommitmentItem
    ] = Field(alias="weeklyCommitments")

    weekly_task_decisions: list[
        BackupWeeklyTaskDecisionItem
    ] = Field(alias="weeklyTaskDecisions")

    cycle_reviews: list[
        BackupCycleReviewItem
    ] = Field(alias="cycleReviews")

    cycle_goal_outcomes: list[
        BackupCycleGoalOutcomeItem
    ] = Field(alias="cycleGoalOutcomes")

    @model_validator(mode="after")
    def validate_unique_identities(self) -> Self:
        """Reject repeated source identities within the backup."""

        collections = [
            (
                "task",
                [
                    item.source_task_id
                    for item in self.tasks
                ],
            ),
            (
                "goal",
                [
                    item.source_goal_id
                    for item in self.goals
                ],
            ),
            (
                "goal milestone",
                [
                    item.source_goal_milestone_id
                    for item in self.goal_milestones
                ],
            ),
            (
                "Brain Dump",
                [
                    item.source_brain_dump_id
                    for item in self.brain_dumps
                ],
            ),
            (
                "task template",
                [
                    item.source_task_template_id
                    for item in self.task_templates
                ],
            ),
            (
                "recurring schedule",
                [
                    item.source_recurring_rule_id
                    for item in self.recurring_rules
                ],
            ),
            (
                "planning cycle",
                [
                    item.source_planning_cycle_id
                    for item in self.planning_cycles
                ],
            ),
            (
                "weekly review",
                [
                    item.source_weekly_review_id
                    for item in self.weekly_reviews
                ],
            ),
            (
                "weekly commitment",
                [
                    item.source_weekly_commitment_id
                    for item in self.weekly_commitments
                ],
            ),
            (
                "weekly task decision",
                [
                    item.source_weekly_task_decision_id
                    for item in self.weekly_task_decisions
                ],
            ),
            (
                "cycle review",
                [
                    item.source_cycle_review_id
                    for item in self.cycle_reviews
                ],
            ),
            (
                "cycle goal outcome",
                [
                    item.source_cycle_goal_outcome_id
                    for item in self.cycle_goal_outcomes
                ],
            ),
        ]

        for label, identities in collections:
            reject_duplicates(
                identities,
                label,
            )

        recurring_task_identities = [
            (
                item.source_recurring_rule_id,
                item.recurrence_occurrence_date,
            )
            for item in self.tasks
            if item.source_recurring_rule_id is not None
        ]

        reject_duplicates(
            recurring_task_identities,
            "recurring task occurrence",
        )

        recurring_exception_identities = [
            (
                item.source_recurring_rule_id,
                item.occurrence_date,
            )
            for item in self.recurring_exceptions
        ]

        reject_duplicates(
            recurring_exception_identities,
            "recurring exception",
        )

        reject_duplicates(
            [
                item.week_start
                for item in self.weekly_reviews
            ],
            "weekly review week",
        )

        linked_commitment_identities = [
            (
                item.week_start,
                item.source_task_id,
            )
            for item in self.weekly_commitments
            if item.source_task_id is not None
        ]

        reject_duplicates(
            linked_commitment_identities,
            "weekly commitment task",
        )

        linked_decision_identities = [
            (
                item.week_start,
                item.source_task_id,
                item.original_due_date,
            )
            for item in self.weekly_task_decisions
            if item.source_task_id is not None
        ]

        reject_duplicates(
            linked_decision_identities,
            "weekly task decision",
        )

        reject_duplicates(
            [
                item.source_cycle_id
                for item in self.cycle_reviews
            ],
            "cycle review planning cycle",
        )

        linked_outcome_identities = [
            (
                item.source_cycle_review_id,
                item.source_goal_id,
            )
            for item in self.cycle_goal_outcomes
            if item.source_goal_id is not None
        ]

        reject_duplicates(
            linked_outcome_identities,
            "cycle review goal outcome",
        )

        active_cycle_count = sum(
            item.active
            for item in self.planning_cycles
        )

        if active_cycle_count > 1:
            raise ValueError(
                "backup contains more than one active "
                "planning cycle"
            )

        return self

    @model_validator(mode="after")
    def validate_relationships(self) -> Self:
        """Require every source relationship to have its parent."""

        task_ids = {
            item.source_task_id
            for item in self.tasks
        }

        goal_ids = {
            item.source_goal_id
            for item in self.goals
        }

        recurring_rule_ids = {
            item.source_recurring_rule_id
            for item in self.recurring_rules
        }

        cycle_ids = {
            item.source_planning_cycle_id
            for item in self.planning_cycles
        }

        cycle_review_ids = {
            item.source_cycle_review_id
            for item in self.cycle_reviews
        }

        for goal in self.goals:
            if (
                goal.source_cycle_id is not None
                and goal.source_cycle_id not in cycle_ids
            ):
                raise ValueError(
                    f"goal {goal.source_goal_id} references "
                    "a missing planning cycle"
                )

        for milestone in self.goal_milestones:
            if milestone.source_goal_id not in goal_ids:
                raise ValueError(
                    f"milestone "
                    f"{milestone.source_goal_milestone_id} "
                    "references a missing goal"
                )

        for task in self.tasks:
            if (
                task.source_goal_id is not None
                and task.source_goal_id not in goal_ids
            ):
                raise ValueError(
                    f"task {task.source_task_id} references "
                    "a missing goal"
                )

            if (
                task.source_recurring_rule_id is not None
                and task.source_recurring_rule_id
                not in recurring_rule_ids
            ):
                raise ValueError(
                    f"task {task.source_task_id} references "
                    "a missing recurring schedule"
                )

        for template in self.task_templates:
            if (
                template.source_goal_id is not None
                and template.source_goal_id not in goal_ids
            ):
                raise ValueError(
                    f"task template "
                    f"{template.source_task_template_id} "
                    "references a missing goal"
                )

        for rule in self.recurring_rules:
            if (
                rule.source_goal_id is not None
                and rule.source_goal_id not in goal_ids
            ):
                raise ValueError(
                    f"recurring schedule "
                    f"{rule.source_recurring_rule_id} "
                    "references a missing goal"
                )

        for exception in self.recurring_exceptions:
            if (
                exception.source_recurring_rule_id
                not in recurring_rule_ids
            ):
                raise ValueError(
                    "recurring exception references "
                    "a missing recurring schedule"
                )

        for review in self.weekly_reviews:
            if (
                review.source_cycle_id is not None
                and review.source_cycle_id not in cycle_ids
            ):
                raise ValueError(
                    f"weekly review "
                    f"{review.source_weekly_review_id} "
                    "references a missing planning cycle"
                )

        for commitment in self.weekly_commitments:
            if (
                commitment.source_cycle_id is not None
                and commitment.source_cycle_id not in cycle_ids
            ):
                raise ValueError(
                    f"weekly commitment "
                    f"{commitment.source_weekly_commitment_id} "
                    "references a missing planning cycle"
                )

            if (
                commitment.source_task_id is not None
                and commitment.source_task_id not in task_ids
            ):
                raise ValueError(
                    f"weekly commitment "
                    f"{commitment.source_weekly_commitment_id} "
                    "references a missing task"
                )

        for decision in self.weekly_task_decisions:
            if (
                decision.source_task_id is not None
                and decision.source_task_id not in task_ids
            ):
                raise ValueError(
                    f"weekly task decision "
                    f"{decision.source_weekly_task_decision_id} "
                    "references a missing task"
                )

            # A deleted recurring schedule may still be named in
            # historical decisions, so its source rule is deliberately
            # not required to remain in recurringRules.

        for review in self.cycle_reviews:
            if review.source_cycle_id not in cycle_ids:
                raise ValueError(
                    f"cycle review "
                    f"{review.source_cycle_review_id} "
                    "references a missing planning cycle"
                )

            if (
                review.source_next_cycle_id is not None
                and review.source_next_cycle_id not in cycle_ids
            ):
                raise ValueError(
                    f"cycle review "
                    f"{review.source_cycle_review_id} "
                    "references a missing next cycle"
                )

        for outcome in self.cycle_goal_outcomes:
            if (
                outcome.source_cycle_review_id
                not in cycle_review_ids
            ):
                raise ValueError(
                    f"cycle outcome "
                    f"{outcome.source_cycle_goal_outcome_id} "
                    "references a missing cycle review"
                )

            if (
                outcome.source_goal_id is not None
                and outcome.source_goal_id not in goal_ids
            ):
                raise ValueError(
                    f"cycle outcome "
                    f"{outcome.source_cycle_goal_outcome_id} "
                    "references a missing goal"
                )

            if (
                outcome.source_destination_goal_id is not None
                and outcome.source_destination_goal_id
                not in goal_ids
            ):
                raise ValueError(
                    f"cycle outcome "
                    f"{outcome.source_cycle_goal_outcome_id} "
                    "references a missing destination goal"
                )

        return self


class WeekFlowBackupImportRequest(BackupSchema):
    """Validate one complete current-format WeekFlow backup."""

    format: Literal["weekflow-backup"]
    version: Literal[12]
    exported_at: BackupTimestamp = Field(alias="exportedAt")

    metadata: WeekFlowBackupMetadata
    data: WeekFlowBackupData

    @field_validator("version", mode="before")
    @classmethod
    def require_integer_version(
        cls,
        value: object,
    ) -> object:
        """Reject booleans and floats that merely equal twelve."""

        if type(value) is not int:
            raise ValueError("version must be an integer")

        return value

class BackupImportCounts(BackupSchema):
    """Count every collection in one validated backup."""

    tasks: NonNegativeInt
    goals: NonNegativeInt
    goal_milestones: NonNegativeInt
    brain_dumps: NonNegativeInt
    task_templates: NonNegativeInt
    recurring_rules: NonNegativeInt
    recurring_exceptions: NonNegativeInt
    planning_cycles: NonNegativeInt
    weekly_reviews: NonNegativeInt
    weekly_commitments: NonNegativeInt
    weekly_task_decisions: NonNegativeInt
    cycle_reviews: NonNegativeInt
    cycle_goal_outcomes: NonNegativeInt


class BackupImportPreviewResult(BackupSchema):
    """Summarize a complete backup without changing PostgreSQL."""

    format: Literal["weekflow-backup"]
    version: Literal[12]
    exported_at: AwareDatetime
    app_version: str
    data_model_version: Literal[1]
    total_records: NonNegativeInt
    counts: BackupImportCounts
    would_create_count: NonNegativeInt
    already_imported_count: NonNegativeInt
    conflict_count: NonNegativeInt
    would_create_counts: BackupImportCounts
    already_imported_counts: BackupImportCounts
    conflict_counts: BackupImportCounts
    conflict_identities: dict[str, list[str]]
    can_import: bool
    validation_passed: Literal[True] = True
    database_changed: Literal[False] = False