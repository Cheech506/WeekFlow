"""Goal API tests against PostgreSQL with rolled-back test transactions."""

from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import engine, get_db
from app.main import app
from app.models import Goal, PlanningCycle


GOALS_URL = f"{API_PREFIX}/goals"


@pytest.fixture
def goal_api() -> Generator[tuple[TestClient, Session], None, None]:
    """Keep endpoint commits inside an outer transaction undone at teardown."""

    with engine.connect() as connection:
        outer_transaction = connection.begin()
        session = Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
        )
        previous_overrides = app.dependency_overrides.copy()

        def override_get_db():
            yield session

        try:
            app.dependency_overrides[get_db] = override_get_db
            with TestClient(app) as client:
                yield client, session
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)
            session.close()
            outer_transaction.rollback()


def goal_payload(**changes) -> dict:
    payload = {
        "title": "Finish WeekFlow",
        "start_date": "2026-10-05",
        "end_date": "2026-12-27",
    }
    payload.update(changes)
    return payload


def create_goal(client: TestClient, **changes) -> dict:
    response = client.post(GOALS_URL, json=goal_payload(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def read_goal(client: TestClient, goal_id: int) -> dict:
    response = client.get(f"{GOALS_URL}/{goal_id}")
    assert response.status_code == 200, response.text
    return response.json()


def make_cycle(session: Session) -> PlanningCycle:
    """Seed a historical cycle without changing any real active cycle."""

    start = date(2026, 1, 5)
    cycle = PlanningCycle(
        name="Goal API test cycle",
        start_date=start,
        end_date=start + timedelta(days=83),
        active=False,
        completed_at=datetime(2026, 3, 29, 12, tzinfo=UTC),
    )
    session.add(cycle)
    session.commit()
    return cycle


def test_create_minimal_goal_and_read_it_back(goal_api):
    client, _ = goal_api
    goal = create_goal(client)

    assert goal["id"] > 0
    assert goal["title"] == "Finish WeekFlow"
    assert goal["start_date"] == "2026-10-05"
    assert goal["end_date"] == "2026-12-27"
    assert goal["source_goal_id"] is None
    assert goal["cycle_id"] is None
    assert goal["completed"] is False
    assert goal["completed_at"] is None
    assert datetime.fromisoformat(goal["created_at"]).tzinfo is not None
    for field in ("reward", "purpose", "success_definition", "notes"):
        assert goal[field] is None
    for field in goal:
        if field.startswith("completion_"):
            assert goal[field] is None
    assert read_goal(client, goal["id"]) == goal


def test_create_goal_trims_text_and_links_postgresql_cycle_id(goal_api):
    client, session = goal_api
    cycle = make_cycle(session)
    goal = create_goal(
        client,
        title="  Build my API  ",
        cycle_id=cycle.id,
        reward="  A day off  ",
        purpose="  Learn backend development  ",
        success_definition="  All required routes work  ",
        notes="  Keep history intact  ",
    )

    assert goal["title"] == "Build my API"
    assert goal["reward"] == "A day off"
    assert goal["purpose"] == "Learn backend development"
    assert goal["success_definition"] == "All required routes work"
    assert goal["notes"] == "Keep history intact"
    assert goal["cycle_id"] == cycle.id
    assert session.get(Goal, goal["id"]).cycle_id == cycle.id


def test_create_goal_normalizes_blank_optional_text(goal_api):
    client, _ = goal_api
    goal = create_goal(
        client, reward=" ", purpose=" ", success_definition=" ", notes=" "
    )
    for field in ("reward", "purpose", "success_definition", "notes"):
        assert goal[field] is None


def test_goal_can_start_and_end_on_same_day(goal_api):
    client, _ = goal_api
    goal = create_goal(client, end_date="2026-10-05")
    assert goal["start_date"] == goal["end_date"]


def test_optional_text_accepts_database_length_limits(goal_api):
    client, _ = goal_api
    fields = {
        "reward": "r" * 200,
        "purpose": "p" * 500,
        "success_definition": "s" * 500,
        "notes": "n" * 2_000,
    }
    goal = create_goal(client, **fields)
    for field, value in fields.items():
        assert goal[field] == value


def test_list_goals_includes_completed_history_and_is_sorted(goal_api):
    client, session = goal_api
    first = create_goal(client, title="Historical goal")
    row = session.get(Goal, first["id"])
    row.completed = True
    row.completed_at = datetime.now(UTC)
    session.commit()
    second = create_goal(client, title="Current goal")

    response = client.get(GOALS_URL)
    assert response.status_code == 200
    rows = response.json()
    keys = [(datetime.fromisoformat(row["created_at"]), row["id"]) for row in rows]
    assert keys == sorted(keys, reverse=True)
    by_id = {row["id"]: row for row in rows}
    assert by_id[first["id"]]["completed"] is True
    assert by_id[second["id"]]["completed"] is False


def test_filter_goals_by_cycle_excludes_other_cycles_and_unlinked_goals(goal_api):
    client, session = goal_api
    first_cycle = make_cycle(session)
    second_cycle = make_cycle(session)
    included = create_goal(client, cycle_id=first_cycle.id)
    create_goal(client, cycle_id=second_cycle.id)
    create_goal(client)

    response = client.get(GOALS_URL, params={"cycle_id": first_cycle.id})
    assert response.status_code == 200
    assert response.json() == [included]


def test_cycle_with_no_goals_returns_empty_list(goal_api):
    client, session = goal_api
    cycle = make_cycle(session)
    response = client.get(GOALS_URL, params={"cycle_id": cycle.id})
    assert response.status_code == 200
    assert response.json() == []


def test_missing_cycle_cannot_receive_new_goal(goal_api):
    client, session = goal_api
    missing_id = (session.scalar(select(func.max(PlanningCycle.id))) or 0) + 1
    before = session.scalar(select(func.count()).select_from(Goal))
    response = client.post(GOALS_URL, json=goal_payload(cycle_id=missing_id))
    assert response.status_code == 404
    assert response.json()["detail"] == "Planning cycle not found."
    assert session.scalar(select(func.count()).select_from(Goal)) == before


@pytest.mark.parametrize("method", ["get", "patch"])
def test_missing_goal_returns_404(goal_api, method):
    client, session = goal_api
    missing_id = (session.scalar(select(func.max(Goal.id))) or 0) + 1
    kwargs = {"json": {"title": "Missing"}} if method == "patch" else {}
    response = getattr(client, method)(f"{GOALS_URL}/{missing_id}", **kwargs)
    assert response.status_code == 404
    assert response.json()["detail"] == "Goal not found."


@pytest.mark.parametrize("method", ["get", "patch"])
@pytest.mark.parametrize("goal_id", [0, -1, 2_147_483_648])
def test_invalid_goal_ids_return_422(goal_api, method, goal_id):
    client, _ = goal_api
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{GOALS_URL}/{goal_id}", **kwargs)
    assert response.status_code == 422


@pytest.mark.parametrize("field", ["title", "start_date", "end_date"])
def test_create_requires_title_and_dates(goal_api, field):
    client, _ = goal_api
    payload = goal_payload()
    del payload[field]
    response = client.post(GOALS_URL, json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize("cycle_id", [0, -1, True, 1.5, "1", 2_147_483_648])
def test_create_rejects_invalid_cycle_ids(goal_api, cycle_id):
    client, _ = goal_api
    response = client.post(GOALS_URL, json=goal_payload(cycle_id=cycle_id))
    assert response.status_code == 422


@pytest.mark.parametrize("cycle_id", ["0", "invalid", "2147483648"])
def test_cycle_filter_rejects_invalid_ids(goal_api, cycle_id):
    client, _ = goal_api
    response = client.get(GOALS_URL, params={"cycle_id": cycle_id})
    assert response.status_code == 422


@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize(
    "field,value",
    [
        ("title", "   "),
        ("title", None),
        ("start_date", None),
        ("end_date", None),
        ("start_date", "2026-02-30"),
        ("end_date", "2026-10-04"),
        ("reward", "x" * 201),
        ("purpose", "x" * 501),
        ("success_definition", "x" * 501),
        ("notes", "x" * 2_001),
        ("id", 42),
        ("source_goal_id", 42),
        ("completed", True),
        ("completion_what_helped", "Overwrite review"),
    ],
    ids=[
        "blank_title", "null_title", "null_start", "null_end",
        "invalid_date", "end_before_start", "reward_too_long",
        "purpose_too_long", "success_definition_too_long", "notes_too_long",
        "protected_id", "protected_source_id", "protected_completion",
        "protected_review",
    ],
)
def test_invalid_writes_preserve_existing_goal(goal_api, method, field, value):
    client, session = goal_api
    existing = create_goal(client)
    before_count = session.scalar(select(func.count()).select_from(Goal))
    if method == "post":
        response = client.post(GOALS_URL, json=goal_payload(**{field: value}))
    else:
        response = client.patch(
            f"{GOALS_URL}/{existing['id']}", json={field: value}
        )
    assert response.status_code == 422, response.text
    assert read_goal(client, existing["id"]) == existing
    assert session.scalar(select(func.count()).select_from(Goal)) == before_count


def test_partial_edit_preserves_source_id_cycle_and_saved_review(goal_api):
    client, session = goal_api
    cycle = make_cycle(session)
    created = create_goal(client, cycle_id=cycle.id)
    row = session.get(Goal, created["id"])
    largest = session.scalar(select(func.max(Goal.source_goal_id))) or 0
    row.source_goal_id = max(largest, 1_900_000_000_000) + 1
    row.completed = True
    row.completed_at = datetime.now(UTC)
    row.completion_what_helped = "A consistent schedule"
    row.completion_hardest_part = "Learning transactions"
    row.completion_learned = "How APIs work"
    row.completion_do_differently = "Test earlier"
    row.completion_task_total = 10
    row.completion_task_completed = 8
    row.completion_milestone_total = 3
    row.completion_milestone_completed = 2
    row.completion_high_priority_completed = 4
    session.commit()
    before = read_goal(client, row.id)

    response = client.patch(
        f"{GOALS_URL}/{row.id}", json={"title": "  Updated title  "}
    )
    assert response.status_code == 200, response.text
    expected = {**before, "title": "Updated title"}
    assert response.json() == expected
    assert read_goal(client, row.id) == expected


@pytest.mark.parametrize("value", [None, "   "])
def test_patch_can_clear_optional_text(goal_api, value):
    client, _ = goal_api
    goal = create_goal(
        client, reward="Reward", purpose="Purpose",
        success_definition="Success", notes="Notes",
    )
    changes = {field: value for field in (
        "reward", "purpose", "success_definition", "notes"
    )}
    response = client.patch(f"{GOALS_URL}/{goal['id']}", json=changes)
    assert response.status_code == 200, response.text
    expected = {**goal, **{field: None for field in changes}}
    assert response.json() == expected
    assert read_goal(client, goal["id"]) == expected


@pytest.mark.parametrize(
    "changes",
    [
        {"start_date": "2026-10-12"},
        {"end_date": "2027-01-01"},
        {"start_date": "2027-02-01", "end_date": "2027-02-28"},
    ],
)
def test_patch_accepts_valid_date_changes(goal_api, changes):
    client, _ = goal_api
    goal = create_goal(client)
    response = client.patch(f"{GOALS_URL}/{goal['id']}", json=changes)
    assert response.status_code == 200, response.text
    expected = {**goal, **changes}
    assert response.json() == expected
    assert read_goal(client, goal["id"]) == expected


def test_patch_checks_new_start_against_saved_end_before_applying_changes(goal_api):
    client, _ = goal_api
    goal = create_goal(client)
    response = client.patch(
        f"{GOALS_URL}/{goal['id']}",
        json={"title": "Must stay unchanged", "start_date": "2027-01-01"},
    )
    assert response.status_code == 422
    assert read_goal(client, goal["id"]) == goal


def test_patch_rejects_reversed_range_when_both_dates_supplied(goal_api):
    client, _ = goal_api
    goal = create_goal(client)
    response = client.patch(
        f"{GOALS_URL}/{goal['id']}",
        json={"start_date": "2027-02-28", "end_date": "2027-02-01"},
    )
    assert response.status_code == 422
    assert read_goal(client, goal["id"]) == goal


def test_patch_cannot_move_goal_to_another_cycle(goal_api):
    client, session = goal_api
    first = make_cycle(session)
    second = make_cycle(session)
    goal = create_goal(client, cycle_id=first.id)
    response = client.patch(
        f"{GOALS_URL}/{goal['id']}", json={"cycle_id": second.id}
    )
    assert response.status_code == 422
    assert read_goal(client, goal["id"]) == goal


def test_empty_patch_preserves_goal(goal_api):
    client, _ = goal_api
    goal = create_goal(client)
    response = client.patch(f"{GOALS_URL}/{goal['id']}", json={})
    assert response.status_code == 200
    assert response.json() == goal
    assert read_goal(client, goal["id"]) == goal


def test_failed_create_rolls_back_without_adding_goal(goal_api):
    client, session = goal_api
    existing = create_goal(client)
    before_count = session.scalar(select(func.count()).select_from(Goal))

    def force_constraint_failure(session, flush_context, instances):
        for row in session.new:
            if isinstance(row, Goal):
                # Trigger the real PostgreSQL nonblank-title CHECK constraint.
                row.title = "   "

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.post(GOALS_URL, json=goal_payload())
    finally:
        event.remove(session, "before_flush", force_constraint_failure)

    assert response.status_code == 409, response.text
    assert session.scalar(select(func.count()).select_from(Goal)) == before_count
    assert read_goal(client, existing["id"]) == existing
    # A failed write must leave the session usable for the next request.
    create_goal(client, title="Valid retry")


def test_failed_patch_rolls_back_all_changed_fields(goal_api):
    client, session = goal_api
    goal = create_goal(client, notes="Original notes")

    def force_constraint_failure(session, flush_context, instances):
        for row in session.dirty:
            if isinstance(row, Goal):
                row.title = "   "

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.patch(
            f"{GOALS_URL}/{goal['id']}",
            json={"title": "Changed title", "notes": "Changed notes"},
        )
    finally:
        event.remove(session, "before_flush", force_constraint_failure)

    assert response.status_code == 409, response.text
    assert read_goal(client, goal["id"]) == goal
    response = client.patch(f"{GOALS_URL}/{goal['id']}", json={"notes": "Retry"})
    assert response.status_code == 200, response.text
