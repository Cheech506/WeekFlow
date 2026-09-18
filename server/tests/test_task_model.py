"""Tests for the PostgreSQL Task model and table."""

from datetime import date

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Task


EXPECTED_TASK_COLUMNS = {
    "id",
    "source_task_id",
    "source_goal_id",
    "source_recurring_rule_id",
    "recurrence_occurrence_date",
    "title",
    "day",
    "due_date",
    "notes",
    "priority",
    "completed",
    "created_at",
    "completed_at",
}


def test_tasks_table_matches_model():
    """Verify that PostgreSQL's tasks table matches the Task model."""

    inspector = inspect(engine)

    assert inspector.has_table(Task.__tablename__)

    inspected_columns = inspector.get_columns(Task.__tablename__)

    database_columns = {
        column["name"]
        for column in inspected_columns
    }
    model_columns = set(Task.__table__.columns.keys())

    assert database_columns == EXPECTED_TASK_COLUMNS
    assert model_columns == EXPECTED_TASK_COLUMNS

    database_column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    # SQLite source identifiers require PostgreSQL BIGINT columns.
    assert database_column_types["source_task_id"] == "BIGINT"
    assert database_column_types["source_goal_id"] == "BIGINT"
    assert database_column_types["source_recurring_rule_id"] == "BIGINT"
    assert database_column_types["recurrence_occurrence_date"] == "DATE"

    primary_key = inspector.get_pk_constraint(Task.__tablename__)

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            Task.__tablename__
        )
    }

    assert "ck_tasks_priority_range" in check_names
    assert "ck_tasks_recurring_source_pair" in check_names

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            Task.__tablename__
        )
    }

    assert "uq_tasks_source_task_id" in unique_names
    assert "uq_tasks_source_recurring_occurrence" in unique_names

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(Task.__tablename__)
    }

    assert indexes["ix_tasks_due_date"] == ["due_date"]


def test_task_can_be_saved_and_read_without_persisting():
    """Round-trip migration metadata through PostgreSQL, then roll it back."""

    temporary_id = -1
    source_task_id = 1_781_204_320_207
    source_goal_id = 1_782_503_210_780
    source_recurring_rule_id = 1_781_999_999_999
    occurrence_date = date(2026, 9, 16)

    with Session(engine) as session:
        task = Task(
            id=temporary_id,
            title="Temporary imported task",
            source_task_id=source_task_id,
            source_goal_id=source_goal_id,
            source_recurring_rule_id=source_recurring_rule_id,
            recurrence_occurrence_date=occurrence_date,
        )

        session.add(task)

        # Send the INSERT to PostgreSQL without committing it.
        session.flush()

        # Forget the Python object so the next read comes from PostgreSQL.
        session.expunge_all()

        saved_task = session.get(Task, temporary_id)

        assert saved_task is not None
        assert saved_task.title == "Temporary imported task"
        assert saved_task.day == "Inbox"
        assert saved_task.priority == 0
        assert saved_task.completed is False
        assert saved_task.created_at is not None

        assert saved_task.source_task_id == source_task_id
        assert saved_task.source_goal_id == source_goal_id
        assert (
            saved_task.source_recurring_rule_id
            == source_recurring_rule_id
        )
        assert (
            saved_task.recurrence_occurrence_date
            == occurrence_date
        )

        # Undo the temporary INSERT so test data is not preserved.
        session.rollback()

    with Session(engine) as session:
        assert session.get(Task, temporary_id) is None


def test_source_task_id_must_be_unique():
    """Prevent the same SQLite task from being imported twice."""

    duplicate_source_id = 1_781_204_320_208

    with Session(engine) as session:
        session.add_all(
            [
                Task(
                    id=-2,
                    title="First imported copy",
                    source_task_id=duplicate_source_id,
                ),
                Task(
                    id=-3,
                    title="Duplicate imported copy",
                    source_task_id=duplicate_source_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_recurring_source_identity_requires_both_values():
    """Reject an incomplete recurring-task source identity."""

    with Session(engine) as session:
        session.add(
            Task(
                id=-4,
                title="Incomplete recurring source",
                source_task_id=1_781_204_320_209,
                source_recurring_rule_id=1_781_999_999_999,
                recurrence_occurrence_date=None,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()