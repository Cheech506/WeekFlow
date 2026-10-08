"""Planning-cycle API tests using PostgreSQL and rolled-back transactions."""

from collections.abc import Generator
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import engine, get_db
from app.main import app
from app.models import Goal, PlanningCycle


CYCLES_URL = f"{API_PREFIX}/planning-cycles"


@pytest.fixture
def cycle_api() -> Generator[tuple[TestClient, Session], None, None]:
    """Undo test rows and restore existing cycles, even after route commits."""

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
            # Make room for test cycles inside the outer transaction only.
            # Teardown restores any real active cycle to its original state.
            session.execute(
                update(PlanningCycle)
                .where(PlanningCycle.active.is_(True))
                .values(active=False, completed_at=datetime.now(UTC))
            )
            session.commit()
            app.dependency_overrides[get_db] = override_get_db

            with TestClient(app) as client:
                yield client, session
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)
            session.close()
            outer_transaction.rollback()


def start_cycle(client: TestClient, **changes) -> dict:
    """Create a valid test cycle and return its API response."""

    payload = {
        "start_date": "2026-10-05",
        "name": "Test cycle",
        "primary_focus": "Finish WeekFlow",
        "theme": "Consistency",
    }
    payload.update(changes)
    response = client.post(CYCLES_URL, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def read_cycle(client: TestClient, cycle_id: int) -> dict:
    response = client.get(f"{CYCLES_URL}/{cycle_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_current_cycle_is_null_when_none_is_active(cycle_api):
    client, _ = cycle_api
    response = client.get(f"{CYCLES_URL}/current")
    assert response.status_code == 200
    assert response.json() is None


@pytest.mark.parametrize("start_date", ["2026-10-05", "2028-02-01"])
def test_create_minimal_cycle_and_read_it_back(cycle_api, start_date):
    client, _ = cycle_api
    response = client.post(CYCLES_URL, json={"start_date": start_date})
    assert response.status_code == 201, response.text
    cycle = response.json()

    assert cycle["id"] > 0
    assert cycle["source_planning_cycle_id"] is None
    assert cycle["start_date"] == start_date
    assert cycle["end_date"] == (
        date.fromisoformat(start_date) + timedelta(days=83)
    ).isoformat()
    assert cycle["active"] is True
    assert cycle["completed_at"] is None
    assert datetime.fromisoformat(cycle["created_at"]).tzinfo is not None
    assert cycle["name"] is None
    assert cycle["primary_focus"] is None
    assert cycle["theme"] is None
    assert read_cycle(client, cycle["id"]) == cycle
    assert client.get(f"{CYCLES_URL}/current").json() == cycle


def test_starting_new_cycle_preserves_history_and_goal_relationship(cycle_api):
    client, session = cycle_api
    old = start_cycle(client, name="Previous cycle")
    goal = Goal(
        cycle_id=old["id"],
        title="Historical goal",
        start_date=date.fromisoformat(old["start_date"]),
        end_date=date.fromisoformat(old["end_date"]),
    )
    session.add(goal)
    session.commit()
    goal_id = goal.id

    new = start_cycle(client, start_date="2027-01-04", name="Next cycle")
    historical = read_cycle(client, old["id"])

    assert new["id"] != old["id"]
    assert historical["active"] is False
    assert historical["completed_at"] is not None
    for field in ("id", "name", "start_date", "end_date", "created_at"):
        assert historical[field] == old[field]
    assert session.get(Goal, goal_id).cycle_id == old["id"]
    assert client.get(f"{CYCLES_URL}/current").json()["id"] == new["id"]
    assert session.scalar(
        select(func.count()).select_from(PlanningCycle)
        .where(PlanningCycle.active.is_(True))
    ) == 1


def test_list_includes_history_in_date_and_id_order(cycle_api):
    client, _ = cycle_api
    created = [
        start_cycle(client, start_date="2027-01-04"),
        start_cycle(client, start_date="2026-10-05"),
        start_cycle(client, start_date="2027-01-04"),
    ]
    response = client.get(CYCLES_URL)
    assert response.status_code == 200
    rows = response.json()
    keys = [(row["start_date"], row["id"]) for row in rows]
    assert keys == sorted(keys, reverse=True)
    assert {row["id"] for row in created} <= {row["id"] for row in rows}


@pytest.mark.parametrize("method", ["get", "patch"])
def test_missing_cycle_returns_404(cycle_api, method):
    client, session = cycle_api
    missing_id = (session.scalar(select(func.max(PlanningCycle.id))) or 0) + 1
    kwargs = {"json": {"name": "Missing"}} if method == "patch" else {}
    response = getattr(client, method)(f"{CYCLES_URL}/{missing_id}", **kwargs)
    assert response.status_code == 404


@pytest.mark.parametrize("method", ["get", "patch"])
@pytest.mark.parametrize("cycle_id", [0, -1])
def test_nonpositive_cycle_ids_are_rejected(cycle_api, method, cycle_id):
    client, _ = cycle_api
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{CYCLES_URL}/{cycle_id}", **kwargs)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"start_date": None},
        {"start_date": "2026-02-30"},
        {"start_date": "9999-12-31"},
        {"start_date": "2026-10-05", "name": "x" * 81},
        {"start_date": "2026-10-05", "primary_focus": "x" * 301},
        {"start_date": "2026-10-05", "theme": "x" * 121},
        {"start_date": "2026-10-05", "id": 42},
        {"start_date": "2026-10-05", "source_planning_cycle_id": 42},
        {"start_date": "2026-10-05", "active": False},
        {"start_date": "2026-10-05", "end_date": "2026-10-06"},
    ],
)
def test_invalid_create_keeps_existing_cycle_unchanged(cycle_api, payload):
    client, _ = cycle_api
    existing = start_cycle(client)
    before = client.get(CYCLES_URL).json()
    response = client.post(CYCLES_URL, json=payload)
    assert response.status_code == 422, response.text
    assert read_cycle(client, existing["id"]) == existing
    assert client.get(CYCLES_URL).json() == before


