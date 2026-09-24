"""Shared types and helpers for WeekFlow backup validation."""

from datetime import date
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
)


# JavaScript can represent integers exactly through this value.
MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991


SourceId = Annotated[
    StrictInt,
    Field(
        gt=0,
        le=MAX_JS_SAFE_INTEGER,
    ),
]

NonNegativeInt = Annotated[
    StrictInt,
    Field(
        ge=0,
        le=MAX_JS_SAFE_INTEGER,
    ),
]

Priority = Annotated[
    StrictInt,
    Field(
        ge=0,
        le=2,
    ),
]

WeekdayIndex = Annotated[
    StrictInt,
    Field(
        ge=0,
        le=6,
    ),
]

Percentage = Annotated[
    StrictInt,
    Field(
        ge=0,
        le=100,
    ),
]

CycleWeekNumber = Annotated[
    StrictInt,
    Field(
        ge=1,
        le=12,
    ),
]

BackupBoolean = StrictBool


def parse_backup_date(value: object) -> date:
    """Parse exactly one YYYY-MM-DD backup date."""

    if not isinstance(value, str):
        raise ValueError(
            "backup dates must be YYYY-MM-DD strings"
        )

    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(
            "backup dates must be valid YYYY-MM-DD strings"
        ) from error

    if value != parsed.isoformat():
        raise ValueError(
            "backup dates must use exactly YYYY-MM-DD"
        )

    return parsed


def require_timestamp_string(value: object) -> object:
    """Require an ISO timestamp string before parsing it."""

    if not isinstance(value, str) or "T" not in value:
        raise ValueError(
            "backup timestamps must be ISO strings"
        )

    return value


BackupDate = Annotated[
    date,
    BeforeValidator(parse_backup_date),
]

BackupTimestamp = Annotated[
    AwareDatetime,
    BeforeValidator(require_timestamp_string),
]


RecurrenceFrequency = Literal[
    "daily",
    "weekly",
    "everyTwoWeeks",
    "certainDays",
    "monthly",
]

WeeklyTaskDecisionAction = Literal[
    "nextWeek",
    "inbox",
    "reschedule",
    "keep",
    "delete",
]

CycleGoalOutcomeAction = Literal[
    "complete",
    "carryForward",
    "archive",
    "replace",
]

WeekdayName = Literal[
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


class BackupSchema(BaseModel):
    """Base behavior shared by all backup schemas."""

    model_config = ConfigDict(
        extra="forbid",
    )


def require_visible_text(
    value: str,
    label: str,
    max_length: int | None = None,
) -> str:
    """Require text containing at least one visible character."""

    if not value.strip():
        raise ValueError(f"{label} cannot be blank")

    if max_length is not None and len(value) > max_length:
        raise ValueError(
            f"{label} cannot exceed {max_length} characters"
        )

    return value


def completion_pair_matches(
    completed: bool,
    completed_at: object | None,
) -> bool:
    """Return whether status and completion timestamp agree."""

    return completed == (completed_at is not None)
