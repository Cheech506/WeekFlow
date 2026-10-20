"""Validation schemas for reusable, one-time task templates."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator


PostgresId = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
Priority = Annotated[int, Field(strict=True, ge=0, le=2)]


class TaskTemplateCreate(BaseModel):
    """Save reusable task details without creating a task or schedule."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str = Field(min_length=1, strict=True)
    notes: str | None = Field(default=None, strict=True)
    priority: Priority = 0
    goal_id: PostgresId | None = None

    @field_validator("notes")
    @classmethod
    def blank_notes_to_none(cls, value: str | None) -> str | None:
        return value or None


class TaskTemplateUpdate(BaseModel):
    """Edit supplied fields while preserving identity and creation time.

    Omitted fields retain their values. Explicit null clears notes or the
    goal link, but cannot erase the required title or priority. Templates
    contain no completion state, due date, or recurring schedule identity.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str | None = Field(default=None, min_length=1, strict=True)
    notes: str | None = Field(default=None, strict=True)
    priority: Priority | None = None
    goal_id: PostgresId | None = None

    @field_validator("title")
    @classmethod
    def reject_null_title(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("title cannot be null")
        return value

    @field_validator("priority")
    @classmethod
    def reject_null_priority(cls, value: int | None) -> int:
        if value is None:
            raise ValueError("priority cannot be null")
        return value

    @field_validator("notes")
    @classmethod
    def blank_notes_to_none(cls, value: str | None) -> str | None:
        return value or None


class TaskTemplateRead(BaseModel):
    """Return saved template details, native links, and migration identity."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_task_template_id: int | None
    goal_id: int | None
    title: str
    notes: str | None
    priority: int
    created_at: datetime
    updated_at: datetime
