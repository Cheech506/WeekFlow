"""API actions for converting, editing, and detaching recurring tasks."""

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.schemas import (
    RecurringEditFromOccurrenceRequest,
    RecurringTaskWorkflowRead,
    TaskConvertToRecurringRequest,
    TaskRead,
)
from app.services.recurring_task_workflows import (
    RecurringTaskConflictError,
    RecurringTaskNotFoundError,
    convert_task_to_recurring,
    detach_recurring_task,
    edit_recurring_from_occurrence,
)


router = APIRouter(
    prefix=f"{API_PREFIX}/tasks",
    tags=["recurring task actions"],
)


def _validation_error(error: ValidationError) -> HTTPException:
    """Encode validation that needs the task's saved occurrence date.

    Request-body validation happens automatically before the service runs.
    The series-edit service also validates the supplied end date against
    the selected task's ORIGINAL occurrence date after loading that task.
    Exclude exception objects from error context so the response is JSON.
    """

    errors = error.errors(include_context=False, include_url=False)
    for item in errors:
        item["loc"] = ["body", *item["loc"]]
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=jsonable_encoder(errors),
    )


@router.post(
    "/{task_id}/convert-to-recurring",
    response_model=RecurringTaskWorkflowRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"description": "The task or requested goal does not exist."},
        409: {"description": "The task cannot be converted safely; no changes were saved."},
    },
)
def convert_existing_task_to_recurring(
    workflow_data: TaskConvertToRecurringRequest,
    task_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> RecurringTaskWorkflowRead:
    """Create a schedule using an existing unfinished task as its first occurrence.

    Supply the complete schedule settings and the device's current date.
    The selected task keeps its PostgreSQL ID and original creation time;
    its supplied start date becomes its scheduled date. Upcoming tasks are
    generated within the requested horizon, without duplicating the first.

    The service saves the schedule and tasks together. A task that already
    has a recurring identity returns 409, including on a successful retry.
    """

    try:
        return convert_task_to_recurring(
            db=db,
            task_id=task_id,
            request=workflow_data,
        )
    except RecurringTaskNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RecurringTaskConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValidationError as error:
        raise _validation_error(error) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post(
    "/{task_id}/edit-recurring-from-occurrence",
    response_model=RecurringTaskWorkflowRead,
    status_code=status.HTTP_200_OK,
    responses={
        404: {"description": "The task, schedule, or requested goal does not exist."},
        409: {"description": "The series cannot be revised safely; no changes were saved."},
    },
)
def edit_series_from_selected_task(
    workflow_data: RecurringEditFromOccurrenceRequest,
    task_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> RecurringTaskWorkflowRead:
    """Apply a complete series edit from the selected unfinished occurrence.

    Send the full editable schedule form, plus the device's current date.
    Omitted optional fields use defaults: notes/goal/end_date clear and
    priority becomes zero. Do not send start_date or active; the saved
    original occurrence date and the schedule's active state determine them.

    The selected task keeps its ID, rescheduled due date, or Inbox placement.
    Earlier occurrences and all completed tasks retain their details and
    individual goal links. Only later unfinished occurrences are removed
    and rebuilt within the generation window. Existing skips are retained;
    paused schedules stay paused. Deleted tasks' saved weekly history is
    retained with its live task links cleared.

    This operation commits once. Repeating it can rebuild later unfinished
    tasks again; the response lists their removed IDs and newly generated IDs.
    """

    try:
        return edit_recurring_from_occurrence(
            db=db,
            task_id=task_id,
            request=workflow_data,
        )
    except RecurringTaskNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RecurringTaskConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValidationError as error:
        raise _validation_error(error) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post(
    "/{task_id}/detach-recurring",
    response_model=TaskRead,
    status_code=status.HTTP_200_OK,
    responses={
        404: {"description": "The task or its recurring schedule does not exist."},
        409: {"description": "The occurrence cannot be detached safely; no changes were saved."},
    },
)
def detach_existing_recurring_task(
    task_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> TaskRead:
    """Keep one unfinished occurrence as a standalone task.

    No request body is needed. The server reads the original occurrence date
    and schedule from the saved task, records a skip, and clears its recurring
    identity in one transaction. Its ID, goal, notes, creation time, due date
    or Inbox placement, and weekly links are retained. Other occurrences and
    the schedule itself are unchanged. Completed history cannot be detached.

    A repeat after a successful detach returns 409. Do not automatically
    repeat this action after a lost response; read the task to check its state.
    """

    try:
        return detach_recurring_task(db=db, task_id=task_id)
    except RecurringTaskNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RecurringTaskConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
