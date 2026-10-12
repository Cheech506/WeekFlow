"""Database service for importing SQLite tasks into PostgreSQL."""

from sqlalchemy import select, text, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Goal, RecurringRule, Task
from app.schemas import (
    TaskImportItem,
    TaskImportMapping,
    TaskImportPreviewResult,
    TaskImportRequest,
    TaskImportResult,
)


# These are the fields that must match when an imported task already
# exists in PostgreSQL.
IMPORT_FIELD_NAMES = (
    "source_task_id",
    "title",
    "day",
    "due_date",
    "notes",
    "priority",
    "source_goal_id",
    "completed",
    "created_at",
    "completed_at",
    "source_recurring_rule_id",
    "recurrence_occurrence_date",
)


class TaskImportConflictError(Exception):
    """Raised when a source task ID exists with different data."""

    def __init__(
        self,
        source_task_ids: list[int],
    ):
        self.source_task_ids = source_task_ids

        super().__init__(
            "Source task IDs already exist with different data: "
            f"{source_task_ids}"
        )


def task_matches_import_item(
    stored_task: Task,
    import_item: TaskImportItem,
) -> bool:
    """Return whether PostgreSQL contains the same imported values."""

    return all(
        getattr(stored_task, field_name)
        == getattr(import_item, field_name)
        for field_name in IMPORT_FIELD_NAMES
    )


def preview_task_import(
    task_data: TaskImportRequest,
    db: Session,
) -> TaskImportPreviewResult:
    """
    Compare SQLite tasks with PostgreSQL without changing either database.

    This function deliberately performs SELECT queries only.
    """

    source_task_ids = [
        task.source_task_id
        for task in task_data.tasks
    ]

    # Find tasks that already use one of the incoming SQLite IDs.
    stored_statement = select(Task).where(
        Task.source_task_id.in_(source_task_ids)
    )

    stored_tasks = db.scalars(
        stored_statement
    ).all()

    stored_by_source_task_id = {
        task.source_task_id: task
        for task in stored_tasks
    }

    # A different source task might already own the same recurring
    # rule/date identity. Check those identities separately.
    requested_recurring_identities = [
        (
            task.source_recurring_rule_id,
            task.recurrence_occurrence_date,
        )
        for task in task_data.tasks
        if (
            task.source_recurring_rule_id is not None
            and task.recurrence_occurrence_date is not None
        )
    ]

    existing_recurring_identities = set()

    if requested_recurring_identities:
        recurring_statement = select(
            Task.source_recurring_rule_id,
            Task.recurrence_occurrence_date,
        ).where(
            tuple_(
                Task.source_recurring_rule_id,
                Task.recurrence_occurrence_date,
            ).in_(requested_recurring_identities)
        )

        existing_recurring_identities = {
            (
                recurring_rule_id,
                occurrence_date,
            )
            for recurring_rule_id, occurrence_date
            in db.execute(recurring_statement)
        }

    would_create_count = 0
    already_imported_count = 0
    conflict_source_task_ids: list[int] = []

    for task in task_data.tasks:
        stored_task = stored_by_source_task_id.get(
            task.source_task_id
        )

        if stored_task is not None:
            if task_matches_import_item(
                stored_task,
                task,
            ):
                already_imported_count += 1
            else:
                conflict_source_task_ids.append(
                    task.source_task_id
                )

            continue

        recurring_identity = (
            task.source_recurring_rule_id,
            task.recurrence_occurrence_date,
        )

        has_recurring_identity = (
            task.source_recurring_rule_id is not None
            and task.recurrence_occurrence_date is not None
        )

        if (
            has_recurring_identity
            and recurring_identity
            in existing_recurring_identities
        ):
            conflict_source_task_ids.append(
                task.source_task_id
            )
        else:
            would_create_count += 1

    return TaskImportPreviewResult(
        received_count=len(task_data.tasks),
        would_create_count=would_create_count,
        already_imported_count=already_imported_count,
        conflict_count=len(
            conflict_source_task_ids
        ),
        conflict_source_task_ids=(
            conflict_source_task_ids
        ),
        goal_linked_count=sum(
            task.source_goal_id is not None
            for task in task_data.tasks
        ),
        recurring_count=sum(
            task.source_recurring_rule_id is not None
            for task in task_data.tasks
        ),
        completed_count=sum(
            task.completed
            for task in task_data.tasks
        ),
        can_import=not conflict_source_task_ids,
        database_changed=False,
    )


