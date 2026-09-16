"""Tests for task request validation."""

from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from app.schemas import TaskCreate, TaskRead, TaskUpdate


def test_task_create_cleans_input_and_applies_defaults():
    """Trim incoming text and provide defaults for omitted fields."""

    task = TaskCreate(
        title="  Finish physics homework  ",
    )

    assert task.title == "Finish physics homework"
    assert task.due_date is None
    assert task.notes is None
    assert task.priority == 0


def test_task_create_parses_an_api_date():
    """Convert a JSON date string into a Python date object."""

    task = TaskCreate.model_validate(
        {
            "title": "Finish physics homework",
            "due_date": "2026-09-10",
        }
    )

    assert task.due_date == date(2026, 9, 10)


def test_task_create_rejects_invalid_input():
    """Reject a blank title and unsupported priority."""

    # This error is expected. The test fails if validation accepts this data.
    with pytest.raises(ValidationError) as error_info:
        TaskCreate(
            title="   ",
            priority=5,
        )

    # Pydantic returns details about every invalid field.
    invalid_fields = {
        error["loc"][0]
        for error in error_info.value.errors()
    }

    assert invalid_fields == {
        "title",
        "priority",
    }

def test_task_update_keeps_only_supplied_fields():
    """Include only fields that the client actually wants to change."""

    update = TaskUpdate(
        priority=2,
    )

    # exclude_unset removes fields that were not included in the request.
    changes = update.model_dump(
        exclude_unset=True,
    )

    assert changes == {
        "priority": 2,
    }


def test_task_update_allows_nullable_fields_to_be_cleared():
    """Keep explicit null values when the client wants to clear a field."""

    update = TaskUpdate(
        due_date=None,
        notes=None,
    )

    changes = update.model_dump(
        exclude_unset=True,
    )

    # These values remain in the dictionary because the client
    # explicitly supplied them, even though their values are None.
    assert changes == {
        "due_date": None,
        "notes": None,
    }


@pytest.mark.parametrize(
    "field_name",
    [
        "title",
        "priority",
        "completed",
    ],
)
def test_task_update_rejects_null_for_required_database_fields(
    field_name: str,
):
    """Do not allow required PostgreSQL values to be erased."""

    with pytest.raises(ValidationError):
        TaskUpdate.model_validate(
            {
                field_name: None,
            }
        )

def test_task_create_rejects_unknown_fields():
    """Catch misspelled creation fields instead of silently ignoring them."""

    with pytest.raises(ValidationError) as error_info:
        TaskCreate.model_validate(
            {
                "title": "Finish homework",
                # This is intentionally misspelled.
                "priorty": 2,
            }
        )

    error = error_info.value.errors()[0]

    assert error["loc"] == ("priorty",)
    assert error["type"] == "extra_forbidden"


def test_task_update_rejects_unknown_fields():
    """Catch misspelled update fields before they reach the route."""

    with pytest.raises(ValidationError) as error_info:
        TaskUpdate.model_validate(
            {
                # The real field is named completed.
                "complete": True,
            }
        )

    error = error_info.value.errors()[0]

    assert error["loc"] == ("complete",)
    assert error["type"] == "extra_forbidden"

def test_task_read_preserves_sqlite_migration_metadata():
    """Preserve the original SQLite identity and relationship values."""

    created_at = datetime(
        2026,
        6,
        11,
        18,
        58,
        40,
        tzinfo=UTC,
    )
    completed_at = datetime(
        2026,
        9,
        16,
        14,
        30,
        tzinfo=UTC,
    )

    task = TaskRead.model_validate(
        {
            # This is the new PostgreSQL ID.
            "id": 7,
            "title": "Imported recurring task",
            "day": "Wednesday",
            "due_date": "2026-09-16",
            "notes": None,
            "priority": 1,
            "completed": True,
            "created_at": created_at,
            "completed_at": completed_at,

            # These values preserve the original SQLite relationships.
            "source_task_id": 1_781_204_320_207,
            "source_goal_id": 1_782_503_210_780,
            "source_recurring_rule_id": 1_781_999_999_999,
            "recurrence_occurrence_date": "2026-09-16",
        }
    )

    assert task.id == 7
    assert task.source_task_id == 1_781_204_320_207
    assert task.source_goal_id == 1_782_503_210_780
    assert task.source_recurring_rule_id == 1_781_999_999_999
    assert task.recurrence_occurrence_date == date(2026, 9, 16)
    assert task.created_at == created_at
    assert task.completed_at == completed_at