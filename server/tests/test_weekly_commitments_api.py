"""PostgreSQL tests for weekly commitments and their live task links.

Each test uses the shared isolated-schema fixture. Application data is untouched.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import PlanningCycle, Task, WeeklyCommitment
from test_backup_refresh_api import refresh_client


URL = "/api/v1/weekly-commitments"
WEEK = date(2026, 10, 12)
STAMP = datetime(2026, 10, 13, 12, tzinfo=UTC)


@pytest.fixture
def commitment_client(refresh_client):
    return refresh_client


def create(client, **changes):
    payload = {"week_start": WEEK.isoformat(), "title": "Study this week"}
    if changes.get("task_id") is not None:
        payload.pop("title")
    response = client.post(URL, json={**payload, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def make_task(session, **changes):
    values = dict(
        title="Study task", notes="Keep these notes", priority=2,
        day="Monday", due_date=WEEK, completed=False, completed_at=None,
        source_task_id=1_781_204_320_207,
    )
    values.update(changes)
    task = Task(**values)
    session.add(task)
    session.flush()
    return task


def make_cycle(session):
    cycle = PlanningCycle(
        name="Historical cycle", start_date=WEEK,
        end_date=WEEK + timedelta(days=83), active=False, completed_at=STAMP,
    )
    session.add(cycle)
    session.flush()
    return cycle


def snapshot(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return {column.name: getattr(row, column.name) for column in model.__table__.columns}


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_create_read_and_edit_standalone(commitment_client):
    client, session = commitment_client
    row = create(client, title="  Finish chapter  ")
    assert row["title"] == "Finish chapter"
    assert row["completed"] is False
    assert row["completed_at"] is None
    assert row["task_id"] is None
    assert row["cycle_id"] is None
    assert row["source_weekly_commitment_id"] is None
    assert row["id"] > 0 and row["created_at"]
    assert client.get(f"{URL}/{row['id']}").json() == row
    response = client.patch(f"{URL}/{row['id']}", json={"title": "  Revised promise  "})
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Revised promise"
    assert count(session, Task) == 0


def test_create_accepts_historical_cycle_and_preserves_native_link(commitment_client):
    client, session = commitment_client
    cycle = make_cycle(session)
    cycle_id = cycle.id
    session.commit()
    before = snapshot(session, PlanningCycle, cycle_id)
    row = create(client, cycle_id=cycle_id)
    assert row["cycle_id"] == cycle_id
    assert snapshot(session, PlanningCycle, cycle_id) == before


@pytest.mark.parametrize("completed", [False, True])
def test_linked_create_copies_task_completion(commitment_client, completed):
    client, session = commitment_client
    task = make_task(session, completed=completed, completed_at=STAMP if completed else None)
    task_id = task.id
    session.commit()
    before = snapshot(session, Task, task_id)
    row = create(client, task_id=task_id)
    assert row["task_id"] == task_id
    assert row["title"] == before["title"]
    assert row["completed"] is completed
    assert snapshot(session, WeeklyCommitment, row["id"])["completed_at"] == before["completed_at"]
    assert snapshot(session, Task, task_id) == before


def test_duplicate_week_task_rejected_but_other_week_allowed(commitment_client):
    client, session = commitment_client
    task_id = make_task(session).id
    session.commit()
    first = create(client, task_id=task_id)
    before = snapshot(session, WeeklyCommitment, first["id"])
    # Checkpoint setup before the endpoint deliberately rolls back a rejection.
    session.commit()
    response = client.post(URL, json={"week_start": WEEK.isoformat(), "task_id": task_id})
    assert response.status_code == 409, response.text
    assert snapshot(session, WeeklyCommitment, first["id"]) == before
    second = create(client, task_id=task_id, week_start=(WEEK + timedelta(days=7)).isoformat())
    assert second["id"] != first["id"]
    assert count(session, WeeklyCommitment) == 2


@pytest.mark.parametrize("changes", [
    {"week_start": "2026-10-13"}, {"week_start": None}, {"week_start": "nonsense"},
    {"title": None}, {"title": ""}, {"title": "   "}, {"title": "x" * 181},
    {"cycle_id": 0}, {"cycle_id": -1}, {"cycle_id": True}, {"cycle_id": "1"},
    {"task_id": 0}, {"task_id": 2_147_483_648}, {"task_id": True},
    {"task_id": "1"}, {"task_id": 1, "title": "Do not forge a task title"},
    {"id": 12}, {"source_weekly_commitment_id": 1_781_204_320_207},
    {"completed": True}, {"completed_at": "2026-10-13T12:00:00Z"},
    {"created_at": "2026-10-13T12:00:00Z"},
])
def test_create_rejects_invalid_or_server_owned_values(commitment_client, changes):
    client, session = commitment_client
    response = client.post(URL, json={"week_start": WEEK.isoformat(), "title": "Valid", **changes})
    assert response.status_code == 422, response.text
    assert count(session, WeeklyCommitment) == 0
    assert count(session, Task) == 0


@pytest.mark.parametrize("field", ["task_id", "cycle_id"])
def test_create_missing_parent_returns_404(commitment_client, field):
    client, session = commitment_client
    payload = {"week_start": WEEK.isoformat(), field: 999_999}
    if field == "cycle_id":
        payload["title"] = "Promise"
    response = client.post(URL, json=payload)
    assert response.status_code == 404, response.text
    assert count(session, WeeklyCommitment) == 0


@pytest.mark.parametrize("title", ["   ", "x" * 181])
def test_linked_create_rejects_unusable_task_title_without_truncating(commitment_client, title):
    client, session = commitment_client
    task_id = make_task(session, title=title).id
    session.commit()
    before = snapshot(session, Task, task_id)
    session.commit()
    response = client.post(URL, json={"week_start": WEEK.isoformat(), "task_id": task_id})
    assert response.status_code == 422, response.text
    assert snapshot(session, Task, task_id) == before
    assert count(session, WeeklyCommitment) == 0


def test_linked_create_rejects_inconsistent_task_completion(commitment_client):
    client, session = commitment_client
    task_id = make_task(session, completed=True, completed_at=None).id
    session.commit()
    response = client.post(URL, json={"week_start": WEEK.isoformat(), "task_id": task_id})
    assert response.status_code == 409, response.text
    assert count(session, WeeklyCommitment) == 0
    assert snapshot(session, Task, task_id)["completed"] is True


def test_list_filters_and_order_use_live_task_completion(commitment_client):
    client, session = commitment_client
    cycle_id = make_cycle(session).id
    task_id = make_task(session).id
    session.commit()
    linked = create(client, task_id=task_id, cycle_id=cycle_id)
    plain = create(client)
    newer = create(client, week_start=(WEEK + timedelta(days=7)).isoformat())
    response = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": True})
    assert response.status_code == 200, response.text
    rows = client.get(URL).json()
    assert [row["id"] for row in rows] == [newer["id"], plain["id"], linked["id"]]
    for params, expected in [
        ({"week_start": WEEK.isoformat()}, [plain["id"], linked["id"]]),
        ({"cycle_id": cycle_id}, [linked["id"]]),
        ({"task_id": task_id}, [linked["id"]]),
        ({"completed": "true"}, [linked["id"]]),
        ({"completed": "false"}, [newer["id"], plain["id"]]),
        ({"week_start": WEEK.isoformat(), "completed": "false"}, [plain["id"]]),
    ]:
        response = client.get(URL, params=params)
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == expected
    assert snapshot(session, WeeklyCommitment, linked["id"])["completed"] is False


@pytest.mark.parametrize("params", [
    {"week_start": "2026-10-13"}, {"week_start": "bad"},
    {"cycle_id": 0}, {"task_id": -1}, {"task_id": 2_147_483_648},
    {"completed": "invalid"},
])
def test_invalid_list_filters_return_422(commitment_client, params):
    client, _ = commitment_client
    response = client.get(URL, params=params)
    assert response.status_code == 422, response.text


def test_live_read_follows_task_reopening_without_stale_timestamp(commitment_client):
    client, session = commitment_client
    task_id = make_task(session, completed=True, completed_at=STAMP).id
    session.commit()
    row = create(client, task_id=task_id)
    before = snapshot(session, WeeklyCommitment, row["id"])
    response = client.patch(f"/api/v1/tasks/{task_id}", json={"completed": False, "title": "x" * 200})
    assert response.status_code == 200, response.text
    for displayed in [client.get(f"{URL}/{row['id']}").json(), client.get(URL).json()[0]]:
        assert displayed["title"] == "x" * 200
        assert displayed["completed"] is False
        assert displayed["completed_at"] is None
    assert snapshot(session, WeeklyCommitment, row["id"]) == before


@pytest.mark.parametrize("linked", [False, True])
def test_complete_repeat_and_reopen_preserve_completion_pair(commitment_client, linked):
    client, session = commitment_client
    task_id = make_task(session).id if linked else None
    session.commit()
    row = create(client, **({"task_id": task_id} if linked else {}))
    task_before = snapshot(session, Task, task_id) if linked else None
    first = client.patch(f"{URL}/{row['id']}", json={"completed": True})
    assert first.status_code == 200, first.text
    assert first.json()["completed"] is True
    stamp = first.json()["completed_at"]
    assert stamp is not None
    second = client.patch(f"{URL}/{row['id']}", json={"completed": True})
    assert second.status_code == 200, second.text
    assert second.json()["completed_at"] == stamp
    if linked:
        now = snapshot(session, Task, task_id)
        assert now["completed"] is True and now["completed_at"] is not None
        assert {k: v for k, v in now.items() if k not in {"completed", "completed_at"}} == {
            k: v for k, v in task_before.items() if k not in {"completed", "completed_at"}
        }
    reopened = client.patch(f"{URL}/{row['id']}", json={"completed": False})
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["completed"] is False
    assert reopened.json()["completed_at"] is None
    assert snapshot(session, WeeklyCommitment, row["id"])["completed_at"] is None
    if linked:
        assert snapshot(session, Task, task_id) == task_before


def test_completion_uses_live_task_timestamp_and_updates_other_week_display(commitment_client):
    client, session = commitment_client
    task_id = make_task(session).id
    session.commit()
    first = create(client, task_id=task_id)
    other = create(client, task_id=task_id, week_start=(WEEK + timedelta(days=7)).isoformat())
    other_before = snapshot(session, WeeklyCommitment, other["id"])
    task = session.get(Task, task_id)
    task.completed = True
    task.completed_at = STAMP
    session.commit()
    response = client.patch(f"{URL}/{first['id']}", json={"completed": True})
    assert response.status_code == 200, response.text
    assert snapshot(session, WeeklyCommitment, first["id"])["completed_at"] == STAMP
    assert client.get(f"{URL}/{other['id']}").json()["completed"] is True
    assert snapshot(session, WeeklyCommitment, other["id"]) == other_before


@pytest.mark.parametrize("changes", [
    {"title": None}, {"title": ""}, {"title": " "}, {"title": "x" * 181},
    {"completed": None}, {"completed": 1}, {"completed": "true"},
    {"week_start": "2026-10-19"}, {"cycle_id": None}, {"task_id": None},
    {"source_weekly_commitment_id": 123}, {"id": 123},
    {"created_at": "2026-10-13T12:00:00Z"}, {"completed_at": None},
])
def test_patch_rejects_invalid_values_and_identity_changes(commitment_client, changes):
    client, session = commitment_client
    row = create(client)
    before = snapshot(session, WeeklyCommitment, row["id"])
    session.commit()
    response = client.patch(f"{URL}/{row['id']}", json=changes)
    assert response.status_code == 422, response.text
    assert snapshot(session, WeeklyCommitment, row["id"]) == before


def test_linked_title_rejection_does_not_partially_complete_task(commitment_client):
    client, session = commitment_client
    task_id = make_task(session).id
    session.commit()
    row = create(client, task_id=task_id)
    before = snapshot(session, WeeklyCommitment, row["id"])
    task_before = snapshot(session, Task, task_id)
    session.commit()
    response = client.patch(f"{URL}/{row['id']}", json={"title": "Wrong place", "completed": True})
    assert response.status_code == 409, response.text
    assert snapshot(session, WeeklyCommitment, row["id"]) == before
    assert snapshot(session, Task, task_id) == task_before


def test_empty_patch_keeps_saved_snapshot(commitment_client):
    client, session = commitment_client
    row = create(client)
    before = snapshot(session, WeeklyCommitment, row["id"])
    response = client.patch(f"{URL}/{row['id']}", json={})
    assert response.status_code == 200, response.text
    assert snapshot(session, WeeklyCommitment, row["id"]) == before


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_missing_commitment_returns_404(commitment_client, method):
    client, _ = commitment_client
    kwargs = {"json": {"completed": True}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/999999", **kwargs)
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648])
@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_invalid_path_id_returns_422(commitment_client, method, identity):
    client, _ = commitment_client
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/{identity}", **kwargs)
    assert response.status_code == 422, response.text


def test_delete_commitment_preserves_task_cycle_and_other_week(commitment_client):
    client, session = commitment_client
    task_id = make_task(session).id
    cycle_id = make_cycle(session).id
    session.commit()
    row = create(client, task_id=task_id, cycle_id=cycle_id)
    other = create(client, task_id=task_id, week_start=(WEEK + timedelta(days=7)).isoformat())
    task_before = snapshot(session, Task, task_id)
    cycle_before = snapshot(session, PlanningCycle, cycle_id)
    other_before = snapshot(session, WeeklyCommitment, other["id"])
    response = client.delete(f"{URL}/{row['id']}")
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert snapshot(session, WeeklyCommitment, row["id"]) is None
    assert snapshot(session, WeeklyCommitment, other["id"]) == other_before
    assert snapshot(session, Task, task_id) == task_before
    assert snapshot(session, PlanningCycle, cycle_id) == cycle_before


def test_task_deletion_retains_stored_commitment_snapshot(commitment_client):
    client, session = commitment_client
    task_id = make_task(session).id
    session.commit()
    row = create(client, task_id=task_id)
    before = snapshot(session, WeeklyCommitment, row["id"])
    response = client.delete(f"/api/v1/tasks/{task_id}")
    assert response.status_code == 204, response.text
    assert snapshot(session, Task, task_id) is None
    assert snapshot(session, WeeklyCommitment, row["id"]) == {**before, "task_id": None}
    displayed = client.get(f"{URL}/{row['id']}").json()
    assert displayed["task_id"] is None
    assert displayed["title"] == before["title"]
    assert displayed["completed"] == before["completed"]


def test_database_cycle_delete_unlinks_without_removing_commitment(commitment_client):
    client, session = commitment_client
    cycle_id = make_cycle(session).id
    session.commit()
    row = create(client, cycle_id=cycle_id)
    before = snapshot(session, WeeklyCommitment, row["id"])
    session.delete(session.get(PlanningCycle, cycle_id))
    session.commit()
    assert snapshot(session, WeeklyCommitment, row["id"]) == {**before, "cycle_id": None}
    assert client.get(f"{URL}/{row['id']}").json()["cycle_id"] is None


def test_failed_linked_completion_rolls_back_both_rows_and_retry_works(commitment_client):
    """Force an actual PostgreSQL CHECK failure after both ORM rows change."""
    client, session = commitment_client
    task_id = make_task(session).id
    session.commit()
    row = create(client, task_id=task_id)
    before = snapshot(session, WeeklyCommitment, row["id"])
    task_before = snapshot(session, Task, task_id)
    session.commit()

    def break_priority(mapper, connection, target):
        if target.id == task_id:
            target.priority = 3

    event.listen(Task, "before_update", break_priority)
    try:
        response = client.patch(f"{URL}/{row['id']}", json={"completed": True})
    finally:
        event.remove(Task, "before_update", break_priority)
    assert response.status_code == 409, response.text
    assert snapshot(session, Task, task_id) == task_before
    assert snapshot(session, WeeklyCommitment, row["id"]) == before
    retry = client.patch(f"{URL}/{row['id']}", json={"completed": True})
    assert retry.status_code == 200, retry.text
    assert snapshot(session, Task, task_id)["completed"] is True
    assert snapshot(session, WeeklyCommitment, row["id"])["completed"] is True


@pytest.mark.parametrize("operation", ["create", "update", "delete"])
def test_commit_failure_rolls_back_operation(commitment_client, monkeypatch, operation):
    client, session = commitment_client
    row = create(client)
    before = snapshot(session, WeeklyCommitment, row["id"])
    session.commit()

    def fail_commit():
        session.flush()
        raise IntegrityError("simulated commit failure", {}, Exception("test failure"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        if operation == "create":
            response = client.post(URL, json={"week_start": WEEK.isoformat(), "title": "Must roll back"})
        elif operation == "update":
            response = client.patch(f"{URL}/{row['id']}", json={"title": "Must roll back", "completed": True})
        else:
            response = client.delete(f"{URL}/{row['id']}")
    assert response.status_code == 409, response.text
    assert snapshot(session, WeeklyCommitment, row["id"]) == before
    assert count(session, WeeklyCommitment) == 1
    assert "simulated" not in response.text
    assert client.get(f"{URL}/{row['id']}").status_code == 200
