"""PostgreSQL API tests for keeping a recurring occurrence as a standalone task.

The shared fixture creates test-owned tables in an isolated schema and rolls
back all test data. These requests never use public WeekFlow task tables.
"""

from datetime import timedelta

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError

from app.models import RecurringOccurrenceException, RecurringRule, Task, WeeklyCommitment, WeeklyTaskDecision
from app.routers import recurring_task_workflows as workflow_router
from app.services import recurring_task_workflows as workflow_service
from test_backup_refresh_api import refresh_client
from test_recurring_task_workflows_api import (
    SOURCE_GOAL, SOURCE_RULE, SOURCE_TASK, STAMP, START, WEEK_START,
    count, database_state, make_goal, make_rule, make_task, occurrence, snapshot,
)


@pytest.fixture
def detach_client(refresh_client):
    return refresh_client


def detach(client, task_id):
    """Send only the task ID; the server loads its saved recurring identity."""
    return client.post(f"/api/v1/tasks/{task_id}/detach-recurring")


def assert_detached(response, identity):
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["id"] == identity
    assert task["recurring_rule_id"] is None
    assert task["source_recurring_rule_id"] is None
    assert task["recurrence_occurrence_date"] is None
    assert task["completed"] is False
    assert task["completed_at"] is None
    return task


@pytest.mark.parametrize("identity_mode", ["native", "imported", "source-only"])
@pytest.mark.parametrize("placement", ["scheduled", "inbox", "rescheduled"])
def test_detach_keeps_every_field_except_recurring_identity(detach_client, identity_mode, placement):
    client, session = detach_client
    goal_id = make_goal(session, source_goal_id=SOURCE_GOAL)
    rule_id = make_rule(session, goal_id=goal_id,
        source_recurring_rule_id=None if identity_mode == "native" else SOURCE_RULE)
    changes = {}
    if placement == "inbox":
        changes = {"due_date": None, "day": "Inbox"}
    elif placement == "rescheduled":
        changes = {"due_date": START + timedelta(days=10), "day": "Friday"}
    identity = occurrence(session, rule_id, source_only=identity_mode == "source-only",
        source_task_id=SOURCE_TASK, title="Personal task title", notes="Keep these notes", priority=2,
        **changes)
    session.commit()
    before = database_state(session)
    task_before = snapshot(session, Task, identity)

    saved = assert_detached(detach(client, identity), identity)

    assert snapshot(session, Task, identity) == {
        **task_before, "recurring_rule_id": None,
        "source_recurring_rule_id": None, "recurrence_occurrence_date": None,
    }
    assert saved["source_task_id"] == SOURCE_TASK
    assert saved["goal_id"] == goal_id and saved["source_goal_id"] == SOURCE_GOAL
    skip = session.get(RecurringOccurrenceException, (rule_id, START))
    assert skip is not None and skip.created_at is not None
    after = database_state(session)
    for name in before:
        if name not in {"tasks", "recurring_exceptions"}:
            assert after[name] == before[name], name
    assert count(session, Task) == 1
    assert count(session, RecurringOccurrenceException) == 1


def test_detach_retains_tasks_own_goal_instead_of_current_schedule_goal(detach_client):
    client, session = detach_client
    old_goal = make_goal(session, source_goal_id=SOURCE_GOAL)
    current_goal = make_goal(session, source_goal_id=SOURCE_GOAL + 1)
    rule_id = make_rule(session, goal_id=current_goal)
    identity = occurrence(session, rule_id, goal_id=old_goal, source_goal_id=SOURCE_GOAL)
    session.commit()
    before = snapshot(session, RecurringRule, rule_id)
    saved = assert_detached(detach(client, identity), identity)
    assert saved["goal_id"] == old_goal and saved["source_goal_id"] == SOURCE_GOAL
    assert snapshot(session, RecurringRule, rule_id) == before


