"""HTTP endpoints for cycle-review drafts, finalization, and goal history."""

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import CycleGoalOutcome, CycleReview
from app.schemas import (
    CycleGoalOutcomeRead, CycleReviewDetail, CycleReviewDraftSave,
    CycleReviewFinalizeResult, CycleReviewRead,
)
from app.schemas.cycle_goal_outcome import CycleGoalOutcomeAction
from app.services.cycle_reviews import (
    CycleReviewConflictError, CycleReviewNotFoundError, finalize_cycle_review,
    get_cycle_review_detail, lock_cycle_review_writes, save_cycle_review_draft,
)


# The exported router registers both endpoint groups in main.py.
router = APIRouter()
reviews_router = APIRouter(
    prefix=f"{API_PREFIX}/cycle-reviews",
    tags=["cycle reviews"],
)
outcomes_router = APIRouter(
    prefix=f"{API_PREFIX}/cycle-goal-outcomes",
    tags=["cycle goal outcomes"],
)


@reviews_router.get("", response_model=list[CycleReviewRead])
def read_cycle_reviews(
    cycle_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    finalized: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[CycleReview]:
    """Read draft and finalized reports without recalculating their statistics."""

    statement = select(CycleReview)
    if cycle_id is not None:
        statement = statement.where(CycleReview.cycle_id == cycle_id)
    if finalized is not None:
        statement = statement.where(
            CycleReview.finalized_at.is_not(None)
            if finalized else CycleReview.finalized_at.is_(None)
        )
    statement = statement.order_by(CycleReview.created_at.desc(), CycleReview.id.desc())
    return list(db.scalars(statement).all())


@reviews_router.post("/draft", response_model=CycleReviewDetail)
def save_cycle_review(
    draft: CycleReviewDraftSave,
    db: Session = Depends(get_db),
) -> CycleReviewDetail:
    """Create or replace the complete draft and its selected goal outcomes.

    Both a new draft and an updated draft return 200. All sections must be
    supplied. outcomes=[] explicitly removes saved draft selections. This
    operation does not complete goals or start the next planning cycle.
    """

    try:
        return save_cycle_review_draft(db, draft)
    except CycleReviewNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except CycleReviewConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@reviews_router.get("/{review_id}", response_model=CycleReviewDetail)
def read_cycle_review(
    review_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> CycleReviewDetail:
    """Read a report together with all of its saved goal outcomes."""

    try:
        return get_cycle_review_detail(db, review_id)
    except CycleReviewNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@reviews_router.post("/{review_id}/finalize", response_model=CycleReviewFinalizeResult)
def finalize_saved_cycle_review(
    review_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> CycleReviewFinalizeResult:
    """Finalize the saved draft, apply outcomes, and start its next cycle.

    No request body is needed: save the complete draft first. Only the
    current cycle may be finalized. Successful retries return the existing
    result with already_finalized=true and create no additional records.
    """

    try:
        return finalize_cycle_review(db, review_id)
    except CycleReviewNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except CycleReviewConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@reviews_router.delete(
    "/{review_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_cycle_review_draft(
    review_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete an unfinished draft and its child selections, preserving goals.

    Finalized reports and drafts already linked to successor records are
    protected. Deleting a draft never reverses a previously applied action.
    """

    try:
        lock_cycle_review_writes(db)
        review = db.scalar(
            select(CycleReview).where(CycleReview.id == review_id)
            .with_for_update().execution_options(populate_existing=True)
        )
        if review is None:
            raise HTTPException(status_code=404, detail="Cycle review not found.")
        if review.finalized_at is not None:
            raise HTTPException(status_code=409, detail="Finalized cycle reports cannot be deleted.")
        if review.next_cycle_id is not None:
            raise HTTPException(status_code=409, detail="This draft already has a successor link and cannot be deleted.")
        destination = db.scalar(
            select(CycleGoalOutcome.id)
            .where(
                CycleGoalOutcome.cycle_review_id == review.id,
                CycleGoalOutcome.destination_goal_id.is_not(None),
            ).limit(1)
        )
        if destination is not None:
            raise HTTPException(status_code=409, detail="This draft already has destination goals and cannot be deleted.")

        # PostgreSQL cascades only the child outcome rows, not the goals.
        db.delete(review)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The cycle review draft could not be deleted. No changes were saved.",
        ) from error
    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@outcomes_router.get("", response_model=list[CycleGoalOutcomeRead])
def read_cycle_goal_outcomes(
    cycle_review_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    goal_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    destination_goal_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    action: CycleGoalOutcomeAction | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[CycleGoalOutcome]:
    """Read saved selections and historical outcomes, including unlinked goals."""

    statement = select(CycleGoalOutcome)
    for column, value in (
        (CycleGoalOutcome.cycle_review_id, cycle_review_id),
        (CycleGoalOutcome.goal_id, goal_id),
        (CycleGoalOutcome.destination_goal_id, destination_goal_id),
        (CycleGoalOutcome.action, action),
    ):
        if value is not None:
            statement = statement.where(column == value)
    statement = statement.order_by(CycleGoalOutcome.cycle_review_id.desc(), CycleGoalOutcome.id.asc())
    return list(db.scalars(statement).all())


@outcomes_router.get("/{outcome_id}", response_model=CycleGoalOutcomeRead)
def read_cycle_goal_outcome(
    outcome_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> CycleGoalOutcome:
    """Read a saved outcome without requiring its original goal to still exist."""

    outcome = db.get(CycleGoalOutcome, outcome_id, populate_existing=True)
    if outcome is None:
        raise HTTPException(status_code=404, detail="Cycle goal outcome not found.")
    return outcome


router.include_router(reviews_router)
router.include_router(outcomes_router)
