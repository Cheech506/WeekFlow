"""Goal completion/reopening tests with rolled-back PostgreSQL writes."""

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import engine, get_db
from app.main import app
from app.models import Goal, GoalMilestone, RecurringRule, Task

GOALS = f"{API_PREFIX}/goals"
NOW = datetime(2026, 10, 8, 12, tzinfo=UTC)
REFLECTIONS = ["what_helped", "hardest_part", "learned", "do_differently"]
SNAPSHOTS = ["completion_task_total", "completion_task_completed",
             "completion_high_priority_completed", "completion_milestone_total",
             "completion_milestone_completed"]


@pytest.fixture
def completion_api():
    with engine.connect() as connection:
        outer = connection.begin()
        session = Session(bind=connection, join_transaction_mode="create_savepoint")
        previous = app.dependency_overrides.copy()

        def override_get_db():
            yield session

        try:
            app.dependency_overrides[get_db] = override_get_db
            with TestClient(app) as client:
                yield client, session
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous)
            session.close()
            outer.rollback()


def seed_goal(session, imported=True, **changes):
    values = dict(title="Completion test goal", start_date=date(2026, 10, 5),
                  end_date=date(2026, 12, 27))
    if imported:
        maximum = session.scalar(select(func.max(Goal.source_goal_id))) or 0
        values["source_goal_id"] = max(maximum, 1_900_000_000_000) + 1
    values.update(changes)
    goal = Goal(**values)
    session.add(goal)
    session.commit()
    return goal


def complete(client, goal_id, **answers):
    response = client.post(f"{GOALS}/{goal_id}/complete", json=answers)
    assert response.status_code == 200, response.text
    return response.json()


def test_completion_counts_only_this_goals_tasks_and_milestones(completion_api):
    client, session = completion_api
    goal = seed_goal(session)
    other = seed_goal(session)
    goal_id, source, other_id, other_source = goal.id, goal.source_goal_id, other.id, other.source_goal_id
    tasks = [
        Task(title="Done high", source_goal_id=source, priority=2,
             completed=True, completed_at=NOW),
        Task(title="Done normal", source_goal_id=source, priority=0,
             completed=True, completed_at=NOW),
        Task(title="Pending high", source_goal_id=source, priority=2),
        Task(title="Other goal", source_goal_id=other_source, priority=2,
             completed=True, completed_at=NOW),
        Task(title="Unlinked", completed=True, completed_at=NOW),
        # A source ID must never be compared with PostgreSQL's own goal ID.
        Task(title="Unrelated source", source_goal_id=goal_id),
    ]
    milestones = [
        GoalMilestone(goal_id=goal_id, title="Done", completed=True, completed_at=NOW),
        GoalMilestone(goal_id=goal_id, title="Pending"),
        GoalMilestone(goal_id=other_id, title="Other", completed=True, completed_at=NOW),
    ]
    session.add_all(tasks + milestones)
    session.commit()
    task_states = {row.id: (row.completed, row.completed_at, row.source_goal_id) for row in tasks}
    milestone_states = {row.id: (row.completed, row.completed_at) for row in milestones}
    before = datetime.now(UTC)
    result = complete(client, goal_id, what_helped="Routine", hardest_part="Time",
                      learned="Plan", do_differently="Start earlier")
    after = datetime.now(UTC)
    assert result["completed"] is True
    assert before <= datetime.fromisoformat(result["completed_at"]) <= after
    assert result["id"] == goal_id and result["source_goal_id"] == source
    assert result["completion_task_total"] == 3
    assert result["completion_task_completed"] == 2
    assert result["completion_high_priority_completed"] == 1
    assert result["completion_milestone_total"] == 2
    assert result["completion_milestone_completed"] == 1
    assert result["completion_what_helped"] == "Routine"
    assert result["completion_hardest_part"] == "Time"
    assert result["completion_learned"] == "Plan"
    assert result["completion_do_differently"] == "Start earlier"
    session.expire_all()
    for task_id, expected in task_states.items():
        row = session.get(Task, task_id)
        assert (row.completed, row.completed_at, row.source_goal_id) == expected
    for milestone_id, expected in milestone_states.items():
        row = session.get(GoalMilestone, milestone_id)
        assert (row.completed, row.completed_at) == expected
    assert session.get(Goal, other_id).completed is False
    assert client.get(f"{GOALS}/{goal_id}").json() == result


