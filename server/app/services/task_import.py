"""Database service for importing SQLite tasks into PostgreSQL."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Task
from app.schemas import (
    TaskImportItem,
    TaskImportMapping,
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


def import_tasks(
    task_data: TaskImportRequest,
    db: Session,
) -> TaskImportResult:
    """
    Import one validated task batch as a single transaction.

    Exact retries return unchanged mappings. If an existing source task
    contains different data, the entire request is rolled back.
    """

    source_task_ids = [
        task.source_task_id
        for task in task_data.tasks
    ]

    # model_dump() returns the internal snake_case names created by the
    # Pydantic aliases.
    #
    # For example:
    # id becomes source_task_id
    # dueDate becomes due_date
    task_values = [
        task.model_dump()
        for task in task_data.tasks
    ]

    # PostgreSQL attempts to insert every task.
    #
    # If source_task_id already exists, PostgreSQL leaves that row
    # unchanged. We inspect it below to determine whether it is an
    # identical retry or a conflicting retry.
    insert_statement = (
        insert(Task)
        .values(task_values)
        .on_conflict_do_nothing()
        .returning(Task.source_task_id)
    )

    try:
        created_source_task_ids = set(
            db.scalars(insert_statement).all()
        )

        # Read all requested source tasks back from PostgreSQL,
        # including both newly inserted and previously existing rows.
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

        # A conflict exists when PostgreSQL did not insert the task
        # because another unique identity owns its values, or when the
        # source task ID exists but its stored data has changed.
        conflicting_source_task_ids = [
            task.source_task_id
            for task in task_data.tasks
            if (
                task.source_task_id
                not in stored_by_source_task_id
                or not task_matches_import_item(
                    stored_by_source_task_id[
                        task.source_task_id
                    ],
                    task,
                )
            )
        ]

        if conflicting_source_task_ids:
            raise TaskImportConflictError(
                conflicting_source_task_ids
            )

        # Preserve the request order in the response mappings.
        mappings = [
            TaskImportMapping(
                source_task_id=task.source_task_id,
                task_id=stored_by_source_task_id[
                    task.source_task_id
                ].id,
                status=(
                    "created"
                    if task.source_task_id
                    in created_source_task_ids
                    else "unchanged"
                ),
            )
            for task in task_data.tasks
        ]

        result = TaskImportResult(
            received_count=len(task_data.tasks),
            created_count=len(
                created_source_task_ids
            ),
            unchanged_count=(
                len(task_data.tasks)
                - len(created_source_task_ids)
            ),
            mappings=mappings,
        )

        # Nothing becomes permanent until every task has passed the
        # comparison above.
        db.commit()

    except Exception:
        # This also removes newly inserted tasks when another task in
        # the same batch conflicts.
        db.rollback()
        raise

    return result