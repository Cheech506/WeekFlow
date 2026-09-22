"""Tests for PostgreSQL recurring schedule models."""

from datetime import date

import pytest
from sqlalchemy import SmallInteger, inspect
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import (
    Goal,
    RecurringOccurrenceException,
    RecurringRule,
)


RULE_START = date(2026, 9, 21)
RULE_END = date(2026, 10, 31)
EXCEPTION_DATE = date(2026, 9, 23)

EXPECTED_RULE_COLUMNS = {
    "id",
    "source_recurring_rule_id",
    "goal_id",
    "title",
    "notes",
    "priority",
    "frequency",
    "start_date",
    "end_date",
    "weekdays",
    "active",
    "created_at",
}

EXPECTED_EXCEPTION_COLUMNS = {
    "recurring_rule_id",
    "occurrence_date",
    "created_at",
}


def make_goal(
    *,
    internal_id: int,
    source_id: int,
) -> Goal:
    """Create a valid incomplete Goal for recurring tests."""

    return Goal(
        id=internal_id,
        source_goal_id=source_id,
        title="Maintain a consistent routine",
        completed=False,
        completed_at=None,
        start_date=date(2026, 9, 21),
        end_date=date(2026, 12, 13),
    )


def make_rule(
    *,
    internal_id: int,
    source_id: int | None,
    goal_id: int | None = None,
    frequency: str = "daily",
    weekdays: list[int] | None = None,
) -> RecurringRule:
    """Create a valid recurring rule for tests."""

    return RecurringRule(
        id=internal_id,
        source_recurring_rule_id=source_id,
        goal_id=goal_id,
        title="Morning planning",
        notes="Review the day before starting work",
        priority=1,
        frequency=frequency,
        start_date=RULE_START,
        end_date=RULE_END,
        weekdays=weekdays if weekdays is not None else [],
        active=True,
    )


def test_recurring_rules_table_matches_model():
    """Verify that PostgreSQL matches RecurringRule."""

    inspector = inspect(engine)

    assert inspector.has_table(
        RecurringRule.__tablename__
    )

    inspected_columns = inspector.get_columns(
        RecurringRule.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        RecurringRule.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_RULE_COLUMNS
    assert model_columns == EXPECTED_RULE_COLUMNS

    columns_by_name = {
        column["name"]: column
        for column in inspected_columns
    }

    assert (
        str(
            columns_by_name[
                "source_recurring_rule_id"
            ]["type"]
        )
        == "BIGINT"
    )
    assert (
        str(columns_by_name["priority"]["type"])
        == "SMALLINT"
    )
    assert (
        str(columns_by_name["start_date"]["type"])
        == "DATE"
    )
    assert (
        str(columns_by_name["end_date"]["type"])
        == "DATE"
    )

    frequency_type = columns_by_name["frequency"]["type"]

    assert getattr(frequency_type, "length", None) == 16

    weekdays_type = columns_by_name["weekdays"]["type"]

    assert isinstance(weekdays_type, ARRAY)
    assert isinstance(
        weekdays_type.item_type,
        SmallInteger,
    )

    primary_key = inspector.get_pk_constraint(
        RecurringRule.__tablename__
    )

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            RecurringRule.__tablename__
        )
    }

    assert (
        "ck_recurring_rules_source_id_positive"
        in check_names
    )
    assert (
        "ck_recurring_rules_title_not_blank"
        in check_names
    )
    assert (
        "ck_recurring_rules_priority_range"
        in check_names
    )
    assert "ck_recurring_rules_frequency" in check_names
    assert "ck_recurring_rules_date_order" in check_names
    assert (
        "ck_recurring_rules_weekday_values"
        in check_names
    )
    assert (
        "ck_recurring_rules_weekdays_unique"
        in check_names
    )
    assert (
        "ck_recurring_rules_certain_days_weekdays"
        in check_names
    )

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            RecurringRule.__tablename__
        )
    }

    assert (
        "uq_recurring_rules_source_recurring_rule_id"
        in unique_names
    )

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            RecurringRule.__tablename__
        )
    }

    assert indexes["ix_recurring_rules_goal_id"] == [
        "goal_id"
    ]
    assert indexes["ix_recurring_rules_active"] == [
        "active"
    ]

    foreign_keys = inspector.get_foreign_keys(
        RecurringRule.__tablename__
    )

    goal_foreign_key = next(
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"] == ["goal_id"]
    )

    assert goal_foreign_key["referred_table"] == "goals"
    assert goal_foreign_key["referred_columns"] == ["id"]
    assert (
        goal_foreign_key["options"].get("ondelete")
        == "SET NULL"
    )


