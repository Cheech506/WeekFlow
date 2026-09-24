"""SQLAlchemy model for a reusable WeekFlow task template."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaskTemplate(Base):
    """A reusable task setup stored in PostgreSQL."""

    __tablename__ = "task_templates"

    __table_args__ = (
        UniqueConstraint(
            "source_task_template_id",
            name="uq_task_templates_source_task_template_id",
        ),
        CheckConstraint(
            """
            source_task_template_id IS NULL
            OR source_task_template_id > 0
            """,
            name="ck_task_templates_source_id_positive",
        ),
        CheckConstraint(
            "btrim(title) <> ''",
            name="ck_task_templates_title_not_blank",
        ),
        CheckConstraint(
            "priority BETWEEN 0 AND 2",
            name="ck_task_templates_priority_range",
        ),
        Index(
            "ix_task_templates_goal_id",
            "goal_id",
        ),
        Index(
            "ix_task_templates_updated_at",
            "updated_at",
        ),
    )

    # PostgreSQL creates its own internal ID.
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    # Preserve the original SQLite template ID.
    source_task_template_id: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

    # This stores the PostgreSQL Goal ID.
    goal_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "goals.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    priority: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=0,
        server_default="0",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )