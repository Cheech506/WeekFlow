"""Check task/goal migration using temporary tables, not WeekFlow's data."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.database import engine
from app.models import Task


@pytest.fixture
def migrated_tables(monkeypatch):
    """Temporary tables shadow the real tables for this connection only."""
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/84c7a620e519_add_task_goal_relationship.py"
    )
    spec = importlib.util.spec_from_file_location("task_goal_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("""
                CREATE TEMPORARY TABLE goals (
                    id INTEGER PRIMARY KEY,
                    source_goal_id BIGINT UNIQUE
                ) ON COMMIT DROP
            """))
            connection.execute(text("""
                CREATE TEMPORARY TABLE tasks (
                    id INTEGER PRIMARY KEY,
                    source_task_id BIGINT UNIQUE,
                    source_goal_id BIGINT,
                    title TEXT NOT NULL,
                    completed BOOLEAN NOT NULL
                ) ON COMMIT DROP
            """))
            # Refuse to run the migration unless both names resolve to
            # this connection's temporary tables.
            for table in ("tasks", "goals"):
                assert connection.scalar(text("""
                    SELECT relnamespace = pg_my_temp_schema()
                    FROM pg_class WHERE oid = to_regclass(:table_name)
                """), {"table_name": table}) is True

            connection.execute(text("""
                INSERT INTO goals (id, source_goal_id)
                VALUES (101, 1900000000001), (202, 1900000000002), (303, NULL)
            """))
            connection.execute(text("""
                INSERT INTO tasks
                    (id, source_task_id, source_goal_id, title, completed)
                VALUES
                    (11, 1900000000101, 1900000000001, 'Historical completed', true),
                    (12, 1900000000102, 1900000000002, 'Current pending', false),
                    (13, 1900000000103, 1900000000999, 'Goal not imported', false),
                    (14, 1900000000104, NULL, 'Unlinked', false),
                    (15, 1900000000105, 101, 'Source is not PostgreSQL ID', false)
            """))
            monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
            migration.upgrade()
            yield connection, migration
        finally:
            transaction.rollback()


def test_model_relationship_is_nullable_and_keeps_tasks_when_goal_deleted():
    column = Task.__table__.c.goal_id
    assert column.nullable is True
    foreign_key = next(iter(column.foreign_keys))
    assert foreign_key.target_fullname == "goals.id"
    assert foreign_key.ondelete == "SET NULL"
    assert any(index.name == "ix_tasks_goal_id" for index in Task.__table__.indexes)


def test_backfill_uses_source_mapping_and_preserves_task_identity_and_history(migrated_tables):
    connection, _ = migrated_tables
    rows = connection.execute(text("SELECT * FROM tasks ORDER BY id")).mappings().all()
    assert [row["goal_id"] for row in rows] == [101, 202, None, None, None]
    assert [row["id"] for row in rows] == [11, 12, 13, 14, 15]
    assert [row["source_task_id"] for row in rows] == list(range(1900000000101, 1900000000106))
    assert [row["source_goal_id"] for row in rows] == [1900000000001, 1900000000002, 1900000000999, None, 101]
    assert rows[0]["completed"] is True
    assert rows[0]["title"] == "Historical completed"
    assert rows[1]["completed"] is False


def test_new_task_can_link_to_native_postgresql_goal(migrated_tables):
    connection, _ = migrated_tables
    connection.execute(text("""
        INSERT INTO tasks (id, title, completed, goal_id)
        VALUES (16, 'Native task', false, 303)
    """))
    row = connection.execute(text("SELECT * FROM tasks WHERE id = 16")).mappings().one()
    assert row["goal_id"] == 303
    assert row["source_task_id"] is None and row["source_goal_id"] is None


def test_relationship_can_be_left_null(migrated_tables):
    connection, _ = migrated_tables
    connection.execute(text("""
        INSERT INTO tasks (id, title, completed) VALUES (16, 'Inbox task', false)
    """))
    assert connection.scalar(text("SELECT goal_id FROM tasks WHERE id = 16")) is None


def test_invalid_goal_link_is_rejected_by_postgresql(migrated_tables):
    connection, _ = migrated_tables
    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            connection.execute(text("UPDATE tasks SET goal_id = 999 WHERE id = 11"))
    assert connection.scalar(text("SELECT goal_id FROM tasks WHERE id = 11")) == 101


def test_goal_delete_clears_only_relationship_and_keeps_task_data(migrated_tables):
    connection, _ = migrated_tables
    before = dict(connection.execute(text("SELECT * FROM tasks WHERE id = 11")).mappings().one())
    connection.execute(text("DELETE FROM goals WHERE id = 101"))
    after = dict(connection.execute(text("SELECT * FROM tasks WHERE id = 11")).mappings().one())
    before["goal_id"] = None
    assert after == before
    assert connection.scalar(text("SELECT goal_id FROM tasks WHERE id = 12")) == 202


def test_migration_can_be_reversed_without_losing_original_columns(migrated_tables):
    connection, migration = migrated_tables
    migration.downgrade()
    columns = set(connection.scalars(text("""
        SELECT attname FROM pg_attribute
        WHERE attrelid = to_regclass('tasks')
          AND attnum > 0 AND NOT attisdropped
    """)))
    assert "goal_id" not in columns
    assert {"id", "source_task_id", "source_goal_id", "title", "completed"} <= columns
    assert connection.scalar(text("SELECT count(*) FROM tasks")) == 5
    assert connection.scalar(text("SELECT completed FROM tasks WHERE id = 11")) is True
