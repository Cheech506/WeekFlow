"""API endpoints for WeekFlow goal milestones."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Goal, GoalMilestone
from app.schemas import (
    GoalMilestoneCreate,
    GoalMilestoneRead,
    GoalMilestoneUpdate,
)


router = APIRouter(
    prefix=f"{API_PREFIX}/goal-milestones",
    tags=["goal milestones"],
)


@router.get("", response_model=list[GoalMilestoneRead])
def read_goal_milestones(
    goal_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> list[GoalMilestone]:
    """Read all milestones, or only those belonging to a selected goal."""

    statement = select(GoalMilestone)

    if goal_id is not None:
        statement = statement.where(GoalMilestone.goal_id == goal_id)

    # Match the app: incomplete milestones first, then upcoming dates.
    statement = statement.order_by(
        GoalMilestone.completed.asc(),
        GoalMilestone.target_date.asc().nulls_last(),
        GoalMilestone.created_at.asc(),
        GoalMilestone.id.asc(),
    )
    return list(db.scalars(statement).all())


@router.get("/{milestone_id}", response_model=GoalMilestoneRead)
def read_goal_milestone(
    milestone_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> GoalMilestone:
    """Read one milestone using its PostgreSQL ID."""

    milestone = db.get(GoalMilestone, milestone_id)

    if milestone is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal milestone not found.",
        )

    return milestone


@router.post(
    "",
    response_model=GoalMilestoneRead,
    status_code=status.HTTP_201_CREATED,
)
def create_goal_milestone(
    milestone_data: GoalMilestoneCreate,
    db: Session = Depends(get_db),
) -> GoalMilestone:
    """Create an incomplete milestone linked to an existing goal."""

    try:
        if db.get(Goal, milestone_data.goal_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found.",
            )

        # PostgreSQL supplies id and created_at. The model supplies
        # completed=False; source identity is reserved for migration.
        milestone = GoalMilestone(**milestone_data.model_dump())
        db.add(milestone)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The milestone could not be created. No changes were saved.",
        ) from error

    except Exception:
        db.rollback()
        raise

    db.refresh(milestone)
    return milestone


@router.patch("/{milestone_id}", response_model=GoalMilestoneRead)
def update_goal_milestone(
    milestone_data: GoalMilestoneUpdate,
    milestone_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> GoalMilestone:
    """Edit details, complete, or reopen a milestone without changing its goal."""

    changes = milestone_data.model_dump(exclude_unset=True)

    try:
        statement = (
            select(GoalMilestone)
            .where(GoalMilestone.id == milestone_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        milestone = db.scalar(statement)

        if milestone is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal milestone not found.",
            )

        if "completed" in changes:
            if changes["completed"] and not milestone.completed:
                changes["completed_at"] = datetime.now(UTC)
            elif not changes["completed"]:
                changes["completed_at"] = None
            # Repeating completed=True preserves the original timestamp.

        for field_name, value in changes.items():
            setattr(milestone, field_name, value)

        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The milestone could not be updated. No changes were saved.",
        ) from error

    except Exception:
        db.rollback()
        raise

    db.refresh(milestone)
    return milestone


@router.delete("/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal_milestone(
    milestone_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete one milestone while retaining its parent goal."""

    try:
        statement = (
            select(GoalMilestone)
            .where(GoalMilestone.id == milestone_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        milestone = db.scalar(statement)

        if milestone is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal milestone not found.",
            )

        db.delete(milestone)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The milestone could not be deleted. No changes were saved.",
        ) from error

    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)
