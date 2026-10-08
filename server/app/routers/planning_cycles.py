"""API endpoints for reading WeekFlow planning cycles."""

from datetime import UTC, datetime, timedelta
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    status,
)
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import PlanningCycle
from app.schemas import (
    PlanningCycleCreate,
    PlanningCycleRead,
    PlanningCycleUpdate,
)


router = APIRouter(
    prefix=f"{API_PREFIX}/planning-cycles",
    tags=["planning cycles"],
)


@router.get(
    "",
    response_model=list[PlanningCycleRead],
)
def read_planning_cycles(
    db: Session = Depends(get_db),
) -> list[PlanningCycle]:
    """Return all cycles, including history, newest first."""

    statement = select(PlanningCycle).order_by(
        PlanningCycle.start_date.desc(),
        PlanningCycle.id.desc(),
    )

    return list(db.scalars(statement).all())


@router.get(
    "/current",
    response_model=PlanningCycleRead | None,
)
def read_current_planning_cycle(
    db: Session = Depends(get_db),
) -> PlanningCycle | None:
    """Return the active cycle, or null if none exists."""

    statement = select(PlanningCycle).where(
        PlanningCycle.active.is_(True)
    )

    return db.scalar(statement)


@router.get(
    "/{cycle_id}",
    response_model=PlanningCycleRead,
)
def read_planning_cycle(
    cycle_id: int = Path(gt=0),
    db: Session = Depends(get_db),
) -> PlanningCycle:
    """Read one cycle using its PostgreSQL ID."""

    cycle = db.get(PlanningCycle, cycle_id)

    if cycle is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Planning cycle not found.",
        )

    return cycle

@router.post(
    "",
    response_model=PlanningCycleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_planning_cycle(
    cycle_data: PlanningCycleCreate,
    db: Session = Depends(get_db),
) -> PlanningCycle:
    """Close the previous active cycle and start a new one atomically."""

    try:
        end_date = (
            cycle_data.start_date
            + timedelta(days=83)
        )
    except OverflowError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "The start date is too late to calculate "
                "the cycle end date."
            ),
        ) from error

    try:
        # Serialize writes so competing requests cannot
        # start active cycles at the same time.
        db.execute(
            text(
                "LOCK TABLE planning_cycles "
                "IN SHARE ROW EXCLUSIVE MODE"
            )
        )

        # Keep the previous cycle as a historical record.
        db.execute(
            update(PlanningCycle)
            .where(PlanningCycle.active.is_(True))
            .values(
                active=False,
                completed_at=datetime.now(UTC),
            )
        )

        # PostgreSQL generates the new cycle's internal ID.
        cycle = PlanningCycle(
            name=cycle_data.name,
            primary_focus=cycle_data.primary_focus,
            theme=cycle_data.theme,
            start_date=cycle_data.start_date,
            end_date=end_date,
            active=True,
            completed_at=None,
        )

        db.add(cycle)

        # Save both changes together.
        db.commit()

    except IntegrityError as error:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "The planning cycle could not be started. "
                "No changes were saved."
            ),
        ) from error

    except Exception:
        db.rollback()
        raise

    db.refresh(cycle)

    return cycle

@router.patch(
    "/{cycle_id}",
    response_model=PlanningCycleRead,
)
def update_planning_cycle(
    cycle_data: PlanningCycleUpdate,
    cycle_id: int = Path(gt=0),
    db: Session = Depends(get_db),
) -> PlanningCycle:
    """Update only supplied fields on the active planning cycle."""

    # Omitted fields keep their current database values.
    changes = cycle_data.model_dump(
        exclude_unset=True,
    )

    if "start_date" in changes:
        try:
            changes["end_date"] = (
                changes["start_date"]
                + timedelta(days=83)
            )
        except OverflowError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    "The start date is too late to calculate "
                    "the cycle end date."
                ),
            ) from error

    try:
        # Coordinate this update with cycle creation and refresh.
        db.execute(
            text(
                "LOCK TABLE planning_cycles "
                "IN SHARE ROW EXCLUSIVE MODE"
            )
        )

        # Read the latest values after obtaining the lock.
        cycle = db.get(
            PlanningCycle,
            cycle_id,
            populate_existing=True,
        )

        if cycle is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Planning cycle not found.",
            )

        if not cycle.active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Only the active planning cycle "
                    "can be edited."
                ),
            )

        for field_name, value in changes.items():
            setattr(cycle, field_name, value)

        db.commit()

    except IntegrityError as error:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "The planning cycle could not be updated. "
                "No changes were saved."
            ),
        ) from error

    except Exception:
        db.rollback()
        raise

    db.refresh(cycle)

    return cycle