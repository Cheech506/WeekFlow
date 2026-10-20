"""Transactional cycle-review drafts and finalization into a successor cycle."""

from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    CycleGoalOutcome, CycleReview, Goal, GoalMilestone, PlanningCycle,
    Task, WeeklyCommitment,
)
from app.schemas import (
    CycleGoalOutcomeRead, CycleReviewDetail, CycleReviewDraftSave,
    CycleReviewFinalizeResult, CycleReviewRead, CycleReviewSnapshot,
    NextCyclePlan, PlanningCycleRead,
)


class CycleReviewNotFoundError(Exception):
    """The requested planning cycle or review does not exist."""


class CycleReviewConflictError(Exception):
    """The saved state cannot safely accept the requested operation."""


def lock_cycle_review_writes(db: Session) -> None:
    """Coordinate drafts and finalization with imports and related writes."""

    db.execute(text(
        "LOCK TABLE cycle_goal_outcomes, cycle_reviews, goal_milestones, "
        "goals, planning_cycles, tasks, weekly_commitments "
        "IN SHARE ROW EXCLUSIVE MODE"
    ))


def _require_review(db: Session, review_id: int) -> CycleReview:
    review = db.scalar(
        select(CycleReview)
        .where(CycleReview.id == review_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if review is None:
        raise CycleReviewNotFoundError("Cycle review not found.")
    return review


def _outcomes(db: Session, review_id: int) -> list[CycleGoalOutcome]:
    return list(db.scalars(
        select(CycleGoalOutcome)
        .where(CycleGoalOutcome.cycle_review_id == review_id)
        .order_by(CycleGoalOutcome.id)
        .execution_options(populate_existing=True)
    ).all())


def get_cycle_review_detail(db: Session, review_id: int) -> CycleReviewDetail:
    """Read the parent and children in one database statement/snapshot."""

    rows = db.execute(
        select(CycleReview, CycleGoalOutcome)
        .outerjoin(CycleGoalOutcome, CycleGoalOutcome.cycle_review_id == CycleReview.id)
        .where(CycleReview.id == review_id)
        .order_by(CycleGoalOutcome.id)
        .execution_options(populate_existing=True)
    ).all()
    if not rows:
        raise CycleReviewNotFoundError("Cycle review not found.")
    return CycleReviewDetail(
        review=CycleReviewRead.model_validate(rows[0][0]),
        outcomes=[CycleGoalOutcomeRead.model_validate(row[1]) for row in rows if row[1] is not None],
    )


def _draft_values(draft: CycleReviewDraftSave) -> dict:
    values = draft.reflection.model_dump()
    values.update({f"snapshot_{key}": value for key, value in draft.snapshot.model_dump().items()})
    plan = draft.next_cycle
    values.update(
        next_cycle_name=plan.name,
        next_cycle_primary_focus=plan.primary_focus,
        next_cycle_theme=plan.theme,
        next_cycle_start_date=plan.start_date,
        next_cycle_first_commitments=list(plan.first_week_commitments),
    )
    return values


def save_cycle_review_draft(db: Session, draft: CycleReviewDraftSave) -> CycleReviewDetail:
    """Replace the complete draft, preserving IDs of retained goal selections.

    This function owns commit/rollback. It never changes the reviewed goals,
    tasks, schedules, or cycles. An explicitly supplied outcomes=[] removes
    draft selections. Finalized reports cannot be edited through this path.
    """

    try:
        lock_cycle_review_writes(db)
        cycle = db.get(PlanningCycle, draft.cycle_id, populate_existing=True)
        if cycle is None:
            raise CycleReviewNotFoundError("Planning cycle not found.")
        review = db.scalar(
            select(CycleReview)
            .where(CycleReview.cycle_id == draft.cycle_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if review is not None and review.finalized_at is not None:
            raise CycleReviewConflictError("This cycle review is finalized and cannot be edited.")
        if review is not None and review.next_cycle_id is not None:
            raise CycleReviewConflictError("This draft already has a successor link and needs correction before editing.")

        goals = list(db.scalars(
            select(Goal).where(Goal.cycle_id == cycle.id)
            .execution_options(populate_existing=True)
        ).all())
        goals_by_id = {goal.id: goal for goal in goals}
        for item in draft.outcomes:
            goal = goals_by_id.get(item.goal_id)
            if goal is None:
                raise CycleReviewConflictError("A selected goal does not belong to this planning cycle.")
            if goal.completed:
                raise CycleReviewConflictError("Completed goals do not need an unfinished-goal outcome.")

        now = datetime.now(UTC)
        if review is None:
            review = CycleReview(
                cycle_id=cycle.id, created_at=now, updated_at=now,
                finalized_at=None, next_cycle_id=None, **_draft_values(draft),
            )
            db.add(review)
            db.flush()
            existing = []
        else:
            existing = _outcomes(db, review.id)
            if any(item.destination_goal_id is not None for item in existing):
                raise CycleReviewConflictError("This draft already has destination goals and needs correction before editing.")
            for name, value in _draft_values(draft).items():
                setattr(review, name, value)
            review.updated_at = now

        by_goal = {item.goal_id: item for item in existing}
        selected = {item.goal_id for item in draft.outcomes}
        for item in existing:
            if item.goal_id not in selected:
                db.delete(item)

        for item in draft.outcomes:
            goal = goals_by_id[item.goal_id]
            outcome = by_goal.get(goal.id)
            if outcome is None:
                outcome = CycleGoalOutcome(
                    cycle_review_id=review.id, goal_id=goal.id,
                    goal_title=goal.title, action=item.action,
                    replacement_title=item.replacement_title,
                    destination_goal_id=None, created_at=now, updated_at=now,
                )
                db.add(outcome)
            else:
                # Imported source IDs and the PostgreSQL primary key stay intact.
                outcome.goal_title = goal.title
                outcome.action = item.action
                outcome.replacement_title = item.replacement_title
                outcome.updated_at = now

        db.flush()
        result = get_cycle_review_detail(db, review.id)
        db.commit()
        return result
    except IntegrityError as error:
        db.rollback()
        raise CycleReviewConflictError("The cycle review draft could not be saved. No changes were saved.") from error
    except Exception:
        db.rollback()
        raise


def _saved_plan(review: CycleReview) -> NextCyclePlan:
    try:
        return NextCyclePlan(
            name=review.next_cycle_name,
            primary_focus=review.next_cycle_primary_focus,
            theme=review.next_cycle_theme,
            start_date=review.next_cycle_start_date,
            first_week_commitments=review.next_cycle_first_commitments,
        )
    except ValidationError as error:
        raise CycleReviewConflictError("The saved next-cycle plan is invalid. Correct the draft before finalizing.") from error


def _saved_snapshot(review: CycleReview) -> CycleReviewSnapshot:
    try:
        return CycleReviewSnapshot.model_validate({
            name: getattr(review, f"snapshot_{name}")
            for name in CycleReviewSnapshot.model_fields
        })
    except ValidationError as error:
        raise CycleReviewConflictError("The saved statistics are inconsistent. Correct the draft before finalizing.") from error


def _task_goal_link(goal: Goal):
    """Match the normal goal-completion API, including legacy source-only tasks."""

    native = Task.goal_id == goal.id
    if goal.source_goal_id is None:
        return native
    return or_(native, and_(Task.goal_id.is_(None), Task.source_goal_id == goal.source_goal_id))


def _complete_goal(db: Session, goal: Goal, now: datetime) -> None:
    task_total, completed, high_priority = db.execute(
        select(
            func.count(Task.id),
            func.count(Task.id).filter(Task.completed.is_(True)),
            func.count(Task.id).filter(Task.completed.is_(True), Task.priority == 2),
        ).where(_task_goal_link(goal))
    ).one()
    milestone_total, milestone_completed = db.execute(
        select(
            func.count(GoalMilestone.id),
            func.count(GoalMilestone.id).filter(GoalMilestone.completed.is_(True)),
        ).where(GoalMilestone.goal_id == goal.id)
    ).one()
    goal.completion_task_total = task_total
    goal.completion_task_completed = completed
    goal.completion_high_priority_completed = high_priority
    goal.completion_milestone_total = milestone_total
    goal.completion_milestone_completed = milestone_completed
    goal.completed = True
    goal.completed_at = now
    # Keep previous written completion reflections and every task unchanged.


def _new_goal(db: Session, source: Goal | None, title: str, cycle: PlanningCycle, now: datetime) -> Goal:
    goal = Goal(
        cycle_id=cycle.id, title=title, start_date=cycle.start_date,
        end_date=cycle.end_date, completed=False, completed_at=None,
        created_at=now,
        reward=source.reward if source is not None else None,
        purpose=source.purpose if source is not None else None,
        success_definition=source.success_definition if source is not None else None,
        notes=source.notes if source is not None else None,
    )
    # No source identity or completion snapshot is copied to the new goal.
    db.add(goal)
    db.flush()
    if source is not None:
        milestones = list(db.scalars(
            select(GoalMilestone).where(GoalMilestone.goal_id == source.id)
            .order_by(GoalMilestone.id)
            .execution_options(populate_existing=True)
        ).all())
        for milestone in milestones:
            db.add(GoalMilestone(
                goal_id=goal.id, title=milestone.title, notes=milestone.notes,
                target_date=milestone.target_date, completed=milestone.completed,
                created_at=milestone.created_at, completed_at=milestone.completed_at,
            ))
        # Match the app: copied milestones retain their dates and completion,
        # receive fresh PostgreSQL IDs, and have no imported source identity.
    return goal


def _finalize_result(db: Session, review: CycleReview, already_finalized: bool) -> CycleReviewFinalizeResult:
    detail = get_cycle_review_detail(db, review.id)
    successor = (
        db.get(PlanningCycle, review.next_cycle_id, populate_existing=True)
        if review.next_cycle_id is not None else None
    )
    return CycleReviewFinalizeResult(
        review=detail.review, outcomes=detail.outcomes,
        next_cycle=PlanningCycleRead.model_validate(successor) if successor is not None else None,
        already_finalized=already_finalized,
    )


def finalize_cycle_review(db: Session, review_id: int) -> CycleReviewFinalizeResult:
    """Finalize a saved draft, apply outcomes, and create its successor atomically.

    Retrying a finalized report returns its saved result without new writes.
    Carry-forward and replacement create new goals. Old tasks and schedules
    remain linked to their original goals. Archive leaves the original goal
    unfinished in the closed cycle; it does not delete its data.
    """

    try:
        lock_cycle_review_writes(db)
        review = _require_review(db, review_id)
        if review.finalized_at is not None:
            result = _finalize_result(db, review, already_finalized=True)
            db.commit()
            return result

        cycle = db.get(PlanningCycle, review.cycle_id, populate_existing=True)
        if cycle is None:
            raise CycleReviewNotFoundError("Planning cycle not found.")
        if not cycle.active:
            raise CycleReviewConflictError("Only the current planning cycle can be finalized.")
        if review.next_cycle_id is not None:
            raise CycleReviewConflictError("This draft already has a successor link and cannot safely create another cycle.")
        plan = _saved_plan(review)
        stats = _saved_snapshot(review)
        if plan.start_date <= cycle.end_date:
            raise CycleReviewConflictError("The next cycle must begin after the reviewed cycle ends.")

        goals = list(db.scalars(
            select(Goal).where(Goal.cycle_id == cycle.id)
            .execution_options(populate_existing=True)
        ).all())
        unfinished = {goal.id: goal for goal in goals if not goal.completed}
        outcomes = _outcomes(db, review.id)
        goal_ids = [item.goal_id for item in outcomes]
        if len(goal_ids) != len(set(goal_ids)) or set(goal_ids) != set(unfinished):
            raise CycleReviewConflictError("Choose one outcome for every unfinished goal in this cycle before finalizing.")
        if any(item.destination_goal_id is not None for item in outcomes):
            raise CycleReviewConflictError("The draft already has destination goals and cannot safely be finalized.")

        now = datetime.now(UTC)
        cycle.active = False
        cycle.completed_at = now
        # Release the single-active-cycle key before adding the successor.
        db.flush()
        successor = PlanningCycle(
            name=plan.name, primary_focus=plan.primary_focus, theme=plan.theme,
            start_date=plan.start_date, end_date=plan.start_date + timedelta(days=83),
            active=True, completed_at=None, created_at=now,
        )
        db.add(successor)
        db.flush()

        first_week = plan.start_date - timedelta(days=plan.start_date.weekday())
        for title in plan.first_week_commitments:
            db.add(WeeklyCommitment(
                week_start=first_week, cycle_id=successor.id, task_id=None,
                title=title, completed=False, completed_at=None, created_at=now,
            ))

        complete_count = 0
        reward_count = 0
        for outcome in outcomes:
            goal = unfinished[outcome.goal_id]
            if outcome.action == "complete":
                _complete_goal(db, goal, now)
                complete_count += 1
                reward_count += int(bool(goal.reward))
            elif outcome.action == "carryForward":
                destination = _new_goal(db, goal, goal.title, successor, now)
                outcome.destination_goal_id = destination.id
            elif outcome.action == "replace":
                if not outcome.replacement_title or not outcome.replacement_title.strip():
                    raise CycleReviewConflictError("A replacement goal needs a nonblank title.")
                destination = _new_goal(db, None, outcome.replacement_title, successor, now)
                outcome.destination_goal_id = destination.id
            elif outcome.action != "archive":
                raise CycleReviewConflictError("The draft contains an unsupported goal outcome.")
            outcome.updated_at = now

        review.snapshot_goal_completed = min(stats.goal_total, stats.goal_completed + complete_count)
        review.snapshot_rewards_unlocked = min(
            review.snapshot_goal_completed, stats.rewards_unlocked + reward_count,
        )
        review.next_cycle_id = successor.id
        review.updated_at = now
        review.finalized_at = now
        db.flush()
        result = _finalize_result(db, review, already_finalized=False)
        db.commit()
        return result
    except IntegrityError as error:
        db.rollback()
        raise CycleReviewConflictError("The cycle review could not be finalized. No changes were saved.") from error
    except Exception:
        db.rollback()
        raise
