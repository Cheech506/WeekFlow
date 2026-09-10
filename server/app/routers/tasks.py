"""API routes for WeekFlow tasks."""
# UTC gives timestamps an explicit universal timezone.
# datetime creates the exact time when a task is completed.
from datetime import UTC, datetime

# FastAPI tools used by these task routes.
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Response,
    status,
)
# select builds SELECT queries in Python.
from sqlalchemy import select

# Session represents one conversation with PostgreSQL.
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Task
from app.schemas import TaskCreate, TaskRead, TaskUpdate

# Every endpoint in this router will begin with /api/v1/tasks.
#
# The "tasks" tag also groups these endpoints together in Swagger.
router = APIRouter(
    prefix=f"{API_PREFIX}/tasks",
    tags=["tasks"],
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
    """
    Validate, save, and return one new task.

    FastAPI converts the incoming JSON into TaskCreate before this
    function runs. Invalid requests never reach this function.
    """

    # A task without a due date belongs in Inbox.
    #
    # If it has a due date, strftime("%A") returns the weekday name.
    # For example, 2026-09-10 becomes "Thursday".
    day = (
        task_data.due_date.strftime("%A")
        if task_data.due_date is not None
        else "Inbox"
    )

    # Convert the validated API data into a SQLAlchemy Task object.
    #
    # We do not provide id, completed, or created_at because
    # SQLAlchemy/PostgreSQL supply their configured defaults.
    task = Task(
        title=task_data.title,
        day=day,
        due_date=task_data.due_date,
        notes=task_data.notes or None,
        priority=task_data.priority,
    )

    # Stage the new Task inside this database session.
    db.add(task)

    # Permanently send the INSERT to PostgreSQL.
    db.commit()

    # Reload the row so PostgreSQL-generated values such as id and
    # created_at are available for the response.
    db.refresh(task)

    # FastAPI passes this SQLAlchemy object through TaskRead and
    # converts it into response JSON.
    return task

@router.get(
    "",
    response_model=list[TaskRead],
)
def read_tasks(
    db: Session = Depends(get_db),
) -> list[Task]:
    """Return every task, with the newest tasks first."""

    # Build the SQLAlchemy version of:
    # SELECT * FROM tasks ORDER BY created_at DESC, id DESC;
    statement = select(Task).order_by(
        Task.created_at.desc(),
        Task.id.desc(),
    )

    # Execute the SELECT and return all matching Task objects.
    # FastAPI converts each object through TaskRead.
    return list(db.scalars(statement).all())


@router.get(
    "/{task_id}",
    response_model=TaskRead,
)
def read_task(
    task_id: int,
    db: Session = Depends(get_db),
) -> Task:
    """Return one task using its unique ID."""

    # PostgreSQL searches the tasks primary key for task_id.
    task = db.get(Task, task_id)

    # A missing resource should produce 404 Not Found.
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    return task

@router.patch(
    "/{task_id}",
    response_model=TaskRead,
)
def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
) -> Task:
    """
    Change only the supplied fields on one existing task.

    PATCH is a partial update. Fields missing from the request keep
    their current PostgreSQL values.
    """

    # First, retrieve the existing task using its primary-key ID.
    task = db.get(Task, task_id)

    # We cannot update a task that does not exist.
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Convert TaskUpdate into a dictionary containing only fields
    # that the client actually included in the PATCH request.
    #
    # Example:
    # {"priority": 2}
    #
    # Without exclude_unset=True, omitted fields would appear as None
    # and could accidentally erase existing values.
    changes = task_data.model_dump(
        exclude_unset=True,
    )

    # WeekFlow derives day from due_date, so they must change together.
    if "due_date" in changes:
        due_date = changes["due_date"]

        changes["day"] = (
            due_date.strftime("%A")
            if due_date is not None
            else "Inbox"
        )

    # Keep completed and completed_at synchronized.
    if "completed" in changes:
        completed = changes["completed"]

        # Set the completion time only when an incomplete task becomes complete.
        if completed and not task.completed:
            changes["completed_at"] = datetime.now(UTC)

        # Reopening a task removes its old completion time.
        elif not completed:
            changes["completed_at"] = None

    # Apply every supplied change to the SQLAlchemy Task object.
    #
    # setattr(task, "priority", 2) is the dynamic equivalent of:
    # task.priority = 2
    for field_name, value in changes.items():
        setattr(
            task,
            field_name,
            value,
        )

    # Permanently save the UPDATE in PostgreSQL.
    db.commit()

    # Reload the saved row before constructing the API response.
    db.refresh(task)

    # TaskRead converts the SQLAlchemy object into response JSON.
    return task

@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Permanently remove one task from PostgreSQL."""

    # Find the task before attempting to delete it.
    task = db.get(Task, task_id)

    # We cannot delete a task that does not exist.
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Mark this SQLAlchemy Task object for deletion.
    #
    # This has not permanently changed PostgreSQL yet.
    db.delete(task)

    # Send the DELETE operation to PostgreSQL permanently.
    db.commit()

    # HTTP 204 means:
    # "The operation succeeded, but there is no response body."
    #
    # There is no task JSON to return because the task no longer exists.
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
    )