"""PostgreSQL API tests for recurring schedules and retained task history.

The shared fixture gives each test isolated tables and rolls back all writes.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Goal,
    RecurringOccurrenceException,
    RecurringRule,
    Task,
    WeeklyCommitment,
    WeeklyTaskDecision,
)
from test_backup_refresh_api import refresh_client


URL = "/api/v1/recurring-rules"
START = date(2026, 10, 12)
COMPLETED_AT = datetime(2026, 10, 13, 12, tzinfo=UTC)


@pytest.fixture
def recurring_client(refresh_client):
    """Reuse test-owned schemas instead of the live application's tables."""

    return refresh_client


def create_rule(client, **changes):
    response = client.post(
        URL,
        json={
            "title": "Daily study",
            "frequency": "daily",
            "start_date": START.isoformat(),
            **changes,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def make_goal(session, *, source_id=None):
    goal = Goal(
        title="Study goal",
        source_goal_id=source_id,
        start_date=START,
        end_date=date(2026, 12, 31),
    )
    session.add(goal)
    session.flush()
    return goal


def make_rule(session, *, source_id=None, goal_id=None):
    rule = RecurringRule(
        title="Imported schedule",
        source_recurring_rule_id=source_id,
        goal_id=goal_id,
        frequency="daily",
        start_date=START,
    )
    session.add(rule)
    session.flush()
    return rule


def make_task(session, rule, occurrence_date, **changes):
    parent = session.get(Goal, rule.goal_id) if rule.goal_id is not None else None
    values = {
        "title": "Historical occurrence",
        "notes": "Keep these notes",
        "priority": 2,
        "goal_id": rule.goal_id,
        "source_goal_id": parent.source_goal_id if parent is not None else None,
        "recurring_rule_id": rule.id,
        "source_recurring_rule_id": rule.source_recurring_rule_id,
        "recurrence_occurrence_date": occurrence_date,
        "due_date": occurrence_date,
        "day": occurrence_date.strftime("%A"),
        "completed": False,
        "completed_at": None,
    }
    values.update(changes)
    task = Task(**values)
    session.add(task)
    session.flush()
    return task


def snapshot(session, model, identity):
    """Read current database values rather than cached ORM attributes."""

    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return {
        column.name: getattr(row, column.name)
        for column in model.__table__.columns
    }


def detached(before):
    """Expected task data when the schedule link is removed."""

    return {
        **before,
        "recurring_rule_id": None,
        "source_recurring_rule_id": None,
        "recurrence_occurrence_date": None,
    }


def test_create_and_read_schedule_defaults(recurring_client):
    client, session = recurring_client
    created = create_rule(client, title="  Daily study  ", notes="   ")

    assert created["id"] > 0
    assert created["title"] == "Daily study"
    assert created["notes"] is None
    assert created["priority"] == 0
    assert created["active"] is True
    assert created["weekdays"] == []
    assert created["goal_id"] is None
    assert created["source_recurring_rule_id"] is None
    assert created["created_at"]
    response = client.get(f"{URL}/{created['id']}")
    assert response.status_code == 200
    assert response.json() == created
    # Managing the schedule does not yet run occurrence generation.
    assert session.scalar(select(Task.id).limit(1)) is None


@pytest.mark.parametrize(
    "frequency",
    ["daily", "weekly", "everyTwoWeeks", "certainDays", "monthly"],
)
def test_all_existing_app_frequencies_are_supported(recurring_client, frequency):
    client, _ = recurring_client
    item = create_rule(client, frequency=frequency, weekdays=[5, 1])
    assert item["frequency"] == frequency
    assert item["weekdays"] == [1, 5]


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"frequency": "yearly"},
        {"frequency": "certainDays"},
        {"start_date": "2026-02-30"},
        {"end_date": "2026-10-11"},
        {"priority": -1},
        {"priority": 3},
        {"priority": True},
        {"goal_id": 0},
        {"goal_id": True},
        {"goal_id": "12"},
        {"goal_id": 2_147_483_648},
        {"weekdays": [1, 1]},
        {"weekdays": [7]},
        {"weekdays": [True]},
        {"active": "false"},
        {"source_recurring_rule_id": 1_781_204_330_006},
        {"id": 12},
        {"created_at": "2026-10-13T12:00:00Z"},
    ],
)
def test_invalid_create_saves_no_schedule(recurring_client, changes):
    client, session = recurring_client
    response = client.post(
        URL,
        json={
            "title": "Invalid schedule",
            "frequency": "daily",
            "start_date": START.isoformat(),
            **changes,
        },
    )
    assert response.status_code == 422, response.text
    assert session.scalar(select(RecurringRule.id).limit(1)) is None


