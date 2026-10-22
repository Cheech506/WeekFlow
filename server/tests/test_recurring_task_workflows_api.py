"""PostgreSQL API tests for task conversion and recurring-series edits.

The shared fixture creates an isolated schema and rolls back all test data.
Setup commits release savepoints only; they never modify public app tables.
"""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    Goal,
    RecurringOccurrenceException,
    RecurringRule,
    Task,
    WeeklyCommitment,
    WeeklyTaskDecision,
)
from app.routers import recurring_task_workflows as workflow_router
from app.services import recurring_task_workflows as workflow_service
from app.services.backup_import import MODELS
from test_backup_refresh_api import refresh_client


START = date(2026, 10, 20)  # Tuesday; WeekFlow weekday index = 2.
WEEK_START = date(2026, 10, 19)
STAMP = datetime(2001, 1, 1, 12, tzinfo=UTC)
SOURCE_TASK = 1_781_204_340_001
SOURCE_GOAL = 1_781_204_340_002
SOURCE_RULE = 1_781_204_340_003
CONVERT = "convert-to-recurring"
EDIT = "edit-recurring-from-occurrence"


@pytest.fixture
def workflow_client(refresh_client):
    return refresh_client


def endpoint(task_id, action):
    return f"/api/v1/tasks/{task_id}/{action}"


def body(action, **changes):
    values = {
        "title": "  Revised study  ",
        "notes": "  Next steps  ",
        "priority": 2,
        "goal_id": None,
        "frequency": "daily",
        "end_date": None,
        "weekdays": [],
        "current_date": START.isoformat(),
        "horizon_days": 3,
    }
    if action == CONVERT:
        values["start_date"] = START.isoformat()
    values.update(changes)
    return values


def post(client, identity, action, **changes):
    return client.post(endpoint(identity, action), json=body(action, **changes))


def success(response, action):
    assert response.status_code == (201 if action == CONVERT else 200), response.text
    value = response.json()
    assert value["task"]["recurring_rule_id"] == value["rule"]["id"]
    assert value["task"]["recurrence_occurrence_date"] == value["rule"]["start_date"]
    assert value["task"]["completed"] is False
    generation = value["generation"]
    assert generation["rules_checked"] == 1
    assert generation["candidate_count"] == sum(
        generation[key] for key in ("created_count", "existing_count", "skipped_count")
    )
    assert len(generation["created_task_ids"]) == generation["created_count"]
    assert len(set(generation["created_task_ids"])) == generation["created_count"]
    assert generation["database_changed"] is (generation["created_count"] > 0)
    assert value["task"]["id"] not in generation["created_task_ids"]
    assert value["task"]["id"] not in value["deleted_task_ids"]
    return value


def make_goal(session, **changes):
    values = dict(title="Saved goal", start_date=START, end_date=START + timedelta(days=83))
    values.update(changes)
    row = Goal(**values)
    session.add(row)
    session.flush()
    return row.id


def make_rule(session, **changes):
    values = dict(
        title="Old schedule", notes="Old notes", priority=1,
        frequency="daily", start_date=START - timedelta(days=7),
        end_date=None, weekdays=[], active=True, goal_id=None, created_at=STAMP,
    )
    values.update(changes)
    row = RecurringRule(**values)
    session.add(row)
    session.flush()
    return row.id


def make_task(session, **changes):
    values = dict(
        title="Original task", notes="Original notes", priority=1,
        day="Inbox", due_date=None, completed=False,
        completed_at=None, created_at=STAMP,
    )
    values.update(changes)
    row = Task(**values)
    session.add(row)
    session.flush()
    return row.id


def occurrence(session, rule_id, offset=0, *, source_only=False, **changes):
    rule = session.get(RecurringRule, rule_id)
    goal = session.get(Goal, rule.goal_id) if rule.goal_id is not None else None
    occurrence_date = START + timedelta(days=offset)
    values = dict(
        recurring_rule_id=None if source_only else rule_id,
        source_recurring_rule_id=rule.source_recurring_rule_id,
        recurrence_occurrence_date=occurrence_date,
        due_date=occurrence_date, day=occurrence_date.strftime("%A"),
        goal_id=rule.goal_id,
        source_goal_id=goal.source_goal_id if goal is not None else None,
    )
    values.update(changes)
    return make_task(session, **values)