def test_recurring_exceptions_table_matches_model():
    """Verify that PostgreSQL matches the exception model."""

    inspector = inspect(engine)

    assert inspector.has_table(
        RecurringOccurrenceException.__tablename__
    )

    inspected_columns = inspector.get_columns(
        RecurringOccurrenceException.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        RecurringOccurrenceException.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_EXCEPTION_COLUMNS
    assert model_columns == EXPECTED_EXCEPTION_COLUMNS

    column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    assert column_types["occurrence_date"] == "DATE"

    primary_key = inspector.get_pk_constraint(
        RecurringOccurrenceException.__tablename__
    )

    assert primary_key["constrained_columns"] == [
        "recurring_rule_id",
        "occurrence_date",
    ]

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            RecurringOccurrenceException.__tablename__
        )
    }

    assert (
        indexes[
            "ix_recurring_occurrence_exceptions_occurrence_date"
        ]
        == ["occurrence_date"]
    )

    foreign_keys = inspector.get_foreign_keys(
        RecurringOccurrenceException.__tablename__
    )

    rule_foreign_key = next(
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"]
        == ["recurring_rule_id"]
    )

    assert (
        rule_foreign_key["referred_table"]
        == "recurring_rules"
    )
    assert rule_foreign_key["referred_columns"] == ["id"]
    assert (
        rule_foreign_key["options"].get("ondelete")
        == "CASCADE"
    )


def test_rule_and_exception_round_trip_without_persisting():
    """Save a Goal, rule, and exception, then roll them back."""

    goal_id = -300
    rule_id = -301
    exception_date = date(2026, 9, 25)

    with Session(engine) as session:
        goal = make_goal(
            internal_id=goal_id,
            source_id=1_781_204_322_000,
        )

        session.add(goal)
        session.flush()

        rule = make_rule(
            internal_id=rule_id,
            source_id=1_781_204_322_001,
            goal_id=goal_id,
            frequency="certainDays",
            weekdays=[1, 3, 5],
        )

        session.add(rule)
        session.flush()

        exception = RecurringOccurrenceException(
            recurring_rule_id=rule_id,
            occurrence_date=exception_date,
        )

        session.add(exception)
        session.flush()
        session.expunge_all()

        saved_rule = session.get(
            RecurringRule,
            rule_id,
        )
        saved_exception = session.get(
            RecurringOccurrenceException,
            (rule_id, exception_date),
        )

        assert saved_rule is not None
        assert (
            saved_rule.source_recurring_rule_id
            == 1_781_204_322_001
        )
        assert saved_rule.goal_id == goal_id
        assert saved_rule.title == "Morning planning"
        assert (
            saved_rule.notes
            == "Review the day before starting work"
        )
        assert saved_rule.priority == 1
        assert saved_rule.frequency == "certainDays"
        assert saved_rule.start_date == RULE_START
        assert saved_rule.end_date == RULE_END
        assert saved_rule.weekdays == [1, 3, 5]
        assert saved_rule.active is True
        assert saved_rule.created_at is not None

        assert saved_exception is not None
        assert saved_exception.recurring_rule_id == rule_id
        assert (
            saved_exception.occurrence_date
            == exception_date
        )
        assert saved_exception.created_at is not None

        session.rollback()

    with Session(engine) as session:
        assert session.get(Goal, goal_id) is None
        assert session.get(RecurringRule, rule_id) is None
        assert (
            session.get(
                RecurringOccurrenceException,
                (rule_id, exception_date),
            )
            is None
        )


