"""PostgreSQL API tests for rebuilding a schedule's unfinished occurrences.

The shared fixture creates test-owned tables in an isolated schema. Endpoint
commits release savepoints; the fixture rolls back all test tables afterward.
"""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, select

from app.models import (
    Goal,
    RecurringOccurrenceException,
    RecurringRule,
    Task,
    WeeklyCommitment,
    WeeklyTaskDecision,
)
from app.routers import recurring_rules as router_module
from app.services import recurring_series_edit as service_module
from app.services.backup_import import MODELS
from test_backup_refresh_api import refresh_client


TODAY = date(2026, 10, 20)  # Tuesday; WeekFlow weekday index = 2.
STAMP = datetime(2001, 1, 1, 12, tzinfo=UTC)
SOURCE = 1_781_204_350_000


@pytest.fixture
def series_client(refresh_client):
    return refresh_client


def endpoint(rule_id):
    return f"/api/v1/recurring-rules/{rule_id}/edit-series"


def body(**changes):
    values = {
        "title": "  Revised schedule  ",
        "notes": "  New details  ",
        "priority": 2,
        "goal_id": None,
        "frequency": "daily",
        "start_date": TODAY.isoformat(),
        "end_date": None,
        "weekdays": [],
        "current_date": TODAY.isoformat(),
        "horizon_days": 3,
    }
    values.update(changes)
    return values


def post(client, rule_id, **changes):
    return client.post(endpoint(rule_id), json=body(**changes))


def save(session, model, **values):
    row = model(**values)
    session.add(row)
    session.flush()
    return row.id


def make_goal(session, **changes):
    values = dict(title="Saved goal", start_date=TODAY, end_date=TODAY + timedelta(days=83))
    values.update(changes)
    return save(session, Goal, **values)


def make_rule(session, **changes):
    values = dict(
        title="Old schedule", notes="Old notes", priority=1,
        frequency="daily", start_date=TODAY - timedelta(days=7),
        end_date=None, weekdays=[], active=True, goal_id=None, created_at=STAMP,
    )
    values.update(changes)
    return save(session, RecurringRule, **values)


def occurrence(session, rule_id, offset=0, *, source_only=False, **changes):
    rule = session.get(RecurringRule, rule_id)
    goal = session.get(Goal, rule.goal_id) if rule.goal_id is not None else None
    when = TODAY + timedelta(days=offset)
    values = dict(
        title="Original task", notes="Original notes", priority=1,
        day=when.strftime("%A"), due_date=when,
        completed=False, completed_at=None, created_at=STAMP,
        goal_id=rule.goal_id,
        source_goal_id=goal.source_goal_id if goal is not None else None,
        recurring_rule_id=None if source_only else rule_id,
        source_recurring_rule_id=rule.source_recurring_rule_id,
        recurrence_occurrence_date=when,
    )
    values.update(changes)
    return save(session, Task, **values)


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
            for row in session.scalars(select(model).order_by(*model.__table__.primary_key.columns)).all()
        ]
        for name, model in MODELS.items()
    }


def task_dates(session, rule_id):
    session.expire_all()
    return list(session.scalars(
        select(Task.recurrence_occurrence_date)
        .where(Task.recurring_rule_id == rule_id)
        .order_by(Task.recurrence_occurrence_date)
    ).all())


def success(response, rule_id):
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["rule"]["id"] == rule_id
    generation = value["generation"]
    assert generation["rules_checked"] == 1
    assert generation["candidate_count"] == sum(
        generation[key] for key in ("created_count", "existing_count", "skipped_count")
    )
    created = generation["created_task_ids"]
    deleted = value["deleted_task_ids"]
    updated = value["updated_task_ids"]
    assert len(created) == len(set(created)) == generation["created_count"]
    assert len(deleted) == len(set(deleted))
    assert len(updated) == len(set(updated))
    assert not (set(created) & set(deleted) or set(created) & set(updated) or set(deleted) & set(updated))
    # database_changed describes generation, not the schedule edit itself.
    assert generation["database_changed"] is (generation["created_count"] > 0)
    return value


