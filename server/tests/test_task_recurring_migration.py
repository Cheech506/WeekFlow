"""Test the recurring-task migration using temporary PostgreSQL tables."""

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.database import engine
from app.models import Task


@pytest.fixture
def recurring_migration(monkeypatch):
    """Apply the migration to temporary tables, then roll everything back."""

    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "c63f9a10b742_add_task_recurring_relationship.py"
    )

    spec = importlib.util.spec_from_file_location(
        "task_recurring_migration",
        migration_path,
    )

    assert spec is not None
    assert spec.loader is not None

    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    with engine.connect() as connection:
        transaction = connection.begin()

        try:
            connection.execute(text("""
                CREATE TEMPORARY TABLE recurring_rules (
                    id INTEGER PRIMARY KEY,
                    source_recurring_rule_id BIGINT UNIQUE
                ) ON COMMIT DROP
            """))

            connection.execute(text("""
                CREATE TEMPORARY TABLE tasks (
                    id INTEGER PRIMARY KEY,
                    source_task_id BIGINT UNIQUE,
                    source_goal_id BIGINT,
                    goal_id INTEGER,
                    source_recurring_rule_id BIGINT,
                    recurrence_occurrence_date DATE,
                    title TEXT NOT NULL,
                    completed BOOLEAN NOT NULL DEFAULT false,

                    CONSTRAINT ck_tasks_recurring_source_pair
                    CHECK (
                        (
                            source_recurring_rule_id IS NULL
                            AND recurrence_occurrence_date IS NULL
                        )
                        OR
                        (
                            source_recurring_rule_id IS NOT NULL
                            AND recurrence_occurrence_date IS NOT NULL
                        )
                    ),

                    CONSTRAINT uq_tasks_source_recurring_occurrence
                    UNIQUE (
                        source_recurring_rule_id,
                        recurrence_occurrence_date
                    )
                ) ON COMMIT DROP
            """))

            # Verify that both names resolve to our temporary tables.
            # The migration must not operate on WeekFlow's real tables.
            for table_name in ("tasks", "recurring_rules"):
                is_temporary = connection.scalar(
                    text("""
                        SELECT relnamespace = pg_my_temp_schema()
                        FROM pg_class
                        WHERE oid = to_regclass(:table_name)
                    """),
                    {"table_name": table_name},
                )

                assert is_temporary is True

            connection.execute(text("""
                INSERT INTO recurring_rules (
                    id,
                    source_recurring_rule_id
                )
                VALUES
                    (101, 1900000000001),
                    (202, NULL)
            """))

            connection.execute(text("""
                INSERT INTO tasks (
                    id,
                    source_task_id,
                    goal_id,
                    source_goal_id,
                    source_recurring_rule_id,
                    recurrence_occurrence_date,
                    title,
                    completed
                )
                VALUES
                    (
                        11, 1900000000101, 7, 1900000000201,
                        1900000000001, '2026-10-09',
                        'Old history', true
                    ),
                    (
                        12, 1900000000102, 8, 1900000000202,
                        1900000000999, '2026-10-09',
                        'Unmapped schedule', false
                    ),
                    (
                        13, 1900000000103, NULL, NULL,
                        NULL, NULL,
                        'Ordinary task', false
                    )
            """))

            monkeypatch.setattr(
                migration,
                "op",
                Operations(
                    MigrationContext.configure(connection)
                ),
            )

            before = connection.execute(
                text("SELECT * FROM tasks ORDER BY id")
            ).mappings().all()

            migration.upgrade()

            yield connection, migration, before

        finally:
            transaction.rollback()


def test_model_native_rule_fk_and_duplicate_protection():
    """The Python model declares the expected relationship."""

    column = Task.__table__.c.recurring_rule_id

    assert column.nullable is True

    foreign_key = next(iter(column.foreign_keys))

    assert foreign_key.target_fullname == "recurring_rules.id"
    assert foreign_key.ondelete == "RESTRICT"

    constraint = next(
        constraint
        for constraint in Task.__table__.constraints
        if constraint.name == "uq_tasks_recurring_occurrence"
    )

    assert list(constraint.columns.keys()) == [
        "recurring_rule_id",
        "recurrence_occurrence_date",
    ]


