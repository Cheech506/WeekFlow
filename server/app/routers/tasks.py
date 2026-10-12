"""API routes for tasks, relationships, and SQLite task imports."""

from datetime import UTC, datetime

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from sqlalchemy import and_, or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import (
    Goal,
    RecurringOccurrenceException,
    RecurringRule,
    Task,
)
from app.schemas import (
    TaskCreate,
    TaskImportPreviewResult,
    TaskImportRequest,
    TaskImportResult,
    TaskRead,
    TaskUpdate,
)
from app.services import (
    TaskImportConflictError,
    import_tasks,
    preview_task_import,
)


router = APIRouter(
    prefix=f"{API_PREFIX}/tasks",
    tags=["tasks"],
)


def lock_task_writes(db: Session) -> None:
    """Coordinate task changes with imports and goal snapshots."""

    db.execute(text(
        "LOCK TABLE goals, recurring_occurrence_exceptions, "
        "recurring_rules, tasks "
        "IN SHARE ROW EXCLUSIVE MODE"
    ))


def require_task(
    db: Session,
    task_id: int,
    *,
    for_update: bool = False,
) -> Task:
    """Find a task or return 404."""

    statement = select(Task).where(
        Task.id == task_id
    )

    if for_update:
        statement = (
            statement
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    task = db.scalar(statement)

    if task is None:
        raise HTTPException(
            status_code=404,
            detail="Task not found",
        )

    return task


def goal_values(
    db: Session,
    goal_id: int | None,
) -> dict:
    """Validate the goal and keep migration metadata consistent."""

    if goal_id is None:
        return {
            "goal_id": None,
            "source_goal_id": None,
        }

    goal = db.get(Goal, goal_id)

    if goal is None:
        raise HTTPException(
            status_code=404,
            detail="Goal not found.",
        )

    return {
        "goal_id": goal.id,
        "source_goal_id": goal.source_goal_id,
    }


def write_conflict() -> HTTPException:
    """Return a safe message after a database constraint fails."""

    return HTTPException(
        status_code=409,
        detail=(
            "The task would duplicate a recurring occurrence "
            "or violate a relationship. No changes were saved."
        ),
    )


@router.post(
    "",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
)
def create_task(
    task_data: TaskCreate,
    db: Session = Depends(get_db),
) -> Task:
    """Create a task using PostgreSQL parent IDs."""

    try:
        lock_task_writes(db)

        values = task_data.model_dump()

        values["notes"] = task_data.notes or None

        values["day"] = (
            task_data.due_date.strftime("%A")
            if task_data.due_date is not None
            else "Inbox"
        )

        goal_id = task_data.goal_id

        if task_data.recurring_rule_id is not None:
            rule = db.get(
                RecurringRule,
                task_data.recurring_rule_id,
            )

            if rule is None:
                raise HTTPException(
                    status_code=404,
                    detail="Recurring rule not found.",
                )

            skipped_occurrence = db.get(
                RecurringOccurrenceException,
                (
                    rule.id,
                    task_data.recurrence_occurrence_date,
                ),
            )

            if skipped_occurrence is not None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This recurring occurrence "
                        "was skipped or deleted."
                    ),
                )

            values["source_recurring_rule_id"] = (
                rule.source_recurring_rule_id
            )

            # Inherit the schedule's goal only when creating the task.
            # Explicit goal_id=null means the task should be unlinked.
            if "goal_id" not in task_data.model_fields_set:
                goal_id = rule.goal_id

        values.update(
            goal_values(db, goal_id)
        )

        task = Task(**values)

        db.add(task)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    db.refresh(task)
    return task


