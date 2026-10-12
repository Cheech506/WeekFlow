"""Add native task/schedule links while preserving SQLite identities.

Revision ID: c63f9a10b742
Revises: 84c7a620e519
"""

from alembic import op
import sqlalchemy as sa


revision = "c63f9a10b742"
down_revision = "84c7a620e519"
branch_labels = None
depends_on = None


PAIR_CHECK = """
(
    recurring_rule_id IS NULL
    AND source_recurring_rule_id IS NULL
    AND recurrence_occurrence_date IS NULL
)
OR
(
    (
        recurring_rule_id IS NOT NULL
        OR source_recurring_rule_id IS NOT NULL
    )
    AND recurrence_occurrence_date IS NOT NULL
)
"""


def upgrade() -> None:
    """Add the relationship and reconnect existing occurrences."""

    op.add_column(
        "tasks",
        sa.Column(
            "recurring_rule_id",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.create_foreign_key(
        "fk_tasks_recurring_rule_id_recurring_rules",
        "tasks",
        "recurring_rules",
        ["recurring_rule_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Allow either imported or native recurrence identities.
    op.drop_constraint(
        "ck_tasks_recurring_source_pair",
        "tasks",
        type_="check",
    )

    op.create_check_constraint(
        "ck_tasks_recurring_source_pair",
        "tasks",
        PAIR_CHECK,
    )

    # Each schedule/date combination can generate only one task.
    op.create_unique_constraint(
        "uq_tasks_recurring_occurrence",
        "tasks",
        [
            "recurring_rule_id",
            "recurrence_occurrence_date",
        ],
    )

    # Match the preserved SQLite schedule ID to its PostgreSQL ID.
    # Each task keeps its own existing goal relationship.
    op.execute(
        sa.text("""
            UPDATE tasks AS task
            SET recurring_rule_id = rule.id
            FROM recurring_rules AS rule
            WHERE
                task.source_recurring_rule_id =
                    rule.source_recurring_rule_id
                AND task.recurring_rule_id IS NULL
        """)
    )


def downgrade() -> None:
    """Reverse this revision when the old schema can preserve the data."""

    # The old schema cannot represent native-only occurrences.
    # Refuse to erase their recurrence identity.
    op.execute(
        sa.text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM tasks
                    WHERE
                        recurring_rule_id IS NOT NULL
                        AND source_recurring_rule_id IS NULL
                ) THEN
                    RAISE EXCEPTION
                        'Cannot downgrade: native-only recurring occurrences would lose their identity';
                END IF;
            END;
            $$
        """)
    )

    op.drop_constraint(
        "uq_tasks_recurring_occurrence",
        "tasks",
        type_="unique",
    )

    op.drop_constraint(
        "ck_tasks_recurring_source_pair",
        "tasks",
        type_="check",
    )

    op.create_check_constraint(
        "ck_tasks_recurring_source_pair",
        "tasks",
        """
        (
            source_recurring_rule_id IS NULL
            AND recurrence_occurrence_date IS NULL
        )
        OR
        (
            source_recurring_rule_id IS NOT NULL
            AND recurrence_occurrence_date IS NOT NULL
        )
        """,
    )

    op.drop_constraint(
        "fk_tasks_recurring_rule_id_recurring_rules",
        "tasks",
        type_="foreignkey",
    )

    op.drop_column(
        "tasks",
        "recurring_rule_id",
    )