"""API endpoints for reading, creating, and editing WeekFlow goals."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import false, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import Goal, GoalMilestone, PlanningCycle, Task
from app.schemas import GoalComplete, GoalCreate, GoalRead, GoalUpdate


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


@router.delete(
    "/{goal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_goal(
    goal_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete an unreviewed goal, keeping its tasks and schedules."""

    try:
        # Use the same table order as backup imports. This also protects
        # legacy task links, which do not yet have a foreign key.
        db.execute(text(
            "LOCK TABLE cycle_goal_outcomes, goal_milestones, goals, "
            "recurring_rules, task_templates, tasks "
            "IN SHARE ROW EXCLUSIVE MODE"
        ))
        goal = db.scalar(
            select(Goal)
            .where(Goal.id == goal_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

        if goal is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found.",
            )

        saved_history = (
            goal.completion_what_helped,
            goal.completion_hardest_part,
            goal.completion_learned,
            goal.completion_do_differently,
            goal.completion_task_total,
            goal.completion_task_completed,
            goal.completion_milestone_total,
            goal.completion_milestone_completed,
            goal.completion_high_priority_completed,
        )
        if goal.completed or any(value is not None for value in saved_history):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This goal has saved completion history and cannot be deleted.",
            )

        if goal.source_goal_id is not None:
            db.execute(
                update(Task)
                .where(Task.source_goal_id == goal.source_goal_id)
                .values(source_goal_id=None)
            )

        # Existing foreign keys delete child milestones and clear goal
        # links on schedules, templates, and saved cycle outcomes.
        db.delete(goal)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The goal could not be deleted. No changes were saved.",
        ) from error
    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{goal_id}/complete", response_model=GoalRead)
def complete_goal(
    completion_data: GoalComplete,
    goal_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Goal:
    """Complete a goal and save reflections and a consistent progress snapshot."""

    try:
        # Hold task/milestone writes until both totals have been saved.
        # Keep the table order consistent with imports and goal deletion.
        db.execute(text(
            "LOCK TABLE goal_milestones, goals, tasks "
            "IN SHARE ROW EXCLUSIVE MODE"
        ))
        goal = db.scalar(
            select(Goal)
            .where(Goal.id == goal_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if goal is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found.",
            )

        # Repeating a successful request must not replace its saved history.
        if not goal.completed:
            # Tasks currently retain their SQLite goal link. Never compare
            # those source IDs with PostgreSQL's generated goal IDs.
            task_link = (
                Task.source_goal_id == goal.source_goal_id
                if goal.source_goal_id is not None
                else false()
            )
            task_total, task_completed, high_priority_completed = db.execute(
                select(
                    func.count(Task.id),
                    func.count(Task.id).filter(Task.completed.is_(True)),
                    func.count(Task.id).filter(
                        Task.completed.is_(True), Task.priority == 2,
                    ),
                ).where(task_link)
            ).one()
            milestone_total, milestone_completed = db.execute(
                select(
                    func.count(GoalMilestone.id),
                    func.count(GoalMilestone.id).filter(
                        GoalMilestone.completed.is_(True)
                    ),
                ).where(GoalMilestone.goal_id == goal.id)
            ).one()

            # On re-completion, omitted answers retain the previous answers.
            # An explicitly supplied null/blank clears that one answer.
            for field, value in completion_data.model_dump(exclude_unset=True).items():
                setattr(goal, f"completion_{field}", value)

            goal.completion_task_total = task_total
            goal.completion_task_completed = task_completed
            goal.completion_high_priority_completed = high_priority_completed
            goal.completion_milestone_total = milestone_total
            goal.completion_milestone_completed = milestone_completed
            goal.completed = True
            goal.completed_at = datetime.now(UTC)

        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The goal could not be completed. No changes were saved.",
        ) from error
    except Exception:
        db.rollback()
        raise

    db.refresh(goal)
    return goal


@router.post("/{goal_id}/reopen", response_model=GoalRead)
def reopen_goal(
    goal_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Goal:
    """Reopen a goal while retaining its last reflections and progress snapshot."""

    try:
        db.execute(text("LOCK TABLE goals IN SHARE ROW EXCLUSIVE MODE"))
        goal = db.scalar(
            select(Goal)
            .where(Goal.id == goal_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if goal is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Goal not found.",
            )

        goal.completed = False
        goal.completed_at = None
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The goal could not be reopened. No changes were saved.",
        ) from error
    except Exception:
        db.rollback()
        raise

    db.refresh(goal)
    return goal
