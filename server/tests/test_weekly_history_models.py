"""Tests for PostgreSQL weekly-review history models."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import (
    PlanningCycle,
    Task,
    WeeklyCommitment,
    WeeklyReview,
    WeeklyTaskDecision,
)


WEEK_START = date(2026, 9, 21)
COMPLETED_AT = datetime(
    2026,
    9,
    27,
    18,
    tzinfo=UTC,
)

EXPECTED_REVIEW_COLUMNS = {
    "id",
    "source_weekly_review_id",
    "week_start",
    "cycle_id",
    "what_went_well",
    "what_caused_problems",
    "what_learned",
    "what_change_next_week",
    "next_week_focus",
    "snapshot_completed_count",
    "snapshot_unfinished_count",
    "snapshot_overdue_count",
    "snapshot_completion_rate",
    "snapshot_goals_progressed_count",
    "snapshot_best_day",
    "snapshot_best_day_count",
    "snapshot_archived_brain_dump_count",
    "snapshot_high_priority_completed_count",
    "snapshot_recurring_completed_count",
    "created_at",
    "updated_at",
    "reviewed_at",
}

EXPECTED_COMMITMENT_COLUMNS = {
    "id",
    "source_weekly_commitment_id",
    "week_start",
    "cycle_id",
    "task_id",
    "title",
    "completed",
    "created_at",
    "completed_at",
}

EXPECTED_DECISION_COLUMNS = {
    "id",
    "source_weekly_task_decision_id",
    "week_start",
    "task_id",
    "task_title",
    "original_due_date",
    "action",
    "resolved_due_date",
    "recurring_rule_id",
    "source_recurring_rule_id",
    "recurrence_occurrence_date",
    "decided_at",
}


def make_cycle(
    *,
    internal_id: int,
    source_id: int,
) -> PlanningCycle:
    """Create a valid completed planning cycle."""

    return PlanningCycle(
        id=internal_id,
        source_planning_cycle_id=source_id,
        name="Reviewed cycle",
        start_date=WEEK_START,
        end_date=WEEK_START + timedelta(days=83),
        active=False,
        completed_at=COMPLETED_AT,
    )


def make_task(
    *,
    internal_id: int,
    source_id: int,
    title: str = "Finish the migration",
) -> Task:
    """Create a valid task for weekly-history tests."""

    return Task(
        id=internal_id,
        source_task_id=source_id,
        title=title,
        day="Monday",
        due_date=WEEK_START,
        completed=False,
        completed_at=None,
    )


def make_review(
    *,
    internal_id: int,
    source_id: int,
    week_start: date = WEEK_START,
    cycle_id: int | None = None,
) -> WeeklyReview:
    """Create a consistent weekly review."""

    return WeeklyReview(
        id=internal_id,
        source_weekly_review_id=source_id,
        week_start=week_start,
        cycle_id=cycle_id,
        what_went_well="The migration stayed incremental.",
        what_caused_problems="Relationship mapping took time.",
        what_learned="Parents must be imported first.",
        what_change_next_week="Review migrations before applying.",
        next_week_focus="Finish review models.",
        snapshot_completed_count=4,
        snapshot_unfinished_count=1,
        snapshot_overdue_count=1,
        snapshot_completion_rate=80,
        snapshot_goals_progressed_count=2,
        snapshot_best_day="Monday",
        snapshot_best_day_count=2,
        snapshot_archived_brain_dump_count=1,
        snapshot_high_priority_completed_count=1,
        snapshot_recurring_completed_count=1,
    )


def make_commitment(
    *,
    internal_id: int,
    source_id: int,
    week_start: date = WEEK_START,
    cycle_id: int | None = None,
    task_id: int | None = None,
) -> WeeklyCommitment:
    """Create a valid unfinished weekly commitment."""

    return WeeklyCommitment(
        id=internal_id,
        source_weekly_commitment_id=source_id,
        week_start=week_start,
        cycle_id=cycle_id,
        task_id=task_id,
        title="Finish review migration",
        completed=False,
        completed_at=None,
    )


def make_decision(
    *,
    internal_id: int,
    source_id: int,
    week_start: date = WEEK_START,
    task_id: int | None = None,
) -> WeeklyTaskDecision:
    """Create a valid keep decision."""

    return WeeklyTaskDecision(
        id=internal_id,
        source_weekly_task_decision_id=source_id,
        week_start=week_start,
        task_id=task_id,
        task_title="Finish review migration",
        original_due_date=week_start,
        action="keep",
        resolved_due_date=None,
        recurring_rule_id=None,
        source_recurring_rule_id=None,
        recurrence_occurrence_date=None,
    )


def test_weekly_history_tables_match_models():
    """Verify all three PostgreSQL tables match their models."""

    inspector = inspect(engine)

    expected_tables = {
        WeeklyReview.__tablename__: EXPECTED_REVIEW_COLUMNS,
        WeeklyCommitment.__tablename__: EXPECTED_COMMITMENT_COLUMNS,
        WeeklyTaskDecision.__tablename__: EXPECTED_DECISION_COLUMNS,
    }

    for table_name, expected_columns in expected_tables.items():
        assert inspector.has_table(table_name)

        database_columns = {
            column["name"]
            for column in inspector.get_columns(table_name)
        }

        if table_name == WeeklyReview.__tablename__:
            model_columns = set(
                WeeklyReview.__table__.columns.keys()
            )
        elif table_name == WeeklyCommitment.__tablename__:
            model_columns = set(
                WeeklyCommitment.__table__.columns.keys()
            )
        else:
            model_columns = set(
                WeeklyTaskDecision.__table__.columns.keys()
            )

        assert database_columns == expected_columns
        assert model_columns == expected_columns

    review_types = {
        column["name"]: str(column["type"])
        for column in inspector.get_columns(
            WeeklyReview.__tablename__
        )
    }
    commitment_types = {
        column["name"]: str(column["type"])
        for column in inspector.get_columns(
            WeeklyCommitment.__tablename__
        )
    }
    decision_types = {
        column["name"]: str(column["type"])
        for column in inspector.get_columns(
            WeeklyTaskDecision.__tablename__
        )
    }

    assert review_types["source_weekly_review_id"] == "BIGINT"
    assert commitment_types[
        "source_weekly_commitment_id"
    ] == "BIGINT"
    assert decision_types[
        "source_weekly_task_decision_id"
    ] == "BIGINT"
    assert decision_types["source_recurring_rule_id"] == "BIGINT"

    assert review_types["week_start"] == "DATE"
    assert commitment_types["week_start"] == "DATE"
    assert decision_types["original_due_date"] == "DATE"


def test_weekly_history_constraints_and_relationships_exist():
    """Verify important constraints, indexes, and foreign keys."""

    inspector = inspect(engine)

    review_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            WeeklyReview.__tablename__
        )
    }
    commitment_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            WeeklyCommitment.__tablename__
        )
    }
    decision_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            WeeklyTaskDecision.__tablename__
        )
    }

    assert "ck_weekly_reviews_week_starts_monday" in review_checks
    assert (
        "ck_weekly_reviews_completion_rate_consistent"
        in review_checks
    )
    assert (
        "ck_weekly_reviews_snapshot_counts_nonnegative"
        in review_checks
    )

    assert (
        "ck_weekly_commitments_week_starts_monday"
        in commitment_checks
    )
    assert (
        "ck_weekly_commitments_completion_pair"
        in commitment_checks
    )

    assert (
        "ck_weekly_task_decisions_action"
        in decision_checks
    )
    assert (
        "ck_weekly_task_decisions_original_date_in_week"
        in decision_checks
    )
    assert (
        "ck_weekly_task_decisions_recurrence_identity"
        in decision_checks
    )

    review_foreign_keys = inspector.get_foreign_keys(
        WeeklyReview.__tablename__
    )
    review_cycle_key = next(
        key
        for key in review_foreign_keys
        if key["constrained_columns"] == ["cycle_id"]
    )

    assert review_cycle_key["referred_table"] == "planning_cycles"
    assert review_cycle_key["options"]["ondelete"] == "SET NULL"

    commitment_foreign_keys = inspector.get_foreign_keys(
        WeeklyCommitment.__tablename__
    )

    commitment_cycle_key = next(
        key
        for key in commitment_foreign_keys
        if key["constrained_columns"] == ["cycle_id"]
    )
    commitment_task_key = next(
        key
        for key in commitment_foreign_keys
        if key["constrained_columns"] == ["task_id"]
    )

    assert commitment_cycle_key["options"]["ondelete"] == "SET NULL"
    assert commitment_task_key["options"]["ondelete"] == "SET NULL"

    decision_foreign_keys = inspector.get_foreign_keys(
        WeeklyTaskDecision.__tablename__
    )
    decision_task_key = next(
        key
        for key in decision_foreign_keys
        if key["constrained_columns"] == ["task_id"]
    )

    assert decision_task_key["options"]["ondelete"] == "SET NULL"


def test_weekly_history_round_trip_without_persisting():
    """Save linked history, read it, and roll everything back."""

    cycle_id = -400
    task_id = -401
    review_id = -402
    commitment_id = -403
    decision_id = -404

    with Session(engine) as session:
        session.add(
            make_cycle(
                internal_id=cycle_id,
                source_id=1_781_204_330_000,
            )
        )
        session.add(
            make_task(
                internal_id=task_id,
                source_id=1_781_204_330_001,
            )
        )
        session.flush()

        review = make_review(
            internal_id=review_id,
            source_id=1_781_204_330_002,
            cycle_id=cycle_id,
        )
        commitment = WeeklyCommitment(
            id=commitment_id,
            source_weekly_commitment_id=1_781_204_330_003,
            week_start=WEEK_START,
            cycle_id=cycle_id,
            task_id=task_id,
            title="Finish the migration",
            completed=True,
            completed_at=COMPLETED_AT,
        )
        decision = WeeklyTaskDecision(
            id=decision_id,
            source_weekly_task_decision_id=1_781_204_330_004,
            week_start=WEEK_START,
            task_id=task_id,
            task_title="Finish the migration",
            original_due_date=WEEK_START,
            action="nextWeek",
            resolved_due_date=WEEK_START + timedelta(days=7),
            recurring_rule_id=25,
            source_recurring_rule_id=1_781_204_330_005,
            recurrence_occurrence_date=WEEK_START,
        )

        session.add_all([review, commitment, decision])
        session.flush()
        session.expunge_all()

        saved_review = session.get(WeeklyReview, review_id)
        saved_commitment = session.get(
            WeeklyCommitment,
            commitment_id,
        )
        saved_decision = session.get(
            WeeklyTaskDecision,
            decision_id,
        )

        assert saved_review is not None
        assert saved_review.cycle_id == cycle_id
        assert saved_review.snapshot_completed_count == 4
        assert saved_review.snapshot_completion_rate == 80
        assert saved_review.snapshot_best_day == "Monday"

        assert saved_commitment is not None
        assert saved_commitment.task_id == task_id
        assert saved_commitment.completed is True
        assert saved_commitment.completed_at == COMPLETED_AT

        assert saved_decision is not None
        assert saved_decision.task_id == task_id
        assert saved_decision.action == "nextWeek"
        assert (
            saved_decision.resolved_due_date
            == WEEK_START + timedelta(days=7)
        )
        assert saved_decision.recurring_rule_id == 25
        assert (
            saved_decision.source_recurring_rule_id
            == 1_781_204_330_005
        )

        session.rollback()

    with Session(engine) as session:
        assert session.get(WeeklyReview, review_id) is None
        assert session.get(WeeklyCommitment, commitment_id) is None
        assert session.get(WeeklyTaskDecision, decision_id) is None


@pytest.mark.parametrize(
    "model_name",
    [
        "review",
        "commitment",
        "decision",
    ],
)
def test_weekly_source_ids_must_be_unique(model_name: str):
    """Prevent importing the same SQLite history row twice."""

    duplicate_source_id = 1_781_204_330_100

    if model_name == "review":
        first = make_review(
            internal_id=-410,
            source_id=duplicate_source_id,
            week_start=WEEK_START,
        )
        second = make_review(
            internal_id=-411,
            source_id=duplicate_source_id,
            week_start=WEEK_START + timedelta(days=7),
        )
    elif model_name == "commitment":
        first = make_commitment(
            internal_id=-412,
            source_id=duplicate_source_id,
            week_start=WEEK_START,
        )
        second = make_commitment(
            internal_id=-413,
            source_id=duplicate_source_id,
            week_start=WEEK_START + timedelta(days=7),
        )
    else:
        first = make_decision(
            internal_id=-414,
            source_id=duplicate_source_id,
            week_start=WEEK_START,
        )
        second = make_decision(
            internal_id=-415,
            source_id=duplicate_source_id,
            week_start=WEEK_START + timedelta(days=7),
        )

    with Session(engine) as session:
        session.add_all([first, second])

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_only_one_review_can_exist_for_each_week():
    """Reject two weekly reviews for the same Monday."""

    with Session(engine) as session:
        session.add_all(
            [
                make_review(
                    internal_id=-420,
                    source_id=1_781_204_330_120,
                ),
                make_review(
                    internal_id=-421,
                    source_id=1_781_204_330_121,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_linked_commitment_identity_must_be_unique():
    """Reject two commitments for the same task and week."""

    task_id = -430

    with Session(engine) as session:
        session.add(
            make_task(
                internal_id=task_id,
                source_id=1_781_204_330_130,
            )
        )
        session.flush()

        session.add_all(
            [
                make_commitment(
                    internal_id=-431,
                    source_id=1_781_204_330_131,
                    task_id=task_id,
                ),
                make_commitment(
                    internal_id=-432,
                    source_id=1_781_204_330_132,
                    task_id=task_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_linked_decision_identity_must_be_unique():
    """Reject duplicate decisions for one task, week, and date."""

    task_id = -440

    with Session(engine) as session:
        session.add(
            make_task(
                internal_id=task_id,
                source_id=1_781_204_330_140,
            )
        )
        session.flush()

        session.add_all(
            [
                make_decision(
                    internal_id=-441,
                    source_id=1_781_204_330_141,
                    task_id=task_id,
                ),
                make_decision(
                    internal_id=-442,
                    source_id=1_781_204_330_142,
                    task_id=task_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"source_weekly_review_id": -1},
        {"week_start": date(2026, 9, 22)},
        {"snapshot_completion_rate": 79},
        {"snapshot_overdue_count": 2},
        {
            "snapshot_best_day": None,
            "snapshot_best_day_count": 2,
        },
    ],
)
def test_weekly_review_rejects_invalid_values(
    changes: dict[str, object],
):
    """Ensure PostgreSQL rejects inconsistent weekly reviews."""

    review = make_review(
        internal_id=-450,
        source_id=1_781_204_330_150,
    )

    for field_name, value in changes.items():
        setattr(review, field_name, value)

    with Session(engine) as session:
        session.add(review)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"source_weekly_commitment_id": -1},
        {"week_start": date(2026, 9, 22)},
        {"title": "   "},
        {
            "completed": True,
            "completed_at": None,
        },
        {
            "completed": False,
            "completed_at": COMPLETED_AT,
        },
    ],
)
def test_weekly_commitment_rejects_invalid_values(
    changes: dict[str, object],
):
    """Ensure PostgreSQL rejects invalid commitments."""

    commitment = make_commitment(
        internal_id=-460,
        source_id=1_781_204_330_160,
    )

    for field_name, value in changes.items():
        setattr(commitment, field_name, value)

    with Session(engine) as session:
        session.add(commitment)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"source_weekly_task_decision_id": -1},
        {"week_start": date(2026, 9, 22)},
        {"original_due_date": WEEK_START + timedelta(days=7)},
        {"action": "later"},
        {
            "action": "nextWeek",
            "resolved_due_date": None,
        },
        {
            "action": "inbox",
            "resolved_due_date": WEEK_START + timedelta(days=7),
        },
        {
            "source_recurring_rule_id": 100,
            "recurrence_occurrence_date": None,
        },
        {
            "source_recurring_rule_id": None,
            "recurring_rule_id": None,
            "recurrence_occurrence_date": WEEK_START,
        },
    ],
)
def test_weekly_decision_rejects_invalid_values(
    changes: dict[str, object],
):
    """Ensure PostgreSQL rejects invalid task decisions."""

    decision = make_decision(
        internal_id=-470,
        source_id=1_781_204_330_170,
    )

    for field_name, value in changes.items():
        setattr(decision, field_name, value)

    with Session(engine) as session:
        session.add(decision)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_deleting_parents_preserves_weekly_history():
    """Clear live links without deleting historical records."""

    cycle_id = -480
    task_id = -481
    review_id = -482
    commitment_id = -483
    decision_id = -484

    with Session(engine) as session:
        cycle = make_cycle(
            internal_id=cycle_id,
            source_id=1_781_204_330_180,
        )
        task = make_task(
            internal_id=task_id,
            source_id=1_781_204_330_181,
            title="Historical task title",
        )

        session.add_all([cycle, task])
        session.flush()

        session.add_all(
            [
                make_review(
                    internal_id=review_id,
                    source_id=1_781_204_330_182,
                    cycle_id=cycle_id,
                ),
                WeeklyCommitment(
                    id=commitment_id,
                    source_weekly_commitment_id=1_781_204_330_183,
                    week_start=WEEK_START,
                    cycle_id=cycle_id,
                    task_id=task_id,
                    title="Historical task title",
                    completed=False,
                    completed_at=None,
                ),
                make_decision(
                    internal_id=decision_id,
                    source_id=1_781_204_330_184,
                    task_id=task_id,
                ),
            ]
        )
        session.flush()

        session.delete(cycle)
        session.flush()
        session.expire_all()

        saved_review = session.get(WeeklyReview, review_id)
        saved_commitment = session.get(
            WeeklyCommitment,
            commitment_id,
        )

        assert saved_review is not None
        assert saved_review.cycle_id is None
        assert saved_commitment is not None
        assert saved_commitment.cycle_id is None

        saved_task = session.get(Task, task_id)
        assert saved_task is not None

        session.delete(saved_task)
        session.flush()
        session.expire_all()

        saved_commitment = session.get(
            WeeklyCommitment,
            commitment_id,
        )
        saved_decision = session.get(
            WeeklyTaskDecision,
            decision_id,
        )

        assert saved_commitment is not None
        assert saved_commitment.task_id is None
        assert saved_commitment.title == "Historical task title"

        assert saved_decision is not None
        assert saved_decision.task_id is None
        assert (
            saved_decision.task_title
            == "Finish review migration"
        )

        session.rollback()