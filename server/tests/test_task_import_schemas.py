"""Tests for SQLite task-import validation."""

from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from app.schemas import TaskImportItem, TaskImportRequest


def make_backup_task(
    task_id: int = 1_781_204_320_207,
    **changes,
):
    """Build one representative task using the backup's camelCase shape."""

    task = {
        "id": task_id,
        "title": "Imported recurring task",
        "day": "Wednesday",
        "dueDate": "2026-09-16",
        "notes": "Preserve these notes",
        "priority": 1,
        "goalId": 1_782_503_210_780,
        "completed": True,
        "createdAt": "2026-06-11T18:58:40.207Z",
        "completedAt": "2026-09-16T14:30:00.000Z",
        "recurringRuleId": 1_781_999_999_999,
        "recurrenceOccurrenceDate": "2026-09-16",
    }

    task.update(changes)

    return task


def test_task_import_item_maps_backup_fields():
    """Translate camelCase backup fields into backend field names."""

    task = TaskImportItem.model_validate(
        make_backup_task()
    )

    assert task.source_task_id == 1_781_204_320_207
    assert task.title == "Imported recurring task"
    assert task.day == "Wednesday"
    assert task.due_date == date(2026, 9, 16)
    assert task.notes == "Preserve these notes"
    assert task.priority == 1
    assert task.source_goal_id == 1_782_503_210_780
    assert task.completed is True

    assert task.created_at == datetime(
        2026,
        6,
        11,
        18,
        58,
        40,
        207_000,
        tzinfo=UTC,
    )
    assert task.completed_at == datetime(
        2026,
        9,
        16,
        14,
        30,
        tzinfo=UTC,
    )

    assert (
        task.source_recurring_rule_id
        == 1_781_999_999_999
    )
    assert (
        task.recurrence_occurrence_date
        == date(2026, 9, 16)
    )

    internal_values = task.model_dump()

    assert internal_values["source_task_id"] == 1_781_204_320_207
    assert internal_values["due_date"] == date(2026, 9, 16)
    assert "id" not in internal_values
    assert "dueDate" not in internal_values


@pytest.mark.parametrize(
    "changes",
    [
        {
            "completed": True,
            "completedAt": None,
        },
        {
            "completed": False,
            "completedAt": "2026-09-16T14:30:00.000Z",
        },
        {
            "recurringRuleId": None,
            "recurrenceOccurrenceDate": "2026-09-16",
        },
        {
            "recurringRuleId": 1_781_999_999_999,
            "recurrenceOccurrenceDate": None,
        },
    ],
)
def test_task_import_item_rejects_inconsistent_linked_values(
    changes,
):
    """Reject completion or recurrence fields that disagree."""

    with pytest.raises(ValidationError):
        TaskImportItem.model_validate(
            make_backup_task(**changes)
        )


def test_task_import_item_rejects_timestamp_without_timezone():
    """Require timestamps that describe an exact global moment."""

    with pytest.raises(ValidationError):
        TaskImportItem.model_validate(
            make_backup_task(
                createdAt="2026-06-11T18:58:40.207",
            )
        )


def test_task_import_item_rejects_unsafe_javascript_id():
    """Keep imported IDs inside JavaScript's exact integer range."""

    with pytest.raises(ValidationError):
        TaskImportItem.model_validate(
            make_backup_task(
                task_id=9_007_199_254_740_992,
            )
        )


def test_task_import_request_rejects_duplicate_source_task_ids():
    """Do not allow one batch to contain the same SQLite task twice."""

    first = make_backup_task(
        recurringRuleId=None,
        recurrenceOccurrenceDate=None,
    )
    duplicate = make_backup_task(
        recurringRuleId=None,
        recurrenceOccurrenceDate=None,
    )

    with pytest.raises(ValidationError):
        TaskImportRequest.model_validate(
            {
                "tasks": [
                    first,
                    duplicate,
                ]
            }
        )


def test_task_import_request_rejects_duplicate_recurring_identity():
    """Reject two tasks representing the same recurring occurrence."""

    first = make_backup_task()
    duplicate_occurrence = make_backup_task(
        task_id=1_781_204_320_208,
    )

    with pytest.raises(ValidationError):
        TaskImportRequest.model_validate(
            {
                "tasks": [
                    first,
                    duplicate_occurrence,
                ]
            }
        )


def test_task_import_request_rejects_empty_batch():
    """Require at least one task in an import request."""

    with pytest.raises(ValidationError):
        TaskImportRequest.model_validate(
            {
                "tasks": [],
            }
        )


def test_task_import_item_rejects_unknown_fields():
    """Reject fields that are not part of the backup task format."""

    task = make_backup_task()
    task["unexpected"] = "value"

    with pytest.raises(ValidationError):
        TaskImportItem.model_validate(task)