def test_missing_goal_rejects_create(recurring_client):
    client, session = recurring_client
    response = client.post(
        URL,
        json={
            "title": "Missing goal",
            "frequency": "daily",
            "start_date": START.isoformat(),
            "goal_id": 2_147_483_647,
        },
    )
    assert response.status_code == 404
    assert session.scalar(select(RecurringRule.id).limit(1)) is None


def test_list_filters_goal_and_active_state(recurring_client):
    client, session = recurring_client
    first_goal = make_goal(session)
    second_goal = make_goal(session)
    first_id, second_id = first_goal.id, second_goal.id
    first = create_rule(client, goal_id=first_id)
    paused = create_rule(client, goal_id=first_id, active=False)
    other = create_rule(client, goal_id=second_id)

    def ids(**params):
        response = client.get(URL, params=params)
        assert response.status_code == 200
        return [item["id"] for item in response.json()]

    assert set(ids()) == {first["id"], paused["id"], other["id"]}
    assert set(ids(goal_id=first_id)) == {first["id"], paused["id"]}
    assert ids(active="false") == [paused["id"]]
    assert set(ids(active="true")) == {first["id"], other["id"]}
    assert ids(goal_id=first_id, active="true") == [first["id"]]
    assert ids(goal_id=2_147_483_647) == []


def test_partial_edit_preserves_omitted_fields_and_identity(recurring_client):
    client, session = recurring_client
    rule = make_rule(session, source_id=1_781_204_330_006)
    rule_id = rule.id
    before = client.get(f"{URL}/{rule_id}").json()
    response = client.patch(
        f"{URL}/{rule_id}",
        json={"title": "  Revised study  ", "priority": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {**before, "title": "Revised study", "priority": 1}
    response = client.patch(f"{URL}/{rule_id}", json={})
    assert response.status_code == 200
    assert response.json() == {**before, "title": "Revised study", "priority": 1}


def test_pause_and_resume_keep_occurrences_and_skips(recurring_client):
    client, session = recurring_client
    rule = make_rule(session)
    rule_id = rule.id
    task = make_task(session, rule, date(2026, 10, 13))
    task_id = task.id
    key = (rule_id, date(2026, 10, 14))
    session.add(RecurringOccurrenceException(
        recurring_rule_id=key[0], occurrence_date=key[1],
    ))
    session.flush()
    task_before = snapshot(session, Task, task_id)
    skip_before = snapshot(session, RecurringOccurrenceException, key)

    for active in (False, True):
        response = client.patch(f"{URL}/{rule_id}", json={"active": active})
        assert response.status_code == 200, response.text
        assert response.json()["active"] is active
        assert snapshot(session, Task, task_id) == task_before
        assert snapshot(session, RecurringOccurrenceException, key) == skip_before


def test_goal_change_preserves_completed_and_unfinished_history(recurring_client):
    client, session = recurring_client
    old_goal = make_goal(session, source_id=1_781_204_330_002)
    current_goal = make_goal(session)
    old_id, current_id = old_goal.id, current_goal.id
    rule = make_rule(session, goal_id=old_id)
    rule_id = rule.id
    completed = make_task(
        session, rule, date(2026, 10, 12),
        completed=True, completed_at=COMPLETED_AT,
    )
    unfinished = make_task(session, rule, date(2026, 10, 13))
    completed_id, unfinished_id = completed.id, unfinished.id
    completed_before = snapshot(session, Task, completed_id)
    unfinished_before = snapshot(session, Task, unfinished_id)

    response = client.patch(f"{URL}/{rule_id}", json={"goal_id": current_id})
    assert response.status_code == 200, response.text
    assert response.json()["goal_id"] == current_id
    assert snapshot(session, Task, completed_id) == completed_before
    assert snapshot(session, Task, unfinished_id) == unfinished_before
    # A newly created occurrence inherits the revised schedule's goal.
    response = client.post("/api/v1/tasks", json={
        "title": "New occurrence",
        "recurring_rule_id": rule_id,
        "recurrence_occurrence_date": "2026-10-14",
    })
    assert response.status_code == 201, response.text
    assert response.json()["goal_id"] == current_id


def test_clear_optional_fields_without_changing_source_identity(recurring_client):
    client, session = recurring_client
    parent = make_goal(session)
    created = create_rule(
        client, goal_id=parent.id, notes="Notes", end_date="2026-10-20",
    )
    response = client.patch(f"{URL}/{created['id']}", json={
        "goal_id": None, "notes": "   ", "end_date": None,
    })
    assert response.status_code == 200, response.text
    assert response.json() == {
        **created, "goal_id": None, "notes": None, "end_date": None,
    }


@pytest.mark.parametrize(
    "initial,changes",
    [
        ({"end_date": "2026-10-20"}, {"start_date": "2026-10-21"}),
        ({}, {"end_date": "2026-10-11"}),
        ({}, {"frequency": "certainDays"}),
        ({"frequency": "certainDays", "weekdays": [1]}, {"weekdays": []}),
    ],
)
def test_invalid_merged_edit_rolls_back_all_fields(recurring_client, initial, changes):
    client, _ = recurring_client
    created = create_rule(client, **initial)
    path = f"{URL}/{created['id']}"
    response = client.patch(path, json={"title": "Must not change", **changes})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"][0] == "body"
    assert client.get(path).json() == created
    # The failed request must not leave the session unusable.
    response = client.patch(path, json={"notes": "Still usable"})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "field", ["title", "priority", "frequency", "start_date", "weekdays", "active"],
)
def test_required_fields_cannot_be_erased(recurring_client, field):
    client, _ = recurring_client
    created = create_rule(client)
    path = f"{URL}/{created['id']}"
    response = client.patch(path, json={field: None})
    assert response.status_code == 422
    assert client.get(path).json() == created


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", 999),
        ("source_recurring_rule_id", 1_781_204_330_006),
        ("created_at", "2026-10-13T12:00:00Z"),
    ],
)
def test_patch_cannot_rewrite_identity(recurring_client, field, value):
    client, _ = recurring_client
    created = create_rule(client)
    path = f"{URL}/{created['id']}"
    assert client.patch(path, json={field: value}).status_code == 422
    assert client.get(path).json() == created