def test_patch_changes_only_supplied_fields_and_preserves_source_id(cycle_api):
    client, session = cycle_api
    cycle = start_cycle(client)
    row = session.get(PlanningCycle, cycle["id"])
    # Use an unused positive source ID without changing the PostgreSQL ID.
    largest = session.scalar(select(func.max(PlanningCycle.source_planning_cycle_id)))
    row.source_planning_cycle_id = (largest or 0) + 1
    session.commit()
    before = read_cycle(client, cycle["id"])

    response = client.patch(
        f"{CYCLES_URL}/{cycle['id']}", json={"name": "  Updated cycle  "}
    )
    assert response.status_code == 200, response.text
    expected = {**before, "name": "Updated cycle"}
    assert response.json() == expected
    assert read_cycle(client, cycle["id"]) == expected


@pytest.mark.parametrize("value", [None, "   "])
def test_optional_text_can_be_cleared(cycle_api, value):
    client, _ = cycle_api
    cycle = start_cycle(client)
    changes = {"name": value, "primary_focus": value, "theme": value}
    response = client.patch(f"{CYCLES_URL}/{cycle['id']}", json=changes)
    assert response.status_code == 200, response.text
    assert response.json() == {
        **cycle, "name": None, "primary_focus": None, "theme": None,
    }


def test_patch_start_date_recalculates_end_date(cycle_api):
    client, _ = cycle_api
    cycle = start_cycle(client)
    new_start = date(2028, 2, 1)
    response = client.patch(
        f"{CYCLES_URL}/{cycle['id']}",
        json={"start_date": new_start.isoformat()},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        **cycle,
        "start_date": new_start.isoformat(),
        "end_date": (new_start + timedelta(days=83)).isoformat(),
    }


def test_empty_patch_preserves_all_fields(cycle_api):
    client, _ = cycle_api
    cycle = start_cycle(client)
    response = client.patch(f"{CYCLES_URL}/{cycle['id']}", json={})
    assert response.status_code == 200
    assert response.json() == cycle


def test_historical_cycle_cannot_be_edited(cycle_api):
    client, _ = cycle_api
    old = start_cycle(client)
    current = start_cycle(client, name="Current cycle")
    before = read_cycle(client, old["id"])
    response = client.patch(
        f"{CYCLES_URL}/{old['id']}", json={"name": "Overwrite history"}
    )
    assert response.status_code == 409
    assert read_cycle(client, old["id"]) == before
    assert client.get(f"{CYCLES_URL}/current").json() == current


@pytest.mark.parametrize(
    "changes",
    [
        {"start_date": None},
        {"start_date": "2026-02-30"},
        {"start_date": "9999-12-31"},
        {"name": "x" * 81},
        {"primary_focus": "x" * 301},
        {"theme": "x" * 121},
        {"id": 42},
        {"source_planning_cycle_id": 42},
        {"active": False},
        {"end_date": "2026-10-06"},
        {"completed_at": "2026-10-07T12:00:00Z"},
    ],
)
def test_invalid_patch_keeps_cycle_unchanged(cycle_api, changes):
    client, _ = cycle_api
    cycle = start_cycle(client)
    response = client.patch(f"{CYCLES_URL}/{cycle['id']}", json=changes)
    assert response.status_code == 422, response.text
    assert read_cycle(client, cycle["id"]) == cycle


def test_failed_create_rolls_back_previous_cycle_closure(cycle_api):
    client, session = cycle_api
    existing = start_cycle(client)
    before = client.get(CYCLES_URL).json()

    def force_constraint_failure(session, flush_context, instances):
        for row in session.new:
            if isinstance(row, PlanningCycle):
                # Trigger the real PostgreSQL twelve-week CHECK constraint.
                row.end_date = row.start_date + timedelta(days=82)

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.post(CYCLES_URL, json={"start_date": "2027-01-04"})
    finally:
        event.remove(session, "before_flush", force_constraint_failure)

    assert response.status_code == 409, response.text
    assert read_cycle(client, existing["id"]) == existing
    assert client.get(f"{CYCLES_URL}/current").json() == existing
    assert client.get(CYCLES_URL).json() == before


def test_failed_patch_rolls_back_changes(cycle_api):
    client, session = cycle_api
    existing = start_cycle(client)

    def force_constraint_failure(session, flush_context, instances):
        for row in session.dirty:
            if isinstance(row, PlanningCycle):
                row.end_date = row.start_date + timedelta(days=82)

    event.listen(session, "before_flush", force_constraint_failure)
    try:
        response = client.patch(
            f"{CYCLES_URL}/{existing['id']}", json={"name": "Must roll back"}
        )
    finally:
        event.remove(session, "before_flush", force_constraint_failure)

    assert response.status_code == 409, response.text
    assert read_cycle(client, existing["id"]) == existing


def test_expo_origin_can_send_patch_requests():
    with TestClient(app) as client:
        response = client.options(
            f"{CYCLES_URL}/1",
            headers={
                "Origin": "http://localhost:8081",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert "PATCH" in response.headers["access-control-allow-methods"]
