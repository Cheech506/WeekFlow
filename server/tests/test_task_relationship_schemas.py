"""Request validation tests; these need no running PostgreSQL instance."""
import pytest
from pydantic import ValidationError

from app.schemas import TaskCreate, TaskUpdate


@pytest.mark.parametrize("schema", [TaskCreate, TaskUpdate])
@pytest.mark.parametrize("value", [0, -1, True, 1.5, "123", 2_147_483_648])
def test_goal_id_requires_positive_native_integer(schema, value):
    with pytest.raises(ValidationError):
        schema.model_validate({"title": "Example", "goal_id": value})


def test_goal_null_and_omission_remain_distinguishable():
    assert TaskUpdate().model_dump(exclude_unset=True) == {}
    assert TaskUpdate(goal_id=None).model_dump(exclude_unset=True) == {"goal_id": None}
    assert TaskCreate(title="Example", goal_id=2_147_483_647).goal_id == 2_147_483_647


@pytest.mark.parametrize("body", [
    {"recurring_rule_id": 1},
    {"recurrence_occurrence_date": "2026-10-09"},
    {"recurring_rule_id": None, "recurrence_occurrence_date": "2026-10-09"},
    {"recurring_rule_id": 1, "recurrence_occurrence_date": None},
    {"recurring_rule_id": True, "recurrence_occurrence_date": "2026-10-09"},
    {"recurring_rule_id": 2_147_483_648, "recurrence_occurrence_date": "2026-10-09"},
])
def test_creation_rejects_partial_or_invalid_recurrence(body):
    with pytest.raises(ValidationError):
        TaskCreate.model_validate({"title": "Example", **body})


@pytest.mark.parametrize("field,value", [
    ("recurring_rule_id", 1),
    ("recurrence_occurrence_date", "2026-10-09"),
    ("source_task_id", 1781204330001),
    ("source_goal_id", 1781204330002),
    ("source_recurring_rule_id", 1781204330006),
])
def test_ordinary_update_cannot_rewrite_recurrence_or_source_identity(field, value):
    with pytest.raises(ValidationError):
        TaskUpdate.model_validate({field: value})


@pytest.mark.parametrize("field", ["source_task_id", "source_goal_id", "source_recurring_rule_id"])
def test_ordinary_create_cannot_forge_source_metadata(field):
    with pytest.raises(ValidationError):
        TaskCreate.model_validate({"title": "Example", field: 1781204330001})


def test_native_occurrence_requires_no_sqlite_source_id():
    item = TaskCreate(title="  Example  ", recurring_rule_id=123,
                      recurrence_occurrence_date="2026-10-09")
    assert item.title == "Example"
    assert item.recurring_rule_id == 123
    assert item.recurrence_occurrence_date.isoformat() == "2026-10-09"
