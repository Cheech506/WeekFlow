"""API endpoints for managing WeekFlow recurring schedules."""

from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import and_, delete, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Goal, RecurringRule, Task
from app.schemas import (
    RecurrenceGenerationRead,
    RecurrenceGenerationRequest,
    RecurringRuleCreate,
    RecurringRuleRead,
    RecurringRuleUpdate,
)

from app.services.recurrence_generation import (
    RecurrenceGenerationConflictError,
    RecurrenceGenerationResult,
    RecurringScheduleNotFoundError,
    generate_recurring_tasks,
)


from app.schemas.recurring_series_edit import (
    RecurringSeriesEditRead,
    RecurringSeriesEditRequest,
)
from app.services.recurring_series_edit import (
    RecurringSeriesEditConflictError,
    RecurringSeriesEditNotFoundError,
    edit_recurring_series,
)

router = APIRouter(
    prefix=f"{API_PREFIX}/recurring-rules",
    tags=["recurring schedules"],
)

DeleteRecurringRuleMode = Literal["stopOnly", "deleteUnfinished"]


def lock_recurring_writes(db: Session) -> None:
    """Coordinate schedule writes with tasks, imports, and history links."""

    # Keep the order consistent with task writes and complete imports.
    # Deleting tasks can clear their links in the two weekly tables.
    db.execute(text(
        "LOCK TABLE goals, recurring_occurrence_exceptions, "
        "recurring_rules, tasks, weekly_commitments, "
        "weekly_task_decisions IN SHARE ROW EXCLUSIVE MODE"
    ))


def require_rule(
    db: Session,
    rule_id: int,
    *,
    for_update: bool = False,
) -> RecurringRule:
    """Read a schedule using its PostgreSQL ID or return 404."""

    statement = select(RecurringRule).where(RecurringRule.id == rule_id)

    if for_update:
        statement = (
            statement
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    rule = db.scalar(statement)

    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recurring schedule not found.",
        )

    return rule


def require_goal(db: Session, goal_id: int | None) -> None:
    """An optional goal must reference an existing PostgreSQL goal."""

    if goal_id is not None and db.get(Goal, goal_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal not found.",
        )


def task_rule_link(rule: RecurringRule):
    """Use the native relationship, with fallback for source-only imports."""

    link = Task.recurring_rule_id == rule.id

    if rule.source_recurring_rule_id is not None:
        link = or_(
            link,
            and_(
                Task.recurring_rule_id.is_(None),
                Task.source_recurring_rule_id == rule.source_recurring_rule_id,
            ),
        )

    return link


def validate_merged_schedule(
    rule: RecurringRule,
    changes: dict,
) -> RecurringRuleCreate:
    """Validate PATCH fields together with the values already stored."""

    values = {
        field: getattr(rule, field)
        for field in RecurringRuleCreate.model_fields
    }
    values.update(changes)

    try:
        return RecurringRuleCreate.model_validate(values)

    except ValidationError as error:
        # Pydantic's optional error context can contain a ValueError object.
        # Exclude it and encode dates before returning a JSON error body.
        errors = error.errors(include_context=False, include_url=False)
        for item in errors:
            item["loc"] = ["body", *item["loc"]]

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=jsonable_encoder(errors),
        ) from error


def write_conflict() -> HTTPException:
    """Return a safe response when a database constraint rejects a write."""

    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="The recurring schedule could not be saved. No changes were saved.",
    )


@router.post(
    "/generate",
    response_model=RecurrenceGenerationRead,
    status_code=status.HTTP_200_OK,
)
def generate_recurring_occurrences(
    generation_data: RecurrenceGenerationRequest,
    db: Session = Depends(get_db),
) -> RecurrenceGenerationResult:
    """Create missing occurrences for one schedule or all schedules.

    Supply the user's current calendar date and an optional lookahead.
    Paused schedules and skips create no tasks. Repeating a request keeps
    existing occurrence identities and task history unchanged.

    This endpoint runs generation when called; it is not a background job.
    The service commits all generated tasks together or rolls them back.
    """

    try:
        return generate_recurring_tasks(
            db=db,
            current_date=generation_data.current_date,
            horizon_days=generation_data.horizon_days,
            recurring_rule_id=generation_data.recurring_rule_id,
        )

    except RecurringScheduleNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error

    except RecurrenceGenerationConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error

    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error