def test_detach_preserves_other_occurrences_and_live_weekly_history_links(detach_client):
    client, session = detach_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    identity = occurrence(session, rule_id)
    retained = [occurrence(session, rule_id, -1), occurrence(session, rule_id, 1),
        occurrence(session, rule_id, 2, completed=True, completed_at=STAMP)]
    commitment = WeeklyCommitment(week_start=WEEK_START, task_id=identity,
        title="Saved promise", completed=False, created_at=STAMP)
    decision = WeeklyTaskDecision(week_start=WEEK_START, task_id=identity,
        task_title="Saved historical title", original_due_date=START, action="keep",
        resolved_due_date=None, recurring_rule_id=rule_id, source_recurring_rule_id=SOURCE_RULE,
        recurrence_occurrence_date=START, decided_at=STAMP)
    session.add_all([commitment, decision]); session.flush()
    commitment_id, decision_id = commitment.id, decision.id
    session.commit()
    before = database_state(session)
    retained_before = {key: snapshot(session, Task, key) for key in retained}

    assert_detached(detach(client, identity), identity)

    for key, saved in retained_before.items():
        assert snapshot(session, Task, key) == saved
    after = database_state(session)
    assert after["recurring_rules"] == before["recurring_rules"]
    assert after["weekly_commitments"] == before["weekly_commitments"]
    assert after["weekly_task_decisions"] == before["weekly_task_decisions"]
    assert session.get(WeeklyCommitment, commitment_id).task_id == identity
    assert session.get(WeeklyTaskDecision, decision_id).task_id == identity
    assert count(session, Task) == 4


def test_detach_reuses_existing_skip_without_replacing_its_timestamp(detach_client):
    client, session = detach_client
    rule_id = make_rule(session)
    identity = occurrence(session, rule_id)
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id,
        occurrence_date=START, created_at=STAMP))
    session.commit()
    before = snapshot(session, RecurringOccurrenceException, (rule_id, START))
    assert_detached(detach(client, identity), identity)
    assert snapshot(session, RecurringOccurrenceException, (rule_id, START)) == before
    assert count(session, RecurringOccurrenceException) == 1


@pytest.mark.parametrize("source_only", [False, True])
def test_generation_skips_detached_slot_but_continues_other_dates(detach_client, source_only):
    client, session = detach_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    identity = occurrence(session, rule_id, source_only=source_only, due_date=None, day="Inbox")
    session.commit()
    assert_detached(detach(client, identity), identity)
    before = snapshot(session, Task, identity)
    response = client.post("/api/v1/recurring-rules/generate", json={
        "current_date": START.isoformat(), "horizon_days": 1, "recurring_rule_id": rule_id,
    })
    assert response.status_code == 200, response.text
    summary = response.json()
    assert summary["skipped_count"] == 1 and summary["created_count"] == 1
    assert identity not in summary["created_task_ids"]
    assert snapshot(session, Task, identity) == before
    dates = list(session.scalars(select(Task.recurrence_occurrence_date)
        .where(Task.recurring_rule_id == rule_id)))
    assert dates == [START + timedelta(days=1)]


def test_detach_does_not_restart_a_paused_schedule(detach_client):
    client, session = detach_client
    rule_id = make_rule(session, active=False)
    identity = occurrence(session, rule_id)
    session.commit()
    before = snapshot(session, RecurringRule, rule_id)
    assert_detached(detach(client, identity), identity)
    assert snapshot(session, RecurringRule, rule_id) == before
    assert session.get(RecurringRule, rule_id).active is False


def test_native_schedule_id_takes_priority_over_stale_source_metadata(detach_client):
    client, session = detach_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    other_rule = make_rule(session, source_recurring_rule_id=SOURCE_RULE + 1)
    identity = occurrence(session, rule_id, source_recurring_rule_id=SOURCE_RULE + 1)
    session.commit()
    assert_detached(detach(client, identity), identity)
    assert session.get(RecurringOccurrenceException, (rule_id, START)) is not None
    assert session.get(RecurringOccurrenceException, (other_rule, START)) is None


@pytest.mark.parametrize("completed,completed_at", [(True, STAMP), (True, None), (False, STAMP)])
def test_detach_rejects_completed_or_inconsistent_completion_history(detach_client, completed, completed_at):
    client, session = detach_client
    rule_id = make_rule(session)
    identity = occurrence(session, rule_id, completed=completed, completed_at=completed_at)
    session.commit()
    before = database_state(session)
    assert detach(client, identity).status_code == 409
    assert database_state(session) == before


def test_detach_rejects_standalone_task_without_creating_a_skip(detach_client):
    client, session = detach_client
    identity = make_task(session)
    session.commit()
    before = database_state(session)
    assert detach(client, identity).status_code == 409
    assert database_state(session) == before


