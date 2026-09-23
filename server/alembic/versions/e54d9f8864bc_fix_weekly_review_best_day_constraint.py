"""fix weekly review best day constraint

Revision ID: e54d9f8864bc
Revises: bb4c84a73202
Create Date: 2026-09-22 14:13:05.208561

"""
from typing import Sequence, Union

from alembic import op


revision: str = "e54d9f8864bc"
down_revision: Union[str, Sequence[str], None] = "bb4c84a73202"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Require a best-day name when its count is positive."""

    op.drop_constraint(
        "ck_weekly_reviews_best_day_consistent",
        "weekly_reviews",
        type_="check",
    )

    op.create_check_constraint(
        "ck_weekly_reviews_best_day_consistent",
        "weekly_reviews",
        """
        (
            snapshot_best_day IS NULL
            AND snapshot_best_day_count = 0
        )
        OR
        (
            snapshot_best_day IS NOT NULL
            AND snapshot_best_day IN (
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
                'Sunday'
            )
            AND snapshot_best_day_count > 0
        )
        """,
    )


def downgrade() -> None:
    """Restore the previous best-day constraint."""

    op.drop_constraint(
        "ck_weekly_reviews_best_day_consistent",
        "weekly_reviews",
        type_="check",
    )

    op.create_check_constraint(
        "ck_weekly_reviews_best_day_consistent",
        "weekly_reviews",
        """
        (
            snapshot_best_day IS NULL
            AND snapshot_best_day_count = 0
        )
        OR
        (
            snapshot_best_day IN (
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
                'Sunday'
            )
            AND snapshot_best_day_count > 0
        )
        """,
    )