"""Create shared login-attempt counters.

Revision ID: d7a4c92e6b13
Revises: c91f2e6a4b70
"""

from alembic import op
import sqlalchemy as sa


revision = "d7a4c92e6b13"
down_revision = "c91f2e6a4b70"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create empty counter storage; login limits are enforced by the service."""
    op.create_table(
        "auth_login_throttles",
        sa.Column(
            "bucket_key", sa.String(67), autoincrement=False, nullable=False,
        ),
        sa.Column(
            "window_started_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("window_ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "attempt_count", sa.Integer(), server_default="0", nullable=False,
        ),
        sa.CheckConstraint(
            "bucket_key = 'instance' OR bucket_key ~ '^ip:[0-9a-f]{64}$'",
            name="ck_auth_login_throttles_bucket_format",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="ck_auth_login_throttles_count_nonnegative",
        ),
        sa.CheckConstraint(
            "window_ends_at > window_started_at",
            name="ck_auth_login_throttles_window_order",
        ),
        sa.PrimaryKeyConstraint("bucket_key"),
    )
    op.create_index(
        "ix_auth_login_throttles_window_ends_at",
        "auth_login_throttles",
        ["window_ends_at"],
    )


def downgrade() -> None:
    """Refuse to discard counters that may be enforcing login restrictions."""
    # Hold this lock until the migration transaction ends. No worker can add
    # a counter between the emptiness check and removal of the table.
    op.execute(sa.text("LOCK TABLE auth_login_throttles IN ACCESS EXCLUSIVE MODE"))
    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM auth_login_throttles)
            THEN
                RAISE EXCEPTION
                    'Cannot downgrade: login throttle state would be lost';
            END IF;
        END;
        $$
    """))
    op.drop_index(
        "ix_auth_login_throttles_window_ends_at",
        table_name="auth_login_throttles",
    )
    op.drop_table("auth_login_throttles")
