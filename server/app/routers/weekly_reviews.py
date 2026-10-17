"""API endpoints for weekly reflections and their frozen statistics."""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.models import PlanningCycle, WeeklyReview
from app.schemas import WeeklyReviewCreate, WeeklyReviewRead, WeeklyReviewUpdate


router = APIRouter(
    prefix=f"{API_PREFIX}/weekly-reviews",
    tags=["weekly reviews"],
)


def lock_review_writes(db: Session) -> None:
    """Coordinate review saves with cycle deletion and backup imports."""

    db.execute(text(
        "LOCK TABLE planning_cycles, weekly_reviews "
        "IN SHARE ROW EXCLUSIVE MODE"
    ))


def require_cycle(db: Session, cycle_id: int | None) -> None:
    """Allow current or historical cycles, but reject dangling native IDs."""

    if cycle_id is not None:
        cycle = db.get(PlanningCycle, cycle_id, populate_existing=True)
        if cycle is None:
            raise HTTPException(status_code=404, detail="Planning cycle not found.")


def require_review(db: Session, review_id: int, *, for_update: bool = False) -> WeeklyReview:
    """Fetch current saved values, optionally locking the review for a write."""

    statement = (
        select(WeeklyReview)
        .where(WeeklyReview.id == review_id)
        .execution_options(populate_existing=True)
    )
    if for_update:
        statement = statement.with_for_update()

    review = db.scalar(statement)
    if review is None:
        raise HTTPException(status_code=404, detail="Weekly review not found.")
    return review


def write_conflict() -> HTTPException:
    """Keep database details out of a rejected write's response."""

    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="The weekly review could not be saved. No changes were saved.",
    )


@router.get("", response_model=list[WeeklyReviewRead])
def read_weekly_reviews(
    week_start: date | None = Query(default=None),
    cycle_id: int | None = Query(default=None, gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> list[WeeklyReview]:
    """Read saved reviews, optionally selecting one week or planning cycle."""

    if week_start is not None and week_start.weekday() != 0:
        raise HTTPException(status_code=422, detail="week_start must be a Monday")

    statement = select(WeeklyReview)
    if week_start is not None:
        statement = statement.where(WeeklyReview.week_start == week_start)
    if cycle_id is not None:
        statement = statement.where(WeeklyReview.cycle_id == cycle_id)

    statement = statement.order_by(WeeklyReview.week_start.desc(), WeeklyReview.id.desc())
    return list(db.scalars(statement).all())


@router.get("/{review_id}", response_model=WeeklyReviewRead)
def read_weekly_review(
    review_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> WeeklyReview:
    """Read a saved review without recalculating its historical statistics."""

    return require_review(db, review_id)


@router.post("", response_model=WeeklyReviewRead, status_code=status.HTTP_201_CREATED)
def create_weekly_review(
    review_data: WeeklyReviewCreate,
    db: Session = Depends(get_db),
) -> WeeklyReviewRead:
    """Save a new review and its supplied, validated snapshot once per week.

    An existing week returns 409. Edit that review through PATCH instead;
    a repeated create request must never replace the original snapshot.
    """

    try:
        lock_review_writes(db)
        require_cycle(db, review_data.cycle_id)
        existing = db.scalar(
            select(WeeklyReview.id)
            .where(WeeklyReview.week_start == review_data.week_start)
            .limit(1)
        )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail="A review already exists for this week. Edit the saved review instead.",
            )

        values = review_data.model_dump(exclude={"snapshot"})
        values.update({
            f"snapshot_{name}": value
            for name, value in review_data.snapshot.model_dump().items()
        })
        now = datetime.now(UTC)
        values.update(created_at=now, updated_at=now, reviewed_at=now)
        review = WeeklyReview(**values)
        db.add(review)
        db.flush()
        result = WeeklyReviewRead.model_validate(review)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return result


@router.patch("/{review_id}", response_model=WeeklyReviewRead)
def update_weekly_review(
    review_data: WeeklyReviewUpdate,
    review_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> WeeklyReviewRead:
    """Edit responses or the cycle link without rewriting the first snapshot."""

    changes = review_data.model_dump(exclude_unset=True)
    try:
        lock_review_writes(db)
        review = require_review(db, review_id, for_update=True)
        if "cycle_id" in changes:
            require_cycle(db, changes["cycle_id"])

        for name, value in changes.items():
            setattr(review, name, value)
        if changes:
            now = datetime.now(UTC)
            review.updated_at = now
            review.reviewed_at = now

        db.flush()
        result = WeeklyReviewRead.model_validate(review)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return result


@router.delete(
    "/{review_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_weekly_review(
    review_id: int = Path(gt=0, le=2_147_483_647),
    db: Session = Depends(get_db),
) -> Response:
    """Delete only this review; retain tasks, commitments, and task decisions."""

    try:
        lock_review_writes(db)
        review = require_review(db, review_id, for_update=True)
        db.delete(review)
        db.commit()

    except IntegrityError as error:
        db.rollback()
        raise write_conflict() from error
    except Exception:
        db.rollback()
        raise

    return Response(status_code=status.HTTP_204_NO_CONTENT)
