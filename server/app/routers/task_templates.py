"""API endpoints for task templates and creating independent Inbox tasks."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Goal, Task, TaskTemplate
from app.schemas import TaskRead, TaskTemplateCreate, TaskTemplateRead, TaskTemplateUpdate


router = APIRouter(
    prefix=f"{API_PREFIX}/task-templates",
    tags=["task templates"],
)


def lock_template_writes(db: Session, *, include_tasks: bool = False) -> None:
    """Coordinate template goal links and task creation with other writers."""

    tables = "goals, task_templates, tasks" if include_tasks else "goals, task_templates"
    db.execute(text(f"LOCK TABLE {tables} IN SHARE ROW EXCLUSIVE MODE"))


def require_template(db: Session, template_id: int, *, for_update: bool = False) -> TaskTemplate:
    statement = (
        select(TaskTemplate).where(TaskTemplate.id == template_id)
        .execution_options(populate_existing=True)
    )
    if for_update:
        statement = statement.with_for_update()
    template = db.scalar(statement)
    if template is None:
        raise HTTPException(status_code=404, detail="Task template not found.")
    return template


def require_goal(db: Session, goal_id: int | None) -> Goal | None:
    if goal_id is None:
        return None
    goal = db.get(Goal, goal_id, populate_existing=True)
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found.")
    return goal


def write_conflict() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail="The task template operation could not be completed. No changes were saved.",
    )


@router.get("", response_model=list[TaskTemplateRead])
def read_task_templates(
    goal_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> list[TaskTemplate]:
    """Read reusable templates, optionally filtered by their native goal ID."""

    statement = select(TaskTemplate)
    if goal_id is not None:
        statement = statement.where(TaskTemplate.goal_id == goal_id)
    statement = statement.order_by(TaskTemplate.updated_at.desc(), TaskTemplate.id.desc())
    return list(db.scalars(statement).all())


@router.get("/{template_id}", response_model=TaskTemplateRead)
def read_task_template(
    template_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> TaskTemplate:
    return require_template(db, template_id)


@router.post("", response_model=TaskTemplateRead, status_code=status.HTTP_201_CREATED)
def create_task_template(
    template_data: TaskTemplateCreate,
    db: Session = Depends(get_db),
) -> TaskTemplateRead:
    """Save reusable task details without creating any live task."""

    try:
        lock_template_writes(db)
        require_goal(db, template_data.goal_id)
        now = datetime.now(UTC)
        template = TaskTemplate(**template_data.model_dump(), created_at=now, updated_at=now)
        db.add(template)
        db.flush()
        result = TaskTemplateRead.model_validate(template)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return result


@router.patch("/{template_id}", response_model=TaskTemplateRead)
def update_task_template(
    template_data: TaskTemplateUpdate,
    template_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> TaskTemplateRead:
    """Edit supplied details without changing tasks previously made from them."""

    changes = template_data.model_dump(exclude_unset=True)
    try:
        lock_template_writes(db)
        template = require_template(db, template_id, for_update=True)
        if "goal_id" in changes:
            require_goal(db, changes["goal_id"])
        for name, value in changes.items():
            setattr(template, name, value)
        if changes:
            template.updated_at = datetime.now(UTC)
        db.flush()
        result = TaskTemplateRead.model_validate(template)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return result


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_task_template(
    template_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete only the template while retaining all existing tasks."""

    try:
        lock_template_writes(db)
        template = require_template(db, template_id, for_update=True)
        db.delete(template)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{template_id}/create-task",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
)
def create_task_from_template(
    template_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> TaskRead:
    """Create a new one-time Inbox task using the current saved template.

    The template is retained unchanged. Each successful call intentionally
    creates another task. Load the template and use the normal Task API
    instead when the user wants to customize details before creating it.
    """

    try:
        lock_template_writes(db, include_tasks=True)
        template = require_template(db, template_id, for_update=True)
        goal = require_goal(db, template.goal_id)
        title = template.title.strip()
        if not title:
            raise HTTPException(status_code=409, detail="The template needs a nonblank title before creating a task.")
        notes = (template.notes or "").strip() or None
        task = Task(
            title=title, notes=notes, priority=template.priority,
            goal_id=goal.id if goal is not None else None,
            source_goal_id=goal.source_goal_id if goal is not None else None,
            day="Inbox", due_date=None, completed=False, completed_at=None,
            source_task_id=None, recurring_rule_id=None,
            source_recurring_rule_id=None, recurrence_occurrence_date=None,
            created_at=datetime.now(UTC),
        )
        db.add(task)
        db.flush()
        result = TaskRead.model_validate(task)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return result