@pytest.mark.parametrize("imported", [False, True])
def test_edit_preserves_schedule_identity_completed_history_and_unrelated_data(series_client, imported):
    client, session = series_client
    old_goal = make_goal(session, source_goal_id=SOURCE + 1 if imported else None)
    new_goal = make_goal(session, source_goal_id=SOURCE + 2 if imported else None)
    rule_id = make_rule(session, goal_id=old_goal, source_recurring_rule_id=SOURCE if imported else None)
    earlier = occurrence(session, rule_id, -1, due_date=None, day="Inbox", source_task_id=SOURCE + 10 if imported else None)
    done_before = occurrence(session, rule_id, -2, completed=True, completed_at=STAMP)
    done_future = occurrence(session, rule_id, 2, completed=True, completed_at=STAMP)
    pending = [occurrence(session, rule_id, n) for n in [0, 1, 40]]
    other_rule = make_rule(session, title="Unrelated schedule")
    other_task = occurrence(session, other_rule)
    session.commit()
    rule_before = snapshot(session, RecurringRule, rule_id)
    earlier_before = snapshot(session, Task, earlier)
    retained = {identity: snapshot(session, Task, identity) for identity in [done_before, done_future, other_task]}
    other_before = snapshot(session, RecurringRule, other_rule)
    goals_before = {identity: snapshot(session, Goal, identity) for identity in [old_goal, new_goal]}

    value = success(post(client, rule_id, goal_id=new_goal), rule_id)
    assert set(value["deleted_task_ids"]) == set(pending)
    assert value["updated_task_ids"] == [earlier]
    assert value["generation"]["created_count"] == 3
    assert value["generation"]["existing_count"] == 1
    rule_after = snapshot(session, RecurringRule, rule_id)
    for field in ["id", "source_recurring_rule_id", "created_at", "active"]:
        assert rule_after[field] == rule_before[field]
    assert rule_after["title"] == "Revised schedule" and rule_after["goal_id"] == new_goal
    earlier_after = snapshot(session, Task, earlier)
    expected = {**earlier_before, "title": "Revised schedule", "notes": "New details", "priority": 2,
                "goal_id": new_goal, "source_goal_id": SOURCE + 2 if imported else None}
    assert earlier_after == expected
    for identity, saved in retained.items():
        assert snapshot(session, Task, identity) == saved
    assert snapshot(session, RecurringRule, other_rule) == other_before
    for identity, saved in goals_before.items():
        assert snapshot(session, Goal, identity) == saved
    for identity in pending:
        assert snapshot(session, Task, identity) is None
    for identity in value["generation"]["created_task_ids"]:
        task = snapshot(session, Task, identity)
        assert task["goal_id"] == new_goal and task["source_task_id"] is None
        assert task["title"] == "Revised schedule" and task["priority"] == 2
        assert task["source_recurring_rule_id"] == (SOURCE if imported else None)
        assert task["completed"] is False and task["completed_at"] is None


def test_original_occurrence_date_controls_rebuild_despite_rescheduling_or_inbox(series_client):
    client, session = series_client
    rule_id = make_rule(session)
    earlier = occurrence(session, rule_id, -1, due_date=TODAY + timedelta(days=30), day="Thursday")
    today_inbox = occurrence(session, rule_id, due_date=None, day="Inbox")
    future_moved_back = occurrence(session, rule_id, 1, due_date=TODAY - timedelta(days=10), day="Saturday")
    session.commit()
    before = snapshot(session, Task, earlier)
    value = success(post(client, rule_id, horizon_days=1), rule_id)
    assert set(value["deleted_task_ids"]) == {today_inbox, future_moved_back}
    assert value["updated_task_ids"] == [earlier]
    after = snapshot(session, Task, earlier)
    for field in ["id", "due_date", "day", "recurrence_occurrence_date", "created_at"]:
        assert after[field] == before[field]


