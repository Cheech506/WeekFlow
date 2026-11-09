"""Create persistent first-run owner setup code state.

Revision ID: c91f2e6a4b70
Revises: a8e24d7b931c
"""

from alembic import op
import sqlalchemy as sa


revision = "c91f2e6a4b70"
down_revision = "a8e24d7b931c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create empty setup-code storage without issuing a credential."""

    op.create_table(
        "owner_setup_codes",
        sa.Column(
            "id",
            sa.SmallInteger(),
            server_default="1",
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "failed_attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "id = 1",
            name="ck_owner_setup_codes_singleton",
        ),
        sa.CheckConstraint(
            "code_hash ~ '^[0-9a-f]{64}$'",
            name="ck_owner_setup_codes_hash_format",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_owner_setup_codes_expiration_after_creation",
        ),
        sa.CheckConstraint(
            "consumed_at IS NULL OR consumed_at >= created_at",
            name="ck_owner_setup_codes_consumption_after_creation",
        ),
        sa.CheckConstraint(
            "failed_attempts >= 0",
            name="ck_owner_setup_codes_attempts_nonnegative",
        ),
        sa.CheckConstraint(
            "blocked_until IS NULL OR blocked_until >= created_at",
            name="ck_owner_setup_codes_block_after_creation",
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Remove unused storage without discarding issued-code security state."""

    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM owner_setup_codes)
            THEN
                RAISE EXCEPTION
                    'Cannot downgrade: owner setup code state would be lost';
            END IF;
        END;
        $$
    """))

    op.drop_table("owner_setup_codes")