def selected_for_action(session, action, **task_changes):
    if action == CONVERT:
        return make_task(session, **task_changes)
    return occurrence(session, make_rule(session), **task_changes)


def snapshot(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return deepcopy({column.name: getattr(row, column.name) for column in model.__table__.columns})


def database_state(session):
    session.expire_all()
    return {
        name: [
            deepcopy({column.name: getattr(row, column.name) for column in model.__table__.columns})
            for row in session.scalars(
                select(model).order_by(*model.__table__.primary_key.columns)
            ).all()
        ]
        for name, model in MODELS.items()
    }


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def task_dates(session, rule_id):
    return list(session.scalars(
        select(Task.recurrence_occurrence_date)
        .where(Task.recurring_rule_id == rule_id)
        .order_by(Task.recurrence_occurrence_date)
    ).all())


@pytest.mark.parametrize("imported", [False, True])
def test_conversion_keeps_selected_identity_and_creates_one_new_schedule(workflow_client, imported):
    client, session = workflow_client
    goal_id = make_goal(session, source_goal_id=SOURCE_GOAL if imported else None)
    identity = make_task(
        session, source_task_id=SOURCE_TASK if imported else None,
        due_date=START + timedelta(days=8), day="Wednesday",
    )
    unrelated_id = make_task(session, title="Unrelated task")
    session.commit()
    before = snapshot(session, Task, identity)
    unrelated = snapshot(session, Task, unrelated_id)
    goal_before = snapshot(session, Goal, goal_id)

    result = success(post(client, identity, CONVERT, goal_id=goal_id), CONVERT)
    selected = result["task"]
    rule = result["rule"]
    assert selected["id"] == identity
    assert selected["source_task_id"] == before["source_task_id"]
    assert snapshot(session, Task, identity)["created_at"] == before["created_at"]
    assert selected["title"] == rule["title"] == "Revised study"
    assert selected["notes"] == rule["notes"] == "Next steps"
    assert selected["priority"] == rule["priority"] == 2
    assert selected["goal_id"] == rule["goal_id"] == goal_id
    assert selected["source_goal_id"] == (SOURCE_GOAL if imported else None)
    assert selected["source_recurring_rule_id"] is None
    assert rule["source_recurring_rule_id"] is None and rule["active"] is True
    assert selected["due_date"] == START.isoformat() and selected["day"] == "Tuesday"
    assert selected["completed_at"] is None
    assert result["deleted_task_ids"] == []
    assert result["generation"]["created_count"] == 3
    assert result["generation"]["existing_count"] == 1
    assert task_dates(session, rule["id"]) == [START + timedelta(days=n) for n in range(4)]
    for task_id in result["generation"]["created_task_ids"]:
        row = snapshot(session, Task, task_id)
        assert row["source_task_id"] is None and row["source_goal_id"] == selected["source_goal_id"]
        assert row["title"] == "Revised study" and row["goal_id"] == goal_id
    assert snapshot(session, Task, unrelated_id) == unrelated
    assert snapshot(session, Goal, goal_id) == goal_before
    assert count(session, RecurringRule) == 1


def test_conversion_retry_conflicts_without_a_second_schedule_or_duplicate_tasks(workflow_client):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    success(post(client, identity, CONVERT), CONVERT)
    before = database_state(session)
    response = post(client, identity, CONVERT)
    assert response.status_code == 409
    assert database_state(session) == before


@pytest.mark.parametrize("frequency,weekdays,horizon,offsets", [
    ("daily", [], 14, list(range(15))),
    ("weekly", [], 14, [0, 7, 14]),
    ("everyTwoWeeks", [], 14, [0, 14]),
    ("certainDays", [4, 2], 14, [0, 2, 7, 9, 14]),
    ("monthly", [], 40, [0, 31]),
])
def test_conversion_generates_each_frequency_without_duplicating_selected_task(
    workflow_client, frequency, weekdays, horizon, offsets,
):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    result = success(post(client, identity, CONVERT, frequency=frequency, weekdays=weekdays, horizon_days=horizon), CONVERT)
    assert result["generation"]["existing_count"] == 1
    assert result["generation"]["created_count"] == len(offsets) - 1
    assert task_dates(session, result["rule"]["id"]) == [START + timedelta(days=n) for n in offsets]
    assert result["rule"]["weekdays"] == sorted(weekdays)


def test_conversion_uses_device_date_and_only_generates_for_new_rule(workflow_client):
    client, session = workflow_client
    other_rule = make_rule(session)
    identity = make_task(session)
    session.commit()
    result = success(post(client, identity, CONVERT, current_date=(START + timedelta(days=5)).isoformat(), horizon_days=1), CONVERT)
    assert result["generation"]["current_date"] == (START + timedelta(days=5)).isoformat()
    assert result["generation"]["created_count"] == 2 and result["generation"]["existing_count"] == 0
    assert task_dates(session, result["rule"]["id"]) == [START, START + timedelta(days=5), START + timedelta(days=6)]
    assert task_dates(session, other_rule) == []


def test_conversion_future_start_outside_window_still_retains_first_task(workflow_client):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    future = START + timedelta(days=40)
    result = success(post(client, identity, CONVERT, start_date=future.isoformat()), CONVERT)
    assert result["task"]["due_date"] == future.isoformat()
    assert result["generation"]["candidate_count"] == 0
    assert task_dates(session, result["rule"]["id"]) == [future]


def test_conversion_accepts_default_generation_window_and_empty_optional_notes(workflow_client):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    response = client.post(endpoint(identity, CONVERT), json={
        "title": "Study", "frequency": "daily", "start_date": START.isoformat(),
        "current_date": START.isoformat(), "notes": "   ",
    })
    result = success(response, CONVERT)
    assert result["generation"]["horizon_days"] == 30 and result["generation"]["created_count"] == 30
    assert result["task"]["notes"] is None and result["task"]["priority"] == 0


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_actions_accept_long_text_without_truncation(workflow_client, action):
    client, session = workflow_client
    identity = selected_for_action(session, action)
    session.commit()
    title, notes = "x" * 20000, "First line\n" + "y" * 20000
    result = success(post(client, identity, action, title=title, notes=notes, horizon_days=0), action)
    assert result["task"]["title"] == result["rule"]["title"] == title
    assert result["task"]["notes"] == result["rule"]["notes"] == notes


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_actions_reject_completed_tasks_without_changing_any_record(workflow_client, action):
    client, session = workflow_client
    identity = selected_for_action(session, action, completed=True, completed_at=STAMP)
    session.commit()
    before = database_state(session)
    response = post(client, identity, action)
    assert response.status_code == 409
    assert database_state(session) == before


@pytest.mark.parametrize("source_only", [False, True])
def test_conversion_rejects_tasks_already_linked_to_a_schedule(workflow_client, source_only):
    client, session = workflow_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    identity = occurrence(session, rule_id, source_only=source_only)
    session.commit()
    before = database_state(session)
    assert post(client, identity, CONVERT).status_code == 409
    assert database_state(session) == before


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_missing_goal_returns_404_and_saves_nothing(workflow_client, action):
    client, session = workflow_client
    identity = selected_for_action(session, action)
    session.commit()
    before = database_state(session)
    assert post(client, identity, action, goal_id=2_147_483_647).status_code == 404
    assert database_state(session) == before


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_missing_task_returns_404(workflow_client, action):
    client, session = workflow_client
    before = database_state(session)
    assert post(client, 2_147_483_647, action).status_code == 404
    assert database_state(session) == before


def test_edit_rejects_standalone_task(workflow_client):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    before = database_state(session)
    assert post(client, identity, EDIT).status_code == 409
    assert database_state(session) == before


def test_edit_reports_missing_legacy_schedule_without_creating_one(workflow_client):
    client, session = workflow_client
    identity = make_task(session, source_recurring_rule_id=SOURCE_RULE, recurrence_occurrence_date=START)
    session.commit()
    before = database_state(session)
    assert post(client, identity, EDIT).status_code == 404
    assert database_state(session) == before


@pytest.mark.parametrize("placement", ["inbox", "rescheduled"])
def test_edit_preserves_selected_placement_and_all_completed_and_earlier_history(workflow_client, placement):
    client, session = workflow_client
    old_goal = make_goal(session, source_goal_id=SOURCE_GOAL)
    new_goal = make_goal(session, source_goal_id=SOURCE_GOAL + 1, title="New cycle goal")
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE, goal_id=old_goal)
    earlier = occurrence(session, rule_id, -1, source_task_id=SOURCE_TASK - 1)
    previous_completed = occurrence(session, rule_id, -2, completed=True, completed_at=STAMP)
    selected = occurrence(session, rule_id, source_task_id=SOURCE_TASK, due_date=None if placement == "inbox" else date(2027, 1, 1), day="Inbox" if placement == "inbox" else "Friday")
    completed_later = occurrence(session, rule_id, 2, completed=True, completed_at=STAMP)
    completed_source_only = occurrence(session, rule_id, 5, source_only=True, completed=True, completed_at=STAMP)
    pending_moved = occurrence(session, rule_id, 1, due_date=date(2027, 2, 1), day="Monday")
    pending_inbox = occurrence(session, rule_id, 3, due_date=None, day="Inbox")
    pending_source_only = occurrence(session, rule_id, 4, source_only=True)
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=START + timedelta(days=1)))
    session.commit()
    before = database_state(session)
    selected_before = snapshot(session, Task, selected)
    retained = {identity: snapshot(session, Task, identity) for identity in [earlier, previous_completed, completed_later, completed_source_only]}
    rule_before = snapshot(session, RecurringRule, rule_id)

    result = success(post(client, selected, EDIT, goal_id=new_goal), EDIT)
    assert set(result["deleted_task_ids"]) == {pending_moved, pending_inbox, pending_source_only}
    after = snapshot(session, Task, selected)
    for field in ["id", "source_task_id", "created_at", "completed", "completed_at", "due_date", "day", "recurrence_occurrence_date"]:
        assert after[field] == selected_before[field]
    assert after["title"] == "Revised study" and after["notes"] == "Next steps" and after["priority"] == 2
    assert after["goal_id"] == new_goal and after["source_goal_id"] == SOURCE_GOAL + 1
    for identity, saved in retained.items():
        assert snapshot(session, Task, identity) == saved
    for identity in result["deleted_task_ids"]:
        assert snapshot(session, Task, identity) is None
    for identity in result["generation"]["created_task_ids"]:
        row = snapshot(session, Task, identity)
        assert row["goal_id"] == new_goal and row["source_goal_id"] == SOURCE_GOAL + 1
    assert result["rule"]["id"] == rule_id and result["rule"]["source_recurring_rule_id"] == SOURCE_RULE
    assert snapshot(session, RecurringRule, rule_id)["created_at"] == rule_before["created_at"]
    assert result["rule"]["start_date"] == START.isoformat()
    assert result["generation"]["created_count"] == 1
    assert result["generation"]["existing_count"] == 2
    assert result["generation"]["skipped_count"] == 1
    after_state = database_state(session)
    for name in before:
        if name not in {"tasks", "recurring_rules"}:
            assert after_state[name] == before[name]