@pytest.mark.parametrize("imported", [True, False])
def test_empty_goal_saves_zero_totals_without_counting_unlinked_tasks(completion_api, imported):
    client, session = completion_api
    goal = seed_goal(session, imported=imported)
    goal_id = goal.id
    session.add(Task(title="Unlinked completed", completed=True, completed_at=NOW, priority=2))
    session.commit()
    result = complete(client, goal_id)
    for field in SNAPSHOTS:
        assert result[field] == 0
    for field in REFLECTIONS:
        assert result[f"completion_{field}"] is None


def test_recurring_schedule_reassignment_does_not_move_historical_task_totals(completion_api):
    client, session = completion_api
    old = seed_goal(session)
    new = seed_goal(session)
    old_id, old_source, new_id = old.id, old.source_goal_id, new.id
    rule = RecurringRule(title="Reassigned schedule", goal_id=new_id,
                         source_recurring_rule_id=1_999_999_999_999,
                         frequency="daily", start_date=date(2026, 10, 5))
    # Avoid a collision with an existing imported schedule.
    maximum = session.scalar(select(func.max(RecurringRule.source_recurring_rule_id))) or 0
    rule.source_recurring_rule_id = max(maximum, 1_900_000_000_000) + 1
    session.add(rule)
    session.commit()
    session.add(Task(title="Historical occurrence", source_goal_id=old_source,
                     source_recurring_rule_id=rule.source_recurring_rule_id,
                     recurrence_occurrence_date=date(2026, 10, 5),
                     completed=True, completed_at=NOW))
    session.commit()
    assert complete(client, old_id)["completion_task_completed"] == 1
    assert complete(client, new_id)["completion_task_total"] == 0


def test_repeat_complete_preserves_original_timestamp_reflections_and_snapshot(completion_api):
    client, session = completion_api
    goal = seed_goal(session)
    goal_id, source = goal.id, goal.source_goal_id
    first = complete(client, goal_id, learned="Keep original answer")
    session.add(Task(title="Added later", source_goal_id=source))
    session.commit()
    second = complete(client, goal_id, learned="Do not overwrite")
    assert second == first


def test_reopen_preserves_history_and_recompletion_refreshes_totals(completion_api):
    client, session = completion_api
    goal = seed_goal(session)
    goal_id, source = goal.id, goal.source_goal_id
    first = complete(client, goal_id, what_helped="Keep this", learned="Original")
    response = client.post(f"{GOALS}/{goal_id}/reopen")
    assert response.status_code == 200, response.text
    reopened = response.json()
    assert reopened["completed"] is False and reopened["completed_at"] is None
    for field in SNAPSHOTS + [f"completion_{field}" for field in REFLECTIONS]:
        assert reopened[field] == first[field]
    assert client.post(f"{GOALS}/{goal_id}/reopen").json() == reopened
    # Saved history remains protected from hard deletion after reopening.
    assert client.delete(f"{GOALS}/{goal_id}").status_code == 409
    session.add(Task(title="New progress", source_goal_id=source,
                     priority=2, completed=True, completed_at=NOW))
    session.commit()
    again = complete(client, goal_id, learned="New answer")
    assert again["completion_what_helped"] == "Keep this"
    assert again["completion_learned"] == "New answer"
    assert again["completion_task_total"] == 1
    assert again["completion_task_completed"] == 1
    assert again["completion_high_priority_completed"] == 1