def test_source_only_imports_are_rebuilt_or_updated_using_their_original_slot(series_client):
    client, session = series_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE)
    earlier = occurrence(session, rule_id, -1, source_only=True, source_task_id=SOURCE + 1)
    pending = occurrence(session, rule_id, source_only=True, source_task_id=SOURCE + 2)
    done = occurrence(session, rule_id, 1, source_only=True, completed=True, completed_at=STAMP)
    session.commit()
    before = snapshot(session, Task, done)
    value = success(post(client, rule_id, horizon_days=1), rule_id)
    assert value["deleted_task_ids"] == [pending] and value["updated_task_ids"] == [earlier]
    assert snapshot(session, Task, earlier)["recurring_rule_id"] is None
    assert snapshot(session, Task, earlier)["source_task_id"] == SOURCE + 1
    assert snapshot(session, Task, done) == before
    assert value["generation"]["existing_count"] == 1
    assert value["generation"]["created_count"] == 1


@pytest.mark.parametrize("frequency,weekdays,horizon,offsets", [
    ("daily", [], 3, [0, 1, 2, 3]),
    ("weekly", [], 14, [0, 7, 14]),
    ("everyTwoWeeks", [], 28, [0, 14, 28]),
    ("certainDays", [4, 2], 9, [0, 2, 7, 9]),
    ("monthly", [], 40, [0, 31]),
])
def test_edit_replaces_obsolete_occurrences_with_the_new_pattern(series_client, frequency, weekdays, horizon, offsets):
    client, session = series_client
    rule_id = make_rule(session)
    obsolete = [occurrence(session, rule_id, n) for n in [0, 1, 40, 80]]
    session.commit()
    value = success(post(client, rule_id, frequency=frequency, weekdays=weekdays, horizon_days=horizon), rule_id)
    assert set(value["deleted_task_ids"]) == set(obsolete)
    assert task_dates(session, rule_id) == [TODAY + timedelta(days=n) for n in offsets]
    assert value["generation"]["created_count"] == len(offsets)
    assert value["rule"]["weekdays"] == sorted(weekdays)


def test_edit_preserves_skips_and_does_not_regenerate_skipped_dates(series_client):
    client, session = series_client
    rule_id = make_rule(session)
    skipped = TODAY + timedelta(days=1)
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=skipped, created_at=STAMP))
    session.commit()
    before = snapshot(session, RecurringOccurrenceException, (rule_id, skipped))
    value = success(post(client, rule_id, horizon_days=2), rule_id)
    assert value["generation"]["skipped_count"] == 1
    assert task_dates(session, rule_id) == [TODAY, TODAY + timedelta(days=2)]
    assert snapshot(session, RecurringOccurrenceException, (rule_id, skipped)) == before


def test_edit_preserves_paused_state_and_completed_history_without_creating_tasks(series_client):
    client, session = series_client
    rule_id = make_rule(session, active=False)
    earlier = occurrence(session, rule_id, -1)
    pending = occurrence(session, rule_id)
    done = occurrence(session, rule_id, 1, completed=True, completed_at=STAMP)
    session.commit()
    before = snapshot(session, Task, done)
    value = success(post(client, rule_id), rule_id)
    assert value["rule"]["active"] is False
    assert value["deleted_task_ids"] == [pending] and value["updated_task_ids"] == [earlier]
    assert value["generation"]["candidate_count"] == 0
    assert snapshot(session, Task, done) == before


