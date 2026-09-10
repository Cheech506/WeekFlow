"""Tests for task request validation."""

from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas import TaskCreate


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