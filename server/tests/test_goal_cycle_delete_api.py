"""Goal/cycle deletion checks using PostgreSQL and rolled-back transactions."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import engine, get_db
from app.main import app
from app.models import (
    CycleGoalOutcome,
    CycleReview,
    Goal,
    GoalMilestone,
    PlanningCycle,
    RecurringRule,
    RecurringOccurrenceException,
    Task,
    TaskTemplate,
    WeeklyCommitment,
    WeeklyReview,
)

GOALS = f"{API_PREFIX}/goals"
CYCLES = f"{API_PREFIX}/planning-cycles"
NOW = datetime(2026, 10, 8, 12, tzinfo=UTC)


@pytest.fixture
def deletion_api():
    """Contain endpoint commits in a transaction rolled back after each test."""
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


def seed_goal(session, **changes):
    values = dict(title="Deletion test goal", start_date=date(2026, 10, 5),
                  end_date=date(2026, 12, 27))
    values.update(changes)
    goal = Goal(**values)
    session.add(goal)
    session.commit()
    return goal


def seed_cycle(session, **changes):
    start = date(2026, 1, 5)
    values = dict(name="Deletion test cycle", start_date=start,
                  end_date=start + timedelta(days=83), active=False,
                  completed_at=NOW)
    values.update(changes)
    cycle = PlanningCycle(**values)
    session.add(cycle)
    session.commit()
    return cycle


def fresh_source(session, column):
    maximum = session.scalar(select(func.max(column))) or 0
    return max(maximum, 1_900_000_000_000) + 1


def free_review_week(session):
    week = date(2200, 1, 1)
    week -= timedelta(days=week.weekday())
    while session.scalar(select(WeeklyReview.id).where(WeeklyReview.week_start == week)):
        week += timedelta(days=7)
    return week


def test_delete_goal_preserves_tasks_schedules_templates_and_other_goals(deletion_api):
    client, session = deletion_api
    source = fresh_source(session, Goal.source_goal_id)
    goal = seed_goal(session, source_goal_id=source)
    other = seed_goal(session, source_goal_id=source + 1)
    goal_id, other_id = goal.id, other.id
    task = Task(title="Keep completed task", source_goal_id=source,
                source_task_id=fresh_source(session, Task.source_task_id),
                completed=True, completed_at=NOW, priority=2,
                notes="Keep this history", due_date=date(2026, 10, 8))
    other_task = Task(title="Other goal task", source_goal_id=source + 1)
    unlinked = Task(title="Already unlinked task")
    milestone = GoalMilestone(goal_id=goal_id, title="Child milestone")
    schedule = RecurringRule(goal_id=goal_id, title="Daily task", frequency="daily",
                             start_date=date(2026, 10, 5), weekdays=[],
                             source_recurring_rule_id=fresh_source(session, RecurringRule.source_recurring_rule_id))
    template = TaskTemplate(goal_id=goal_id, title="Keep template",
                            source_task_template_id=fresh_source(session, TaskTemplate.source_task_template_id))
    session.add_all([task, other_task, unlinked, milestone, schedule, template])
    session.commit()
    task_id, other_task_id, unlinked_id = task.id, other_task.id, unlinked.id
    milestone_id, schedule_id, template_id = milestone.id, schedule.id, template.id
    task_source = task.source_task_id
    schedule_source = schedule.source_recurring_rule_id
    template_source = template.source_task_template_id
    created_at = task.created_at
    exception_date = date(2026, 10, 9)
    session.add(RecurringOccurrenceException(recurring_rule_id=schedule_id,
                                             occurrence_date=exception_date))
    session.commit()

    response = client.delete(f"{GOALS}/{goal_id}")
    assert response.status_code == 204, response.text
    assert response.content == b""
    session.expire_all()
    assert session.get(Goal, goal_id) is None
    assert session.get(GoalMilestone, milestone_id) is None
    kept = session.get(Task, task_id)
    assert kept.source_goal_id is None
    assert kept.source_task_id == task_source
    assert kept.title == "Keep completed task"
    assert kept.completed is True and kept.completed_at == NOW
    assert kept.created_at == created_at
    assert kept.priority == 2 and kept.notes == "Keep this history"
    assert kept.due_date == date(2026, 10, 8)
    assert session.get(RecurringRule, schedule_id).goal_id is None
    assert session.get(RecurringRule, schedule_id).active is True
    assert session.get(RecurringRule, schedule_id).source_recurring_rule_id == schedule_source
    assert session.get(RecurringOccurrenceException, (schedule_id, exception_date)) is not None
    assert session.get(TaskTemplate, template_id).goal_id is None
    assert session.get(TaskTemplate, template_id).source_task_template_id == template_source
    assert session.get(Goal, other_id) is not None
    assert session.get(Task, other_task_id).source_goal_id == source + 1
    assert session.get(Task, unlinked_id).source_goal_id is None
    assert client.delete(f"{GOALS}/{goal_id}").status_code == 404


def test_delete_native_goal_does_not_clear_unrelated_legacy_links(deletion_api):
    client, session = deletion_api
    goal = seed_goal(session)
    goal_id = goal.id
    source = fresh_source(session, Goal.source_goal_id)
    other = seed_goal(session, source_goal_id=source)
    task = Task(title="Legacy task", source_goal_id=source)
    session.add(task)
    session.commit()
    task_id, other_id = task.id, other.id
    response = client.delete(f"{GOALS}/{goal_id}")
    assert response.status_code == 204, response.text
    session.expire_all()
    assert session.get(Task, task_id).source_goal_id == source
    assert session.get(Goal, other_id) is not None


@pytest.mark.parametrize("link", ["goal_id", "destination_goal_id"])
def test_goal_delete_preserves_saved_cycle_outcome_text(deletion_api, link):
    client, session = deletion_api
    cycle = seed_cycle(session)
    goal = seed_goal(session)
    goal_id = goal.id
    review = CycleReview(cycle_id=cycle.id, what_learned="Saved reflection")
    session.add(review)
    session.commit()
    review_id = review.id
    outcome = CycleGoalOutcome(cycle_review_id=review_id, goal_title="Historical title",
                               action="carryForward", **{link: goal_id})
    session.add(outcome)
    session.commit()
    outcome_id = outcome.id
    response = client.delete(f"{GOALS}/{goal_id}")
    assert response.status_code == 204, response.text
    session.expire_all()
    kept = session.get(CycleGoalOutcome, outcome_id)
    assert getattr(kept, link) is None
    assert kept.goal_title == "Historical title"
    assert kept.action == "carryForward"
    assert session.get(CycleReview, review_id).what_learned == "Saved reflection"


@pytest.mark.parametrize("history", [
    {"completed": True, "completed_at": NOW},
    {"completion_what_helped": "A routine"},
    {"completion_hardest_part": "Time"},
    {"completion_learned": "Plan ahead"},
    {"completion_do_differently": "Start earlier"},
    {"completion_task_total": 0},
    {"completion_task_completed": 0},
    {"completion_milestone_total": 0},
    {"completion_milestone_completed": 0},
    {"completion_high_priority_completed": 0},
])
def test_goal_with_saved_completion_history_is_protected(deletion_api, history):
    client, session = deletion_api
    source = fresh_source(session, Goal.source_goal_id)
    goal = seed_goal(session, source_goal_id=source, **history)
    goal_id = goal.id
    task = Task(title="Still linked", source_goal_id=source)
    session.add(task)
    session.commit()
    task_id = task.id
    response = client.delete(f"{GOALS}/{goal_id}")
    assert response.status_code == 409, response.text
    session.expire_all()
    kept = session.get(Goal, goal_id)
    assert kept is not None
    for field, value in history.items():
        assert getattr(kept, field) == value
    assert session.get(Task, task_id).source_goal_id == source


def test_delete_empty_historical_cycle(deletion_api):
    client, session = deletion_api
    cycle = seed_cycle(session)
    cycle_id = cycle.id
    active_before = session.scalar(select(PlanningCycle.id).where(PlanningCycle.active.is_(True)))
    response = client.delete(f"{CYCLES}/{cycle_id}")
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert session.get(PlanningCycle, cycle_id) is None
    assert session.scalar(select(PlanningCycle.id).where(PlanningCycle.active.is_(True))) == active_before
    assert client.delete(f"{CYCLES}/{cycle_id}").status_code == 404


def test_delete_empty_active_cycle_does_not_reactivate_history(deletion_api):
    client, session = deletion_api
    # These changes are contained in this test's outer transaction.
    session.execute(update(PlanningCycle).where(PlanningCycle.active.is_(True))
                    .values(active=False, completed_at=NOW))
    historical = seed_cycle(session)
    historical_id = historical.id
    cycle = seed_cycle(session, active=True, completed_at=None)
    cycle_id = cycle.id
    response = client.delete(f"{CYCLES}/{cycle_id}")
    assert response.status_code == 204, response.text
    session.expire_all()
    assert session.get(PlanningCycle, historical_id).active is False
    assert client.get(f"{CYCLES}/current").json() is None


@pytest.mark.parametrize("kind", ["goal", "cycle_review", "next_cycle", "weekly_review", "commitment"])
def test_cycle_with_related_records_is_protected(deletion_api, kind):
    client, session = deletion_api
    cycle = seed_cycle(session)
    cycle_id = cycle.id
    if kind == "goal":
        linked = seed_goal(session, cycle_id=cycle_id)
    elif kind == "cycle_review":
        linked = CycleReview(cycle_id=cycle_id, what_learned="Do not lose this")
    elif kind == "next_cycle":
        earlier = seed_cycle(session)
        linked = CycleReview(cycle_id=earlier.id, next_cycle_id=cycle_id,
                             what_learned="Preserve next-cycle relationship")
    elif kind == "weekly_review":
        linked = WeeklyReview(cycle_id=cycle_id, week_start=free_review_week(session),
                              what_learned="Keep weekly history")
    else:
        linked = WeeklyCommitment(cycle_id=cycle_id, week_start=date(2026, 10, 5),
                                  title="Keep my commitment")
    session.add(linked)
    session.commit()
    linked_id, linked_type = linked.id, type(linked)
    response = client.delete(f"{CYCLES}/{cycle_id}")
    assert response.status_code == 409, response.text
    session.expire_all()
    assert session.get(PlanningCycle, cycle_id) is not None
    kept = session.get(linked_type, linked_id)
    assert kept is not None
    assert getattr(kept, "next_cycle_id" if kind == "next_cycle" else "cycle_id") == cycle_id


@pytest.mark.parametrize("url,model", [(GOALS, Goal), (CYCLES, PlanningCycle)])
def test_missing_record_returns_404(deletion_api, url, model):
    client, session = deletion_api
    missing = (session.scalar(select(func.max(model.id))) or 0) + 1
    assert client.delete(f"{url}/{missing}").status_code == 404


@pytest.mark.parametrize("url", [GOALS, CYCLES])
@pytest.mark.parametrize("invalid", [0, -1, 2_147_483_648, "abc", "1.5"])
def test_invalid_delete_id_returns_422(deletion_api, url, invalid):
    client, _ = deletion_api
    assert client.delete(f"{url}/{invalid}").status_code == 422


def test_failed_goal_delete_rolls_back_task_unlinking(deletion_api):
    client, session = deletion_api
    source = fresh_source(session, Goal.source_goal_id)
    goal = seed_goal(session, source_goal_id=source)
    goal_id = goal.id
    task = Task(title="Must keep association on failure", source_goal_id=source)
    milestone = GoalMilestone(goal_id=goal_id, title="Must keep milestone")
    session.add_all([task, milestone])
    session.commit()
    task_id, milestone_id = task.id, milestone.id

    def force_constraint_failure(current, context, instances):
        if any(isinstance(row, Goal) for row in current.deleted):
            current.add(GoalMilestone(goal_id=goal_id, title=" "))

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.delete(f"{GOALS}/{goal_id}")
    finally:
        event.remove(session, "before_flush", force_constraint_failure)
    assert response.status_code == 409, response.text
    session.expire_all()
    assert session.get(Goal, goal_id) is not None
    assert session.get(GoalMilestone, milestone_id) is not None
    assert session.get(Task, task_id).source_goal_id == source
    assert client.delete(f"{GOALS}/{goal_id}").status_code == 204


def test_failed_cycle_delete_rolls_back_and_allows_retry(deletion_api):
    client, session = deletion_api
    cycle = seed_cycle(session)
    cycle_id = cycle.id

    def force_constraint_failure(current, context, instances):
        if any(isinstance(row, PlanningCycle) for row in current.deleted):
            current.add(Goal(title=" ", start_date=date(2026, 10, 5),
                             end_date=date(2026, 12, 27)))

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.delete(f"{CYCLES}/{cycle_id}")
    finally:
        event.remove(session, "before_flush", force_constraint_failure)
    assert response.status_code == 409, response.text
    session.expire_all()
    assert session.get(PlanningCycle, cycle_id) is not None
    assert client.delete(f"{CYCLES}/{cycle_id}").status_code == 204


@pytest.mark.parametrize("url", [GOALS, CYCLES])
@pytest.mark.parametrize("origin", ["http://localhost:8081", "http://127.0.0.1:8081"])
def test_browser_can_request_delete(url, origin):
    with TestClient(app) as client:
        response = client.options(f"{url}/1", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "DELETE",
        })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "DELETE" in response.headers["access-control-allow-methods"]