@router.get(
    "",
    response_model=list[TaskRead],
)
def read_tasks(
    goal_id: int | None = Query(
        default=None,
        gt=0,
        le=2_147_483_647,
    ),
    recurring_rule_id: int | None = Query(
        default=None,
        gt=0,
        le=2_147_483_647,
    ),
    db: Session = Depends(get_db),
) -> list[Task]:
    """Read tasks, optionally filtered by goal or recurring schedule."""

    statement = select(Task)

    if goal_id is not None:
        goal = db.get(Goal, goal_id)

        link = Task.goal_id == goal_id

        # Support older imports whose native link is not mapped yet.
        if goal is not None and goal.source_goal_id is not None:
            link = or_(
                link,
                and_(
                    Task.goal_id.is_(None),
                    Task.source_goal_id == goal.source_goal_id,
                ),
            )

        statement = statement.where(link)

    if recurring_rule_id is not None:
        rule = db.get(
            RecurringRule,
            recurring_rule_id,
        )

        link = (
            Task.recurring_rule_id == recurring_rule_id
        )

        if (
            rule is not None
            and rule.source_recurring_rule_id is not None
        ):
            link = or_(
                link,
                and_(
                    Task.recurring_rule_id.is_(None),
                    Task.source_recurring_rule_id
                    == rule.source_recurring_rule_id,
                ),
            )

        statement = statement.where(link)

    statement = statement.order_by(
        Task.created_at.desc(),
        Task.id.desc(),
    )

    return list(
        db.scalars(statement).all()
    )


@router.post(
    "/import/preview",
    response_model=TaskImportPreviewResult,
)
def preview_task_import_batch(
    task_data: TaskImportRequest,
    db: Session = Depends(get_db),
) -> TaskImportPreviewResult:
    """Compare SQLite tasks without changing PostgreSQL."""

    return preview_task_import(
        task_data=task_data,
        db=db,
    )


@router.post(
    "/import",
    response_model=TaskImportResult,
)
def import_task_batch(
    task_data: TaskImportRequest,
    db: Session = Depends(get_db),
) -> TaskImportResult:
    """Import tasks atomically and detect conflicting retries."""

    try:
        return import_tasks(
            task_data=task_data,
            db=db,
        )

    except TaskImportConflictError as error:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    "One or more source task IDs already "
                    "exist with different data."
                ),
                "source_task_ids": error.source_task_ids,
            },
        ) from error


@router.get(
    "/{task_id}",
    response_model=TaskRead,
)
def read_task(
    task_id: int,
    db: Session = Depends(get_db),
) -> Task:
    """Read a task using its PostgreSQL ID."""

    return require_task(db, task_id)


@router.patch(
    "/{task_id}",
    response_model=TaskRead,
)
def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
) -> Task:
    """Edit this task while preserving its recurrence identity."""

    try:
        lock_task_writes(db)

        task = require_task(
            db,
            task_id,
            for_update=True,
        )

        changes = task_data.model_dump(
            exclude_unset=True,
        )

        if "goal_id" in changes:
            changes.update(
                goal_values(
                    db,
                    changes["goal_id"],
                )
            )

        if "due_date" in changes:
            due_date = changes["due_date"]

            changes["day"] = (
                due_date.strftime("%A")
                if due_date is not None
                else "Inbox"
            )

        if "completed" in changes:
            if changes["completed"] and not task.completed:
                changes["completed_at"] = datetime.now(UTC)

            elif not changes["completed"]:
                changes["completed_at"] = None

        if "notes" in changes:
            changes["notes"] = changes["notes"] or None

        for field_name, value in changes.items():
            setattr(task, field_name, value)

        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    db.refresh(task)
    return task


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Delete a task and preserve a skip record for recurring work."""

    try:
        lock_task_writes(db)

        task = require_task(
            db,
            task_id,
            for_update=True,
        )

        rule_id = task.recurring_rule_id

        # Resolve older source-only imports when their schedule exists.
        if (
            rule_id is None
            and task.source_recurring_rule_id is not None
        ):
            rule_id = db.scalar(
                select(RecurringRule.id).where(
                    RecurringRule.source_recurring_rule_id
                    == task.source_recurring_rule_id
                )
            )

        if (
            rule_id is not None
            and task.recurrence_occurrence_date is not None
        ):
            # Save the exception and delete the task in one transaction.
            # A future scheduler must respect this skipped occurrence.
            db.execute(
                insert(RecurringOccurrenceException)
                .values(
                    recurring_rule_id=rule_id,
                    occurrence_date=task.recurrence_occurrence_date,
                )
                .on_conflict_do_nothing()
            )

        db.delete(task)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
    )