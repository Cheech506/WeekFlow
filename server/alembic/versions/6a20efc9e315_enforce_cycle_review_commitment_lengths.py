"""enforce cycle review commitment lengths

Revision ID: 6a20efc9e315
Revises: e54d9f8864bc
Create Date: 2026-09-22 18:37:40.041525

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "6a20efc9e315"
down_revision: Union[str, Sequence[str], None] = "e54d9f8864bc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Store commitments as text and validate each element."""

    op.drop_constraint(
        "ck_cycle_reviews_first_commitments_shape",
        "cycle_reviews",
        type_="check",
    )

    op.execute(
        """
        ALTER TABLE cycle_reviews
        ALTER COLUMN next_cycle_first_commitments
        DROP DEFAULT
        """
    )

    op.alter_column(
        "cycle_reviews",
        "next_cycle_first_commitments",
        existing_type=postgresql.ARRAY(
            sa.String(length=180)
        ),
        type_=postgresql.ARRAY(sa.Text()),
        existing_nullable=False,
        postgresql_using=(
            "next_cycle_first_commitments::text[]"
        ),
    )

    op.execute(
        """
        ALTER TABLE cycle_reviews
        ALTER COLUMN next_cycle_first_commitments
        SET DEFAULT '{}'::text[]
        """
    )

    op.create_check_constraint(
        "ck_cycle_reviews_first_commitments_shape",
        "cycle_reviews",
        """
        cardinality(next_cycle_first_commitments) <= 5
        AND (
            cardinality(next_cycle_first_commitments) = 0
            OR array_ndims(next_cycle_first_commitments) = 1
        )
        AND array_position(
            next_cycle_first_commitments,
            NULL
        ) IS NULL
        AND coalesce(
            char_length(
                next_cycle_first_commitments[
                    array_lower(next_cycle_first_commitments, 1)
                ]
            ),
            0
        ) <= 180
        AND coalesce(
            char_length(
                next_cycle_first_commitments[
                    array_lower(next_cycle_first_commitments, 1) + 1
                ]
            ),
            0
        ) <= 180
        AND coalesce(
            char_length(
                next_cycle_first_commitments[
                    array_lower(next_cycle_first_commitments, 1) + 2
                ]
            ),
            0
        ) <= 180
        AND coalesce(
            char_length(
                next_cycle_first_commitments[
                    array_lower(next_cycle_first_commitments, 1) + 3
                ]
            ),
            0
        ) <= 180
        AND coalesce(
            char_length(
                next_cycle_first_commitments[
                    array_lower(next_cycle_first_commitments, 1) + 4
                ]
            ),
            0
        ) <= 180
        """,
    )


def downgrade() -> None:
    """Restore the previous bounded string array."""

    op.drop_constraint(
        "ck_cycle_reviews_first_commitments_shape",
        "cycle_reviews",
        type_="check",
    )

    op.execute(
        """
        ALTER TABLE cycle_reviews
        ALTER COLUMN next_cycle_first_commitments
        DROP DEFAULT
        """
    )

    op.alter_column(
        "cycle_reviews",
        "next_cycle_first_commitments",
        existing_type=postgresql.ARRAY(sa.Text()),
        type_=postgresql.ARRAY(
            sa.String(length=180)
        ),
        existing_nullable=False,
        postgresql_using=(
            "next_cycle_first_commitments::varchar(180)[]"
        ),
    )

    op.execute(
        """
        ALTER TABLE cycle_reviews
        ALTER COLUMN next_cycle_first_commitments
        SET DEFAULT '{}'::varchar(180)[]
        """
    )

    op.create_check_constraint(
        "ck_cycle_reviews_first_commitments_shape",
        "cycle_reviews",
        """
        cardinality(next_cycle_first_commitments) <= 5
        AND array_position(
            next_cycle_first_commitments,
            NULL
        ) IS NULL
        """,
    )