def test_device_date_is_the_inclusive_cutoff_and_unrelated_schedules_are_not_generated(series_client):
    client, session = series_client
    rule_id = make_rule(session)
    retained = occurrence(session, rule_id, 4)
    replaced = occurrence(session, rule_id, 5)
    other_rule = make_rule(session)
    session.commit()
    cutoff = TODAY + timedelta(days=5)
    value = success(post(client, rule_id, current_date=cutoff.isoformat(), horizon_days=0), rule_id)
    assert value["deleted_task_ids"] == [replaced] and value["updated_task_ids"] == [retained]
    assert value["generation"]["current_date"] == cutoff.isoformat()
    assert task_dates(session, rule_id) == [TODAY + timedelta(days=4), cutoff]
    assert task_dates(session, other_rule) == []


@pytest.mark.parametrize("start_offset,end_offset,expected", [(5, None, []), (-10, -1, []), (0, 1, [0, 1])])
def test_revised_date_bounds_limit_generation(series_client, start_offset, end_offset, expected):
    client, session = series_client
    rule_id = make_rule(session)
    pending = occurrence(session, rule_id)
    session.commit()
    value = success(post(client, rule_id,
        start_date=(TODAY + timedelta(days=start_offset)).isoformat(),
        end_date=None if end_offset is None else (TODAY + timedelta(days=end_offset)).isoformat(),
    ), rule_id)
    assert value["deleted_task_ids"] == [pending]
    assert task_dates(session, rule_id) == [TODAY + timedelta(days=n) for n in expected]


def test_omitted_optional_values_clear_fields_and_unlink_earlier_unfinished_tasks(series_client):
    client, session = series_client
    goal_id = make_goal(session, source_goal_id=SOURCE + 1)
    rule_id = make_rule(session, goal_id=goal_id, end_date=TODAY + timedelta(days=40))
    earlier = occurrence(session, rule_id, -1)
    session.commit()
    value = success(client.post(endpoint(rule_id), json={
        "title": "Required fields", "frequency": "daily",
        "start_date": TODAY.isoformat(), "current_date": TODAY.isoformat(), "horizon_days": 0,
    }), rule_id)
    assert value["rule"]["notes"] is None and value["rule"]["priority"] == 0
    assert value["rule"]["goal_id"] is None and value["rule"]["end_date"] is None
    task = snapshot(session, Task, earlier)
    assert task["goal_id"] is None and task["source_goal_id"] is None
    assert task["notes"] is None and task["priority"] == 0


def test_rebuild_clears_weekly_live_links_but_preserves_saved_history(series_client):
    client, session = series_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE)
    pending = occurrence(session, rule_id)
    commitment = save(session, WeeklyCommitment,
        week_start=date(2026, 10, 19), task_id=pending, title="Saved promise",
        completed=False, created_at=STAMP,
    )
    decision = save(session, WeeklyTaskDecision,
        week_start=date(2026, 10, 19), task_id=pending, task_title="Saved task title",
        original_due_date=TODAY, action="keep", resolved_due_date=None,
        recurring_rule_id=rule_id, source_recurring_rule_id=SOURCE,
        recurrence_occurrence_date=TODAY, decided_at=STAMP,
    )
    session.commit()
    saved_commitment = snapshot(session, WeeklyCommitment, commitment)
    saved_decision = snapshot(session, WeeklyTaskDecision, decision)
    value = success(post(client, rule_id), rule_id)
    assert value["deleted_task_ids"] == [pending]
    assert snapshot(session, WeeklyCommitment, commitment) == {**saved_commitment, "task_id": None}
    assert snapshot(session, WeeklyTaskDecision, decision) == {**saved_decision, "task_id": None}


def test_conflicting_source_slot_owned_by_another_native_rule_rolls_back_edit(series_client):
    client, session = series_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE)
    earlier = occurrence(session, rule_id, -1)
    occurrence(session, rule_id)
    other_rule = make_rule(session)
    occurrence(session, other_rule, 1, source_recurring_rule_id=SOURCE)
    session.commit()
    before = database_state(session)
    response = post(client, rule_id)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert snapshot(session, Task, earlier)["title"] == "Original task"


