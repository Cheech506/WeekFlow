"""Validation schemas for Brain Dump notes and their archive state."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BrainDumpCreate(BaseModel):
    """Create an active note; the server supplies identity and timestamps."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    # The app and PostgreSQL use unrestricted text, so do not invent a
    # short maximum that could prevent an existing note from being saved.
    body: str = Field(min_length=1, strict=True)


class BrainDumpUpdate(BaseModel):
    """Edit note text, archive it, or restore it through a partial update.

    Omitted fields retain their values. Explicit null cannot erase required
    text or archive state. The router manages archived_at and must preserve
    the original timestamp when an archive request is repeated.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    body: str | None = Field(default=None, min_length=1, strict=True)
    archived: bool | None = Field(default=None, strict=True)

    @field_validator("body")
    @classmethod
    def reject_null_body(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("body cannot be null")
        return value

    @field_validator("archived")
    @classmethod
    def reject_null_archive_state(cls, value: bool | None) -> bool:
        if value is None:
            raise ValueError("archived cannot be null")
        return value


class BrainDumpRead(BaseModel):
    """Return a note with its generated identity and archive history."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_brain_dump_id: int | None
    body: str
    archived: bool
    created_at: datetime
    archived_at: datetime | None