def test_missing_goal_patch_does_not_save_other_fields(recurring_client):
    client, _ = recurring_client
    created = create_rule(client)
    path = f"{URL}/{created['id']}"
    response = client.patch(path, json={"goal_id": 2_147_483_647, "title": "Invalid"})
    assert response.status_code == 404
    assert client.get(path).json() == created


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_missing_schedule_returns_404(recurring_client, method):
    client, _ = recurring_client
    kwargs = {"json": {"notes": "Change"}} if method == "patch" else {}
    assert getattr(client, method)(f"{URL}/2147483647", **kwargs).status_code == 404


@pytest.mark.parametrize("identity", ["0", "-1", "2147483648", "not-an-id"])
def test_invalid_path_id_returns_422(recurring_client, identity):
    client, _ = recurring_client
    assert client.get(f"{URL}/{identity}").status_code == 422


def test_default_delete_keeps_tasks_and_removes_skips(recurring_client):
    client, session = recurring_client
    parent = make_goal(session, source_id=1_781_204_330_002)
    rule = make_rule(session, source_id=1_781_204_330_006, goal_id=parent.id)
    rule_id = rule.id
    first = make_task(session, rule, date(2026, 10, 12), source_task_id=1001)
    second = make_task(session, rule, date(2026, 10, 13),
                       completed=True, completed_at=COMPLETED_AT)
    task_ids = [first.id, second.id]
    before = {identity: snapshot(session, Task, identity) for identity in task_ids}
    key = (rule_id, date(2026, 10, 14))
    session.add(RecurringOccurrenceException(recurring_rule_id=key[0], occurrence_date=key[1]))
    session.flush()

    response = client.delete(f"{URL}/{rule_id}")
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert snapshot(session, RecurringRule, rule_id) is None
    assert snapshot(session, RecurringOccurrenceException, key) is None
    for identity in task_ids:
        assert snapshot(session, Task, identity) == detached(before[identity])


def test_delete_unfinished_retains_completed_tasks_and_weekly_history(recurring_client):
    client, session = recurring_client
    parent = make_goal(session)
    rule = make_rule(session, source_id=1_781_204_330_006, goal_id=parent.id)
    rule_id = rule.id
    finished = make_task(session, rule, date(2026, 10, 12),
                         completed=True, completed_at=COMPLETED_AT)
    moved = make_task(session, rule, date(2026, 10, 13),
                      due_date=date(2026, 11, 1), day="Sunday")
    inbox = make_task(session, rule, date(2026, 10, 14), due_date=None, day="Inbox")
    other_rule = make_rule(session)
    other = make_task(session, other_rule, date(2026, 10, 13))
    finished_id, moved_id, inbox_id, other_id = finished.id, moved.id, inbox.id, other.id
    commitment = WeeklyCommitment(
        week_start=START, task_id=moved_id, title="Keep this promise in history",
    )
    decision = WeeklyTaskDecision(
        week_start=START, task_id=moved_id, task_title="Historical occurrence",
        original_due_date=date(2026, 10, 13), action="keep",
        recurring_rule_id=rule_id, source_recurring_rule_id=rule.source_recurring_rule_id,
        recurrence_occurrence_date=date(2026, 10, 13),
    )
    session.add_all([commitment, decision])
    session.flush()
    commitment_id, decision_id = commitment.id, decision.id
    finished_before = snapshot(session, Task, finished_id)
    other_before = snapshot(session, Task, other_id)
    commitment_before = snapshot(session, WeeklyCommitment, commitment_id)
    decision_before = snapshot(session, WeeklyTaskDecision, decision_id)

    response = client.delete(f"{URL}/{rule_id}", params={"mode": "deleteUnfinished"})
    assert response.status_code == 204, response.text
    assert snapshot(session, Task, moved_id) is None
    assert snapshot(session, Task, inbox_id) is None
    assert snapshot(session, Task, finished_id) == detached(finished_before)
    assert snapshot(session, Task, other_id) == other_before
    assert snapshot(session, WeeklyCommitment, commitment_id) == {**commitment_before, "task_id": None}
    assert snapshot(session, WeeklyTaskDecision, decision_id) == {**decision_before, "task_id": None}


