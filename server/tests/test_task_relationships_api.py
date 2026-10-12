"""Regression tests for native task links, recurrence history, and imports.

Endpoint requests use isolated test tables and roll back all test data afterward.
"""
from copy import deepcopy
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Goal, RecurringOccurrenceException, RecurringRule, Task
from test_backup_refresh_api import refresh_client
from test_backup_import_schemas import (
    GOAL_ID, RECURRING_RULE_ID, TASK_ID, make_valid_backup,
)

BASE = "/api/v1"
DAY = "2026-10-09"


@pytest.fixture
def isolated_links(refresh_client):
    """Reuse the isolated-schema fixture; never exercise public app tables."""

    return refresh_client


def goal(session, source=None):
    row = Goal(title="Relationship test", source_goal_id=source,
               start_date=date(2026, 9, 21), end_date=date(2026, 12, 13))
    session.add(row)
    session.flush()
    return row


def rule(session, linked_goal=None, source=None):
    row = RecurringRule(title="Daily test", goal_id=linked_goal,
                        source_recurring_rule_id=source, frequency="daily",
                        start_date=date(2026, 9, 21))
    session.add(row)
    session.flush()
    return row


def create(client, **fields):
    response = client.post(f"{BASE}/tasks", json={"title": "Test occurrence", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def task_from_backup(session):
    return session.scalar(select(Task).where(Task.source_task_id == TASK_ID))


def test_native_goal_link_round_trip_and_filter(isolated_links):
    client, session = isolated_links
    parent = goal(session)
    other = goal(session)
    linked = create(client, goal_id=parent.id)
    create(client, goal_id=other.id)
    assert linked["goal_id"] == parent.id
    assert linked["source_goal_id"] is None
    assert linked["source_task_id"] is None
    assert client.get(f"{BASE}/tasks/{linked['id']}").json() == linked
    filtered = client.get(f"{BASE}/tasks", params={"goal_id": parent.id}).json()
    assert [row["id"] for row in filtered] == [linked["id"]]


def test_goal_edit_omit_reassign_and_clear_preserve_task_identity(isolated_links):
    client, session = isolated_links
    first, second = goal(session, GOAL_ID), goal(session, GOAL_ID + 1)
    item = create(client, goal_id=first.id)
    url = f"{BASE}/tasks/{item['id']}"
    assert client.patch(url, json={"notes": "Retain goal"}).json()["goal_id"] == first.id
    changed = client.patch(url, json={"goal_id": second.id}).json()
    assert (changed["goal_id"], changed["source_goal_id"]) == (second.id, GOAL_ID + 1)
    cleared = client.patch(url, json={"goal_id": None}).json()
    assert cleared["goal_id"] is None and cleared["source_goal_id"] is None
    assert cleared["id"] == item["id"] and cleared["created_at"] == item["created_at"]


@pytest.mark.parametrize("field", ["goal_id", "recurring_rule_id"])
def test_missing_parent_rejects_create_without_saving(isolated_links, field):
    client, session = isolated_links
    fields = {field: 2_147_483_647}
    if field == "recurring_rule_id":
        fields["recurrence_occurrence_date"] = DAY
    response = client.post(f"{BASE}/tasks", json={"title": "Missing parent", **fields})
    assert response.status_code == 404
    assert session.scalar(select(Task).where(Task.title == "Missing parent")) is None


def test_missing_goal_patch_rolls_back_other_changes(isolated_links):
    client, session = isolated_links
    item = create(client, goal_id=goal(session).id)
    url = f"{BASE}/tasks/{item['id']}"
    assert client.patch(url, json={"goal_id": 2_147_483_647, "title": "Must roll back"}).status_code == 404
    assert client.get(url).json() == item


def test_native_goal_completion_counts_its_tasks(isolated_links):
    client, session = isolated_links
    parent = goal(session)
    first = create(client, goal_id=parent.id, priority=2)
    create(client, goal_id=parent.id)
    create(client, goal_id=goal(session).id, priority=2)
    assert client.patch(f"{BASE}/tasks/{first['id']}", json={"completed": True}).status_code == 200
    response = client.post(f"{BASE}/goals/{parent.id}/complete", json={})
    assert response.status_code == 200
    data = response.json()
    assert data["completion_task_total"] == 2
    assert data["completion_task_completed"] == 1
    assert data["completion_high_priority_completed"] == 1


def test_native_goal_is_authoritative_over_stale_source_metadata(isolated_links):
    client, session = isolated_links
    old, current = goal(session, GOAL_ID), goal(session)
    task = Task(title="Contradictory legacy metadata", goal_id=current.id, source_goal_id=GOAL_ID)
    session.add(task)
    session.flush()
    assert client.get(f"{BASE}/tasks", params={"goal_id": old.id}).json() == []
    snapshot = client.post(f"{BASE}/goals/{old.id}/complete", json={}).json()
    assert snapshot["completion_task_total"] == 0
    # The current goal still counts the task even though its source metadata is stale.
    snapshot = client.post(f"{BASE}/goals/{current.id}/complete", json={}).json()
    assert snapshot["completion_task_total"] == 1


def test_delete_goal_keeps_task_and_clears_both_goal_links(isolated_links):
    client, session = isolated_links
    parent = goal(session, GOAL_ID)
    item = create(client, goal_id=parent.id)
    url = f"{BASE}/tasks/{item['id']}"
    before = client.patch(url, json={"completed": True}).json()
    assert client.delete(f"{BASE}/goals/{parent.id}").status_code == 204
    after = client.get(url).json()
    assert after == {**before, "goal_id": None, "source_goal_id": None}


def test_delete_other_goal_does_not_unlink_authoritative_native_task(isolated_links):
    client, session = isolated_links
    stale, actual = goal(session, GOAL_ID), goal(session)
    task = Task(title="Authoritative FK", goal_id=actual.id, source_goal_id=GOAL_ID)
    session.add(task)
    session.flush()
    task_id = task.id
    assert client.delete(f"{BASE}/goals/{stale.id}").status_code == 204
    assert client.get(f"{BASE}/tasks/{task_id}").json()["goal_id"] == actual.id


@pytest.mark.parametrize("explicit", [False, True])
def test_occurrence_inherits_goal_once_or_respects_explicit_null(isolated_links, explicit):
    client, session = isolated_links
    parent = goal(session)
    schedule = rule(session, parent.id)
    fields = {"recurring_rule_id": schedule.id, "recurrence_occurrence_date": DAY}
    if explicit:
        fields["goal_id"] = None
    item = create(client, **fields)
    assert item["goal_id"] == (None if explicit else parent.id)
    assert item["recurring_rule_id"] == schedule.id
    assert item["source_recurring_rule_id"] is None
    assert item["recurrence_occurrence_date"] == DAY


def test_explicit_occurrence_goal_can_differ_from_schedule(isolated_links):
    client, session = isolated_links
    old, current = goal(session), goal(session)
    schedule = rule(session, current.id)
    item = create(client, goal_id=old.id, recurring_rule_id=schedule.id, recurrence_occurrence_date=DAY)
    assert item["goal_id"] == old.id


def test_relinking_schedule_preserves_old_occurrence_goal_and_completion(isolated_links):
    client, session = isolated_links
    old, current = goal(session), goal(session)
    schedule = rule(session, old.id)
    before = create(client, recurring_rule_id=schedule.id, recurrence_occurrence_date=DAY)
    completed = client.patch(f"{BASE}/tasks/{before['id']}", json={"completed": True}).json()
    schedule.goal_id = current.id
    session.commit()
    after = create(client, recurring_rule_id=schedule.id, recurrence_occurrence_date="2026-10-10")
    assert client.get(f"{BASE}/tasks/{before['id']}").json() == completed
    assert completed["goal_id"] == old.id and after["goal_id"] == current.id
    for parent in (old, current):
        result = client.post(f"{BASE}/goals/{parent.id}/complete", json={}).json()
        assert result["completion_task_total"] == 1
        assert result["completion_task_completed"] == (1 if parent.id == old.id else 0)


def test_reschedule_keeps_original_identity_and_duplicate_returns_409(isolated_links):
    client, session = isolated_links
    schedule = rule(session)
    fields = {"recurring_rule_id": schedule.id, "recurrence_occurrence_date": DAY}
    item = create(client, due_date=DAY, **fields)
    moved = client.patch(f"{BASE}/tasks/{item['id']}", json={"due_date": "2026-10-12"}).json()
    assert moved["due_date"] == "2026-10-12" and moved["day"] == "Monday"
    assert moved["recurrence_occurrence_date"] == DAY
    assert client.post(f"{BASE}/tasks", json={"title": "Duplicate", **fields}).status_code == 409
    assert client.get(f"{BASE}/tasks/{item['id']}").json() == moved
    # After the failed request, the session remains usable for another occurrence.
    assert create(client, recurring_rule_id=schedule.id, recurrence_occurrence_date="2026-10-10")


def test_imported_schedule_create_sets_source_metadata_and_filters(isolated_links):
    client, session = isolated_links
    parent = goal(session, GOAL_ID)
    schedule = rule(session, parent.id, RECURRING_RULE_ID)
    item = create(client, recurring_rule_id=schedule.id, recurrence_occurrence_date=DAY)
    assert item["source_goal_id"] == GOAL_ID
    assert item["source_recurring_rule_id"] == RECURRING_RULE_ID
    filtered = client.get(f"{BASE}/tasks", params={"goal_id": parent.id, "recurring_rule_id": schedule.id}).json()
    assert [row["id"] for row in filtered] == [item["id"]]


def test_delete_occurrence_records_exception_and_cannot_regenerate(isolated_links):
    client, session = isolated_links
    schedule = rule(session)
    fields = {"recurring_rule_id": schedule.id, "recurrence_occurrence_date": DAY}
    item = create(client, **fields)
    assert client.delete(f"{BASE}/tasks/{item['id']}").status_code == 204
    skipped = session.get(RecurringOccurrenceException, (schedule.id, date.fromisoformat(DAY)))
    assert skipped is not None
    assert client.post(f"{BASE}/tasks", json={"title": "Recreate", **fields}).status_code == 409
    assert client.get(f"{BASE}/tasks/{item['id']}").status_code == 404


def test_rule_delete_is_blocked_until_occurrence_is_explicitly_detached(isolated_links):
    client, session = isolated_links
    schedule = rule(session)
    item = create(client, recurring_rule_id=schedule.id, recurrence_occurrence_date=DAY)
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            session.delete(schedule)
            session.flush()
    task = session.get(Task, item["id"])
    task.recurring_rule_id = None
    task.source_recurring_rule_id = None
    task.recurrence_occurrence_date = None
    session.flush()
    session.delete(session.get(RecurringRule, item["recurring_rule_id"]))
    session.commit()
    assert client.get(f"{BASE}/tasks/{item['id']}").json()["recurring_rule_id"] is None


def test_full_import_maps_task_goal_and_rule_and_identical_retry(isolated_links):
    client, session = isolated_links
    backup = make_valid_backup()
    assert client.post(f"{BASE}/backups/import", json=backup).status_code == 200
    task = task_from_backup(session)
    parent = session.scalar(select(Goal).where(Goal.source_goal_id == GOAL_ID))
    schedule = session.scalar(select(RecurringRule).where(RecurringRule.source_recurring_rule_id == RECURRING_RULE_ID))
    assert task.goal_id == parent.id and task.recurring_rule_id == schedule.id
    assert task.source_goal_id == GOAL_ID and task.source_recurring_rule_id == RECURRING_RULE_ID
    task_id = task.id
    retry = client.post(f"{BASE}/backups/import", json=backup)
    assert retry.status_code == 200 and retry.json()["database_changed"] is False
    assert task_from_backup(session).id == task_id


def test_source_only_task_import_is_reconnected_when_full_backup_arrives(isolated_links):
    client, session = isolated_links
    backup = make_valid_backup()
    response = client.post(f"{BASE}/tasks/import", json={"tasks": backup["data"]["tasks"]})
    assert response.status_code == 200
    task = task_from_backup(session)
    task_id = task.id
    assert task.goal_id is None and task.recurring_rule_id is None
    response = client.post(f"{BASE}/backups/import", json=backup)
    assert response.status_code == 200, response.text
    task = task_from_backup(session)
    assert task.id == task_id and task.goal_id is not None and task.recurring_rule_id is not None


def test_standalone_import_resolves_existing_parents_on_retry(isolated_links):
    client, session = isolated_links
    backup = make_valid_backup()
    body = {"tasks": backup["data"]["tasks"]}
    assert client.post(f"{BASE}/tasks/import", json=body).status_code == 200
    item_id = task_from_backup(session).id
    parent = goal(session, GOAL_ID)
    schedule = rule(session, parent.id, RECURRING_RULE_ID)
    retry = client.post(f"{BASE}/tasks/import", json=body)
    assert retry.status_code == 200
    assert retry.json()["unchanged_count"] == 1
    item = task_from_backup(session)
    assert item.id == item_id and item.goal_id == parent.id and item.recurring_rule_id == schedule.id


def test_full_import_repairs_legacy_links_but_preview_stays_read_only(isolated_links):
    client, session = isolated_links
    backup = make_valid_backup()
    assert client.post(f"{BASE}/backups/import", json=backup).status_code == 200
    item = task_from_backup(session)
    item.goal_id = None
    item.recurring_rule_id = None
    session.commit()
    result = client.post(f"{BASE}/backups/import/preview", json=backup)
    assert result.status_code == 200 and result.json()["database_changed"] is False
    session.expire_all()
    item = task_from_backup(session)
    assert item.goal_id is None and item.recurring_rule_id is None
    retry = client.post(f"{BASE}/backups/import", json=backup)
    assert retry.status_code == 200 and retry.json()["database_changed"] is True
    assert retry.json()["created_count"] == 0
    assert task_from_backup(session).goal_id is not None
    assert task_from_backup(session).recurring_rule_id is not None


def test_refresh_maps_changed_task_parents_without_changing_task_id(isolated_links):
    client, session = isolated_links
    backup = make_valid_backup()
    assert client.post(f"{BASE}/backups/import", json=backup).status_code == 200
    original = task_from_backup(session)
    task_id, original_goal, original_rule = original.id, original.goal_id, original.recurring_rule_id
    changed = deepcopy(backup)
    data = changed["data"]
    new_goal = deepcopy(data["goals"][0])
    new_goal["id"] = GOAL_ID + 100
    data["goals"].append(new_goal)
    new_rule = deepcopy(data["recurringRules"][0])
    new_rule["id"] = RECURRING_RULE_ID + 100
    new_rule["goalId"] = new_goal["id"]
    data["recurringRules"].append(new_rule)
    data["tasks"][0]["goalId"] = new_goal["id"]
    data["tasks"][0]["recurringRuleId"] = new_rule["id"]
    result = client.post(f"{BASE}/backups/import/refresh", json=changed)
    assert result.status_code == 200, result.text
    item = task_from_backup(session)
    assert item.id == task_id and item.source_task_id == TASK_ID
    assert item.goal_id != original_goal and item.recurring_rule_id != original_rule
    assert item.source_goal_id == GOAL_ID + 100
    assert item.source_recurring_rule_id == RECURRING_RULE_ID + 100
    retry = client.post(f"{BASE}/backups/import/refresh", json=changed)
    assert retry.status_code == 200 and retry.json()["database_changed"] is False


def test_import_preserves_occurrence_goal_when_schedule_goal_differs(isolated_links):
    client, session = isolated_links
    backup = make_valid_backup()
    data = backup["data"]
    current = deepcopy(data["goals"][0])
    current["id"] = GOAL_ID + 100
    data["goals"].append(current)
    data["recurringRules"][0]["goalId"] = current["id"]
    response = client.post(f"{BASE}/backups/import", json=backup)
    assert response.status_code == 200, response.text
    task = task_from_backup(session)
    schedule = session.get(RecurringRule, task.recurring_rule_id)
    assert task.goal_id != schedule.goal_id
    assert session.get(Goal, task.goal_id).source_goal_id == GOAL_ID


def test_identical_import_keeps_goal_link_added_after_migration(isolated_links):
    """A strict retry must not erase a goal assigned through PostgreSQL."""

    client, session = isolated_links
    backup = make_valid_backup()
    backup["data"]["tasks"][0]["goalId"] = None
    initial = client.post(f"{BASE}/backups/import", json=backup)
    assert initial.status_code == 200, initial.text

    task = task_from_backup(session)
    task_id = task.id
    native_goal = goal(session)
    linked = client.patch(
        f"{BASE}/tasks/{task_id}",
        json={"goal_id": native_goal.id},
    )
    assert linked.status_code == 200, linked.text
    before = linked.json()
    assert before["goal_id"] == native_goal.id
    assert before["source_goal_id"] is None

    retry = client.post(f"{BASE}/backups/import", json=backup)
    assert retry.status_code == 200, retry.text
    assert retry.json()["database_changed"] is False
    after = client.get(f"{BASE}/tasks/{task_id}")
    assert after.status_code == 200
    assert after.json() == before