def import_tasks(
    task_data: TaskImportRequest,
    db: Session,
) -> TaskImportResult:
    """Import tasks and connect any parents already present in PostgreSQL.

    Identical retries keep the same task IDs. Changed source data rejects
    the whole batch. Missing parents can be connected on a later retry.
    """

    source_task_ids = [
        task.source_task_id
        for task in task_data.tasks
    ]

    try:
        # Hold related writes until validation and link mapping finish.
        # Use the same table order as task edits and backup imports.
        db.execute(text(
            "LOCK TABLE goals, recurring_rules, tasks "
            "IN SHARE ROW EXCLUSIVE MODE"
        ))

        goal_sources = {
            task.source_goal_id
            for task in task_data.tasks
            if task.source_goal_id is not None
        }
        rule_sources = {
            task.source_recurring_rule_id
            for task in task_data.tasks
            if task.source_recurring_rule_id is not None
        }

        # Look up existing parent IDs; never copy a SQLite ID into a
        # PostgreSQL foreign key or create another parent here.
        goal_ids = dict(db.execute(
            select(Goal.source_goal_id, Goal.id)
            .where(Goal.source_goal_id.in_(goal_sources))
        ).all())
        rule_ids = dict(db.execute(
            select(
                RecurringRule.source_recurring_rule_id,
                RecurringRule.id,
            )
            .where(
                RecurringRule.source_recurring_rule_id.in_(rule_sources)
            )
        ).all())

        task_values = [
            {
                **task.model_dump(),
                "goal_id": goal_ids.get(task.source_goal_id),
                "recurring_rule_id": rule_ids.get(
                    task.source_recurring_rule_id
                ),
            }
            for task in task_data.tasks
        ]

        # The task's own source_goal_id determines its goal. A schedule's
        # current goal must not rewrite historical task relationships.
        # Preserve source IDs for retries and for parents arriving later.
        insert_statement = (
            insert(Task)
            .values(task_values)
            .on_conflict_do_nothing()
            .returning(Task.source_task_id)
        )
        created_source_task_ids = set(
            db.scalars(insert_statement).all()
        )

        stored_tasks = db.scalars(
            select(Task)
            .where(Task.source_task_id.in_(source_task_ids))
            .execution_options(populate_existing=True)
        ).all()
        stored_by_source_task_id = {
            task.source_task_id: task
            for task in stored_tasks
        }

        # Skipped inserts must be exact retries. A changed task or a
        # recurring identity already owned by another task is a conflict.
        conflicting_source_task_ids = [
            task.source_task_id
            for task in task_data.tasks
            if (
                task.source_task_id not in stored_by_source_task_id
                or not task_matches_import_item(
                    stored_by_source_task_id[task.source_task_id],
                    task,
                )
            )
        ]
        if conflicting_source_task_ids:
            raise TaskImportConflictError(
                conflicting_source_task_ids
            )

        # An identical task may have been imported before its parents.
        # Connect those parents now while keeping the task's primary key
        # and all of its imported content unchanged.
        for task in task_data.tasks:
            stored_task = stored_by_source_task_id[task.source_task_id]

            if task.source_goal_id in goal_ids:
                stored_task.goal_id = goal_ids[task.source_goal_id]

            if task.source_recurring_rule_id in rule_ids:
                stored_task.recurring_rule_id = rule_ids[
                    task.source_recurring_rule_id
                ]

        # Keep the original response format and request order. An
        # "unchanged" task can have a previously missing parent connected.
        mappings = [
            TaskImportMapping(
                source_task_id=task.source_task_id,
                task_id=stored_by_source_task_id[task.source_task_id].id,
                status=(
                    "created"
                    if task.source_task_id in created_source_task_ids
                    else "unchanged"
                ),
            )
            for task in task_data.tasks
        ]
        result = TaskImportResult(
            received_count=len(task_data.tasks),
            created_count=len(created_source_task_ids),
            unchanged_count=(
                len(task_data.tasks) - len(created_source_task_ids)
            ),
            mappings=mappings,
        )

        # Commit only after every task and relationship has passed.
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise TaskImportConflictError(source_task_ids) from error

    except Exception:
        db.rollback()
        raise

    return result