def test_edit_rebuild_clears_live_weekly_links_but_keeps_saved_history(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    selected = occurrence(session, rule_id)
    later = occurrence(session, rule_id, 1)
    commitment = WeeklyCommitment(week_start=WEEK_START, task_id=later, title="Historical promise", completed=False, created_at=STAMP)
    decision = WeeklyTaskDecision(
        week_start=WEEK_START, task_id=later, task_title="Historical task title",
        original_due_date=START + timedelta(days=1), action="keep", resolved_due_date=None,
        recurring_rule_id=rule_id, source_recurring_rule_id=SOURCE_RULE,
        recurrence_occurrence_date=START + timedelta(days=1), decided_at=STAMP,
    )
    session.add_all([commitment, decision])
    session.flush()
    commitment_id, decision_id = commitment.id, decision.id
    session.commit()
    commitment_before = snapshot(session, WeeklyCommitment, commitment_id)
    decision_before = snapshot(session, WeeklyTaskDecision, decision_id)
    result = success(post(client, selected, EDIT), EDIT)
    assert later in result["deleted_task_ids"]
    assert snapshot(session, WeeklyCommitment, commitment_id) == {**commitment_before, "task_id": None}
    assert snapshot(session, WeeklyTaskDecision, decision_id) == {**decision_before, "task_id": None}
    assert count(session, WeeklyCommitment) == count(session, WeeklyTaskDecision) == 1


def test_conversion_preserves_selected_task_weekly_links(workflow_client):
    client, session = workflow_client
    identity = make_task(session, due_date=START, day="Tuesday")
    row = WeeklyCommitment(week_start=WEEK_START, task_id=identity, title="Existing promise", completed=False)
    session.add(row); session.flush()
    commitment_id = row.id
    session.commit()
    before = snapshot(session, WeeklyCommitment, commitment_id)
    success(post(client, identity, CONVERT), CONVERT)
    assert snapshot(session, WeeklyCommitment, commitment_id) == before


def test_edit_resolves_source_only_selected_link_without_rewriting_source_only_history(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    selected = occurrence(session, rule_id, source_only=True, source_task_id=SOURCE_TASK)
    earlier = occurrence(session, rule_id, -1, source_only=True)
    completed = occurrence(session, rule_id, 1, source_only=True, completed=True, completed_at=STAMP)
    session.commit()
    history_before = {identity: snapshot(session, Task, identity) for identity in [earlier, completed]}
    result = success(post(client, selected, EDIT), EDIT)
    assert result["task"]["recurring_rule_id"] == rule_id
    assert result["task"]["source_task_id"] == SOURCE_TASK
    assert result["task"]["source_recurring_rule_id"] == SOURCE_RULE
    for identity, row in history_before.items():
        assert snapshot(session, Task, identity) == row


def test_edit_uses_native_rule_authority_for_deletion(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    other_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE + 1)
    selected = occurrence(session, rule_id)
    # Stale source metadata must not make a different native rule's task a
    # deletion target. Keep this date outside the generation window too.
    unrelated = occurrence(session, other_id, 40, source_recurring_rule_id=SOURCE_RULE)
    session.commit()
    before = snapshot(session, Task, unrelated)
    result = success(post(client, selected, EDIT), EDIT)
    assert unrelated not in result["deleted_task_ids"]
    assert snapshot(session, Task, unrelated) == before


def test_edit_uses_native_selected_rule_even_with_stale_source_metadata(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    other_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE + 1)
    selected = occurrence(session, rule_id, source_recurring_rule_id=SOURCE_RULE + 1)
    session.commit()
    other_before = snapshot(session, RecurringRule, other_id)
    result = success(post(client, selected, EDIT), EDIT)
    assert result["rule"]["id"] == rule_id
    assert result["task"]["source_recurring_rule_id"] == SOURCE_RULE
    assert snapshot(session, RecurringRule, other_id) == other_before


def test_edit_paused_rule_stays_paused_and_generates_nothing(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session, active=False)
    selected = occurrence(session, rule_id)
    later = occurrence(session, rule_id, 1)
    completed = occurrence(session, rule_id, 2, completed=True, completed_at=STAMP)
    session.commit()
    completed_before = snapshot(session, Task, completed)
    result = success(post(client, selected, EDIT), EDIT)
    assert result["rule"]["active"] is False
    assert result["deleted_task_ids"] == [later]
    assert result["generation"]["candidate_count"] == 0
    assert count(session, Task) == 2
    assert snapshot(session, Task, completed) == completed_before


def test_edit_to_weekly_removes_obsolete_future_dates_and_regenerates_pattern(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session)
    selected = occurrence(session, rule_id)
    obsolete = [occurrence(session, rule_id, n) for n in [1, 2, 40]]
    session.commit()
    result = success(post(client, selected, EDIT, frequency="weekly", horizon_days=14), EDIT)
    assert set(result["deleted_task_ids"]) == set(obsolete)
    assert task_dates(session, rule_id) == [START, START + timedelta(days=7), START + timedelta(days=14)]
    assert result["generation"]["created_count"] == 2


def test_selected_date_may_remain_outside_revised_selected_weekdays(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session)
    selected = occurrence(session, rule_id)
    session.commit()
    result = success(post(client, selected, EDIT, frequency="certainDays", weekdays=[3], horizon_days=2), EDIT)
    assert result["task"]["recurrence_occurrence_date"] == START.isoformat()
    assert task_dates(session, rule_id) == [START, START + timedelta(days=1)]
    assert result["generation"]["candidate_count"] == result["generation"]["created_count"] == 1


def test_edit_omitted_optional_values_clear_fields_as_a_complete_form(workflow_client):
    client, session = workflow_client
    goal_id = make_goal(session, source_goal_id=SOURCE_GOAL)
    rule_id = make_rule(session, goal_id=goal_id, end_date=START + timedelta(days=30))
    selected = occurrence(session, rule_id)
    earlier = occurrence(session, rule_id, -1)
    session.commit()
    earlier_before = snapshot(session, Task, earlier)
    response = client.post(endpoint(selected, EDIT), json={
        "title": "Only required values", "frequency": "daily",
        "current_date": START.isoformat(), "horizon_days": 0,
    })
    result = success(response, EDIT)
    assert result["rule"]["goal_id"] is None and result["rule"]["end_date"] is None
    assert result["rule"]["notes"] is None and result["rule"]["priority"] == 0
    assert result["task"]["goal_id"] is None and result["task"]["source_goal_id"] is None
    assert snapshot(session, Task, earlier) == earlier_before


def test_edit_end_date_is_checked_against_original_date_not_rescheduled_date(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session)
    selected = occurrence(session, rule_id, due_date=START - timedelta(days=10), day="Saturday")
    session.commit()
    before = database_state(session)
    response = post(client, selected, EDIT, end_date=(START - timedelta(days=1)).isoformat())
    assert response.status_code == 422 and isinstance(response.json()["detail"], list)
    assert database_state(session) == before


def test_edit_end_date_can_stop_after_selected_occurrence(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session)
    selected = occurrence(session, rule_id)
    later = occurrence(session, rule_id, 1)
    session.commit()
    result = success(post(client, selected, EDIT, end_date=START.isoformat()), EDIT)
    assert result["deleted_task_ids"] == [later]
    assert task_dates(session, rule_id) == [START]
    assert result["generation"]["created_count"] == 0


def test_edit_does_not_erase_selected_skip_to_allow_an_inconsistent_task(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session)
    selected = occurrence(session, rule_id)
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=START))
    session.commit()
    before = database_state(session)
    assert post(client, selected, EDIT).status_code == 409
    assert database_state(session) == before


