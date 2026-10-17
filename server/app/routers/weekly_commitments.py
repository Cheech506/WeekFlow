"""API endpoints for standalone and task-linked weekly commitments."""

from datetime import UTC, date, datetime

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    status,
)
from sqlalchemy import case, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import PlanningCycle, Task, WeeklyCommitment
from app.schemas import (
    WeeklyCommitmentCreate,
    WeeklyCommitmentRead,
    WeeklyCommitmentUpdate,
)


router = APIRouter(
    prefix=f"{API_PREFIX}/weekly-commitments",
    tags=["weekly commitments"],
)


def lock_commitment_writes(db: Session) -> None:
    """Coordinate linked-task completion with goal snapshots and imports."""

    # Match the relative table order used by other application writes.
    db.execute(text(
        "LOCK TABLE goals, planning_cycles, tasks, weekly_commitments "
        "IN SHARE ROW EXCLUSIVE MODE"
    ))


def require_commitment(db: Session, commitment_id: int) -> WeeklyCommitment:
    """Read the latest commitment under the write lock or return 404."""

    commitment = db.scalar(
        select(WeeklyCommitment)
        .where(WeeklyCommitment.id == commitment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if commitment is None:
        raise HTTPException(status_code=404, detail="Weekly commitment not found.")

    return commitment


def require_task(db: Session, task_id: int) -> Task:
    """Read a linked PostgreSQL task without accepting a SQLite source ID."""

    task = db.scalar(
        select(Task)
        .where(Task.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )

    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")

    return task


def displayed_completion():
    """Use live task state when linked, otherwise the saved commitment."""

    return case(
        (Task.id.is_not(None), Task.completed),
        else_=WeeklyCommitment.completed,
    )


def commitment_read_statement():
    """Project live task fields without writing into the stored snapshot."""

    return select(
        WeeklyCommitment.id,
        WeeklyCommitment.source_weekly_commitment_id,
        WeeklyCommitment.week_start,
        WeeklyCommitment.cycle_id,
        WeeklyCommitment.task_id,
        case(
            (Task.id.is_not(None), Task.title),
            else_=WeeklyCommitment.title,
        ).label("title"),
        displayed_completion().label("completed"),
        WeeklyCommitment.created_at,
        # An incomplete live task has completed_at=null. Do not fall back
        # to an older saved completion timestamp in that case.
        case(
            (Task.id.is_not(None), Task.completed_at),
            else_=WeeklyCommitment.completed_at,
        ).label("completed_at"),
    ).outerjoin(Task, WeeklyCommitment.task_id == Task.id)


def read_commitment_result(db: Session, commitment_id: int) -> WeeklyCommitmentRead:
    """Read the same displayed state used by the list endpoint."""

    row = db.execute(
        commitment_read_statement().where(WeeklyCommitment.id == commitment_id)
    ).mappings().one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail="Weekly commitment not found.")

    return WeeklyCommitmentRead.model_validate(row)


def write_conflict() -> HTTPException:
    """Report duplicate selections or rejected writes without database details."""

    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="The weekly commitment could not be saved. No changes were saved.",
    )


@router.get("", response_model=list[WeeklyCommitmentRead])
def read_weekly_commitments(
    week_start: date | None = Query(default=None),
    cycle_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    task_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    completed: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[WeeklyCommitmentRead]:
    """Read commitments using live task state and optional filters."""

    if week_start is not None and week_start.weekday() != 0:
        raise HTTPException(status_code=422, detail="week_start must be a Monday")

    statement = commitment_read_statement()
    if week_start is not None:
        statement = statement.where(WeeklyCommitment.week_start == week_start)
    if cycle_id is not None:
        statement = statement.where(WeeklyCommitment.cycle_id == cycle_id)
    if task_id is not None:
        statement = statement.where(WeeklyCommitment.task_id == task_id)
    if completed is not None:
        statement = statement.where(displayed_completion().is_(completed))

    statement = statement.order_by(
        WeeklyCommitment.week_start.desc(),
        displayed_completion().asc(),
        WeeklyCommitment.id.asc(),
    )

    return [
        WeeklyCommitmentRead.model_validate(row)
        for row in db.execute(statement).mappings().all()
    ]


@router.get("/{commitment_id}", response_model=WeeklyCommitmentRead)
def read_weekly_commitment(
    commitment_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> WeeklyCommitmentRead:
    """Read one standalone or linked commitment."""

    return read_commitment_result(db, commitment_id)


@router.post(
    "",
    response_model=WeeklyCommitmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_weekly_commitment(
    commitment_data: WeeklyCommitmentCreate,
    db: Session = Depends(get_db),
) -> WeeklyCommitmentRead:
    """Create a promise or select an existing task for a Monday-based week."""

    try:
        lock_commitment_writes(db)

        if commitment_data.cycle_id is not None:
            if db.get(PlanningCycle, commitment_data.cycle_id) is None:
                raise HTTPException(status_code=404, detail="Planning cycle not found.")

        values = commitment_data.model_dump()
        values.update(completed=False, completed_at=None)

        if commitment_data.task_id is not None:
            task = require_task(db, commitment_data.task_id)
            duplicate = db.scalar(
                select(WeeklyCommitment.id).where(
                    WeeklyCommitment.week_start == commitment_data.week_start,
                    WeeklyCommitment.task_id == task.id,
                ).limit(1)
            )
            if duplicate is not None:
                raise HTTPException(
                    status_code=409,
                    detail="That task is already a commitment for this week.",
                )

            title = task.title.strip()
            if not title or len(title) > 180:
                raise HTTPException(
                    status_code=422,
                    detail="The linked task needs a title between 1 and 180 characters.",
                )

            if task.completed != (task.completed_at is not None):
                raise HTTPException(
                    status_code=409,
                    detail="The linked task has inconsistent completion data. No changes were saved.",
                )

            values.update(
                title=title,
                completed=task.completed,
                completed_at=task.completed_at,
            )

        commitment = WeeklyCommitment(**values)
        db.add(commitment)
        db.flush()
        commitment_id = commitment.id
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return read_commitment_result(db, commitment_id)


@router.patch("/{commitment_id}", response_model=WeeklyCommitmentRead)
def update_weekly_commitment(
    commitment_data: WeeklyCommitmentUpdate,
    commitment_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> WeeklyCommitmentRead:
    """Edit a promise or atomically complete/reopen a commitment and its task."""

    changes = commitment_data.model_dump(exclude_unset=True)

    try:
        lock_commitment_writes(db)
        commitment = require_commitment(db, commitment_id)

        if "title" in changes:
            if commitment.task_id is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Edit a task-linked commitment's title through the Task API.",
                )
            commitment.title = changes["title"]

        if "completed" in changes:
            task = (
                require_task(db, commitment.task_id)
                if commitment.task_id is not None
                else None
            )
            current_state = task if task is not None else commitment
            completed = changes["completed"]

            if completed:
                completed_at = (
                    current_state.completed_at
                    if current_state.completed
                    else datetime.now(UTC)
                )
                if completed_at is None:
                    raise HTTPException(
                        status_code=409,
                        detail="The current completion data is inconsistent. No changes were saved.",
                    )
            else:
                completed_at = None

            if task is not None:
                task.completed = completed
                task.completed_at = completed_at

            commitment.completed = completed
            commitment.completed_at = completed_at

        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return read_commitment_result(db, commitment_id)


@router.delete(
    "/{commitment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_weekly_commitment(
    commitment_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Remove the commitment while preserving its task and planning cycle."""

    try:
        lock_commitment_writes(db)
        commitment = require_commitment(db, commitment_id)
        db.delete(commitment)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)