def test_backfill_preserves_existing_data_and_individual_goal(
    recurring_migration,
):
    """Map the schedule without changing IDs, goals, or history."""

    connection, _, before = recurring_migration

    after = connection.execute(
        text("SELECT * FROM tasks ORDER BY id")
    ).mappings().all()

    assert [
        row["recurring_rule_id"]
        for row in after
    ] == [101, None, None]

    original_columns_after = [
        {
            key: value
            for key, value in row.items()
            if key != "recurring_rule_id"
        }
        for row in after
    ]

    assert original_columns_after == [
        dict(row)
        for row in before
    ]


def test_native_occurrence_accepts_no_source_id(
    recurring_migration,
):
    """New PostgreSQL occurrences do not need SQLite source IDs."""

    connection, _, _ = recurring_migration

    connection.execute(text("""
        INSERT INTO tasks (
            id,
            title,
            recurring_rule_id,
            recurrence_occurrence_date
        )
        VALUES (
            14,
            'Native',
            202,
            '2026-10-10'
        )
    """))

    row = connection.execute(
        text("SELECT * FROM tasks WHERE id = 14")
    ).mappings().one()

    assert row["recurring_rule_id"] == 202
    assert row["source_recurring_rule_id"] is None


@pytest.mark.parametrize(
    "rule_id, occurrence_date",
    [
        (202, None),
        (None, "2026-10-10"),
        (999, "2026-10-10"),
        (101, "2026-10-09"),
    ],
    ids=[
        "missing-date",
        "missing-rule",
        "missing-parent",
        "duplicate-occurrence",
    ],
)
def test_invalid_native_recurrence_rejected_atomically(
    recurring_migration,
    rule_id,
    occurrence_date,
):
    """Reject invalid relationships without saving the failed task."""

    connection, _, _ = recurring_migration

    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            connection.execute(
                text("""
                    INSERT INTO tasks (
                        id,
                        title,
                        recurring_rule_id,
                        recurrence_occurrence_date
                    )
                    VALUES (
                        14,
                        'Invalid occurrence',
                        :rule_id,
                        CAST(:occurrence_date AS DATE)
                    )
                """),
                {
                    "rule_id": rule_id,
                    "occurrence_date": occurrence_date,
                },
            )

    assert connection.scalar(
        text("SELECT count(*) FROM tasks")
    ) == 3


def test_schedule_delete_requires_explicit_detach(
    recurring_migration,
):
    """Retained tasks must be detached before deleting their schedule."""

    connection, _, _ = recurring_migration

    with pytest.raises(IntegrityError):
        with connection.begin_nested():
            connection.execute(
                text("DELETE FROM recurring_rules WHERE id = 101")
            )

    connection.execute(text("""
        UPDATE tasks
        SET
            recurring_rule_id = NULL,
            source_recurring_rule_id = NULL,
            recurrence_occurrence_date = NULL
        WHERE recurring_rule_id = 101
    """))

    connection.execute(
        text("DELETE FROM recurring_rules WHERE id = 101")
    )

    assert connection.scalar(
        text("SELECT completed FROM tasks WHERE id = 11")
    ) is True

    assert connection.scalar(
        text("SELECT goal_id FROM tasks WHERE id = 11")
    ) == 7


def test_downgrade_preserves_imported_payloads(
    recurring_migration,
):
    """Reversing the migration preserves the original imported data."""

    connection, migration, before = recurring_migration

    migration.downgrade()

    after = connection.execute(
        text("SELECT * FROM tasks ORDER BY id")
    ).mappings().all()

    assert [
        dict(row)
        for row in after
    ] == [
        dict(row)
        for row in before
    ]


def test_downgrade_refuses_to_erase_native_occurrence_identity(
    recurring_migration,
):
    """Block a downgrade when the old schema cannot preserve identity."""

    connection, migration, _ = recurring_migration

    connection.execute(text("""
        INSERT INTO tasks (
            id,
            title,
            recurring_rule_id,
            recurrence_occurrence_date
        )
        VALUES (
            14,
            'Native',
            202,
            '2026-10-10'
        )
    """))

    with pytest.raises(
        DBAPIError,
        match="native-only recurring occurrences",
    ):
        with connection.begin_nested():
            migration.downgrade()

    assert connection.scalar(
        text("SELECT recurring_rule_id FROM tasks WHERE id = 14")
    ) == 202