@pytest.mark.parametrize("missing", ["rule", "goal"])
def test_missing_schedule_or_goal_returns_404_without_changing_records(series_client, missing):
    client, session = series_client
    rule_id = make_rule(session)
    occurrence(session, rule_id)
    session.commit()
    before = database_state(session)
    response = post(client, 2_147_483_647) if missing == "rule" else post(client, rule_id, goal_id=2_147_483_647)
    assert response.status_code == 404, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("changes", [
    {"title": "   "}, {"priority": True}, {"goal_id": 0},
    {"frequency": "yearly"}, {"frequency": "certainDays", "weekdays": []},
    {"weekdays": [2, 2]}, {"weekdays": [7]},
    {"active": True}, {"source_recurring_rule_id": SOURCE},
    {"start_date": None}, {"end_date": (TODAY - timedelta(days=1)).isoformat()},
    {"current_date": "invalid"}, {"horizon_days": -1}, {"horizon_days": 367},
])
def test_invalid_payload_never_reaches_service_or_changes_records(series_client, monkeypatch, changes):
    client, session = series_client
    rule_id = make_rule(session)
    session.commit()
    before = database_state(session)
    def unexpected(**kwargs):
        pytest.fail("Invalid request reached the service")
    monkeypatch.setattr(router_module, "edit_recurring_series", unexpected)
    assert post(client, rule_id, **changes).status_code == 422
    assert database_state(session) == before


@pytest.mark.parametrize("field", ["title", "frequency", "start_date", "current_date"])
def test_missing_required_field_returns_422(series_client, field):
    client, _ = series_client
    payload = body()
    del payload[field]
    assert client.post(endpoint(1), json=payload).status_code == 422


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648, "invalid"])
def test_invalid_schedule_id_returns_422(series_client, identity):
    client, _ = series_client
    assert post(client, identity).status_code == 422


@pytest.mark.parametrize("stage", ["schedule-update", "earlier-task-update", "generated-insert"])
def test_real_database_constraint_failure_rolls_back_schedule_deletions_and_partial_generation(series_client, stage):
    client, session = series_client
    rule_id = make_rule(session)
    occurrence(session, rule_id, -1)
    occurrence(session, rule_id)
    session.commit()
    before = database_state(session)
    model = RecurringRule if stage == "schedule-update" else Task
    event_name = "before_insert" if stage == "generated-insert" else "before_update"
    writes = 0
    def reject_write(mapper, connection, target):
        nonlocal writes
        writes += 1
        # Let one replacement task be inserted before failing the second.
        if stage != "generated-insert" or writes == 2:
            target.priority = 99
    event.listen(model, event_name, reject_write)
    try:
        response = post(client, rule_id)
    finally:
        event.remove(model, event_name, reject_write)
    assert response.status_code == 409, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("stage", ["response-validation", "commit"])
def test_unexpected_failure_before_commit_rolls_back_the_entire_edit(series_client, monkeypatch, stage):
    client, session = series_client
    rule_id = make_rule(session)
    occurrence(session, rule_id, -1)
    occurrence(session, rule_id)
    session.commit()
    before = database_state(session)
    def fail(*args, **kwargs):
        raise RuntimeError("Injected failure")
    if stage == "response-validation":
        monkeypatch.setattr(service_module, "RecurringSeriesEditRead", fail)
    else:
        monkeypatch.setattr(session, "commit", fail)
    with pytest.raises(RuntimeError, match="Injected failure"):
        post(client, rule_id)
    assert database_state(session) == before


def test_service_commits_once_after_generation_and_response_validation(series_client, monkeypatch):
    client, session = series_client
    rule_id = make_rule(session)
    occurrence(session, rule_id)
    session.commit()
    real_commit = session.commit
    commits = 0
    def record_commit():
        nonlocal commits
        commits += 1
        real_commit()
    monkeypatch.setattr(session, "commit", record_commit)
    success(post(client, rule_id), rule_id)
    assert commits == 1