def test_repeated_detach_does_not_remove_skip_or_change_task(detach_client):
    client, session = detach_client
    identity = occurrence(session, make_rule(session))
    session.commit()
    assert_detached(detach(client, identity), identity)
    before = database_state(session)
    assert detach(client, identity).status_code == 409
    assert database_state(session) == before


def test_missing_task_returns_404_without_writes(detach_client):
    client, session = detach_client
    before = database_state(session)
    assert detach(client, 2_147_483_647).status_code == 404
    assert database_state(session) == before


def test_missing_source_only_schedule_returns_404_without_writes(detach_client):
    client, session = detach_client
    identity = make_task(session, source_recurring_rule_id=SOURCE_RULE,
        recurrence_occurrence_date=START)
    session.commit()
    before = database_state(session)
    assert detach(client, identity).status_code == 404
    assert database_state(session) == before


@pytest.mark.parametrize("selected_source_only", [False, True])
def test_logical_duplicate_occurrences_are_not_silently_skipped(detach_client, selected_source_only):
    client, session = detach_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    # Separate native/source UNIQUE constraints allow these two legacy rows.
    native = occurrence(session, rule_id, source_recurring_rule_id=None)
    source_only = occurrence(session, rule_id, source_only=True)
    session.commit()
    before = database_state(session)
    identity = source_only if selected_source_only else native
    assert detach(client, identity).status_code == 409
    assert database_state(session) == before


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648, SOURCE_TASK, "1.5", "invalid"])
def test_invalid_task_ids_never_reach_service(detach_client, monkeypatch, identity):
    client, session = detach_client
    before = database_state(session)
    def unexpected(**kwargs):
        pytest.fail("Invalid task ID reached the detach service")
    monkeypatch.setattr(workflow_router, "detach_recurring_task", unexpected)
    assert detach(client, identity).status_code == 422
    assert database_state(session) == before


@pytest.mark.parametrize("stage", ["task-update", "skip-insert"])
def test_real_database_constraint_failure_rolls_back_both_changes(detach_client, stage):
    client, session = detach_client
    identity = occurrence(session, make_rule(session))
    session.commit()
    before = database_state(session)
    model, event_name = (Task, "before_update") if stage == "task-update" else (RecurringOccurrenceException, "before_insert")
    def break_constraint(mapper, connection, target):
        if stage == "task-update":
            target.priority = 99
        else:
            target.recurring_rule_id = 2_147_483_647
    event.listen(model, event_name, break_constraint)
    try:
        response = detach(client, identity)
    finally:
        event.remove(model, event_name, break_constraint)
    assert response.status_code == 409, response.text
    assert database_state(session) == before


def test_commit_failure_rolls_back_skip_and_task_and_allows_retry(detach_client, monkeypatch):
    client, session = detach_client
    identity = occurrence(session, make_rule(session))
    session.commit()
    before = database_state(session)
    def fail_commit():
        session.flush()
        raise IntegrityError("forced test failure", {}, Exception("test only"))
    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = detach(client, identity)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert_detached(detach(client, identity), identity)


def test_response_validation_failure_rolls_back_before_commit(detach_client, monkeypatch):
    client, session = detach_client
    identity = occurrence(session, make_rule(session))
    session.commit()
    before = database_state(session)
    def invalid_response(*args, **kwargs):
        raise ValueError("Forced response validation failure")
    with monkeypatch.context() as patch:
        patch.setattr(workflow_service.TaskRead, "model_validate", invalid_response)
        response = detach(client, identity)
    assert response.status_code == 422, response.text
    assert database_state(session) == before


def test_detach_commits_once_after_both_changes_are_flushed(detach_client, monkeypatch):
    client, session = detach_client
    rule_id = make_rule(session)
    identity = occurrence(session, rule_id)
    session.commit()
    real_commit = session.commit
    commits = 0
    def record_commit():
        nonlocal commits
        commits += 1
        session.flush()
        assert session.get(Task, identity).recurring_rule_id is None
        assert session.get(RecurringOccurrenceException, (rule_id, START)) is not None
        real_commit()
    monkeypatch.setattr(session, "commit", record_commit)
    assert_detached(detach(client, identity), identity)
    assert commits == 1
