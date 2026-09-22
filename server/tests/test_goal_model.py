"""Tests for PostgreSQL Goal and GoalMilestone models."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Goal, GoalMilestone, PlanningCycle


CYCLE_START = date(2026, 9, 23)
CYCLE_END = CYCLE_START + timedelta(days=83)
GOAL_START = date(2026, 9, 23)
GOAL_END = date(2026, 12, 22)

COMPLETED_AT = datetime(
    2026,
    12,
    23,
    12,
    tzinfo=UTC,
)


EXPECTED_GOAL_COLUMNS = {
    "id",
    "source_goal_id",
    "cycle_id",
    "title",
    "completed",
    "created_at",
    "completed_at",
    "start_date",
    "end_date",
    "reward",
    "purpose",
    "success_definition",
    "notes",
    "completion_what_helped",
    "completion_hardest_part",
    "completion_learned",
    "completion_do_differently",
    "completion_task_total",
    "completion_task_completed",
    "completion_milestone_total",
    "completion_milestone_completed",
    "completion_high_priority_completed",
}


EXPECTED_MILESTONE_COLUMNS = {
    "id",
    "source_goal_milestone_id",
    "goal_id",
    "title",
    "notes",
    "target_date",
    "completed",
    "created_at",
    "completed_at",
}


def make_goal(
    *,
    internal_id: int,
    source_id: int,
    cycle_id: int | None = None,
) -> Goal:
    """Create a valid incomplete Goal for tests."""

    return Goal(
        id=internal_id,
        source_goal_id=source_id,
        cycle_id=cycle_id,
        title="Finish WeekFlow migration",
        completed=False,
        completed_at=None,
        start_date=GOAL_START,
        end_date=GOAL_END,
    )


def make_milestone(
    *,
    internal_id: int,
    source_id: int,
    goal_id: int,
) -> GoalMilestone:
    """Create a valid incomplete milestone for tests."""

    return GoalMilestone(
        id=internal_id,
        source_goal_milestone_id=source_id,
        goal_id=goal_id,
        title="Finish PostgreSQL models",
        completed=False,
        completed_at=None,
    )


def test_goals_table_matches_model():
    """Verify that PostgreSQL matches the Goal model."""

    inspector = inspect(engine)

    assert inspector.has_table(Goal.__tablename__)

    inspected_columns = inspector.get_columns(
        Goal.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        Goal.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_GOAL_COLUMNS
    assert model_columns == EXPECTED_GOAL_COLUMNS

    column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    assert column_types["source_goal_id"] == "BIGINT"
    assert column_types["start_date"] == "DATE"
    assert column_types["end_date"] == "DATE"

    primary_key = inspector.get_pk_constraint(
        Goal.__tablename__
    )

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            Goal.__tablename__
        )
    }

    assert "ck_goals_source_id_positive" in check_names
    assert "ck_goals_title_not_blank" in check_names
    assert "ck_goals_date_order" in check_names
    assert "ck_goals_completion_pair" in check_names
    assert (
        "ck_goals_completion_counts_nonnegative"
        in check_names
    )
    assert "ck_goals_task_snapshot_counts" in check_names
    assert "ck_goals_milestone_snapshot_counts" in check_names
    assert (
        "ck_goals_high_priority_snapshot_count"
        in check_names
    )

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            Goal.__tablename__
        )
    }

    assert "uq_goals_source_goal_id" in unique_names

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            Goal.__tablename__
        )
    }

    assert indexes["ix_goals_cycle_id"] == ["cycle_id"]

    foreign_keys = inspector.get_foreign_keys(
        Goal.__tablename__
    )

    cycle_foreign_key = next(
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"] == ["cycle_id"]
    )

    assert (
        cycle_foreign_key["referred_table"]
        == "planning_cycles"
    )
    assert cycle_foreign_key["referred_columns"] == ["id"]
    assert (
        cycle_foreign_key["options"]["ondelete"]
        == "SET NULL"
    )


def test_goal_milestones_table_matches_model():
    """Verify that PostgreSQL matches the milestone model."""

    inspector = inspect(engine)

    assert inspector.has_table(
        GoalMilestone.__tablename__
    )

    inspected_columns = inspector.get_columns(
        GoalMilestone.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        GoalMilestone.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_MILESTONE_COLUMNS
    assert model_columns == EXPECTED_MILESTONE_COLUMNS

    column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    assert (
        column_types["source_goal_milestone_id"]
        == "BIGINT"
    )
    assert column_types["target_date"] == "DATE"

    primary_key = inspector.get_pk_constraint(
        GoalMilestone.__tablename__
    )

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            GoalMilestone.__tablename__
        )
    }

    assert (
        "ck_goal_milestones_source_id_positive"
        in check_names
    )
    assert (
        "ck_goal_milestones_title_not_blank"
        in check_names
    )
    assert (
        "ck_goal_milestones_completion_pair"
        in check_names
    )

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            GoalMilestone.__tablename__
        )
    }

    assert (
        "uq_goal_milestones_source_id"
        in unique_names
    )

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            GoalMilestone.__tablename__
        )
    }

    assert indexes["ix_goal_milestones_goal_id"] == [
        "goal_id"
    ]

    foreign_keys = inspector.get_foreign_keys(
        GoalMilestone.__tablename__
    )

    goal_foreign_key = next(
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"] == ["goal_id"]
    )

    assert goal_foreign_key["referred_table"] == "goals"
    assert goal_foreign_key["referred_columns"] == ["id"]
    assert (
        goal_foreign_key["options"]["ondelete"]
        == "CASCADE"
    )


def test_goal_and_milestone_round_trip_without_persisting():
    """Save a complete hierarchy, read it, and roll it back."""

    cycle_id = -200
    goal_id = -201
    milestone_id = -202

    with Session(engine) as session:
        cycle = PlanningCycle(
            id=cycle_id,
            source_planning_cycle_id=1_781_204_321_000,
            name="Fall 2026",
            start_date=CYCLE_START,
            end_date=CYCLE_END,
            active=False,
            completed_at=COMPLETED_AT,
        )

        session.add(cycle)
        session.flush()

        goal = Goal(
            id=goal_id,
            source_goal_id=1_781_204_321_001,
            cycle_id=cycle_id,
            title="Finish WeekFlow migration",
            completed=True,
            completed_at=COMPLETED_AT,
            start_date=GOAL_START,
            end_date=GOAL_END,
            reward="Launch WeekFlow",
            purpose="Centralize WeekFlow data",
            success_definition="Use PostgreSQL safely",
            notes="Preserve all existing data",
            completion_what_helped="Small migrations",
            completion_hardest_part="Relationship mapping",
            completion_learned="Import parents first",
            completion_do_differently="Plan IDs earlier",
            completion_task_total=10,
            completion_task_completed=8,
            completion_milestone_total=2,
            completion_milestone_completed=1,
            completion_high_priority_completed=3,
        )

        session.add(goal)
        session.flush()

        milestone = GoalMilestone(
            id=milestone_id,
            source_goal_milestone_id=1_781_204_321_002,
            goal_id=goal_id,
            title="Finish PostgreSQL models",
            notes="Verify every relationship",
            target_date=date(2026, 10, 15),
            completed=True,
            completed_at=COMPLETED_AT,
        )

        session.add(milestone)
        session.flush()
        session.expunge_all()

        saved_goal = session.get(Goal, goal_id)
        saved_milestone = session.get(
            GoalMilestone,
            milestone_id,
        )

        assert saved_goal is not None
        assert saved_goal.cycle_id == cycle_id
        assert saved_goal.source_goal_id == 1_781_204_321_001
        assert saved_goal.completed is True
        assert saved_goal.completion_task_total == 10
        assert saved_goal.completion_task_completed == 8
        assert saved_goal.completion_milestone_total == 2
        assert saved_goal.completion_milestone_completed == 1
        assert (
            saved_goal.completion_high_priority_completed
            == 3
        )

        assert saved_milestone is not None
        assert saved_milestone.goal_id == goal_id
        assert saved_milestone.completed is True
        assert saved_milestone.target_date == date(
            2026,
            10,
            15,
        )

        session.rollback()

    with Session(engine) as session:
        assert session.get(PlanningCycle, cycle_id) is None
        assert session.get(Goal, goal_id) is None
        assert (
            session.get(GoalMilestone, milestone_id)
            is None
        )


def test_source_goal_id_must_be_unique():
    """Prevent importing the same SQLite Goal twice."""

    duplicate_source_id = 1_781_204_321_003

    with Session(engine) as session:
        session.add_all(
            [
                make_goal(
                    internal_id=-203,
                    source_id=duplicate_source_id,
                ),
                make_goal(
                    internal_id=-204,
                    source_id=duplicate_source_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_source_milestone_id_must_be_unique():
    """Prevent importing the same SQLite milestone twice."""

    goal_id = -205
    duplicate_source_id = 1_781_204_321_004

    with Session(engine) as session:
        session.add(
            make_goal(
                internal_id=goal_id,
                source_id=1_781_204_321_005,
            )
        )
        session.flush()

        session.add_all(
            [
                make_milestone(
                    internal_id=-206,
                    source_id=duplicate_source_id,
                    goal_id=goal_id,
                ),
                make_milestone(
                    internal_id=-207,
                    source_id=duplicate_source_id,
                    goal_id=goal_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_parent_deletion_preserves_expected_relationships():
    """Unlink Goals from cycles and delete milestones with Goals."""

    cycle_id = -208
    goal_id = -209
    milestone_id = -210

    with Session(engine) as session:
        cycle = PlanningCycle(
            id=cycle_id,
            source_planning_cycle_id=1_781_204_321_006,
            start_date=CYCLE_START,
            end_date=CYCLE_END,
            active=False,
            completed_at=COMPLETED_AT,
        )
        goal = make_goal(
            internal_id=goal_id,
            source_id=1_781_204_321_007,
            cycle_id=cycle_id,
        )
        milestone = make_milestone(
            internal_id=milestone_id,
            source_id=1_781_204_321_008,
            goal_id=goal_id,
        )

        session.add(cycle)
        session.flush()
        session.add(goal)
        session.flush()
        session.add(milestone)
        session.flush()

        session.delete(cycle)
        session.flush()
        session.expunge_all()

        saved_goal = session.get(Goal, goal_id)

        assert saved_goal is not None
        assert saved_goal.cycle_id is None

        session.delete(saved_goal)
        session.flush()
        session.expunge_all()

        assert (
            session.get(GoalMilestone, milestone_id)
            is None
        )

        session.rollback()


def test_goal_requires_an_existing_cycle():
    """Reject a Goal connected to a missing cycle."""

    with Session(engine) as session:
        goal = make_goal(
            internal_id=-211,
            source_id=1_781_204_321_009,
            cycle_id=-999_999,
        )

        session.add(goal)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_milestone_requires_an_existing_goal():
    """Reject a milestone connected to a missing Goal."""

    with Session(engine) as session:
        milestone = make_milestone(
            internal_id=-212,
            source_id=1_781_204_321_010,
            goal_id=-999_999,
        )

        session.add(milestone)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"source_goal_id": -1},
        {
            "completed": True,
            "completed_at": None,
        },
        {
            "completed": False,
            "completed_at": COMPLETED_AT,
        },
        {
            "end_date": date(2026, 9, 22),
        },
        {
            "completion_task_total": -1,
        },
        {
            "completion_task_total": 1,
            "completion_task_completed": 2,
        },
        {
            "completion_milestone_total": 1,
            "completion_milestone_completed": 2,
        },
        {
            "completion_task_completed": 1,
            "completion_high_priority_completed": 2,
        },
    ],
)
def test_goal_rejects_invalid_values(
    changes: dict[str, object],
):
    """Ensure PostgreSQL enforces important Goal rules."""

    goal = make_goal(
        internal_id=-213,
        source_id=1_781_204_321_011,
    )

    for field_name, value in changes.items():
        setattr(goal, field_name, value)

    with Session(engine) as session:
        session.add(goal)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"source_goal_milestone_id": -1},
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
def test_milestone_rejects_invalid_values(
    changes: dict[str, object],
):
    """Ensure PostgreSQL enforces milestone rules."""

    goal_id = -214

    milestone = make_milestone(
        internal_id=-215,
        source_id=1_781_204_321_012,
        goal_id=goal_id,
    )

    for field_name, value in changes.items():
        setattr(milestone, field_name, value)

    with Session(engine) as session:
        session.add(
            make_goal(
                internal_id=goal_id,
                source_id=1_781_204_321_013,
            )
        )
        session.flush()

        session.add(milestone)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()