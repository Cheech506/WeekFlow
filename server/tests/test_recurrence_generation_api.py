"""PostgreSQL tests for recurring-task generation, history, and rollback.

The shared fixture creates isolated test tables and rolls back the outer
transaction after each case. Setup commits below release savepoints only;
they do not persist test records in the application's public tables.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import Goal, RecurringOccurrenceException, RecurringRule, Task
from app.routers import recurring_rules as recurring_router
from test_backup_refresh_api import refresh_client


URL = "/api/v1/recurring-rules/generate"
START = date(2026, 10, 12)
SOURCE_RULE = 1_781_204_330_006
SOURCE_GOAL = 1_781_204_330_002


@pytest.fixture
def generation_client(refresh_client):
    """Use test-owned tables and the actual FastAPI generation endpoint."""

    return refresh_client


def make_goal(session, source_id=None):
    goal = Goal(
        title="Study goal", source_goal_id=source_id,
        start_date=START, end_date=date(2026, 12, 31),
    )
    session.add(goal)
    session.flush()
    return goal


def make_rule(session, **changes):
    values = {
        "title": "Study daily", "notes": "Keep learning", "priority": 2,
        "frequency": "daily", "start_date": START,
        "end_date": None, "weekdays": [], "active": True,
    }
    values.update(changes)
    rule = RecurringRule(**values)
    session.add(rule)
    session.flush()
    return rule


def generate(client, **changes):
    return client.post(URL, json={
        "current_date": START.isoformat(), "horizon_days": 2, **changes,
    })


def assert_summary(response, *, created=0, existing=0, skipped=0, rules=1):
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["rules_checked"] == rules
    assert data["created_count"] == created
    assert data["existing_count"] == existing
    assert data["skipped_count"] == skipped
    assert data["candidate_count"] == created + existing + skipped
    assert len(data["created_task_ids"]) == created
    assert len(set(data["created_task_ids"])) == created
    assert data["database_changed"] is (created > 0)
    current = date.fromisoformat(data["current_date"])
    assert data["window_end"] == (current + timedelta(days=data["horizon_days"])).isoformat()
    return data


def task_snapshots(session):
    """Reload every task field so stale ORM values cannot hide changes."""

    session.expire_all()
    return {
        task.id: {
            column.name: getattr(task, column.name)
            for column in Task.__table__.columns
        }
        for task in session.scalars(select(Task).order_by(Task.id)).all()
    }


@pytest.mark.parametrize("imported", [False, True])
def test_new_tasks_copy_schedule_details_and_correct_parent_ids(generation_client, imported):
    client, session = generation_client
    goal = make_goal(session, SOURCE_GOAL if imported else None)
    goal_id = goal.id
    rule = make_rule(
        session, goal_id=goal_id,
        source_recurring_rule_id=SOURCE_RULE if imported else None,
    )
    rule_id = rule.id
    session.commit()

    data = assert_summary(generate(client), created=3)
    tasks = task_snapshots(session)
    assert set(tasks) == set(data["created_task_ids"])
    assert sorted(row["due_date"] for row in tasks.values()) == [
        START, START + timedelta(days=1), START + timedelta(days=2),
    ]
    for row in tasks.values():
        assert row["title"] == "Study daily"
        assert row["notes"] == "Keep learning"
        assert row["priority"] == 2
        assert row["goal_id"] == goal_id
        assert row["source_goal_id"] == (SOURCE_GOAL if imported else None)
        assert row["recurring_rule_id"] == rule_id
        assert row["source_recurring_rule_id"] == (SOURCE_RULE if imported else None)
        assert row["source_task_id"] is None
        assert row["due_date"] == row["recurrence_occurrence_date"]
        assert row["day"] == row["due_date"].strftime("%A")
        assert row["completed"] is False and row["completed_at"] is None
        assert row["created_at"] is not None


def test_default_window_and_identical_retry_preserve_task_ids(generation_client):
    client, session = generation_client
    make_rule(session)
    session.commit()
    response = client.post(URL, json={"current_date": START.isoformat()})
    data = assert_summary(response, created=31)
    assert data["horizon_days"] == 30
    before = task_snapshots(session)

    retry = client.post(URL, json={"current_date": START.isoformat()})
    assert_summary(retry, existing=31)
    assert task_snapshots(session) == before


def test_extending_window_creates_only_additional_occurrences(generation_client):
    client, session = generation_client
    make_rule(session)
    session.commit()
    first = assert_summary(generate(client, horizon_days=0), created=1)
    original = task_snapshots(session)
    second = assert_summary(generate(client), created=2, existing=1)
    assert set(first["created_task_ids"]).isdisjoint(second["created_task_ids"])
    for identity, row in original.items():
        assert task_snapshots(session)[identity] == row


@pytest.mark.parametrize(
    "frequency,weekdays,horizon,offsets",
    [
        ("daily", [], 14, list(range(15))),
        ("weekly", [], 14, [0, 7, 14]),
        ("everyTwoWeeks", [], 14, [0, 14]),
        ("certainDays", [1, 3], 14, [0, 2, 7, 9, 14]),
        ("monthly", [], 40, [0, 31]),
    ],
)
def test_generated_tasks_follow_each_frequency(generation_client, frequency, weekdays, horizon, offsets):
    client, session = generation_client
    make_rule(session, frequency=frequency, weekdays=weekdays)
    session.commit()
    assert_summary(generate(client, horizon_days=horizon), created=len(offsets))
    assert sorted(row["recurrence_occurrence_date"] for row in task_snapshots(session).values()) == [
        START + timedelta(days=offset) for offset in offsets
    ]


def test_all_schedule_request_ignores_paused_rules(generation_client):
    client, session = generation_client
    daily_id = make_rule(session).id
    weekly_id = make_rule(session, frequency="weekly").id
    paused_id = make_rule(session, active=False).id
    session.commit()
    assert_summary(generate(client, horizon_days=1), created=3, rules=3)
    tasks = task_snapshots(session)
    assert {row["recurring_rule_id"] for row in tasks.values()} == {daily_id, weekly_id}
    assert all(row["recurring_rule_id"] != paused_id for row in tasks.values())


def test_selected_rule_does_not_generate_other_rules(generation_client):
    client, session = generation_client
    selected_id = make_rule(session).id
    make_rule(session)
    session.commit()
    assert_summary(generate(client, recurring_rule_id=selected_id), created=3)
    assert {row["recurring_rule_id"] for row in task_snapshots(session).values()} == {selected_id}


def test_no_schedules_returns_an_empty_success(generation_client):
    client, session = generation_client
    assert_summary(generate(client), rules=0)
    assert task_snapshots(session) == {}


@pytest.mark.parametrize(
    "changes",
    [
        {"active": False},
        {"start_date": date(2026, 11, 1)},
        {"end_date": START},
    ],
)
def test_paused_future_and_expired_rules_create_nothing(generation_client, changes):
    client, session = generation_client
    rule_id = make_rule(session, **changes).id
    session.commit()
    assert_summary(generate(
        client, current_date="2026-10-13", recurring_rule_id=rule_id,
    ))
    assert task_snapshots(session) == {}


def test_end_date_is_inclusive(generation_client):
    client, session = generation_client
    make_rule(session, end_date=START + timedelta(days=1))
    session.commit()
    assert_summary(generate(client), created=2)
    assert sorted(row["due_date"] for row in task_snapshots(session).values()) == [
        START, START + timedelta(days=1),
    ]


def test_skips_are_respected_on_first_request_and_retry(generation_client):
    client, session = generation_client
    rule_id = make_rule(session).id
    skip_date = START + timedelta(days=1)
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=skip_date))
    session.commit()
    skip = session.get(RecurringOccurrenceException, (rule_id, skip_date))
    original_timestamp = skip.created_at
    assert_summary(generate(client), created=2, skipped=1)
    before = task_snapshots(session)
    assert all(row["recurrence_occurrence_date"] != skip_date for row in before.values())
    assert_summary(generate(client), existing=2, skipped=1)
    assert task_snapshots(session) == before
    assert session.get(RecurringOccurrenceException, (rule_id, skip_date)).created_at == original_timestamp


@pytest.mark.parametrize("state", ["completed", "rescheduled", "inbox"])
def test_existing_occurrence_is_never_rewritten_or_duplicated(generation_client, state):
    client, session = generation_client
    rule_id = make_rule(session).id
    task = Task(
        title="Original task details", notes="Preserve me", priority=1,
        recurring_rule_id=rule_id, recurrence_occurrence_date=START,
        due_date=None if state == "inbox" else date(2026, 11, 1),
        day="Inbox" if state == "inbox" else "Sunday",
        completed=state == "completed",
        completed_at=datetime(2026, 10, 12, 12, tzinfo=UTC) if state == "completed" else None,
    )
    session.add(task)
    session.flush()
    task_id = task.id
    session.commit()
    before = task_snapshots(session)[task_id]
    assert_summary(generate(client, horizon_days=1), created=1, existing=1)
    assert task_snapshots(session)[task_id] == before
    assert len(task_snapshots(session)) == 2


@pytest.mark.parametrize("completed", [False, True])
def test_source_only_imported_occurrence_is_preserved(generation_client, completed):
    client, session = generation_client
    current_goal_id = make_goal(session).id
    make_rule(session, source_recurring_rule_id=SOURCE_RULE, goal_id=current_goal_id)
    legacy = Task(
        source_task_id=1_781_204_330_001,
        source_recurring_rule_id=SOURCE_RULE,
        recurring_rule_id=None,
        source_goal_id=SOURCE_GOAL,
        goal_id=None,
        recurrence_occurrence_date=START,
        title="Original imported goal history", notes="Legacy task", priority=1,
        due_date=None, day="Inbox", completed=completed,
        completed_at=datetime(2026, 10, 12, 12, tzinfo=UTC) if completed else None,
    )
    session.add(legacy)
    session.flush()
    legacy_id = legacy.id
    session.commit()
    before = task_snapshots(session)[legacy_id]
    assert_summary(generate(client, horizon_days=0), existing=1)
    assert task_snapshots(session) == {legacy_id: before}


def test_new_goal_and_details_apply_only_to_new_tasks(generation_client):
    client, session = generation_client
    old_goal_id = make_goal(session, SOURCE_GOAL).id
    new_goal_id = make_goal(session).id
    rule_id = make_rule(session, goal_id=old_goal_id, source_recurring_rule_id=SOURCE_RULE).id
    session.commit()
    first = assert_summary(generate(client, horizon_days=0), created=1)
    first_id = first["created_task_ids"][0]
    response = client.patch(f"/api/v1/tasks/{first_id}", json={"completed": True})
    assert response.status_code == 200, response.text
    before = task_snapshots(session)[first_id]

    response = client.patch(f"/api/v1/recurring-rules/{rule_id}", json={
        "goal_id": new_goal_id, "title": "New cycle study", "notes": "New notes", "priority": 1,
    })
    assert response.status_code == 200, response.text
    second = assert_summary(generate(client, current_date="2026-10-13", horizon_days=0), created=1)
    new_id = second["created_task_ids"][0]
    tasks = task_snapshots(session)
    assert tasks[first_id] == before
    assert tasks[new_id]["goal_id"] == new_goal_id
    assert tasks[new_id]["source_goal_id"] is None
    assert tasks[new_id]["title"] == "New cycle study"
    assert tasks[new_id]["notes"] == "New notes"
    assert tasks[new_id]["priority"] == 1
    assert tasks[new_id]["completed"] is False
    assert_summary(generate(client, horizon_days=1), existing=2)
    assert task_snapshots(session) == tasks


def test_pausing_then_resuming_generates_missing_tasks(generation_client):
    client, session = generation_client
    rule_id = make_rule(session, active=False).id
    session.commit()
    assert_summary(generate(client))
    assert client.patch(f"/api/v1/recurring-rules/{rule_id}", json={"active": True}).status_code == 200
    assert_summary(generate(client), created=3)
    before = task_snapshots(session)
    assert client.patch(f"/api/v1/recurring-rules/{rule_id}", json={"active": False}).status_code == 200
    assert_summary(generate(client))
    assert task_snapshots(session) == before


def test_frequency_change_does_not_remove_old_occurrences(generation_client):
    client, session = generation_client
    rule_id = make_rule(session).id
    session.commit()
    assert_summary(generate(client), created=3)
    before = task_snapshots(session)
    assert client.patch(f"/api/v1/recurring-rules/{rule_id}", json={"frequency": "weekly"}).status_code == 200
    assert_summary(generate(client, horizon_days=7), created=1, existing=1)
    after = task_snapshots(session)
    assert len(after) == 4
    for identity, row in before.items():
        assert after[identity] == row


def test_completed_history_and_skip_can_coexist_without_new_task(generation_client):
    client, session = generation_client
    rule_id = make_rule(session).id
    task = Task(
        title="Completed historical occurrence", recurring_rule_id=rule_id,
        recurrence_occurrence_date=START, completed=True,
        completed_at=datetime(2026, 10, 12, 12, tzinfo=UTC),
    )
    session.add_all([
        task, RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=START),
    ])
    session.commit()
    before = task_snapshots(session)
    assert_summary(generate(client, horizon_days=0), skipped=1)
    assert task_snapshots(session) == before


def test_deleted_occurrence_stays_skipped_until_skip_is_removed(generation_client):
    client, session = generation_client
    rule_id = make_rule(session).id
    session.commit()
    first_id = assert_summary(generate(client, horizon_days=0), created=1)["created_task_ids"][0]
    assert client.delete(f"/api/v1/tasks/{first_id}").status_code == 204
    assert_summary(generate(client, horizon_days=0), skipped=1)
    assert task_snapshots(session) == {}
    path = f"/api/v1/recurring-exceptions/{rule_id}/{START.isoformat()}"
    assert client.delete(path).status_code == 204
    new_id = assert_summary(generate(client, horizon_days=0), created=1)["created_task_ids"][0]
    assert new_id != first_id
    assert set(task_snapshots(session)) == {new_id}


def test_native_identity_is_authoritative_over_stale_source_metadata(generation_client):
    client, session = generation_client
    rule_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE).id
    task = Task(
        title="Native occurrence", recurring_rule_id=rule_id,
        source_recurring_rule_id=SOURCE_RULE + 1, recurrence_occurrence_date=START,
    )
    session.add(task)
    session.commit()
    before = task_snapshots(session)
    assert_summary(generate(client, horizon_days=0, recurring_rule_id=rule_id), existing=1)
    assert task_snapshots(session) == before


@pytest.mark.parametrize("across_schedules", [False, True])
def test_source_identity_conflict_rolls_back_earlier_inserts(generation_client, across_schedules):
    client, session = generation_client
    if across_schedules:
        make_rule(session, title="Earlier independent schedule")
    requested_id = make_rule(session, source_recurring_rule_id=SOURCE_RULE).id
    other_id = make_rule(session, active=False).id
    conflict_date = START if across_schedules else START + timedelta(days=1)
    session.add(Task(
        title="Conflicting source owner", recurring_rule_id=other_id,
        source_recurring_rule_id=SOURCE_RULE, recurrence_occurrence_date=conflict_date,
    ))
    session.commit()
    before = task_snapshots(session)
    fields = {"horizon_days": 0} if across_schedules else {
        "horizon_days": 1, "recurring_rule_id": requested_id,
    }
    response = generate(client, **fields)
    assert response.status_code == 409, response.text
    assert "No changes were saved" in response.json()["detail"]
    assert task_snapshots(session) == before
    assert session.get(RecurringRule, requested_id) is not None


def test_real_database_failure_rolls_back_all_new_tasks(generation_client):
    client, session = generation_client
    rule_id = make_rule(session).id
    session.commit()
    attempted_dates = []

    def reject_second_insert(mapper, connection, target):
        if target.recurring_rule_id == rule_id:
            attempted_dates.append(target.recurrence_occurrence_date)
            if len(attempted_dates) == 2:
                # Exercise PostgreSQL's real priority CHECK after one task
                # has already been inserted in the same transaction.
                target.priority = 3

    event.listen(Task, "before_insert", reject_second_insert)
    try:
        response = generate(client, horizon_days=1)
    finally:
        event.remove(Task, "before_insert", reject_second_insert)

    assert response.status_code == 409, response.text
    assert attempted_dates == [START, START + timedelta(days=1)]
    assert task_snapshots(session) == {}
    assert session.get(RecurringRule, rule_id) is not None
    assert_summary(generate(client, horizon_days=1), created=2)


def test_failed_commit_rolls_back_every_generated_task(generation_client, monkeypatch):
    client, session = generation_client
    rule_id = make_rule(session).id
    session.commit()

    def fail_commit():
        assert session.scalar(select(func.count()).select_from(Task)) == 2
        raise IntegrityError("test commit", {}, Exception("forced test failure"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = generate(client, horizon_days=1)

    assert response.status_code == 409, response.text
    assert task_snapshots(session) == {}
    assert session.get(RecurringRule, rule_id) is not None
    assert_summary(generate(client, horizon_days=1), created=2)


def test_missing_selected_schedule_returns_404_without_changes(generation_client):
    client, session = generation_client
    existing_id = make_rule(session).id
    session.commit()
    response = generate(client, recurring_rule_id=2_147_483_647)
    assert response.status_code == 404, response.text
    assert task_snapshots(session) == {}
    assert session.get(RecurringRule, existing_id) is not None


@pytest.mark.parametrize(
    "changes",
    [
        {"current_date": None},
        {"current_date": "2026-02-30"},
        {"current_date": "9999-12-31", "horizon_days": 1},
        {"horizon_days": -1},
        {"horizon_days": 367},
        {"horizon_days": True},
        {"horizon_days": 1.5},
        {"horizon_days": "30"},
        {"recurring_rule_id": 0},
        {"recurring_rule_id": True},
        {"recurring_rule_id": "1"},
        {"recurring_rule_id": 2_147_483_648},
        {"source_recurring_rule_id": SOURCE_RULE},
    ],
)
def test_invalid_requests_never_call_generation(generation_client, monkeypatch, changes):
    client, session = generation_client

    def must_not_generate(**kwargs):
        raise AssertionError("Invalid request reached the generation service")

    monkeypatch.setattr(recurring_router, "generate_recurring_tasks", must_not_generate)
    response = generate(client, **changes)
    assert response.status_code == 422, response.text
    assert task_snapshots(session) == {}


def test_current_date_is_required(generation_client):
    client, _ = generation_client
    assert client.post(URL, json={"horizon_days": 2}).status_code == 422


def test_maximum_horizon_is_accepted(generation_client):
    client, session = generation_client
    make_rule(session, active=False)
    session.commit()
    data = assert_summary(generate(client, horizon_days=366))
    assert data["window_end"] == (START + timedelta(days=366)).isoformat()
