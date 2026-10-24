"""Add durable task-sync identity and upload tracking.

Revision ID: f4d8b2c913a7
Revises: c63f9a10b742
"""

from uuid import uuid4

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "f4d8b2c913a7"
down_revision = "c63f9a10b742"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create sync tracking tables and seed one persistent database identity."""

    identity_table = op.create_table(
        "sync_server_identity",
        sa.Column(
            "id",
            sa.SmallInteger(),
            server_default="1",
            autoincrement=False,
            nullable=False,
        ),
        sa.Column("instance_key", sa.String(32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "id = 1",
            name="ck_sync_server_identity_singleton",
        ),
        sa.CheckConstraint(
            "instance_key ~ '^[0-9a-f]{32}$'",
            name="ck_sync_server_identity_key_format",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "instance_key",
            name="uq_sync_server_identity_instance_key",
        ),
    )

    op.create_table(
        "task_sync_client_tasks",
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("client_task_key", sa.String(32), nullable=False),
        # An audit ID remains valid as history after the task is deleted.
        sa.Column("server_task_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(btrim(owner_key)) > 0",
            name="ck_task_sync_client_tasks_owner_not_blank",
        ),
        sa.CheckConstraint(
            "client_task_key ~ '^[0-9a-f]{32}$'",
            name="ck_task_sync_client_tasks_key_format",
        ),
        sa.CheckConstraint(
            "server_task_id > 0",
            name="ck_task_sync_client_tasks_task_id_positive",
        ),
        sa.PrimaryKeyConstraint("owner_key", "client_task_key"),
    )

    op.create_table(
        "task_sync_receipts",
        sa.Column("owner_key", sa.String(128), nullable=False),
        sa.Column("operation_key", sa.String(32), nullable=False),
        sa.Column("client_task_key", sa.String(32), nullable=False),
        sa.Column("action", sa.String(6), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(btrim(owner_key)) > 0",
            name="ck_task_sync_receipts_owner_not_blank",
        ),
        sa.CheckConstraint(
            "operation_key ~ '^[0-9a-f]{32}$'",
            name="ck_task_sync_receipts_operation_key_format",
        ),
        sa.CheckConstraint(
            "action IN ('create', 'update', 'delete')",
            name="ck_task_sync_receipts_action",
        ),
        sa.CheckConstraint(
            "request_hash ~ '^[0-9a-f]{64}$'",
            name="ck_task_sync_receipts_request_hash_format",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(response_json) = 'object'",
            name="ck_task_sync_receipts_response_object",
        ),
        sa.ForeignKeyConstraint(
            ["owner_key", "client_task_key"],
            [
                "task_sync_client_tasks.owner_key",
                "task_sync_client_tasks.client_task_key",
            ],
            name="fk_task_sync_receipts_client_task",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("owner_key", "operation_key"),
    )

    # Generated when this migration runs, once per database. It does not
    # change on API restarts, and needs no PostgreSQL UUID extension.
    op.bulk_insert(
        identity_table,
        [{"id": 1, "instance_key": uuid4().hex}],
    )


def downgrade() -> None:
    """Remove unused tracking tables without erasing upload history."""

    op.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM task_sync_client_tasks)
                OR EXISTS (SELECT 1 FROM task_sync_receipts)
            THEN
                RAISE EXCEPTION
                    'Cannot downgrade: task sync identity mappings or upload receipts would be lost';
            END IF;
        END;
        $$
    """))

    op.drop_table("task_sync_receipts")
    op.drop_table("task_sync_client_tasks")
    op.drop_table("sync_server_identity")
