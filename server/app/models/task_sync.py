"""Database identity and durable receipts for safe task-sync retries."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def new_server_instance_key() -> str:
    """Generate a database identity once, not on each API startup."""

    return uuid4().hex


class SyncServerIdentity(Base):
    """One persistent identity for the PostgreSQL database behind the API."""

    __tablename__ = "sync_server_identity"

    __table_args__ = (
        CheckConstraint(
            "id = 1",
            name="ck_sync_server_identity_singleton",
        ),
        CheckConstraint(
            "instance_key ~ '^[0-9a-f]{32}$'",
            name="ck_sync_server_identity_key_format",
        ),
        UniqueConstraint(
            "instance_key",
            name="uq_sync_server_identity_instance_key",
        ),
    )

    # A singleton row: a second identity must not appear alongside the first.
    id: Mapped[int] = mapped_column(
        SmallInteger,
        primary_key=True,
        autoincrement=False,
        default=1,
        server_default="1",
    )

    # This identifies the database, not a task, device, or running process.
    instance_key: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=new_server_instance_key,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class TaskSyncClientTask(Base):
    """Remember which PostgreSQL task belongs to a client's stable task key."""

    __tablename__ = "task_sync_client_tasks"

    __table_args__ = (
        CheckConstraint(
            "char_length(btrim(owner_key)) > 0",
            name="ck_task_sync_client_tasks_owner_not_blank",
        ),
        CheckConstraint(
            "client_task_key ~ '^[0-9a-f]{32}$'",
            name="ck_task_sync_client_tasks_key_format",
        ),
        CheckConstraint(
            "server_task_id > 0",
            name="ck_task_sync_client_tasks_task_id_positive",
        ),
    )

    # The API will select the owner. A body field is not authentication.
    # The current single-owner app will use the literal "single-owner".
    owner_key: Mapped[str] = mapped_column(
        String(128),
        primary_key=True,
    )

    client_task_key: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
    )

    # Deliberately an audit value, not a cascading foreign key to tasks.
    # Keep this mapping after task deletion: retrying an old create must
    # never resurrect that task or generate another PostgreSQL ID.
    server_task_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class TaskSyncReceipt(Base):
    """A successful upload result, committed atomically with its task change."""

    __tablename__ = "task_sync_receipts"

    __table_args__ = (
        ForeignKeyConstraint(
            ["owner_key", "client_task_key"],
            [
                "task_sync_client_tasks.owner_key",
                "task_sync_client_tasks.client_task_key",
            ],
            name="fk_task_sync_receipts_client_task",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "char_length(btrim(owner_key)) > 0",
            name="ck_task_sync_receipts_owner_not_blank",
        ),
        CheckConstraint(
            "operation_key ~ '^[0-9a-f]{32}$'",
            name="ck_task_sync_receipts_operation_key_format",
        ),
        CheckConstraint(
            "action IN ('create', 'update', 'delete')",
            name="ck_task_sync_receipts_action",
        ),
        CheckConstraint(
            "request_hash ~ '^[0-9a-f]{64}$'",
            name="ck_task_sync_receipts_request_hash_format",
        ),
        CheckConstraint(
            "jsonb_typeof(response_json) = 'object'",
            name="ck_task_sync_receipts_response_object",
        ),
    )

    owner_key: Mapped[str] = mapped_column(
        String(128),
        primary_key=True,
    )

    # One key identifies one exact upload. Retrying it returns its receipt;
    # changing the request under the same key will be rejected by the service.
    operation_key: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
    )

    client_task_key: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    action: Mapped[str] = mapped_column(
        String(6),
        nullable=False,
    )

    # SHA-256 of a canonical validated request, including its baseline.
    request_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    # Preserve the original successful response even if the task is later
    # edited or deleted. A replay must not apply that old write again.
    response_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