def test_recompletion_can_explicitly_clear_a_saved_answer(completion_api):
    client, session = completion_api
    goal_id = seed_goal(session).id
    complete(client, goal_id, learned="Previous", what_helped="Still saved")
    assert client.post(f"{GOALS}/{goal_id}/reopen").status_code == 200
    again = complete(client, goal_id, learned=None)
    assert again["completion_learned"] is None
    assert again["completion_what_helped"] == "Still saved"


def test_reopen_never_completed_goal_does_not_create_history(completion_api):
    client, session = completion_api
    goal_id = seed_goal(session).id
    response = client.post(f"{GOALS}/{goal_id}/reopen")
    assert response.status_code == 200, response.text
    assert response.json()["completed"] is False
    for field in SNAPSHOTS:
        assert response.json()[field] is None
    assert client.delete(f"{GOALS}/{goal_id}").status_code == 204


@pytest.mark.parametrize("field", REFLECTIONS)
@pytest.mark.parametrize("value,expected", [("  Useful answer  ", "Useful answer"), ("   ", None), (None, None), ("x" * 1000, "x" * 1000)])
def test_completion_normalizes_and_accepts_valid_reflections(completion_api, field, value, expected):
    client, session = completion_api
    result = complete(client, seed_goal(session).id, **{field: value})
    assert result[f"completion_{field}"] == expected


@pytest.mark.parametrize("field", REFLECTIONS)
@pytest.mark.parametrize("invalid", ["x" * 1001, 123, True, ["answer"]])
def test_invalid_reflection_rejected_without_completing_goal(completion_api, field, invalid):
    client, session = completion_api
    goal_id = seed_goal(session).id
    response = client.post(f"{GOALS}/{goal_id}/complete", json={field: invalid})
    assert response.status_code == 422, response.text
    session.expire_all()
    goal = session.get(Goal, goal_id)
    assert goal.completed is False and goal.completed_at is None


@pytest.mark.parametrize("field", ["id", "source_goal_id", "completed_at", "completion_task_total", "completed"])
def test_client_cannot_supply_server_owned_completion_fields(completion_api, field):
    client, session = completion_api
    goal_id = seed_goal(session).id
    response = client.post(f"{GOALS}/{goal_id}/complete", json={field: 1})
    assert response.status_code == 422, response.text
    session.expire_all()
    assert session.get(Goal, goal_id).completed is False


@pytest.mark.parametrize("action", ["complete", "reopen"])
def test_missing_goal_returns_404(completion_api, action):
    client, session = completion_api
    missing = (session.scalar(select(func.max(Goal.id))) or 0) + 1
    response = client.post(f"{GOALS}/{missing}/{action}", json={})
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("action", ["complete", "reopen"])
@pytest.mark.parametrize("invalid", [0, -1, 2_147_483_648, "abc"])
def test_invalid_goal_id_returns_422(completion_api, action, invalid):
    client, _ = completion_api
    response = client.post(f"{GOALS}/{invalid}/{action}", json={})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("action", ["complete", "reopen"])
def test_failed_completion_transition_rolls_back_and_allows_retry(completion_api, action):
    client, session = completion_api
    goal_id = seed_goal(session).id
    if action == "reopen":
        complete(client, goal_id, learned="Keep this reflection")
    original = client.get(f"{GOALS}/{goal_id}").json()

    def force_constraint_failure(current, context, instances):
        if any(isinstance(row, Goal) for row in current.dirty):
            current.add(GoalMilestone(goal_id=goal_id, title=" "))

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.post(f"{GOALS}/{goal_id}/{action}", json={"learned": "Change"})
    finally:
        event.remove(session, "before_flush", force_constraint_failure)
    assert response.status_code == 409, response.text
    assert client.get(f"{GOALS}/{goal_id}").json() == original
    response = client.post(f"{GOALS}/{goal_id}/{action}", json={})
    assert response.status_code == 200, response.text
