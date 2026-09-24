"""Read-only planning for complete WeekFlow backup imports."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    BrainDump,
    CycleGoalOutcome,
    CycleReview,
    Goal,
    GoalMilestone,
    PlanningCycle,
    RecurringOccurrenceException,
    RecurringRule,
    Task,
    TaskTemplate,
    WeeklyCommitment,
    WeeklyReview,
    WeeklyTaskDecision,
)
from app.schemas import (
    BackupBrainDumpItem,
    BackupCycleGoalOutcomeItem,
    BackupCycleReviewItem,
    BackupGoalItem,
    BackupGoalMilestoneItem,
    BackupImportCounts,
    BackupImportPreviewResult,
    BackupPlanningCycleItem,
    BackupRecurringExceptionItem,
    BackupRecurringRuleItem,
    BackupTaskTemplateItem,
    BackupWeeklyCommitmentItem,
    BackupWeeklyReviewItem,
    BackupWeeklyTaskDecisionItem,
    TaskImportItem,
    WeekFlowBackupImportRequest,
)


MODELS = {
    "tasks": Task,
    "goals": Goal,
    "goal_milestones": GoalMilestone,
    "brain_dumps": BrainDump,
    "task_templates": TaskTemplate,
    "recurring_rules": RecurringRule,
    "recurring_exceptions": RecurringOccurrenceException,
    "planning_cycles": PlanningCycle,
    "weekly_reviews": WeeklyReview,
    "weekly_commitments": WeeklyCommitment,
    "weekly_task_decisions": WeeklyTaskDecision,
    "cycle_reviews": CycleReview,
    "cycle_goal_outcomes": CycleGoalOutcome,
}

SCHEMAS = {
    "tasks": TaskImportItem,
    "goals": BackupGoalItem,
    "goal_milestones": BackupGoalMilestoneItem,
    "brain_dumps": BackupBrainDumpItem,
    "task_templates": BackupTaskTemplateItem,
    "recurring_rules": BackupRecurringRuleItem,
    "recurring_exceptions": BackupRecurringExceptionItem,
    "planning_cycles": BackupPlanningCycleItem,
    "weekly_reviews": BackupWeeklyReviewItem,
    "weekly_commitments": BackupWeeklyCommitmentItem,
    "weekly_task_decisions": BackupWeeklyTaskDecisionItem,
    "cycle_reviews": BackupCycleReviewItem,
    "cycle_goal_outcomes": BackupCycleGoalOutcomeItem,
}

SOURCE_ID_FIELDS = {
    "tasks": "source_task_id",
    "goals": "source_goal_id",
    "goal_milestones": "source_goal_milestone_id",
    "brain_dumps": "source_brain_dump_id",
    "task_templates": "source_task_template_id",
    "recurring_rules": "source_recurring_rule_id",
    "planning_cycles": "source_planning_cycle_id",
    "weekly_reviews": "source_weekly_review_id",
    "weekly_commitments": "source_weekly_commitment_id",
    "weekly_task_decisions": "source_weekly_task_decision_id",
    "cycle_reviews": "source_cycle_review_id",
    "cycle_goal_outcomes": "source_cycle_goal_outcome_id",
}

RELATION_FIELDS = {
    "goals": {
        "source_cycle_id": ("cycle_id", "planning_cycles"),
    },
    "goal_milestones": {
        "source_goal_id": ("goal_id", "goals"),
    },
    "task_templates": {
        "source_goal_id": ("goal_id", "goals"),
    },
    "recurring_rules": {
        "source_goal_id": ("goal_id", "goals"),
    },
    "recurring_exceptions": {
        "source_recurring_rule_id": (
            "recurring_rule_id",
            "recurring_rules",
        ),
    },
    "weekly_reviews": {
        "source_cycle_id": ("cycle_id", "planning_cycles"),
    },
    "weekly_commitments": {
        "source_cycle_id": ("cycle_id", "planning_cycles"),
        "source_task_id": ("task_id", "tasks"),
    },
    "weekly_task_decisions": {
        "source_task_id": ("task_id", "tasks"),
    },
    "cycle_reviews": {
        "source_cycle_id": ("cycle_id", "planning_cycles"),
        "source_next_cycle_id": ("next_cycle_id", "planning_cycles"),
    },
    "cycle_goal_outcomes": {
        "source_cycle_review_id": (
            "cycle_review_id",
            "cycle_reviews",
        ),
        "source_goal_id": ("goal_id", "goals"),
        "source_destination_goal_id": (
            "destination_goal_id",
            "goals",
        ),
    },
}


@dataclass
class CollectionImportPlan:
    """Classify one collection without changing PostgreSQL."""

    would_create: list[Any] = field(default_factory=list)
    already_imported: list[Any] = field(default_factory=list)
    conflicts: list[Any] = field(default_factory=list)
    conflict_identities: list[str] = field(default_factory=list)


@dataclass
class BackupImportPlan:
    """Hold reusable classifications for a complete backup."""

    collections: dict[str, CollectionImportPlan]

    def counts_for(self, status: str) -> BackupImportCounts:
        """Count one classification across all collections."""

        return BackupImportCounts(
            **{
                name: len(getattr(self.collections[name], status))
                for name in MODELS
            }
        )

    @property
    def conflict_identities(self) -> dict[str, list[str]]:
        """Return only collections containing conflicts."""

        return {
            name: plan.conflict_identities
            for name, plan in self.collections.items()
            if plan.conflict_identities
        }


def source_maps_for(
    stored: dict[str, list[Any]],
) -> dict[str, dict[int, int | None]]:
    """Map PostgreSQL IDs back to preserved SQLite IDs."""

    maps: dict[str, dict[int, int | None]] = {}

    for name, source_field in SOURCE_ID_FIELDS.items():
        maps[name] = {
            row.id: getattr(row, source_field)
            for row in stored[name]
        }

    return maps


def primary_identity(
    name: str,
    record: Any,
    is_row: bool,
    source_maps: dict[str, dict[int, int | None]],
) -> object:
    """Return the preserved identity for one item or stored row."""

    if name == "recurring_exceptions":
        recurring_rule_id = (
            source_maps["recurring_rules"].get(
                record.recurring_rule_id
            )
            if is_row
            else record.source_recurring_rule_id
        )
        return recurring_rule_id, record.occurrence_date

    return getattr(record, SOURCE_ID_FIELDS[name])


def secondary_identity(
    name: str,
    record: Any,
    is_row: bool,
    source_maps: dict[str, dict[int, int | None]],
) -> object | None:
    """Return an identity protected by a second unique constraint."""

    if name == "tasks":
        rule_id = record.source_recurring_rule_id
        return (
            (rule_id, record.recurrence_occurrence_date)
            if rule_id is not None
            else None
        )

    if name == "planning_cycles":
        return "active" if record.active else None

    if name == "weekly_reviews":
        return record.week_start

    if name in {"weekly_commitments", "weekly_task_decisions"}:
        task_id = (
            source_maps["tasks"].get(record.task_id)
            if is_row
            else record.source_task_id
        )
        if task_id is None:
            return None

        identity = (record.week_start, task_id)
        if name == "weekly_task_decisions":
            identity += (record.original_due_date,)
        return identity

    if name == "cycle_reviews":
        return (
            source_maps["planning_cycles"].get(record.cycle_id)
            if is_row
            else record.source_cycle_id
        )

    if name == "cycle_goal_outcomes":
        goal_id = (
            source_maps["goals"].get(record.goal_id)
            if is_row
            else record.source_goal_id
        )
        if goal_id is None:
            return None

        review_id = (
            source_maps["cycle_reviews"].get(
                record.cycle_review_id
            )
            if is_row
            else record.source_cycle_review_id
        )
        return review_id, goal_id

    return None


def signature(
    name: str,
    record: Any,
    is_row: bool,
    source_maps: dict[str, dict[int, int | None]],
) -> tuple[object, ...]:
    """Normalize an item or row so their saved data can be compared."""

    values: list[object] = []
    relationships = RELATION_FIELDS.get(name, {})

    for field_name in SCHEMAS[name].model_fields:
        relationship = relationships.get(field_name)

        if is_row and relationship is not None:
            internal_field, parent_name = relationship
            internal_id = getattr(record, internal_field)
            value = (
                source_maps[parent_name].get(internal_id)
                if internal_id is not None
                else None
            )
        else:
            value = getattr(record, field_name)

        if (
            not is_row
            and name == "goals"
            and field_name in {"start_date", "end_date"}
        ):
            value = value.date()

        values.append(value)

    return tuple(values)


def identity_label(identity: object) -> str:
    """Create a readable label for simple or composite identities."""

    if isinstance(identity, tuple):
        return " | ".join(str(part) for part in identity)
    return str(identity)


def classify_collection(
    name: str,
    items: list[Any],
    stored_rows: list[Any],
    source_maps: dict[str, dict[int, int | None]],
) -> CollectionImportPlan:
    """Classify new, unchanged, and conflicting source records."""

    plan = CollectionImportPlan()
    item_primary: Callable[[Any], object] = lambda item: (
        primary_identity(name, item, False, source_maps)
    )
    row_primary: Callable[[Any], object] = lambda row: (
        primary_identity(name, row, True, source_maps)
    )

    stored_by_primary = {
        identity: row
        for row in stored_rows
        if (identity := row_primary(row)) is not None
    }
    stored_by_secondary = {
        identity: row
        for row in stored_rows
        if (
            identity := secondary_identity(
                name,
                row,
                True,
                source_maps,
            )
        ) is not None
    }

    for item in items:
        identity = item_primary(item)
        stored_row = stored_by_primary.get(identity)

        if stored_row is not None:
            if signature(name, item, False, source_maps) == signature(
                name,
                stored_row,
                True,
                source_maps,
            ):
                plan.already_imported.append(item)
            else:
                plan.conflicts.append(item)
                plan.conflict_identities.append(identity_label(identity))
            continue

        secondary = secondary_identity(
            name,
            item,
            False,
            source_maps,
        )
        if secondary is not None and secondary in stored_by_secondary:
            plan.conflicts.append(item)
            plan.conflict_identities.append(identity_label(identity))
        else:
            plan.would_create.append(item)

    return plan


def build_backup_import_plan(
    backup: WeekFlowBackupImportRequest,
    db: Session,
) -> BackupImportPlan:
    """Compare every backup collection with PostgreSQL using SELECTs."""

    stored = {
        name: list(db.scalars(select(model)).all())
        for name, model in MODELS.items()
    }
    source_maps = source_maps_for(stored)

    return BackupImportPlan(
        collections={
            name: classify_collection(
                name=name,
                items=list(getattr(backup.data, name)),
                stored_rows=stored[name],
                source_maps=source_maps,
            )
            for name in MODELS
        }
    )


def total_counts(counts: BackupImportCounts) -> int:
    """Return the sum of all collection counts."""

    return sum(counts.model_dump().values())


def preview_backup_import(
    backup: WeekFlowBackupImportRequest,
    db: Session,
) -> BackupImportPreviewResult:
    """Return a database-aware plan without writing to PostgreSQL."""

    plan = build_backup_import_plan(backup=backup, db=db)
    received_counts = BackupImportCounts(
        **{
            name: len(getattr(backup.data, name))
            for name in MODELS
        }
    )
    would_create_counts = plan.counts_for("would_create")
    already_imported_counts = plan.counts_for("already_imported")
    conflict_counts = plan.counts_for("conflicts")
    conflict_count = total_counts(conflict_counts)

    return BackupImportPreviewResult(
        format=backup.format,
        version=backup.version,
        exported_at=backup.exported_at,
        app_version=backup.metadata.app_version,
        data_model_version=backup.metadata.data_model_version,
        total_records=total_counts(received_counts),
        counts=received_counts,
        would_create_count=total_counts(would_create_counts),
        already_imported_count=total_counts(already_imported_counts),
        conflict_count=conflict_count,
        would_create_counts=would_create_counts,
        already_imported_counts=already_imported_counts,
        conflict_counts=conflict_counts,
        conflict_identities=plan.conflict_identities,
        can_import=conflict_count == 0,
        validation_passed=True,
        database_changed=False,
    )