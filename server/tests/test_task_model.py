from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Task


EXPECTED_TASK_COLUMNS = {
    "id",
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

    database_columns = {
        column["name"]
        for column in inspector.get_columns(Task.__tablename__)
    }
    model_columns = set(Task.__table__.columns.keys())

    assert database_columns == EXPECTED_TASK_COLUMNS
    assert model_columns == EXPECTED_TASK_COLUMNS

    primary_key = inspector.get_pk_constraint(Task.__tablename__)

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            Task.__tablename__
        )
    }

    assert "ck_tasks_priority_range" in check_names

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(Task.__tablename__)
    }

    assert indexes["ix_tasks_due_date"] == ["due_date"]


def test_task_can_be_saved_and_read_without_persisting():
    """Round-trip a task through PostgreSQL, then roll it back."""
    temporary_id = -1

    with Session(engine) as session:
        task = Task(
            id=temporary_id,
            title="Temporary test task",
        )

        session.add(task)
        # Send the INSERT to PostgreSQL without committing it.
        session.flush()
        # Forget the Python object so the next read comes from PostgreSQL.
        session.expunge_all()

        saved_task = session.get(Task, temporary_id)

        assert saved_task is not None
        assert saved_task.title == "Temporary test task"
        assert saved_task.day == "Inbox"
        assert saved_task.priority == 0
        assert saved_task.completed is False
        assert saved_task.created_at is not None

        # Undo the temporary INSERT so test data is not preserved.
        session.rollback()

    with Session(engine) as session:
        assert session.get(Task, temporary_id) is None
        