def test_source_recurring_rule_id_must_be_unique():
    """Prevent importing the same SQLite rule twice."""

    duplicate_source_id = 1_781_204_322_002

    with Session(engine) as session:
        session.add_all(
            [
                make_rule(
                    internal_id=-302,
                    source_id=duplicate_source_id,
                ),
                make_rule(
                    internal_id=-303,
                    source_id=duplicate_source_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_server_rules_can_have_null_source_ids():
    """Allow multiple new PostgreSQL rules without SQLite IDs."""

    with Session(engine) as session:
        session.add_all(
            [
                make_rule(
                    internal_id=-304,
                    source_id=None,
                ),
                make_rule(
                    internal_id=-305,
                    source_id=None,
                ),
            ]
        )

        session.flush()
        session.rollback()


def test_exception_identity_must_be_unique():
    """Prevent two exceptions for one rule and date."""

    rule_id = -306

    with Session(engine) as session:
        session.add(
            make_rule(
                internal_id=rule_id,
                source_id=1_781_204_322_003,
            )
        )
        session.flush()

        session.add_all(
            [
                RecurringOccurrenceException(
                    recurring_rule_id=rule_id,
                    occurrence_date=EXCEPTION_DATE,
                ),
                RecurringOccurrenceException(
                    recurring_rule_id=rule_id,
                    occurrence_date=EXCEPTION_DATE,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_parent_deletion_preserves_expected_relationships():
    """Unlink rules from Goals and cascade rule exceptions."""

    goal_id = -307
    rule_id = -308

    with Session(engine) as session:
        goal = make_goal(
            internal_id=goal_id,
            source_id=1_781_204_322_004,
        )
        rule = make_rule(
            internal_id=rule_id,
            source_id=1_781_204_322_005,
            goal_id=goal_id,
        )
        exception = RecurringOccurrenceException(
            recurring_rule_id=rule_id,
            occurrence_date=EXCEPTION_DATE,
        )

        session.add(goal)
        session.flush()
        session.add(rule)
        session.flush()
        session.add(exception)
        session.flush()

        session.delete(goal)
        session.flush()
        session.expunge_all()

        saved_rule = session.get(
            RecurringRule,
            rule_id,
        )

        assert saved_rule is not None
        assert saved_rule.goal_id is None

        session.delete(saved_rule)
        session.flush()
        session.expunge_all()

        assert (
            session.get(
                RecurringOccurrenceException,
                (rule_id, EXCEPTION_DATE),
            )
            is None
        )

        session.rollback()


def test_recurring_rule_requires_an_existing_goal():
    """Reject a rule connected to a missing Goal."""

    with Session(engine) as session:
        rule = make_rule(
            internal_id=-309,
            source_id=1_781_204_322_006,
            goal_id=-999_999,
        )

        session.add(rule)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_exception_requires_an_existing_rule():
    """Reject an exception connected to a missing rule."""

    with Session(engine) as session:
        exception = RecurringOccurrenceException(
            recurring_rule_id=-999_999,
            occurrence_date=EXCEPTION_DATE,
        )

        session.add(exception)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_exception_date_can_outlive_current_rule_window():
    """Preserve old exceptions after a schedule is edited."""

    rule_id = -310
    old_exception_date = date(2026, 1, 5)

    with Session(engine) as session:
        session.add(
            make_rule(
                internal_id=rule_id,
                source_id=1_781_204_322_007,
            )
        )
        session.flush()

        session.add(
            RecurringOccurrenceException(
                recurring_rule_id=rule_id,
                occurrence_date=old_exception_date,
            )
        )
        session.flush()
        session.expunge_all()

        saved_exception = session.get(
            RecurringOccurrenceException,
            (rule_id, old_exception_date),
        )

        assert saved_exception is not None
        assert saved_exception.occurrence_date < RULE_START

        session.rollback()


@pytest.mark.parametrize(
    ("frequency", "weekdays"),
    [
        ("daily", []),
        ("weekly", []),
        ("everyTwoWeeks", []),
        ("certainDays", [1, 3, 5]),
        ("monthly", []),
    ],
)
def test_supported_frequencies_are_accepted(
    frequency: str,
    weekdays: list[int],
):
    """Accept every recurrence frequency used by WeekFlow."""

    with Session(engine) as session:
        rule = make_rule(
            internal_id=-311,
            source_id=1_781_204_322_008,
            frequency=frequency,
            weekdays=weekdays,
        )

        session.add(rule)
        session.flush()
        session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {
            "source_recurring_rule_id": -1,
        },
        {
            "title": "   ",
        },
        {
            "priority": -1,
        },
        {
            "priority": 3,
        },
        {
            "frequency": "yearly",
        },
        {
            "end_date": date(2026, 9, 20),
        },
        {
            "weekdays": [-1],
        },
        {
            "weekdays": [7],
        },
        {
            "weekdays": [1, None],
        },
        {
            "weekdays": [1, 1],
        },
        {
            "frequency": "certainDays",
            "weekdays": [],
        },
    ],
)
def test_recurring_rule_rejects_invalid_values(
    changes: dict[str, object],
):
    """Ensure PostgreSQL enforces recurring-rule rules."""

    rule = make_rule(
        internal_id=-312,
        source_id=1_781_204_322_009,
    )

    for field_name, value in changes.items():
        setattr(rule, field_name, value)

    with Session(engine) as session:
        session.add(rule)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()