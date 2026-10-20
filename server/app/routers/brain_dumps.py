"""API endpoints for Brain Dump notes, archive state, and task conversion."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import BrainDump, Task
from app.schemas import BrainDumpCreate, BrainDumpRead, BrainDumpUpdate, TaskRead


router = APIRouter(
    prefix=f"{API_PREFIX}/brain-dumps",
    tags=["brain dumps"],
)


def lock_brain_dump_writes(db: Session, *, include_tasks: bool = False) -> None:
    """Coordinate note writes and conversion with imports and task snapshots."""

    # Names and order are fixed, never taken from request data.
    tables = "brain_dumps, goals, tasks" if include_tasks else "brain_dumps"
    db.execute(text(f"LOCK TABLE {tables} IN SHARE ROW EXCLUSIVE MODE"))


def require_brain_dump(db: Session, brain_dump_id: int, *, for_update: bool = False) -> BrainDump:
    statement = (
        select(BrainDump).where(BrainDump.id == brain_dump_id)
        .execution_options(populate_existing=True)
    )
    if for_update:
        statement = statement.with_for_update()
    note = db.scalar(statement)
    if note is None:
        raise HTTPException(status_code=404, detail="Brain Dump note not found.")
    return note


def write_conflict() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail="The Brain Dump operation could not be completed. No changes were saved.",
    )


@router.get("", response_model=list[BrainDumpRead])
def read_brain_dumps(
    archived: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[BrainDump]:
    """Read all notes, or select active or archived notes."""

    statement = select(BrainDump)
    if archived is not None:
        statement = statement.where(BrainDump.archived.is_(archived))
    statement = statement.order_by(BrainDump.created_at.desc(), BrainDump.id.desc())
    return list(db.scalars(statement).all())


@router.get("/{brain_dump_id}", response_model=BrainDumpRead)
def read_brain_dump(
    brain_dump_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> BrainDump:
    return require_brain_dump(db, brain_dump_id)


@router.post("", response_model=BrainDumpRead, status_code=status.HTTP_201_CREATED)
def create_brain_dump(
    note_data: BrainDumpCreate,
    db: Session = Depends(get_db),
) -> BrainDumpRead:
    """Create an active note with a PostgreSQL-generated ID."""

    try:
        lock_brain_dump_writes(db)
        note = BrainDump(
            body=note_data.body, archived=False, archived_at=None,
            created_at=datetime.now(UTC),
        )
        db.add(note)
        db.flush()
        result = BrainDumpRead.model_validate(note)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return result


@router.patch("/{brain_dump_id}", response_model=BrainDumpRead)
def update_brain_dump(
    note_data: BrainDumpUpdate,
    brain_dump_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> BrainDumpRead:
    """Edit text, archive, or restore while preserving the note's identity."""

    changes = note_data.model_dump(exclude_unset=True)
    try:
        lock_brain_dump_writes(db)
        note = require_brain_dump(db, brain_dump_id, for_update=True)
        if "body" in changes:
            note.body = changes["body"]
        if "archived" in changes:
            archived = changes["archived"]
            if archived and not note.archived:
                note.archived_at = datetime.now(UTC)
            elif not archived:
                note.archived_at = None
            # Repeating archived=True preserves the original archive time.
            note.archived = archived
        db.flush()
        result = BrainDumpRead.model_validate(note)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return result


@router.delete(
    "/{brain_dump_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_brain_dump(
    brain_dump_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete only the note; existing tasks and saved reports are unchanged."""

    try:
        lock_brain_dump_writes(db)
        note = require_brain_dump(db, brain_dump_id, for_update=True)
        db.delete(note)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{brain_dump_id}/convert-to-task",
    response_model=TaskRead,
    status_code=status.HTTP_201_CREATED,
)
def convert_brain_dump_to_task(
    brain_dump_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> TaskRead:
    """Create one Inbox task and remove the active note in one transaction.

    The new task receives its own PostgreSQL ID and creation timestamp.
    No SQLite source identity, goal, or recurrence identity is copied.
    A retry after success returns 404 because the source note is gone.
    """

    try:
        lock_brain_dump_writes(db, include_tasks=True)
        note = require_brain_dump(db, brain_dump_id, for_update=True)
        if note.archived:
            raise HTTPException(
                status_code=409,
                detail="Restore the Brain Dump note before turning it into a task.",
            )
        title = note.body.strip()
        if not title:
            raise HTTPException(status_code=409, detail="An empty Brain Dump note cannot become a task.")

        task = Task(
            title=title, day="Inbox", due_date=None, notes=None,
            priority=0, goal_id=None, source_task_id=None,
            source_goal_id=None, recurring_rule_id=None,
            source_recurring_rule_id=None, recurrence_occurrence_date=None,
            completed=False, completed_at=None, created_at=datetime.now(UTC),
        )
        db.add(task)
        db.delete(note)
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