def test_source_occurrence_owned_by_other_native_rule_rolls_back_entire_edit(workflow_client):
    client, session = workflow_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE)
    other = make_rule(session)
    selected = occurrence(session, rule_id)
    occurrence(session, rule_id, 2)
    occurrence(session, other, 1, source_recurring_rule_id=SOURCE_RULE)
    session.commit()
    before = database_state(session)
    assert post(client, selected, EDIT).status_code == 409
    assert database_state(session) == before


@pytest.mark.parametrize("action", [CONVERT, EDIT])
@pytest.mark.parametrize("changes", [
    {"title": "   "}, {"title": None}, {"frequency": "yearly"},
    {"priority": True}, {"priority": "1"}, {"priority": 3},
    {"goal_id": 0}, {"goal_id": True}, {"goal_id": "3"},
    {"goal_id": 2_147_483_648}, {"weekdays": [2, 2]},
    {"weekdays": [7]}, {"weekdays": [True]}, {"weekdays": None},
    {"frequency": "certainDays", "weekdays": []},
    {"current_date": None}, {"current_date": "invalid-date"},
    {"horizon_days": -1}, {"horizon_days": 367}, {"horizon_days": True},
    {"horizon_days": "30"}, {"current_date": "9999-12-31"},
    {"source_task_id": SOURCE_TASK}, {"source_goal_id": SOURCE_GOAL},
    {"source_recurring_rule_id": SOURCE_RULE}, {"id": 123},
    {"recurring_rule_id": 123}, {"completed": True},
    {"recurrence_occurrence_date": START.isoformat()},
    {"created_at": STAMP.isoformat()},
])
def test_invalid_payloads_never_reach_service_or_change_database(workflow_client, monkeypatch, action, changes):
    client, session = workflow_client
    identity = selected_for_action(session, action)
    session.commit()
    before = database_state(session)
    def unexpected(**kwargs):
        pytest.fail("Invalid payload reached workflow service")
    target = "convert_task_to_recurring" if action == CONVERT else "edit_recurring_from_occurrence"
    monkeypatch.setattr(workflow_router, target, unexpected)
    assert post(client, identity, action, **changes).status_code == 422
    assert database_state(session) == before


