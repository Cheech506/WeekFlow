"""Tests for the PostgreSQL PlanningCycle model and table."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import PlanningCycle


EXPECTED_PLANNING_CYCLE_COLUMNS = {
    "id",
    "source_planning_cycle_id",
    "name",
    "primary_focus",
    "theme",
    "start_date",
    "end_date",
    "active",
    "created_at",
    "completed_at",
}


def test_planning_cycles_table_matches_model():
    """Verify that PostgreSQL matches the PlanningCycle model."""

    inspector = inspect(engine)

    assert inspector.has_table(
        PlanningCycle.__tablename__
    )

    inspected_columns = inspector.get_columns(
        PlanningCycle.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        PlanningCycle.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_PLANNING_CYCLE_COLUMNS
    assert model_columns == EXPECTED_PLANNING_CYCLE_COLUMNS

    database_column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    assert (
        database_column_types["source_planning_cycle_id"]
        == "BIGINT"
    )
    assert database_column_types["start_date"] == "DATE"
    assert database_column_types["end_date"] == "DATE"

    primary_key = inspector.get_pk_constraint(
        PlanningCycle.__tablename__
    )

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            PlanningCycle.__tablename__
        )
    }

    assert "ck_planning_cycles_source_id_positive" in check_names
    assert "ck_planning_cycles_twelve_weeks" in check_names
    assert (
        "ck_planning_cycles_active_completion_pair"
        in check_names
    )

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            PlanningCycle.__tablename__
        )
    }

    assert (
        "uq_planning_cycles_source_planning_cycle_id"
        in unique_names
    )

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            PlanningCycle.__tablename__
        )
    }

    assert indexes["uq_planning_cycles_single_active"] == [
        "active"
    ]


def test_planning_cycle_can_be_saved_and_read_without_persisting():
    """Round-trip one cycle through PostgreSQL, then roll it back."""

    temporary_id = -100
    source_cycle_id = 1_781_204_320_300
    start_date = date(2026, 9, 23)
    end_date = start_date + timedelta(days=83)
    completed_at = datetime(
        2026,
        12,
        16,
        12,
        tzinfo=UTC,
    )

    with Session(engine) as session:
        cycle = PlanningCycle(
            id=temporary_id,
            source_planning_cycle_id=source_cycle_id,
            name="Fall 2026",
            primary_focus="Finish the WeekFlow migration",
            theme="Consistency",
            start_date=start_date,
            end_date=end_date,
            active=False,
            completed_at=completed_at,
        )

        session.add(cycle)
        session.flush()
        session.expunge_all()

        saved_cycle = session.get(
            PlanningCycle,
            temporary_id,
        )

        assert saved_cycle is not None
        assert saved_cycle.source_planning_cycle_id == source_cycle_id
        assert saved_cycle.name == "Fall 2026"
        assert (
            saved_cycle.primary_focus
            == "Finish the WeekFlow migration"
        )
        assert saved_cycle.theme == "Consistency"
        assert saved_cycle.start_date == start_date
        assert saved_cycle.end_date == end_date
        assert saved_cycle.active is False
        assert saved_cycle.created_at is not None
        assert saved_cycle.completed_at == completed_at

        session.rollback()

    with Session(engine) as session:
        assert session.get(
            PlanningCycle,
            temporary_id,
        ) is None


def test_source_planning_cycle_id_must_be_unique():
    """Prevent the same SQLite cycle from being imported twice."""

    duplicate_source_id = 1_781_204_320_301
    start_date = date(2026, 9, 23)
    end_date = start_date + timedelta(days=83)
    completed_at = datetime(
        2026,
        12,
        16,
        12,
        tzinfo=UTC,
    )

    with Session(engine) as session:
        session.add_all(
            [
                PlanningCycle(
                    id=-101,
                    source_planning_cycle_id=duplicate_source_id,
                    start_date=start_date,
                    end_date=end_date,
                    active=False,
                    completed_at=completed_at,
                ),
                PlanningCycle(
                    id=-102,
                    source_planning_cycle_id=duplicate_source_id,
                    start_date=start_date,
                    end_date=end_date,
                    active=False,
                    completed_at=completed_at,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_only_one_planning_cycle_can_be_active():
    """Prevent PostgreSQL from storing two current cycles."""

    first_start = date(2026, 9, 23)
    second_start = date(2026, 12, 16)

    with Session(engine) as session:
        session.add_all(
            [
                PlanningCycle(
                    id=-103,
                    source_planning_cycle_id=1_781_204_320_302,
                    start_date=first_start,
                    end_date=first_start + timedelta(days=83),
                    active=True,
                    completed_at=None,
                ),
                PlanningCycle(
                    id=-104,
                    source_planning_cycle_id=1_781_204_320_303,
                    start_date=second_start,
                    end_date=second_start + timedelta(days=83),
                    active=True,
                    completed_at=None,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_inactive_cycle_requires_completion_timestamp():
    """Require inactive cycles to record when they were completed."""

    start_date = date(2026, 9, 23)

    with Session(engine) as session:
        session.add(
            PlanningCycle(
                id=-105,
                source_planning_cycle_id=1_781_204_320_304,
                start_date=start_date,
                end_date=start_date + timedelta(days=83),
                active=False,
                completed_at=None,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_planning_cycle_must_be_exactly_twelve_weeks():
    """Reject a planning cycle with the wrong end date."""

    start_date = date(2026, 9, 23)

    with Session(engine) as session:
        session.add(
            PlanningCycle(
                id=-106,
                source_planning_cycle_id=1_781_204_320_305,
                start_date=start_date,
                end_date=start_date + timedelta(days=82),
                active=False,
                completed_at=datetime(
                    2026,
                    12,
                    15,
                    12,
                    tzinfo=UTC,
                ),
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()