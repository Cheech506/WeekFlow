"""API routes for WeekFlow tasks."""

# FastAPI tools used by these task routes.
from fastapi import APIRouter, Depends, HTTPException, status

# select builds SELECT queries in Python.
from sqlalchemy import select

# Session represents one conversation with PostgreSQL.
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Task
from app.schemas import TaskCreate, TaskRead

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