@pytest.mark.parametrize("changes", [
    {"active": False}, {"active": 1}, {"start_date": None},
    {"end_date": (START - timedelta(days=1)).isoformat()},
    {"frequency": "certainDays", "weekdays": [1, 3]},
])
def test_conversion_specific_invalid_settings(workflow_client, changes):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    before = database_state(session)
    assert post(client, identity, CONVERT, **changes).status_code == 422
    assert database_state(session) == before


@pytest.mark.parametrize("changes", [{"start_date": START.isoformat()}, {"active": True}])
def test_edit_cannot_override_saved_anchor_or_active_state(workflow_client, changes):
    client, session = workflow_client
    identity = selected_for_action(session, EDIT)
    session.commit()
    before = database_state(session)
    assert post(client, identity, EDIT, **changes).status_code == 422
    assert database_state(session) == before


@pytest.mark.parametrize("action", [CONVERT, EDIT])
@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648, "invalid"])
def test_invalid_task_ids_return_422(workflow_client, action, identity):
    client, session = workflow_client
    before = database_state(session)
    assert post(client, identity, action).status_code == 422
    assert database_state(session) == before


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_missing_body_returns_422(workflow_client, action):
    client, _ = workflow_client
    assert client.post(endpoint(1, action)).status_code == 422


@pytest.mark.parametrize("action", [CONVERT, EDIT])
@pytest.mark.parametrize("field", ["title", "frequency", "current_date"])
def test_missing_required_fields_return_422(workflow_client, action, field):
    client, _ = workflow_client
    payload = body(action)
    del payload[field]
    assert client.post(endpoint(1, action), json=payload).status_code == 422


