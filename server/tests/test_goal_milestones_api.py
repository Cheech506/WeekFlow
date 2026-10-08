"""Goal milestone API tests using PostgreSQL and rolled-back transactions."""

from collections.abc import Generator
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import engine, get_db
from app.main import app
from app.models import Goal, GoalMilestone


MILESTONES_URL = f"{API_PREFIX}/goal-milestones"


@pytest.fixture
def milestone_api() -> Generator[tuple[TestClient, Session], None, None]:
    """Undo test changes, including endpoint commits and deletions."""

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


def make_goal(session: Session) -> Goal:
    """Seed a new test goal without changing existing goals."""

    goal = Goal(
        title="Milestone API test goal",
        start_date=date(2026, 10, 5),
        end_date=date(2026, 12, 27),
    )
    session.add(goal)
    session.commit()
    return goal


def create_milestone(client: TestClient, goal_id: int, **changes) -> dict:
    payload = {"goal_id": goal_id, "title": "Finish API tests"}
    payload.update(changes)
    response = client.post(MILESTONES_URL, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def read_milestone(client: TestClient, milestone_id: int) -> dict:
    response = client.get(f"{MILESTONES_URL}/{milestone_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_create_minimal_milestone_and_read_it_back(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    milestone = create_milestone(client, goal.id)

    assert milestone["id"] > 0
    assert milestone["goal_id"] == goal.id
    assert milestone["source_goal_milestone_id"] is None
    assert milestone["title"] == "Finish API tests"
    assert milestone["notes"] is None
    assert milestone["target_date"] is None
    assert milestone["completed"] is False
    assert milestone["completed_at"] is None
    assert datetime.fromisoformat(milestone["created_at"]).tzinfo is not None
    assert read_milestone(client, milestone["id"]) == milestone


def test_create_trims_text_and_accepts_target_date(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    milestone = create_milestone(
        client, goal.id, title="  Finish API  ",
        notes="  Check relationships  ", target_date="2026-11-01",
    )
    assert milestone["title"] == "Finish API"
    assert milestone["notes"] == "Check relationships"
    assert milestone["target_date"] == "2026-11-01"
    assert session.get(GoalMilestone, milestone["id"]).goal_id == goal.id


def test_create_normalizes_blank_notes(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    milestone = create_milestone(client, goal.id, notes="   ")
    assert milestone["notes"] is None


def test_title_and_notes_accept_maximum_lengths(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    milestone = create_milestone(client, goal.id, title="x" * 160, notes="n" * 500)
    assert milestone["title"] == "x" * 160
    assert milestone["notes"] == "n" * 500


def test_list_sorting_and_goal_filter_match_app(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    other_goal = make_goal(session)
    late = create_milestone(client, goal.id, target_date="2026-12-01")
    undated = create_milestone(client, goal.id)
    early = create_milestone(client, goal.id, target_date="2026-11-01")
    same_date = create_milestone(client, goal.id, target_date="2026-11-01")
    finished = create_milestone(client, goal.id, target_date="2026-10-15")
    response = client.patch(
        f"{MILESTONES_URL}/{finished['id']}", json={"completed": True}
    )
    assert response.status_code == 200
    other = create_milestone(client, other_goal.id)

    response = client.get(MILESTONES_URL, params={"goal_id": goal.id})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [
        early["id"], same_date["id"], late["id"], undated["id"], finished["id"],
    ]
    assert all(row["goal_id"] == goal.id for row in response.json())

    response = client.get(MILESTONES_URL)
    assert response.status_code == 200
    rows = response.json()
    assert other["id"] in {row["id"] for row in rows}
    keys = [
        (
            row["completed"], row["target_date"] is None,
            row["target_date"] or "9999-12-31",
            datetime.fromisoformat(row["created_at"]), row["id"],
        )
        for row in rows
    ]
    assert keys == sorted(keys)


def test_goal_without_milestones_returns_empty_list(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    response = client.get(MILESTONES_URL, params={"goal_id": goal.id})
    assert response.status_code == 200
    assert response.json() == []


def test_missing_goal_cannot_receive_milestone(milestone_api):
    client, session = milestone_api
    missing_id = (session.scalar(select(func.max(Goal.id))) or 0) + 1
    before = session.scalar(select(func.count()).select_from(GoalMilestone))
    response = client.post(
        MILESTONES_URL, json={"goal_id": missing_id, "title": "Missing goal"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Goal not found."
    assert session.scalar(select(func.count()).select_from(GoalMilestone)) == before


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_missing_milestone_returns_404(milestone_api, method):
    client, session = milestone_api
    missing_id = (session.scalar(select(func.max(GoalMilestone.id))) or 0) + 1
    kwargs = {"json": {"title": "Missing"}} if method == "patch" else {}
    response = getattr(client, method)(f"{MILESTONES_URL}/{missing_id}", **kwargs)
    assert response.status_code == 404


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
@pytest.mark.parametrize("milestone_id", [0, -1, 2_147_483_648])
def test_invalid_milestone_ids_return_422(milestone_api, method, milestone_id):
    client, _ = milestone_api
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{MILESTONES_URL}/{milestone_id}", **kwargs)
    assert response.status_code == 422


@pytest.mark.parametrize("goal_id", [0, -1, True, 1.5, "1", 2_147_483_648])
def test_create_rejects_invalid_goal_ids(milestone_api, goal_id):
    client, _ = milestone_api
    response = client.post(
        MILESTONES_URL, json={"goal_id": goal_id, "title": "Test"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("goal_id", ["0", "invalid", "2147483648"])
def test_filter_rejects_invalid_goal_ids(milestone_api, goal_id):
    client, _ = milestone_api
    response = client.get(MILESTONES_URL, params={"goal_id": goal_id})
    assert response.status_code == 422


@pytest.mark.parametrize("field", ["goal_id", "title"])
def test_create_requires_goal_and_title(milestone_api, field):
    client, session = milestone_api
    goal = make_goal(session)
    payload = {"goal_id": goal.id, "title": "Required fields"}
    del payload[field]
    assert client.post(MILESTONES_URL, json=payload).status_code == 422


@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize(
    "field,value",
    [
        ("title", "   "),
        ("title", None),
        ("title", "x" * 161),
        ("notes", "x" * 501),
        ("target_date", "2026-02-30"),
        ("id", 42),
        ("source_goal_milestone_id", 42),
        ("completed_at", "2026-10-07T12:00:00Z"),
    ],
    ids=[
        "blank_title", "null_title", "title_too_long", "notes_too_long",
        "invalid_date", "protected_id", "protected_source_id", "protected_timestamp",
    ],
)
def test_invalid_writes_preserve_existing_milestone(milestone_api, method, field, value):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    before_count = session.scalar(select(func.count()).select_from(GoalMilestone))
    if method == "post":
        payload = {"goal_id": goal.id, "title": "New milestone", field: value}
        response = client.post(MILESTONES_URL, json=payload)
    else:
        response = client.patch(
            f"{MILESTONES_URL}/{existing['id']}", json={field: value}
        )
    assert response.status_code == 422, response.text
    assert read_milestone(client, existing["id"]) == existing
    assert session.scalar(select(func.count()).select_from(GoalMilestone)) == before_count


def test_create_cannot_set_completion_state(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    response = client.post(
        MILESTONES_URL,
        json={"goal_id": goal.id, "title": "Test", "completed": True},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("completed", [None, 1, "true"])
def test_patch_rejects_invalid_completion_values(milestone_api, completed):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    response = client.patch(
        f"{MILESTONES_URL}/{existing['id']}", json={"completed": completed}
    )
    assert response.status_code == 422
    assert read_milestone(client, existing["id"]) == existing


def test_partial_edit_preserves_source_goal_link_and_completion_history(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id, target_date="2026-11-01")
    row = session.get(GoalMilestone, existing["id"])
    largest = session.scalar(select(func.max(GoalMilestone.source_goal_milestone_id))) or 0
    row.source_goal_milestone_id = max(largest, 1_900_000_000_000) + 1
    row.completed = True
    row.completed_at = datetime(2025, 1, 1, 12, tzinfo=UTC)
    session.commit()
    before = read_milestone(client, row.id)

    response = client.patch(
        f"{MILESTONES_URL}/{row.id}",
        json={"title": "  Updated title  ", "completed": True},
    )
    assert response.status_code == 200, response.text
    expected = {**before, "title": "Updated title"}
    assert response.json() == expected
    assert read_milestone(client, row.id) == expected


@pytest.mark.parametrize("notes", [None, "   "])
def test_patch_can_clear_notes_and_target_date(milestone_api, notes):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(
        client, goal.id, notes="Original notes", target_date="2026-11-01"
    )
    response = client.patch(
        f"{MILESTONES_URL}/{existing['id']}",
        json={"notes": notes, "target_date": None},
    )
    assert response.status_code == 200, response.text
    expected = {**existing, "notes": None, "target_date": None}
    assert response.json() == expected
    assert read_milestone(client, existing["id"]) == expected


def test_patch_can_set_target_date(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    response = client.patch(
        f"{MILESTONES_URL}/{existing['id']}", json={"target_date": "2026-11-01"}
    )
    assert response.status_code == 200
    assert read_milestone(client, existing["id"]) == {
        **existing, "target_date": "2026-11-01",
    }


def test_milestone_cannot_be_moved_to_another_goal(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    other_goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    response = client.patch(
        f"{MILESTONES_URL}/{existing['id']}", json={"goal_id": other_goal.id}
    )
    assert response.status_code == 422
    assert read_milestone(client, existing["id"]) == existing


def test_empty_patch_preserves_every_field(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    response = client.patch(f"{MILESTONES_URL}/{existing['id']}", json={})
    assert response.status_code == 200
    assert response.json() == existing


def test_complete_repeat_reopen_and_complete_again(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    url = f"{MILESTONES_URL}/{existing['id']}"

    before = datetime.now(UTC)
    response = client.patch(url, json={"completed": True})
    assert response.status_code == 200, response.text
    finished = response.json()
    timestamp = datetime.fromisoformat(finished["completed_at"])
    assert timestamp.tzinfo is not None
    assert before <= timestamp <= datetime.now(UTC)
    assert finished == {**existing, "completed": True, "completed_at": finished["completed_at"]}
    assert read_milestone(client, existing["id"]) == finished

    response = client.patch(url, json={"completed": True})
    assert response.status_code == 200
    assert response.json() == finished

    response = client.patch(url, json={"completed": False})
    assert response.status_code == 200
    assert response.json() == existing
    assert read_milestone(client, existing["id"]) == existing

    response = client.patch(url, json={"completed": True})
    assert response.status_code == 200
    assert response.json()["completed"] is True
    assert datetime.fromisoformat(response.json()["completed_at"]) >= timestamp


def test_delete_removes_only_requested_milestone(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    first = create_milestone(client, goal.id)
    sibling = create_milestone(client, goal.id, title="Keep this milestone")
    goal_before = client.get(f"{API_PREFIX}/goals/{goal.id}")
    assert goal_before.status_code == 200

    response = client.delete(f"{MILESTONES_URL}/{first['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"{MILESTONES_URL}/{first['id']}").status_code == 404
    assert session.get(GoalMilestone, first["id"]) is None
    assert read_milestone(client, sibling["id"]) == sibling
    assert client.get(f"{API_PREFIX}/goals/{goal.id}").json() == goal_before.json()
    assert client.delete(f"{MILESTONES_URL}/{first['id']}").status_code == 404


def test_failed_create_rolls_back_and_session_can_retry(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id)
    before_count = session.scalar(select(func.count()).select_from(GoalMilestone))

    def force_constraint_failure(session, flush_context, instances):
        for row in session.new:
            if isinstance(row, GoalMilestone):
                # Trigger the real PostgreSQL nonblank-title CHECK constraint.
                row.title = "   "

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.post(
            MILESTONES_URL, json={"goal_id": goal.id, "title": "Valid request"}
        )
    finally:
        event.remove(session, "before_flush", force_constraint_failure)

    assert response.status_code == 409, response.text
    assert session.scalar(select(func.count()).select_from(GoalMilestone)) == before_count
    assert read_milestone(client, existing["id"]) == existing
    create_milestone(client, goal.id, title="Valid retry")


def test_failed_patch_rolls_back_details_and_completion(milestone_api):
    client, session = milestone_api
    goal = make_goal(session)
    existing = create_milestone(client, goal.id, notes="Original notes")

    def force_constraint_failure(session, flush_context, instances):
        for row in session.dirty:
            if isinstance(row, GoalMilestone):
                row.title = "   "

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.patch(
            f"{MILESTONES_URL}/{existing['id']}",
            json={"notes": "Changed notes", "completed": True},
        )
    finally:
        event.remove(session, "before_flush", force_constraint_failure)

    assert response.status_code == 409, response.text
    assert read_milestone(client, existing["id"]) == existing
    response = client.patch(
        f"{MILESTONES_URL}/{existing['id']}", json={"notes": "Valid retry"}
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("origin", ["http://localhost:8081", "http://127.0.0.1:8081"])
def test_expo_can_send_delete_requests(origin):
    with TestClient(app) as client:
        response = client.options(
            f"{MILESTONES_URL}/1",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "DELETE" in response.headers["access-control-allow-methods"]
