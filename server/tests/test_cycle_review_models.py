"""Tests for PostgreSQL cycle-review history models."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import Text, inspect
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import (
    CycleGoalOutcome,
    CycleReview,
    Goal,
    PlanningCycle,
)


CYCLE_START = date(2026, 7, 1)
NEXT_CYCLE_START = date(2026, 9, 30)
FINALIZED_AT = datetime(2026, 9, 23, 12, tzinfo=UTC)

EXPECTED_REVIEW_COLUMNS = {
    "id",
    "source_cycle_review_id",
    "cycle_id",
    "biggest_accomplishment",
    "biggest_challenge",
    "what_worked_well",
    "what_change_next_cycle",
    "what_stop_doing",
    "what_continue_doing",
    "what_learned",
    "snapshot_goal_total",
    "snapshot_goal_completed",
    "snapshot_task_completed",
    "snapshot_milestone_total",
    "snapshot_milestone_completed",
    "snapshot_weekly_reviews_completed",
    "snapshot_longest_streak",
    "snapshot_best_week_number",
    "snapshot_best_week_count",
    "snapshot_best_day",
    "snapshot_best_day_count",
    "snapshot_high_priority_completed",
    "snapshot_recurring_completed",
    "snapshot_rewards_unlocked",
    "snapshot_brain_dumps_archived",
    "next_cycle_name",
    "next_cycle_primary_focus",
    "next_cycle_theme",
    "next_cycle_start_date",
    "next_cycle_first_commitments",
    "next_cycle_id",
    "created_at",
    "updated_at",
    "finalized_at",
}

EXPECTED_OUTCOME_COLUMNS = {
    "id",
    "source_cycle_goal_outcome_id",
    "cycle_review_id",
    "goal_id",
    "goal_title",
    "action",
    "replacement_title",
    "destination_goal_id",
    "created_at",
    "updated_at",
}


def make_cycle(
    *,
    internal_id: int,
    source_id: int,
    start_date: date = CYCLE_START,
) -> PlanningCycle:
    """Create a valid historical planning cycle."""

    return PlanningCycle(
        id=internal_id,
        source_planning_cycle_id=source_id,
        start_date=start_date,
        end_date=start_date + timedelta(days=83),
        active=False,
        completed_at=FINALIZED_AT,
    )


def make_goal(
    *,
    internal_id: int,
    source_id: int,
    cycle_id: int | None,
    title: str = "Historical goal",
    start_date: date = CYCLE_START,
) -> Goal:
    """Create a valid incomplete goal."""

    return Goal(
        id=internal_id,
        source_goal_id=source_id,
        cycle_id=cycle_id,
        title=title,
        completed=False,
        completed_at=None,
        start_date=start_date,
        end_date=start_date + timedelta(days=83),
    )


def make_review(
    *,
    internal_id: int,
    source_id: int,
    cycle_id: int,
    next_cycle_id: int | None = None,
) -> CycleReview:
    """Create a valid finalized cycle review."""

    return CycleReview(
        id=internal_id,
        source_cycle_review_id=source_id,
        cycle_id=cycle_id,
        biggest_accomplishment="Finished the local app",
        biggest_challenge="Relationship mapping",
        what_worked_well="Small migrations",
        what_change_next_cycle="Start integration earlier",
        what_stop_doing="Overcommitting",
        what_continue_doing="Weekly reviews",
        what_learned="Import parents first",
        snapshot_goal_total=3,
        snapshot_goal_completed=2,
        snapshot_task_completed=20,
        snapshot_milestone_total=6,
        snapshot_milestone_completed=4,
        snapshot_weekly_reviews_completed=10,
        snapshot_longest_streak=8,
        snapshot_best_week_number=7,
        snapshot_best_week_count=5,
        snapshot_best_day="Tuesday",
        snapshot_best_day_count=4,
        snapshot_high_priority_completed=5,
        snapshot_recurring_completed=3,
        snapshot_rewards_unlocked=1,
        snapshot_brain_dumps_archived=2,
        next_cycle_name="Fall 2026",
        next_cycle_primary_focus="Finish the migration",
        next_cycle_theme="Consistency",
        next_cycle_start_date=NEXT_CYCLE_START,
        next_cycle_first_commitments=[
            "Apply the migration",
            "Verify imported history",
        ],
        next_cycle_id=next_cycle_id,
        finalized_at=FINALIZED_AT,
    )


def make_outcome(
    *,
    internal_id: int,
    source_id: int,
    review_id: int,
    goal_id: int | None = None,
    destination_goal_id: int | None = None,
    action: str = "archive",
    replacement_title: str | None = None,
) -> CycleGoalOutcome:
    """Create a valid historical goal outcome."""

    return CycleGoalOutcome(
        id=internal_id,
        source_cycle_goal_outcome_id=source_id,
        cycle_review_id=review_id,
        goal_id=goal_id,
        goal_title="Historical goal",
        action=action,
        replacement_title=replacement_title,
        destination_goal_id=destination_goal_id,
    )


def test_cycle_review_tables_match_models():
    """Verify both PostgreSQL tables match their models."""

    inspector = inspect(engine)

    assert inspector.has_table(CycleReview.__tablename__)
    assert inspector.has_table(CycleGoalOutcome.__tablename__)

    review_columns = inspector.get_columns(
        CycleReview.__tablename__
    )
    outcome_columns = inspector.get_columns(
        CycleGoalOutcome.__tablename__
    )

    assert {
        column["name"] for column in review_columns
    } == EXPECTED_REVIEW_COLUMNS

    assert set(
        CycleReview.__table__.columns.keys()
    ) == EXPECTED_REVIEW_COLUMNS

    assert {
        column["name"] for column in outcome_columns
    } == EXPECTED_OUTCOME_COLUMNS

    assert set(
        CycleGoalOutcome.__table__.columns.keys()
    ) == EXPECTED_OUTCOME_COLUMNS

    review_types = {
        column["name"]: column["type"]
        for column in review_columns
    }
    outcome_types = {
        column["name"]: column["type"]
        for column in outcome_columns
    }

    assert str(
        review_types["source_cycle_review_id"]
    ) == "BIGINT"

    assert str(
        review_types["next_cycle_start_date"]
    ) == "DATE"

    commitments_type = review_types[
        "next_cycle_first_commitments"
    ]

    assert isinstance(commitments_type, ARRAY)
    assert isinstance(commitments_type.item_type, Text)

    assert str(
        outcome_types["source_cycle_goal_outcome_id"]
    ) == "BIGINT"

    assert outcome_types["action"].length == 12
    assert outcome_types["replacement_title"].length == 180

    assert inspector.get_pk_constraint(
        CycleReview.__tablename__
    )["constrained_columns"] == ["id"]

    assert inspector.get_pk_constraint(
        CycleGoalOutcome.__tablename__
    )["constrained_columns"] == ["id"]

    review_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            CycleReview.__tablename__
        )
    }

    assert {
        "ck_cycle_reviews_source_id_positive",
        "ck_cycle_reviews_response_lengths",
        "ck_cycle_reviews_snapshot_counts_nonnegative",
        "ck_cycle_reviews_snapshot_counts_consistent",
        "ck_cycle_reviews_best_week_number",
        "ck_cycle_reviews_first_commitments_shape",
        "ck_cycle_reviews_finalized_plan",
    } <= review_checks

    outcome_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            CycleGoalOutcome.__tablename__
        )
    }

    assert {
        "ck_cycle_goal_outcomes_source_id_positive",
        "ck_cycle_goal_outcomes_title_not_blank",
        "ck_cycle_goal_outcomes_action",
        "ck_cycle_goal_outcomes_replacement_action",
    } <= outcome_checks

    review_uniques = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            CycleReview.__tablename__
        )
    }

    assert {
        "uq_cycle_reviews_source_cycle_review_id",
        "uq_cycle_reviews_cycle_id",
    } <= review_uniques

    outcome_uniques = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            CycleGoalOutcome.__tablename__
        )
    }

    assert (
        "uq_cycle_goal_outcomes_source_id"
        in outcome_uniques
    )

    review_indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            CycleReview.__tablename__
        )
    }

    assert review_indexes[
        "ix_cycle_reviews_next_cycle_id"
    ] == ["next_cycle_id"]

    outcome_indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            CycleGoalOutcome.__tablename__
        )
    }

    assert outcome_indexes[
        "ix_cycle_goal_outcomes_review_id"
    ] == ["cycle_review_id", "id"]

    assert outcome_indexes[
        "uq_cycle_goal_outcomes_review_goal"
    ] == ["cycle_review_id", "goal_id"]

    assert outcome_indexes[
        "ix_cycle_goal_outcomes_destination_id"
    ] == ["destination_goal_id"]

    review_foreign_keys = {
        tuple(foreign_key["constrained_columns"]): foreign_key
        for foreign_key in inspector.get_foreign_keys(
            CycleReview.__tablename__
        )
    }

    assert review_foreign_keys[
        ("cycle_id",)
    ]["referred_table"] == "planning_cycles"

    assert review_foreign_keys[
        ("cycle_id",)
    ]["referred_columns"] == ["id"]

    assert review_foreign_keys[
        ("cycle_id",)
    ]["options"].get("ondelete") == "CASCADE"

    assert review_foreign_keys[
        ("next_cycle_id",)
    ]["referred_table"] == "planning_cycles"

    assert review_foreign_keys[
        ("next_cycle_id",)
    ]["referred_columns"] == ["id"]

    assert review_foreign_keys[
        ("next_cycle_id",)
    ]["options"].get("ondelete") == "SET NULL"

    outcome_foreign_keys = {
        tuple(foreign_key["constrained_columns"]): foreign_key
        for foreign_key in inspector.get_foreign_keys(
            CycleGoalOutcome.__tablename__
        )
    }

    assert outcome_foreign_keys[
        ("cycle_review_id",)
    ]["referred_table"] == "cycle_reviews"

    assert outcome_foreign_keys[
        ("cycle_review_id",)
    ]["options"].get("ondelete") == "CASCADE"

    assert outcome_foreign_keys[
        ("goal_id",)
    ]["referred_table"] == "goals"

    assert outcome_foreign_keys[
        ("goal_id",)
    ]["options"].get("ondelete") == "SET NULL"

    assert outcome_foreign_keys[
        ("destination_goal_id",)
    ]["referred_table"] == "goals"

    assert outcome_foreign_keys[
        ("destination_goal_id",)
    ]["options"].get("ondelete") == "SET NULL"


def test_cycle_review_hierarchy_round_trips_then_rolls_back():
    """Save and read a full review hierarchy without retaining it."""

    source_cycle_id = -400
    next_cycle_id = -401
    original_goal_id = -402
    destination_goal_id = -403
    review_id = -404
    outcome_id = -405

    with Session(engine) as session:
        session.add_all(
            [
                make_cycle(
                    internal_id=source_cycle_id,
                    source_id=1_781_204_323_000,
                ),
                make_cycle(
                    internal_id=next_cycle_id,
                    source_id=1_781_204_323_001,
                    start_date=NEXT_CYCLE_START,
                ),
            ]
        )
        session.flush()

        session.add_all(
            [
                make_goal(
                    internal_id=original_goal_id,
                    source_id=1_781_204_323_002,
                    cycle_id=source_cycle_id,
                ),
                make_goal(
                    internal_id=destination_goal_id,
                    source_id=1_781_204_323_003,
                    cycle_id=next_cycle_id,
                    title="Carried goal",
                    start_date=NEXT_CYCLE_START,
                ),
            ]
        )
        session.flush()

        session.add(
            make_review(
                internal_id=review_id,
                source_id=1_781_204_323_004,
                cycle_id=source_cycle_id,
                next_cycle_id=next_cycle_id,
            )
        )
        session.flush()

        session.add(
            make_outcome(
                internal_id=outcome_id,
                source_id=1_781_204_323_005,
                review_id=review_id,
                goal_id=original_goal_id,
                destination_goal_id=destination_goal_id,
                action="carryForward",
            )
        )
        session.flush()
        session.expunge_all()

        saved_review = session.get(CycleReview, review_id)
        saved_outcome = session.get(
            CycleGoalOutcome,
            outcome_id,
        )

        assert saved_review is not None
        assert saved_review.cycle_id == source_cycle_id
        assert saved_review.next_cycle_id == next_cycle_id
        assert saved_review.snapshot_goal_total == 3
        assert saved_review.snapshot_task_completed == 20
        assert saved_review.snapshot_best_week_number == 7
        assert saved_review.next_cycle_first_commitments == [
            "Apply the migration",
            "Verify imported history",
        ]
        assert saved_review.created_at is not None
        assert saved_review.updated_at is not None
        assert saved_review.finalized_at == FINALIZED_AT

        assert saved_outcome is not None
        assert saved_outcome.cycle_review_id == review_id
        assert saved_outcome.goal_id == original_goal_id
        assert (
            saved_outcome.destination_goal_id
            == destination_goal_id
        )
        assert saved_outcome.action == "carryForward"
        assert saved_outcome.goal_title == "Historical goal"
        assert saved_outcome.created_at is not None
        assert saved_outcome.updated_at is not None

        session.rollback()

    with Session(engine) as session:
        assert session.get(CycleReview, review_id) is None
        assert session.get(
            CycleGoalOutcome,
            outcome_id,
        ) is None
        assert session.get(
            PlanningCycle,
            source_cycle_id,
        ) is None
        assert session.get(
            PlanningCycle,
            next_cycle_id,
        ) is None


def test_source_cycle_review_id_must_be_unique():
    """Prevent importing the same SQLite review twice."""

    with Session(engine) as session:
        session.add_all(
            [
                make_cycle(
                    internal_id=-410,
                    source_id=1_781_204_323_010,
                ),
                make_cycle(
                    internal_id=-411,
                    source_id=1_781_204_323_011,
                    start_date=NEXT_CYCLE_START,
                ),
            ]
        )
        session.flush()

        session.add_all(
            [
                make_review(
                    internal_id=-412,
                    source_id=1_781_204_323_012,
                    cycle_id=-410,
                ),
                make_review(
                    internal_id=-413,
                    source_id=1_781_204_323_012,
                    cycle_id=-411,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_source_cycle_goal_outcome_id_must_be_unique():
    """Prevent importing the same SQLite outcome twice."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-420,
                source_id=1_781_204_323_020,
            )
        )
        session.flush()

        session.add(
            make_review(
                internal_id=-421,
                source_id=1_781_204_323_021,
                cycle_id=-420,
            )
        )
        session.flush()

        session.add_all(
            [
                make_outcome(
                    internal_id=-422,
                    source_id=1_781_204_323_022,
                    review_id=-421,
                ),
                make_outcome(
                    internal_id=-423,
                    source_id=1_781_204_323_022,
                    review_id=-421,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_only_one_review_can_exist_per_cycle():
    """Keep the one-review-per-cycle identity."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-430,
                source_id=1_781_204_323_030,
            )
        )
        session.flush()

        session.add_all(
            [
                make_review(
                    internal_id=-431,
                    source_id=1_781_204_323_031,
                    cycle_id=-430,
                ),
                make_review(
                    internal_id=-432,
                    source_id=1_781_204_323_032,
                    cycle_id=-430,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"source_cycle_review_id": -1},
        {"snapshot_goal_total": -1},
        {
            "snapshot_goal_total": 1,
            "snapshot_goal_completed": 2,
        },
        {
            "snapshot_milestone_total": 1,
            "snapshot_milestone_completed": 2,
        },
        {
            "snapshot_task_completed": 1,
            "snapshot_high_priority_completed": 2,
        },
        {
            "snapshot_goal_completed": 0,
            "snapshot_rewards_unlocked": 1,
        },
        {"snapshot_best_week_number": 0},
        {"snapshot_best_week_number": 13},
        {"next_cycle_start_date": None},
    ],
)
def test_cycle_review_rejects_invalid_snapshot_values(
    changes: dict[str, object],
):
    """Enforce saved-report analytics and finalization rules."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-440,
                source_id=1_781_204_323_040,
            )
        )
        session.flush()

        review = make_review(
            internal_id=-441,
            source_id=1_781_204_323_041,
            cycle_id=-440,
        )

        for field_name, value in changes.items():
            setattr(review, field_name, value)

        session.add(review)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"source_cycle_goal_outcome_id": -1},
        {"goal_title": "   "},
        {"action": "defer"},
        {
            "action": "replace",
            "replacement_title": None,
        },
        {
            "action": "archive",
            "replacement_title": "Unexpected replacement",
        },
        {
            "action": "replace",
            "replacement_title": "   ",
        },
    ],
)
def test_cycle_goal_outcome_rejects_invalid_values(
    changes: dict[str, object],
):
    """Enforce supported actions and replacement-title pairing."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-450,
                source_id=1_781_204_323_050,
            )
        )
        session.flush()

        session.add(
            make_review(
                internal_id=-451,
                source_id=1_781_204_323_051,
                cycle_id=-450,
            )
        )
        session.flush()

        outcome = make_outcome(
            internal_id=-452,
            source_id=1_781_204_323_052,
            review_id=-451,
        )

        for field_name, value in changes.items():
            setattr(outcome, field_name, value)

        session.add(outcome)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_review_cannot_repeat_an_original_goal_outcome():
    """Allow only one decision per linked goal in a review."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-460,
                source_id=1_781_204_323_060,
            )
        )
        session.flush()

        session.add(
            make_goal(
                internal_id=-461,
                source_id=1_781_204_323_061,
                cycle_id=-460,
            )
        )

        session.add(
            make_review(
                internal_id=-462,
                source_id=1_781_204_323_062,
                cycle_id=-460,
            )
        )
        session.flush()

        session.add_all(
            [
                make_outcome(
                    internal_id=-463,
                    source_id=1_781_204_323_063,
                    review_id=-462,
                    goal_id=-461,
                ),
                make_outcome(
                    internal_id=-464,
                    source_id=1_781_204_323_064,
                    review_id=-462,
                    goal_id=-461,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_deleting_review_cascades_goal_outcomes():
    """Delete child outcomes when their review is deleted."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-470,
                source_id=1_781_204_323_070,
            )
        )
        session.flush()

        review = make_review(
            internal_id=-471,
            source_id=1_781_204_323_071,
            cycle_id=-470,
        )
        session.add(review)
        session.flush()

        session.add(
            make_outcome(
                internal_id=-472,
                source_id=1_781_204_323_072,
                review_id=-471,
            )
        )
        session.flush()

        session.delete(review)
        session.flush()
        session.expunge_all()

        assert session.get(CycleReview, -471) is None
        assert session.get(
            CycleGoalOutcome,
            -472,
        ) is None
        assert session.get(
            PlanningCycle,
            -470,
        ) is not None

        session.rollback()


def test_deleting_reviewed_cycle_cascades_review_and_outcomes():
    """Delete a cycle review when its reviewed cycle is deleted."""

    with Session(engine) as session:
        cycle = make_cycle(
            internal_id=-480,
            source_id=1_781_204_323_080,
        )
        session.add(cycle)
        session.flush()

        session.add(
            make_review(
                internal_id=-481,
                source_id=1_781_204_323_081,
                cycle_id=-480,
            )
        )
        session.flush()

        session.add(
            make_outcome(
                internal_id=-482,
                source_id=1_781_204_323_082,
                review_id=-481,
            )
        )
        session.flush()

        session.delete(cycle)
        session.flush()
        session.expunge_all()

        assert session.get(CycleReview, -481) is None
        assert session.get(
            CycleGoalOutcome,
            -482,
        ) is None

        session.rollback()


def test_deleted_goal_and_next_cycle_links_preserve_history():
    """Clear optional links while retaining saved history."""

    with Session(engine) as session:
        source_cycle = make_cycle(
            internal_id=-490,
            source_id=1_781_204_323_090,
        )
        next_cycle = make_cycle(
            internal_id=-491,
            source_id=1_781_204_323_091,
            start_date=NEXT_CYCLE_START,
        )
        session.add_all([source_cycle, next_cycle])
        session.flush()

        original_goal = make_goal(
            internal_id=-492,
            source_id=1_781_204_323_092,
            cycle_id=-490,
        )
        destination_goal = make_goal(
            internal_id=-493,
            source_id=1_781_204_323_093,
            cycle_id=-491,
            title="Replacement goal",
            start_date=NEXT_CYCLE_START,
        )
        session.add_all([original_goal, destination_goal])
        session.flush()

        session.add(
            make_review(
                internal_id=-494,
                source_id=1_781_204_323_094,
                cycle_id=-490,
                next_cycle_id=-491,
            )
        )
        session.flush()

        session.add(
            make_outcome(
                internal_id=-495,
                source_id=1_781_204_323_095,
                review_id=-494,
                goal_id=-492,
                destination_goal_id=-493,
                action="replace",
                replacement_title="Replacement goal",
            )
        )
        session.flush()

        session.delete(original_goal)
        session.delete(destination_goal)
        session.delete(next_cycle)
        session.flush()
        session.expunge_all()

        saved_review = session.get(CycleReview, -494)
        saved_outcome = session.get(
            CycleGoalOutcome,
            -495,
        )

        assert saved_review is not None
        assert saved_review.next_cycle_id is None
        assert saved_review.next_cycle_name == "Fall 2026"
        assert (
            saved_review.next_cycle_start_date
            == NEXT_CYCLE_START
        )

        assert saved_outcome is not None
        assert saved_outcome.goal_id is None
        assert saved_outcome.destination_goal_id is None
        assert saved_outcome.goal_title == "Historical goal"
        assert saved_outcome.action == "replace"
        assert (
            saved_outcome.replacement_title
            == "Replacement goal"
        )

        session.rollback()


def test_cycle_review_accepts_five_commitments():
    """Accept the backup format's maximum commitment count."""

    commitments = [
        "Commitment one",
        "Commitment two",
        "Commitment three",
        "Commitment four",
        "Commitment five",
    ]

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-500,
                source_id=1_781_204_323_100,
            )
        )
        session.flush()

        review = make_review(
            internal_id=-501,
            source_id=1_781_204_323_101,
            cycle_id=-500,
        )
        review.next_cycle_first_commitments = commitments
        session.add(review)
        session.flush()
        session.expunge_all()

        saved_review = session.get(CycleReview, -501)

        assert saved_review is not None
        assert (
            saved_review.next_cycle_first_commitments
            == commitments
        )

        session.rollback()


@pytest.mark.parametrize(
    "commitments",
    [
        ["One", "Two", "Three", "Four", "Five", "Six"],
        ["Valid", None],
        ["x" * 181],
    ],
)
def test_cycle_review_rejects_invalid_commitment_arrays(
    commitments: list[object],
):
    """Reject excessive, null, or oversized commitment entries."""

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=-510,
                source_id=1_781_204_323_110,
            )
        )
        session.flush()

        review = make_review(
            internal_id=-511,
            source_id=1_781_204_323_111,
            cycle_id=-510,
        )
        review.next_cycle_first_commitments = commitments  # type: ignore[assignment]
        session.add(review)

        with pytest.raises((IntegrityError, DataError)):
            session.flush()

        session.rollback()