@pytest.mark.parametrize("stage", ["rule-insert", "selected-update", "generated-insert"])
def test_conversion_real_constraint_failure_rolls_back_schedule_task_and_generation(workflow_client, stage):
    client, session = workflow_client
    identity = make_task(session)
    session.commit()
    before = database_state(session)
    model, event_name = (RecurringRule, "before_insert") if stage == "rule-insert" else (Task, "before_update" if stage == "selected-update" else "before_insert")
    inserts = 0
    def reject_write(mapper, connection, target):
        nonlocal inserts
        inserts += 1
        # Permit one generated task first to test rollback of partial work.
        if stage != "generated-insert" or inserts == 2:
            target.priority = 99
    event.listen(model, event_name, reject_write)
    try:
        response = post(client, identity, CONVERT)
    finally:
        event.remove(model, event_name, reject_write)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert count(session, RecurringRule) == 0


@pytest.mark.parametrize("stage", ["rule-update", "selected-update", "generated-insert"])
def test_edit_real_constraint_failure_rolls_back_changes_deletion_and_weekly_unlink(workflow_client, stage):
    client, session = workflow_client
    rule_id = make_rule(session)
    selected = occurrence(session, rule_id)
    later = occurrence(session, rule_id, 1)
    session.add(WeeklyCommitment(week_start=WEEK_START, task_id=later, title="Preserve live link on rollback", completed=False))
    session.commit()
    before = database_state(session)
    model, event_name = (RecurringRule, "before_update") if stage == "rule-update" else (Task, "before_update" if stage == "selected-update" else "before_insert")
    inserts = 0
    def reject_write(mapper, connection, target):
        nonlocal inserts
        inserts += 1
        if stage != "generated-insert" or inserts == 2:
            target.priority = 99
    event.listen(model, event_name, reject_write)
    try:
        response = post(client, selected, EDIT)
    finally:
        event.remove(model, event_name, reject_write)
    assert response.status_code == 409, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_commit_failure_rolls_back_all_changes_and_allows_retry(workflow_client, monkeypatch, action):
    client, session = workflow_client
    identity = selected_for_action(session, action)
    if action == EDIT:
        selected = session.get(Task, identity)
        later = occurrence(session, selected.recurring_rule_id, 1)
        session.add(WeeklyCommitment(week_start=WEEK_START, task_id=later, title="Keep link if commit fails", completed=False))
    session.commit()
    before = database_state(session)
    def fail_commit():
        session.flush()
        raise IntegrityError("forced test commit failure", {}, Exception("test only"))
    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = post(client, identity, action)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    success(post(client, identity, action), action)


@pytest.mark.parametrize("action", [CONVERT, EDIT])
def test_workflow_commits_once_after_generation_and_response_validation(workflow_client, monkeypatch, action):
    client, session = workflow_client
    identity = selected_for_action(session, action)
    session.commit()
    commits = 0
    real_commit = session.commit
    def record_commit():
        nonlocal commits
        commits += 1
        real_commit()
    monkeypatch.setattr(session, "commit", record_commit)
    success(post(client, identity, action), action)
    assert commits == 1
