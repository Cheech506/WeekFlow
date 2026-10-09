"""Add the PostgreSQL task-to-goal relationship and map imported tasks.

Revision ID: 84c7a620e519
Revises: 2fd043b83410
"""

from alembic import op
import sqlalchemy as sa

revision = "84c7a620e519"
down_revision = "2fd043b83410"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add a nullable relationship without changing existing identities."""
    op.add_column("tasks", sa.Column("goal_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_tasks_goal_id_goals",
        "tasks",
        "goals",
        ["goal_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tasks_goal_id", "tasks", ["goal_id"])

    # SQLite source IDs identify the matching goal. Store that goal's
    # PostgreSQL ID as the relationship; leave every source ID intact.
    op.execute(sa.text("""
        UPDATE tasks AS task
        SET goal_id = goal.id
        FROM goals AS goal
        WHERE task.source_goal_id = goal.source_goal_id
          AND task.goal_id IS NULL
    """))


def downgrade() -> None:
    """Remove the relationship column while retaining original task data."""
    op.drop_index("ix_tasks_goal_id", table_name="tasks")
    op.drop_constraint("fk_tasks_goal_id_goals", "tasks", type_="foreignkey")
    op.drop_column("tasks", "goal_id")
