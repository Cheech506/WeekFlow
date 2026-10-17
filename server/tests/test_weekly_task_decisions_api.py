"""PostgreSQL tests for atomic task decisions and retained weekly history.

Setup commits release savepoints only. The shared fixture rolls back all
schema creation and data afterward, leaving application tables untouched.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Goal, RecurringOccurrenceException, RecurringRule, Task,
    WeeklyCommitment, WeeklyReview, WeeklyTaskDecision,
)
from test_backup_refresh_api import refresh_client


URL = "/api/v1/weekly-task-decisions"
WEEK = date(2026, 10, 12)
DUE = WEEK + timedelta(days=2)
STAMP = datetime(2026, 10, 13, 12, tzinfo=UTC)
SOURCE_RULE = 1_781_204_330_006
ACTIONS = ("nextWeek", "inbox", "reschedule", "keep", "delete")
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


@pytest.fixture
def decision_client(refresh_client):
    return refresh_client


def make_rule(session):
    rule = RecurringRule(
        title="Study daily", frequency="daily", start_date=WEEK,
        source_recurring_rule_id=SOURCE_RULE,
    )
    session.add(rule)
    session.flush()
    return rule.id


def make_task(session, *, rule_id=None, legacy=False, **changes):
    values = dict(
        title="Historical task title", notes="Keep notes", priority=2,
        due_date=DUE, completed=False, completed_at=None,
        recurring_rule_id=None if legacy else rule_id,
        source_recurring_rule_id=SOURCE_RULE if rule_id is not None else None,
        recurrence_occurrence_date=WEEK if rule_id is not None else None,
    )
    values.update(changes)
    due = values["due_date"]
    values["day"] = "Inbox" if due is None else DAYS[due.weekday()]
    task = Task(**values)
    session.add(task)
    session.flush()
    return task.id


def body(task_identity, action="keep", **changes):
    values = dict(
        task_id=task_identity, week_start=WEEK.isoformat(),
        original_due_date=DUE.isoformat(), action=action,
    )
    if action == "reschedule":
        values["resolved_due_date"] = "2026-11-01"
    return {**values, **changes}


def apply(client, task_id, action="keep", **changes):
    response = client.post(URL, json=body(task_id, action, **changes))
    assert response.status_code == 201, response.text
    return response.json()


def snapshot(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return {column.name: getattr(row, column.name) for column in model.__table__.columns}


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


@pytest.mark.parametrize("action", ACTIONS)
def test_actions_save_history_and_preserve_unrelated_task_fields(decision_client, action):
    client, session = decision_client
    goal = Goal(title="Old goal", source_goal_id=1_781_204_330_002, start_date=WEEK, end_date=WEEK + timedelta(days=83))
    session.add(goal)
    session.flush()
    goal_id = goal.id
    rule_id = make_rule(session)
    task_id = make_task(session, rule_id=rule_id, goal_id=goal_id, source_goal_id=goal.source_goal_id, source_task_id=1_781_204_320_207)
    session.commit()
    before = snapshot(session, Task, task_id)
    goal_before = snapshot(session, Goal, goal_id)
    row = apply(client, task_id, action)
    assert row["id"] > 0 and row["source_weekly_task_decision_id"] is None
    assert row["action"] == action
    assert row["task_title"] == before["title"]
    assert row["original_due_date"] == DUE.isoformat()
    assert row["week_start"] == WEEK.isoformat()
    assert row["recurring_rule_id"] == rule_id
    assert row["source_recurring_rule_id"] == SOURCE_RULE
    assert row["recurrence_occurrence_date"] == WEEK.isoformat()
    assert row["decided_at"]
    assert client.get(f"{URL}/{row['id']}").json() == row
    assert snapshot(session, Goal, goal_id) == goal_before
    after = snapshot(session, Task, task_id)
    if action == "delete":
        assert after is None and row["task_id"] is None
        assert row["resolved_due_date"] is None
    else:
        due = {"nextWeek": DUE + timedelta(days=7), "inbox": None, "reschedule": date(2026, 11, 1), "keep": DUE}[action]
        assert after == {**before, "due_date": due, "day": "Inbox" if due is None else DAYS[due.weekday()]}
        expected_resolved = due.isoformat() if action in ("nextWeek", "reschedule") else None
        assert row["resolved_due_date"] == expected_resolved
        assert row["task_id"] == task_id
    assert count(session, WeeklyTaskDecision) == 1


@pytest.mark.parametrize("offset", range(7))
def test_next_week_preserves_each_weekday(decision_client, offset):
    client, session = decision_client
    due = WEEK + timedelta(days=offset)
    task_id = make_task(session, due_date=due)
    session.commit()
    row = apply(client, task_id, "nextWeek", original_due_date=due.isoformat())
    task = snapshot(session, Task, task_id)
    assert row["resolved_due_date"] == (due + timedelta(days=7)).isoformat()
    assert task["due_date"] == due + timedelta(days=7)
    assert task["day"] == DAYS[offset]


@pytest.mark.parametrize("action", ACTIONS[:-1])
def test_identical_retry_is_noop_with_same_id_and_timestamp(decision_client, action):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    row = apply(client, task_id, action)
    before = snapshot(session, Task, task_id)
    history_before = snapshot(session, WeeklyTaskDecision, row["id"])
    response = client.post(URL, json=body(task_id, action))
    assert response.status_code == 200, response.text
    assert response.json() == row
    assert snapshot(session, Task, task_id) == before
    assert snapshot(session, WeeklyTaskDecision, row["id"]) == history_before
    assert count(session, WeeklyTaskDecision) == 1


def test_delete_retry_returns_404_without_duplicate_history(decision_client):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    row = apply(client, task_id, "delete")
    before = snapshot(session, WeeklyTaskDecision, row["id"])
    session.commit()
    response = client.post(URL, json=body(task_id, "delete"))
    assert response.status_code == 404, response.text
    assert snapshot(session, WeeklyTaskDecision, row["id"]) == before
    assert count(session, WeeklyTaskDecision) == 1


def test_update_existing_decision_preserves_native_and_imported_ids(decision_client):
    client, session = decision_client
    task_id = make_task(session)
    old = WeeklyTaskDecision(
        source_weekly_task_decision_id=1_781_204_330_009, week_start=WEEK,
        task_id=task_id, task_title="Imported title", original_due_date=DUE,
        action="keep", decided_at=STAMP,
    )
    session.add(old)
    session.flush()
    decision_id = old.id
    session.commit()
    response = client.post(URL, json=body(task_id, "nextWeek"))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == decision_id
    assert result["source_weekly_task_decision_id"] == 1_781_204_330_009
    assert result["task_title"] == "Historical task title"
    assert result["action"] == "nextWeek"
    assert count(session, WeeklyTaskDecision) == 1


@pytest.mark.parametrize("state", ["completed", "inconsistent", "moved", "inbox", "blank_title"])
def test_rejects_completed_stale_or_unusable_tasks_without_changes(decision_client, state):
    client, session = decision_client
    changes = {
        "completed": dict(completed=True, completed_at=STAMP),
        "inconsistent": dict(completed=False, completed_at=STAMP),
        "moved": dict(due_date=DUE + timedelta(days=1)),
        "inbox": dict(due_date=None), "blank_title": dict(title="   "),
    }[state]
    task_id = make_task(session, **changes)
    session.commit()
    before = snapshot(session, Task, task_id)
    session.commit()
    response = client.post(URL, json=body(task_id, "nextWeek"))
    assert response.status_code == 409, response.text
    assert snapshot(session, Task, task_id) == before
    assert count(session, WeeklyTaskDecision) == 0


def test_different_action_after_task_has_moved_is_rejected(decision_client):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    row = apply(client, task_id, "nextWeek")
    task_before = snapshot(session, Task, task_id)
    before = snapshot(session, WeeklyTaskDecision, row["id"])
    session.commit()
    response = client.post(URL, json=body(task_id, "inbox"))
    assert response.status_code == 409, response.text
    assert snapshot(session, Task, task_id) == task_before
    assert snapshot(session, WeeklyTaskDecision, row["id"]) == before


def test_retry_does_not_move_task_back_after_later_changes(decision_client):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    row = apply(client, task_id, "nextWeek")
    changed = client.patch(f"/api/v1/tasks/{task_id}", json={"due_date": "2026-11-02"})
    assert changed.status_code == 200, changed.text
    before = snapshot(session, Task, task_id)
    history = snapshot(session, WeeklyTaskDecision, row["id"])
    session.commit()
    response = client.post(URL, json=body(task_id, "nextWeek"))
    assert response.status_code == 409, response.text
    assert snapshot(session, Task, task_id) == before
    assert snapshot(session, WeeklyTaskDecision, row["id"]) == history


@pytest.mark.parametrize("legacy", [False, True])
def test_recurring_delete_skips_original_occurrence_and_prevents_regeneration(decision_client, legacy):
    client, session = decision_client
    rule_id = make_rule(session)
    task_id = make_task(session, rule_id=rule_id, legacy=legacy)
    session.commit()
    row = apply(client, task_id, "delete")
    assert row["recurring_rule_id"] == rule_id
    assert snapshot(session, RecurringOccurrenceException, (rule_id, WEEK)) is not None
    assert snapshot(session, RecurringOccurrenceException, (rule_id, DUE)) is None
    generated = client.post("/api/v1/recurring-rules/generate", json={
        "current_date": WEEK.isoformat(), "horizon_days": 0, "recurring_rule_id": rule_id,
    })
    assert generated.status_code == 200, generated.text
    assert generated.json()["created_count"] == 0
    assert generated.json()["skipped_count"] == 1
    assert count(session, Task) == 0


def test_existing_skip_is_retained_when_task_is_deleted(decision_client):
    client, session = decision_client
    rule_id = make_rule(session)
    task_id = make_task(session, rule_id=rule_id)
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=WEEK, created_at=STAMP))
    session.commit()
    before = snapshot(session, RecurringOccurrenceException, (rule_id, WEEK))
    apply(client, task_id, "delete")
    assert snapshot(session, RecurringOccurrenceException, (rule_id, WEEK)) == before
    assert count(session, RecurringOccurrenceException) == 1


def test_source_only_task_without_schedule_keeps_historical_identity(decision_client):
    client, session = decision_client
    task_id = make_task(session, source_recurring_rule_id=SOURCE_RULE, recurrence_occurrence_date=WEEK)
    session.commit()
    row = apply(client, task_id, "delete")
    assert row["recurring_rule_id"] is None
    assert row["source_recurring_rule_id"] == SOURCE_RULE
    assert row["recurrence_occurrence_date"] == WEEK.isoformat()
    assert count(session, RecurringOccurrenceException) == 0


def test_delete_task_clears_older_links_but_preserves_histories_and_commitment(decision_client):
    client, session = decision_client
    task_id = make_task(session)
    previous_week = WEEK - timedelta(days=7)
    previous = WeeklyTaskDecision(week_start=previous_week, task_id=task_id, task_title="Previous title", original_due_date=previous_week, action="keep", decided_at=STAMP)
    commitment = WeeklyCommitment(week_start=WEEK, task_id=task_id, title="Saved promise")
    review = WeeklyReview(week_start=WEEK, what_learned="Keep reflection")
    session.add_all([previous, commitment, review])
    session.flush()
    old_id, commitment_id, review_id = previous.id, commitment.id, review.id
    session.commit()
    old_before = snapshot(session, WeeklyTaskDecision, old_id)
    commitment_before = snapshot(session, WeeklyCommitment, commitment_id)
    review_before = snapshot(session, WeeklyReview, review_id)
    row = apply(client, task_id, "delete")
    assert row["id"] != old_id and row["task_id"] is None
    assert snapshot(session, WeeklyTaskDecision, old_id) == {**old_before, "task_id": None}
    assert snapshot(session, WeeklyCommitment, commitment_id) == {**commitment_before, "task_id": None}
    assert snapshot(session, WeeklyReview, review_id) == review_before


def test_live_task_and_schedule_deletion_do_not_erase_decision_identity(decision_client):
    client, session = decision_client
    rule_id = make_rule(session)
    task_id = make_task(session, rule_id=rule_id)
    session.commit()
    row = apply(client, task_id, "keep")
    before = snapshot(session, WeeklyTaskDecision, row["id"])
    deleted = client.delete(f"/api/v1/recurring-rules/{rule_id}")
    assert deleted.status_code == 204, deleted.text
    assert snapshot(session, WeeklyTaskDecision, row["id"]) == before
    deleted_task = client.delete(f"/api/v1/tasks/{task_id}")
    assert deleted_task.status_code == 204, deleted_task.text
    assert snapshot(session, WeeklyTaskDecision, row["id"]) == {**before, "task_id": None}


@pytest.mark.parametrize("action", ["nextWeek", "delete"])
def test_delete_history_does_not_undo_task_action_or_skip(decision_client, action):
    client, session = decision_client
    rule_id = make_rule(session)
    task_id = make_task(session, rule_id=rule_id)
    session.commit()
    row = apply(client, task_id, action)
    task_before = snapshot(session, Task, task_id)
    skip_before = snapshot(session, RecurringOccurrenceException, (rule_id, WEEK))
    response = client.delete(f"{URL}/{row['id']}")
    assert response.status_code == 204 and response.content == b"", response.text
    assert snapshot(session, WeeklyTaskDecision, row["id"]) is None
    assert snapshot(session, Task, task_id) == task_before
    assert snapshot(session, RecurringOccurrenceException, (rule_id, WEEK)) == skip_before


def test_list_order_and_filters_include_unlinked_history(decision_client):
    client, session = decision_client
    assert client.get(URL).json() == []
    rule_id = make_rule(session)
    first_task = make_task(session, rule_id=rule_id)
    second_task = make_task(session)
    old_task = make_task(session, due_date=DUE - timedelta(days=7))
    session.commit()
    first = apply(client, first_task, "keep")
    second = apply(client, second_task, "delete")
    old = apply(client, old_task, "keep", week_start=(WEEK - timedelta(days=7)).isoformat(), original_due_date=(DUE - timedelta(days=7)).isoformat())
    for identity in [first["id"], second["id"], old["id"]]:
        session.get(WeeklyTaskDecision, identity).decided_at = STAMP
    session.commit()
    for params, expected in [
        ({}, [second["id"], first["id"], old["id"]]),
        ({"week_start": WEEK.isoformat()}, [second["id"], first["id"]]),
        ({"task_id": first_task}, [first["id"]]),
        ({"recurring_rule_id": rule_id}, [first["id"]]),
        ({"action": "delete"}, [second["id"]]),
        ({"week_start": WEEK.isoformat(), "action": "keep"}, [first["id"]]),
        ({"task_id": 999999}, []),
    ]:
        response = client.get(URL, params=params)
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == expected


@pytest.mark.parametrize("changes", [
    {"task_id": None}, {"task_id": 0}, {"task_id": -1}, {"task_id": True},
    {"task_id": "1"}, {"task_id": 2_147_483_648},
    {"week_start": "2026-10-13"}, {"week_start": "bad"},
    {"original_due_date": "2026-10-11"}, {"original_due_date": "2026-10-19"},
    {"action": "unknown"}, {"action": "reschedule", "resolved_due_date": None},
    {"action": "nextWeek", "resolved_due_date": "2026-10-22"},
    {"action": "inbox", "resolved_due_date": "2026-10-22"},
    {"action": "keep", "resolved_due_date": "2026-10-22"},
    {"action": "delete", "resolved_due_date": "2026-10-22"},
    {"task_title": "Forged"}, {"source_weekly_task_decision_id": 123},
    {"recurring_rule_id": 123}, {"source_recurring_rule_id": 123},
    {"recurrence_occurrence_date": "2026-10-12"},
    {"decided_at": "2026-10-12T00:00:00Z"}, {"id": 12},
    {"week_start": "9999-12-27", "original_due_date": "9999-12-31", "action": "nextWeek"},
])
def test_invalid_request_changes_nothing(decision_client, changes):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    before = snapshot(session, Task, task_id)
    session.commit()
    response = client.post(URL, json=body(task_id, **changes))
    assert response.status_code == 422, response.text
    assert snapshot(session, Task, task_id) == before
    assert count(session, WeeklyTaskDecision) == 0


@pytest.mark.parametrize("field", ["task_id", "week_start", "original_due_date", "action"])
def test_missing_required_request_field_returns_422(decision_client, field):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    incoming = body(task_id)
    del incoming[field]
    response = client.post(URL, json=incoming)
    assert response.status_code == 422, response.text
    assert count(session, WeeklyTaskDecision) == 0


def test_missing_task_returns_404(decision_client):
    client, session = decision_client
    response = client.post(URL, json=body(999999))
    assert response.status_code == 404, response.text
    assert count(session, WeeklyTaskDecision) == 0


@pytest.mark.parametrize("params", [
    {"week_start": "2026-10-13"}, {"week_start": "bad"},
    {"task_id": 0}, {"task_id": 2_147_483_648},
    {"recurring_rule_id": -1}, {"recurring_rule_id": 2_147_483_648},
    {"action": "unknown"},
])
def test_invalid_list_filters_return_422(decision_client, params):
    client, _ = decision_client
    response = client.get(URL, params=params)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("method", ["get", "delete"])
def test_missing_history_returns_404(decision_client, method):
    client, _ = decision_client
    response = getattr(client, method)(f"{URL}/999999")
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648])
@pytest.mark.parametrize("method", ["get", "delete"])
def test_invalid_history_id_returns_422(decision_client, identity, method):
    client, _ = decision_client
    response = getattr(client, method)(f"{URL}/{identity}")
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("action", ACTIONS)
def test_real_database_failure_rolls_back_task_history_and_skip(decision_client, action):
    """Inject a real CHECK violation during the history INSERT."""
    client, session = decision_client
    rule_id = make_rule(session)
    task_id = make_task(session, rule_id=rule_id)
    session.commit()
    before = snapshot(session, Task, task_id)
    session.commit()

    def break_action(mapper, connection, target):
        target.action = "bad"

    event.listen(WeeklyTaskDecision, "before_insert", break_action)
    try:
        response = client.post(URL, json=body(task_id, action))
    finally:
        event.remove(WeeklyTaskDecision, "before_insert", break_action)
    assert response.status_code == 409, response.text
    assert snapshot(session, Task, task_id) == before
    assert count(session, WeeklyTaskDecision) == 0
    assert count(session, RecurringOccurrenceException) == 0
    retried = client.post(URL, json=body(task_id, action))
    assert retried.status_code == 201, retried.text


@pytest.mark.parametrize("operation", ["new", "existing", "delete_history"])
def test_commit_failure_preserves_existing_records_and_retry_works(decision_client, monkeypatch, operation):
    client, session = decision_client
    task_id = make_task(session)
    session.commit()
    row = apply(client, task_id, "keep") if operation != "new" else None
    before = snapshot(session, Task, task_id)
    history = snapshot(session, WeeklyTaskDecision, row["id"]) if row else None
    session.commit()

    def request():
        if operation == "delete_history":
            return client.delete(f"{URL}/{row['id']}")
        return client.post(URL, json=body(task_id, "nextWeek"))

    def fail_commit():
        session.flush()
        raise IntegrityError("simulated commit failure", {}, Exception("private test detail"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = request()
    assert response.status_code == 409, response.text
    assert "private test detail" not in response.text
    assert snapshot(session, Task, task_id) == before
    assert count(session, WeeklyTaskDecision) == (1 if row else 0)
    if row:
        assert snapshot(session, WeeklyTaskDecision, row["id"]) == history
    retried = request()
    assert retried.status_code == {"new": 201, "existing": 200, "delete_history": 204}[operation], retried.text
