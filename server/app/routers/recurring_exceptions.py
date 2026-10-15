"""API endpoints for skipped recurring occurrences."""

from datetime import date

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import RecurringOccurrenceException, Task
from app.routers.recurring_rules import (
    lock_recurring_writes,
    require_rule,
    task_rule_link,
)
from app.schemas import RecurringExceptionCreate, RecurringExceptionRead


router = APIRouter(
    prefix=f"{API_PREFIX}/recurring-exceptions",
    tags=["recurring exceptions"],
)


def require_exception(
    db: Session,
    rule_id: int,
    occurrence_date: date,
) -> RecurringOccurrenceException:
    """Find a skip by its composite identity or return 404."""

    exception = db.get(
        RecurringOccurrenceException,
        (rule_id, occurrence_date),
        populate_existing=True,
    )

    if exception is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recurring exception not found.",
        )

    return exception


def write_conflict() -> HTTPException:
    """Report a rejected write without exposing database internals."""

    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="The recurring exception could not be saved. No changes were saved.",
    )


@router.get("", response_model=list[RecurringExceptionRead])
def read_recurring_exceptions(
    recurring_rule_id: int | None = Query(
        default=None,
        gt=0,
        le=2_147_483_647,
    ),
    occurrence_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[RecurringOccurrenceException]:
    """Read skips, optionally filtered by PostgreSQL schedule ID and date."""

    statement = select(RecurringOccurrenceException)

    if recurring_rule_id is not None:
        statement = statement.where(
            RecurringOccurrenceException.recurring_rule_id == recurring_rule_id
        )

    if occurrence_date is not None:
        statement = statement.where(
            RecurringOccurrenceException.occurrence_date == occurrence_date
        )

    statement = statement.order_by(
        RecurringOccurrenceException.occurrence_date.asc(),
        RecurringOccurrenceException.recurring_rule_id.asc(),
    )

    return list(db.scalars(statement).all())


@router.get(
    "/{rule_id}/{occurrence_date}",
    response_model=RecurringExceptionRead,
)
def read_recurring_exception(
    rule_id: int = Path(gt=0, le=2_147_483_647),
    occurrence_date: date = Path(),
    db: Session = Depends(get_db),
) -> RecurringOccurrenceException:
    """Read one skip using its schedule ID and original occurrence date."""

    return require_exception(db, rule_id, occurrence_date)


@router.post(
    "",
    response_model=RecurringExceptionRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {
            "model": RecurringExceptionRead,
            "description": "The occurrence was already skipped.",
        },
    },
)
def create_recurring_exception(
    exception_data: RecurringExceptionCreate,
    response: Response,
    db: Session = Depends(get_db),
) -> RecurringOccurrenceException:
    """Skip an occurrence that has no task; identical retries are harmless.

    An existing task must be handled through the Task API. Deleting a
    recurring task there records its skip and deletion in one transaction.
    This endpoint never deletes tasks or changes completed history.
    """

    try:
        lock_recurring_writes(db)
        rule = require_rule(
            db,
            exception_data.recurring_rule_id,
            for_update=True,
        )

        identity = (rule.id, exception_data.occurrence_date)
        exception = db.get(
            RecurringOccurrenceException,
            identity,
            populate_existing=True,
        )

        if exception is not None:
            # Preserve the first skip's timestamp rather than replacing it.
            response.status_code = status.HTTP_200_OK

        else:
            existing_task_id = db.scalar(
                select(Task.id)
                .where(
                    task_rule_link(rule),
                    Task.recurrence_occurrence_date
                    == exception_data.occurrence_date,
                )
                .limit(1)
            )

            if existing_task_id is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "This occurrence already has a task. "
                        "Handle that task through the Task API. "
                        "No changes were saved."
                    ),
                )

            exception = RecurringOccurrenceException(
                recurring_rule_id=rule.id,
                occurrence_date=exception_data.occurrence_date,
            )
            db.add(exception)

        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    db.refresh(exception)
    return exception


@router.delete(
    "/{rule_id}/{occurrence_date}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_recurring_exception(
    rule_id: int = Path(gt=0, le=2_147_483_647),
    occurrence_date: date = Path(),
    db: Session = Depends(get_db),
) -> Response:
    """Remove a skip so a future generation request can create the occurrence.

    Removing a skip does not create a task immediately, erase task history,
    or change the schedule's active status or date pattern.
    """

    try:
        lock_recurring_writes(db)
        exception = require_exception(db, rule_id, occurrence_date)
        db.delete(exception)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error

    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)