@router.get("", response_model=list[RecurringRuleRead])
def read_recurring_rules(
    goal_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    active: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[RecurringRule]:
    """Read schedules, optionally filtered by goal and active status."""

    statement = select(RecurringRule)

    if goal_id is not None:
        statement = statement.where(RecurringRule.goal_id == goal_id)

    if active is not None:
        statement = statement.where(RecurringRule.active.is_(active))

    statement = statement.order_by(
        RecurringRule.active.desc(),
        RecurringRule.created_at.desc(),
        RecurringRule.id.desc(),
    )

    return list(db.scalars(statement).all())


@router.get("/{rule_id}", response_model=RecurringRuleRead)
def read_recurring_rule(
    rule_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> RecurringRule:
    """Read one recurring schedule."""

    return require_rule(db, rule_id)


@router.post(
    "",
    response_model=RecurringRuleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_recurring_rule(
    rule_data: RecurringRuleCreate,
    db: Session = Depends(get_db),
) -> RecurringRule:
    """Create a schedule; occurrence generation is a separate operation."""

    try:
        lock_recurring_writes(db)
        require_goal(db, rule_data.goal_id)

        rule = RecurringRule(**rule_data.model_dump())
        db.add(rule)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=RecurringRuleRead)
def update_recurring_rule(
    rule_data: RecurringRuleUpdate,
    rule_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> RecurringRule:
    """Edit the schedule while preserving all existing task occurrences.

    Setting active=false pauses generation; active=true resumes it when
    occurrence generation runs. Goal changes apply to future generated
    occurrences. This endpoint does not rebuild or rewrite existing tasks.
    """

    changes = rule_data.model_dump(exclude_unset=True)

    try:
        lock_recurring_writes(db)
        rule = require_rule(db, rule_id, for_update=True)
        validated = validate_merged_schedule(rule, changes)
        require_goal(db, validated.goal_id)

        # Apply supplied fields only. The PostgreSQL ID, source identity,
        # creation timestamp, task histories, and skip records stay intact.
        for field in changes:
            setattr(rule, field, getattr(validated, field))

        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    db.refresh(rule)
    return rule


@router.delete(
    "/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_recurring_rule(
    rule_id: int = Path(gt=0, le=2_147_483_647),
    mode: DeleteRecurringRuleMode = Query(default="stopOnly"),
    db: Session = Depends(get_db),
) -> Response:
    """Remove a schedule using one of WeekFlow's two deletion options.

    stopOnly keeps all generated tasks as standalone tasks.
    deleteUnfinished deletes incomplete occurrences and keeps completed
    history as standalone tasks. Both modes remove the schedule's skips.
    """

    try:
        lock_recurring_writes(db)
        rule = require_rule(db, rule_id, for_update=True)
        link = task_rule_link(rule)

        if mode == "deleteUnfinished":
            # Existing task foreign keys retain commitments and decisions
            # while clearing their live links to the deleted tasks.
            db.execute(
                delete(Task).where(link, Task.completed.is_(False))
            )

        # Clear all recurrence identity fields together so the task CHECK
        # remains valid. Preserve task IDs, source_task_id, goal links,
        # completion state, titles, notes, and dates.
        db.execute(
            update(Task)
            .where(link)
            .values(
                recurring_rule_id=None,
                source_recurring_rule_id=None,
                recurrence_occurrence_date=None,
            )
        )

        # The exception foreign key cascades. Weekly task decisions retain
        # their historical recurring identities without a live rule FK.
        db.delete(rule)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{rule_id}/edit-series",
    response_model=RecurringSeriesEditRead,
    status_code=status.HTTP_200_OK,
)
def edit_recurring_schedule_series(
    edit_data: RecurringSeriesEditRequest,
    rule_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> RecurringSeriesEditRead:
    """Save a full schedule edit and rebuild future unfinished occurrences.

    Use the device's current calendar date as the inclusive rebuild boundary.
    Original occurrence dates determine which unfinished tasks are rebuilt,
    even if their due dates or Inbox placement have changed. Earlier unfinished
    tasks keep their IDs and placement while receiving the new task details.

    Completed history, skips, the schedule ID, and its active/paused state are
    preserved. Future replacement tasks receive new PostgreSQL IDs. The service
    saves the entire operation in one transaction or rolls it all back.

    Do not automatically retry after a lost response: another successful call
    can rebuild future tasks again. Refresh before deciding to submit again.
    """

    try:
        return edit_recurring_series(
            db=db,
            rule_id=rule_id,
            request=edit_data,
        )

    except RecurringSeriesEditNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error

    except RecurringSeriesEditConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
