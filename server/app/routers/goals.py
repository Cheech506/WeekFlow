"""API endpoints for reading, creating, and editing WeekFlow goals."""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Goal, PlanningCycle
from app.schemas import GoalCreate, GoalRead, GoalUpdate


router = APIRouter(
    prefix=f"{API_PREFIX}/goals",
    tags=["goals"],
)


@router.get("", response_model=list[GoalRead])
def read_goals(
    cycle_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> list[Goal]:
    """Read all goals, or only goals belonging to a selected cycle."""

    statement = select(Goal)

    if cycle_id is not None:
        statement = statement.where(Goal.cycle_id == cycle_id)

    statement = statement.order_by(Goal.created_at.desc(), Goal.id.desc())
    return list(db.scalars(statement).all())


@router.get("/{goal_id}", response_model=GoalRead)
def read_goal(
    goal_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Goal:
    """Read one goal using its PostgreSQL ID."""

    goal = db.get(Goal, goal_id)

    if goal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal not found.",
        )

    return goal


@router.post(
    "",
    response_model=GoalRead,
    status_code=status.HTTP_201_CREATED,
)
def create_goal(
    goal_data: GoalCreate,
    db: Session = Depends(get_db),
) -> Goal:
    """Create a goal and validate its optional planning-cycle relationship."""

    try:
        if goal_data.cycle_id is not None:
            cycle = db.get(PlanningCycle, goal_data.cycle_id)

            if cycle is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Planning cycle not found.",
                )

        # The schema supplies editable fields only. PostgreSQL generates id
        # and created_at; the model defaults new goals to incomplete.
        goal = Goal(**goal_data.model_dump())
        db.add(goal)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The goal could not be created. No changes were saved.",
        ) from error

    except Exception:
        db.rollback()
        raise

    db.refresh(goal)
    return goal


@router.patch("/{goal_id}", response_model=GoalRead)
def update_goal(
    goal_data: GoalUpdate,
    goal_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Goal:
    """Edit supplied planning details while preserving identity and history."""

    changes = goal_data.model_dump(exclude_unset=True)

    try:
        # Lock this row until commit so simultaneous edits use current dates.
        statement = (
            select(Goal)
            .where(Goal.id == goal_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        goal = db.scalar(statement)

        if goal is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found.",
            )

        # A PATCH may supply just one date. Check it against the other
        # date already stored in PostgreSQL before changing anything.
        start_date = changes.get("start_date", goal.start_date)
        end_date = changes.get("end_date", goal.end_date)

        if end_date < start_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="end_date cannot be before start_date.",
            )

        for field_name, value in changes.items():
            setattr(goal, field_name, value)

        # IDs, cycle membership, and completion history are excluded from
        # GoalUpdate, so a details edit cannot overwrite those fields.
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The goal could not be updated. No changes were saved.",
        ) from error

    except Exception:
        db.rollback()
        raise

    db.refresh(goal)
    return goal