@pytest.mark.parametrize("mode", ["stopOnly", "deleteUnfinished"])
def test_delete_supports_legacy_source_only_occurrences(recurring_client, mode):
    client, session = recurring_client
    rule = make_rule(session, source_id=1_781_204_330_006)
    rule_id = rule.id
    unfinished = make_task(session, rule, date(2026, 10, 12), recurring_rule_id=None)
    completed = make_task(session, rule, date(2026, 10, 13), recurring_rule_id=None,
                          completed=True, completed_at=COMPLETED_AT)
    unfinished_id, completed_id = unfinished.id, completed.id
    first_before = snapshot(session, Task, unfinished_id)
    second_before = snapshot(session, Task, completed_id)

    response = client.delete(f"{URL}/{rule_id}", params={"mode": mode})
    assert response.status_code == 204, response.text
    expected = None if mode == "deleteUnfinished" else detached(first_before)
    assert snapshot(session, Task, unfinished_id) == expected
    assert snapshot(session, Task, completed_id) == detached(second_before)


@pytest.mark.parametrize("mode", ["stopOnly", "deleteUnfinished"])
def test_delete_respects_native_link_over_stale_source_metadata(recurring_client, mode):
    client, session = recurring_client
    old = make_rule(session, source_id=1_781_204_330_006)
    actual = make_rule(session)
    old_id = old.id
    task = make_task(session, actual, date(2026, 10, 13),
                     source_recurring_rule_id=old.source_recurring_rule_id)
    task_id = task.id
    before = snapshot(session, Task, task_id)
    response = client.delete(f"{URL}/{old_id}", params={"mode": mode})
    assert response.status_code == 204, response.text
    assert snapshot(session, Task, task_id) == before


def test_invalid_delete_mode_changes_nothing(recurring_client):
    client, _ = recurring_client
    item = create_rule(client)
    path = f"{URL}/{item['id']}"
    assert client.delete(path, params={"mode": "deleteEverything"}).status_code == 422
    assert client.get(path).json() == item


def test_failed_delete_rolls_back_removed_tasks_and_detached_history(recurring_client, monkeypatch):
    client, session = recurring_client
    rule = make_rule(session, source_id=1_781_204_330_006)
    rule_id = rule.id
    unfinished = make_task(session, rule, date(2026, 10, 12))
    completed = make_task(session, rule, date(2026, 10, 13),
                          completed=True, completed_at=COMPLETED_AT)
    task_ids = [unfinished.id, completed.id]
    key = (rule_id, date(2026, 10, 14))
    session.add(RecurringOccurrenceException(recurring_rule_id=key[0], occurrence_date=key[1]))
    # Commit the setup savepoint; the fixture still owns the outer rollback.
    session.commit()
    before_rule = snapshot(session, RecurringRule, rule_id)
    before_tasks = {identity: snapshot(session, Task, identity) for identity in task_ids}
    before_skip = snapshot(session, RecurringOccurrenceException, key)

    def fail_commit():
        # Execute the pending rule deletion before simulating a failed commit.
        session.flush()
        raise IntegrityError("test commit", {}, Exception("forced test failure"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = client.delete(f"{URL}/{rule_id}", params={"mode": "deleteUnfinished"})

    assert response.status_code == 409, response.text
    assert snapshot(session, RecurringRule, rule_id) == before_rule
    assert snapshot(session, RecurringOccurrenceException, key) == before_skip
    for identity in task_ids:
        assert snapshot(session, Task, identity) == before_tasks[identity]
    # A subsequent request succeeds after the rollback.
    assert client.delete(f"{URL}/{rule_id}", params={"mode": "stopOnly"}).status_code == 204
