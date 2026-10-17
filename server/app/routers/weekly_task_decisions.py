"""Apply unfinished-task decisions and save their history atomically."""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import RecurringOccurrenceException, RecurringRule, Task, WeeklyTaskDecision
from app.schemas import WeeklyTaskDecisionCreate, WeeklyTaskDecisionRead
from app.schemas.weekly_task_decision import WeeklyTaskDecisionAction


router = APIRouter(
    prefix=f"{API_PREFIX}/weekly-task-decisions",
    tags=["weekly task decisions"],
)


WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def lock_decision_writes(db: Session) -> None:
    """Use the same lock order as task and recurring-schedule writes."""

    # Task deletion can clear links in both weekly history tables.
    db.execute(text(
        "LOCK TABLE goals, recurring_occurrence_exceptions, "
        "recurring_rules, tasks, weekly_commitments, "
        "weekly_task_decisions IN SHARE ROW EXCLUSIVE MODE"
    ))


def require_decision(db: Session, decision_id: int, *, for_update: bool = False) -> WeeklyTaskDecision:
    statement = (
        select(WeeklyTaskDecision)
        .where(WeeklyTaskDecision.id == decision_id)
        .execution_options(populate_existing=True)
    )
    if for_update:
        statement = statement.with_for_update()
    decision = db.scalar(statement)
    if decision is None:
        raise HTTPException(status_code=404, detail="Weekly task decision not found.")
    return decision


def task_rule_id(db: Session, task: Task) -> int | None:
    """Resolve legacy source-only links without changing the task's identity."""

    if task.recurring_rule_id is not None:
        return task.recurring_rule_id
    if task.source_recurring_rule_id is None:
        return None
    return db.scalar(
        select(RecurringRule.id)
        .where(RecurringRule.source_recurring_rule_id == task.source_recurring_rule_id)
    )


def write_conflict() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail="The weekly task decision could not be applied. No changes were saved.",
    )


@router.get("", response_model=list[WeeklyTaskDecisionRead])
def read_weekly_task_decisions(
    week_start: date | None = Query(default=None),
    task_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    recurring_rule_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    action: WeeklyTaskDecisionAction | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[WeeklyTaskDecision]:
    """Read decision history, including records whose tasks no longer exist."""

    if week_start is not None and week_start.weekday() != 0:
        raise HTTPException(status_code=422, detail="week_start must be a Monday")

    statement = select(WeeklyTaskDecision)
    for column, value in (
        (WeeklyTaskDecision.week_start, week_start),
        (WeeklyTaskDecision.task_id, task_id),
        (WeeklyTaskDecision.recurring_rule_id, recurring_rule_id),
        (WeeklyTaskDecision.action, action),
    ):
        if value is not None:
            statement = statement.where(column == value)

    statement = statement.order_by(
        WeeklyTaskDecision.week_start.desc(),
        WeeklyTaskDecision.decided_at.desc(),
        WeeklyTaskDecision.id.desc(),
    )
    return list(db.scalars(statement).all())


@router.get("/{decision_id}", response_model=WeeklyTaskDecisionRead)
def read_weekly_task_decision(
    decision_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> WeeklyTaskDecision:
    return require_decision(db, decision_id)


@router.post(
    "",
    response_model=WeeklyTaskDecisionRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {
            "model": WeeklyTaskDecisionRead,
            "description": "An existing decision was updated or the same action was already applied.",
        },
    },
)
def apply_weekly_task_decision(
    decision_data: WeeklyTaskDecisionCreate,
    response: Response,
    db: Session = Depends(get_db),
) -> WeeklyTaskDecisionRead:
    """Change an unfinished task and save its decision in one transaction.

    The request refers to the task BEFORE applying the action. Do not move
    or delete it through another endpoint first. A matching retry is a no-op
    while the task still exists in the expected resulting state. A deleted
    task returns 404 on retry, without creating another history record.
    """

    try:
        lock_decision_writes(db)
        task = db.scalar(
            select(Task)
            .where(Task.id == decision_data.task_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found.")
        if task.completed or task.completed_at is not None:
            raise HTTPException(
                status_code=409,
                detail="Only unfinished tasks can receive a weekly decision. No changes were saved.",
            )
        if not task.title.strip():
            raise HTTPException(status_code=409, detail="The task needs a nonblank title. No changes were saved.")

        existing = db.scalar(
            select(WeeklyTaskDecision)
            .where(
                WeeklyTaskDecision.week_start == decision_data.week_start,
                WeeklyTaskDecision.task_id == task.id,
                WeeklyTaskDecision.original_due_date == decision_data.original_due_date,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        rule_id = task_rule_id(db, task)
        action = decision_data.action
        resolved = decision_data.resolved_due_date
        target_due_date = (
            resolved if action in ("nextWeek", "reschedule")
            else None if action == "inbox"
            else decision_data.original_due_date
        )
        target_day = "Inbox" if target_due_date is None else WEEKDAYS[target_due_date.weekday()]

        already_applied = (
            existing is not None
            and action != "delete"
            and existing.action == action
            and existing.resolved_due_date == resolved
            and existing.recurring_rule_id == rule_id
            and existing.source_recurring_rule_id == task.source_recurring_rule_id
            and existing.recurrence_occurrence_date == task.recurrence_occurrence_date
            and task.due_date == target_due_date
            and task.day == target_day
        )
        if already_applied:
            result = WeeklyTaskDecisionRead.model_validate(existing)
            db.commit()
            response.status_code = status.HTTP_200_OK
            return result

        if task.due_date != decision_data.original_due_date:
            raise HTTPException(
                status_code=409,
                detail="The task's scheduled date has changed. Refresh the task before deciding. No changes were saved.",
            )

        values = dict(
            week_start=decision_data.week_start,
            task_id=None if action == "delete" else task.id,
            task_title=task.title,
            original_due_date=decision_data.original_due_date,
            action=action,
            resolved_due_date=resolved,
            recurring_rule_id=rule_id,
            source_recurring_rule_id=task.source_recurring_rule_id,
            recurrence_occurrence_date=task.recurrence_occurrence_date,
            decided_at=datetime.now(UTC),
        )
        if existing is None:
            decision = WeeklyTaskDecision(**values)
            db.add(decision)
        else:
            decision = existing
            # Preserve both the PostgreSQL ID and any imported source ID.
            for name, value in values.items():
                setattr(decision, name, value)

        if action == "delete":
            if rule_id is not None and task.recurrence_occurrence_date is not None:
                # Use the original recurring date, even after rescheduling.
                # This prevents the generator from recreating deleted work.
                db.execute(
                    insert(RecurringOccurrenceException)
                    .values(
                        recurring_rule_id=rule_id,
                        occurrence_date=task.recurrence_occurrence_date,
                    )
                    .on_conflict_do_nothing()
                )
            db.delete(task)
        elif action != "keep":
            task.due_date = target_due_date
            task.day = target_day
            # Keep goal links, recurrence identity, and completion fields.

        db.flush()
        result = WeeklyTaskDecisionRead.model_validate(decision)
        db.commit()
        if existing is not None:
            response.status_code = status.HTTP_200_OK

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return result


@router.delete(
    "/{decision_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_weekly_task_decision(
    decision_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete only the history record; do not undo the task action or its skip."""

    try:
        lock_decision_writes(db)
        decision = require_decision(db, decision_id, for_update=True)
        db.delete(decision)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)
