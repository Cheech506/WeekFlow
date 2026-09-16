"""add task migration source fields

Revision ID: 68c2642f766e
Revises: 1f2fcccb7506
Create Date: 2026-09-16 10:38:02.580294

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# Revision identifiers used by Alembic.
revision: str = "68c2642f766e"
down_revision: Union[str, Sequence[str], None] = "1f2fcccb7506"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add fields that preserve SQLite task migration information."""

    op.add_column(
        "tasks",
        sa.Column(
            "source_task_id",
            sa.BigInteger(),
            nullable=True,
        ),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "source_goal_id",
            sa.BigInteger(),
            nullable=True,
        ),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "source_recurring_rule_id",
            sa.BigInteger(),
            nullable=True,
        ),
    )
    op.add_column(
        "tasks",
        sa.Column(
            "recurrence_occurrence_date",
            sa.Date(),
            nullable=True,
        ),
    )

    # A SQLite task may be imported only once.
    op.create_unique_constraint(
        "uq_tasks_source_task_id",
        "tasks",
        ["source_task_id"],
    )

    # A recurring occurrence needs both pieces of its source identity.
    # Ordinary tasks have both values set to NULL.
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


def downgrade() -> None:
    """Remove the SQLite migration fields."""

    # Constraints must be removed before their columns.
    op.drop_constraint(
        "ck_tasks_recurring_source_pair",
        "tasks",
        type_="check",
    )
    op.drop_constraint(
        "uq_tasks_source_task_id",
        "tasks",
        type_="unique",
    )

    op.drop_column(
        "tasks",
        "recurrence_occurrence_date",
    )
    op.drop_column(
        "tasks",
        "source_recurring_rule_id",
    )
    op.drop_column(
        "tasks",
        "source_goal_id",
    )
    op.drop_column(
        "tasks",
        "source_task_id",
    )