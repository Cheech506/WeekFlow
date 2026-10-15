"""PostgreSQL API tests for skips, retries, and occurrence history.

Each test uses isolated tables and rolls back its data and schema afterward.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import RecurringOccurrenceException, RecurringRule, Task
from test_backup_refresh_api import refresh_client


URL = "/api/v1/recurring-exceptions"
DAY = date(2026, 10, 13)


@pytest.fixture
def exception_client(refresh_client):
    """Reuse test-owned tables instead of the live application's tables."""

    return refresh_client


def make_rule(session, *, source_id=None, active=True):
    rule = RecurringRule(
        title="Study schedule",
        source_recurring_rule_id=source_id,
        frequency="daily",
        start_date=date(2026, 10, 12),
        active=active,
    )
    session.add(rule)
    session.flush()
    return rule


def create_skip(client, rule_id, occurrence_date=DAY):
    response = client.post(URL, json={
        "recurring_rule_id": rule_id,
        "occurrence_date": occurrence_date.isoformat(),
    })
    assert response.status_code == 201, response.text
    return response.json()


def skip_path(rule_id, occurrence_date=DAY):
    return f"{URL}/{rule_id}/{occurrence_date.isoformat()}"


def make_task(session, rule, *, completed=False, legacy=False, **changes):
    values = {
        "title": "Keep this occurrence",
        "notes": "Preserve history",
        "priority": 2,
        "recurring_rule_id": None if legacy else rule.id,
        "source_recurring_rule_id": rule.source_recurring_rule_id,
        "recurrence_occurrence_date": DAY,
        # Rescheduling must not change the original date used for the skip.
        "due_date": date(2026, 10, 20),
        "day": "Tuesday",
        "completed": completed,
        "completed_at": datetime(2026, 10, 13, 12, tzinfo=UTC) if completed else None,
    }
    values.update(changes)
    task = Task(**values)
    session.add(task)
    session.flush()
    return task


def stored_skip(session, rule_id, occurrence_date=DAY):
    """Reload the composite identity after writes and rollbacks."""

    session.expire_all()
    return session.get(RecurringOccurrenceException, (rule_id, occurrence_date))


def test_create_read_and_retry_preserve_the_original_skip(exception_client):
    client, session = exception_client
    rule_id = make_rule(session).id
    created = create_skip(client, rule_id)
    assert created["recurring_rule_id"] == rule_id
    assert created["occurrence_date"] == DAY.isoformat()
    assert created["created_at"]
    assert "id" not in created

    response = client.get(skip_path(rule_id))
    assert response.status_code == 200
    assert response.json() == created
    response = client.post(URL, json={
        "recurring_rule_id": rule_id, "occurrence_date": DAY.isoformat(),
    })
    assert response.status_code == 200, response.text
    assert response.json() == created
    assert session.scalar(select(func.count()).select_from(RecurringOccurrenceException)) == 1


def test_composite_identity_keeps_dates_and_schedules_separate(exception_client):
    client, session = exception_client
    first_id = make_rule(session).id
    second_id = make_rule(session).id
    first = create_skip(client, first_id)
    second = create_skip(client, second_id)
    later = create_skip(client, first_id, date(2026, 10, 14))

    assert client.get(skip_path(first_id)).json() == first
    assert client.get(skip_path(second_id)).json() == second
    assert client.get(skip_path(first_id, date(2026, 10, 14))).json() == later
    assert session.scalar(select(func.count()).select_from(RecurringOccurrenceException)) == 3


def test_list_filters_by_schedule_and_occurrence_date(exception_client):
    client, session = exception_client
    assert client.get(URL).json() == []
    first_id = make_rule(session).id
    second_id = make_rule(session).id
    first = create_skip(client, first_id)
    second = create_skip(client, second_id)
    later = create_skip(client, first_id, date(2026, 10, 14))

    response = client.get(URL)
    assert response.status_code == 200
    assert response.json() == [first, second, later]
    assert client.get(URL, params={"recurring_rule_id": first_id}).json() == [first, later]
    assert client.get(URL, params={"occurrence_date": DAY.isoformat()}).json() == [first, second]
    assert client.get(URL, params={
        "recurring_rule_id": first_id, "occurrence_date": DAY.isoformat(),
    }).json() == [first]
    assert client.get(URL, params={"recurring_rule_id": 2_147_483_647}).json() == []


@pytest.mark.parametrize(
    "changes",
    [
        {"recurring_rule_id": 0},
        {"recurring_rule_id": -1},
        {"recurring_rule_id": True},
        {"recurring_rule_id": "1"},
        {"recurring_rule_id": 1.5},
        {"recurring_rule_id": 2_147_483_648},
        {"recurring_rule_id": None},
        {"occurrence_date": None},
        {"occurrence_date": "2026-02-30"},
        {"source_recurring_rule_id": 1_781_204_330_006},
        {"id": 12},
        {"created_at": "2026-10-13T12:00:00Z"},
    ],
)
def test_invalid_create_does_not_save_a_skip(exception_client, changes):
    client, session = exception_client
    rule_id = make_rule(session).id
    response = client.post(URL, json={
        "recurring_rule_id": rule_id, "occurrence_date": DAY.isoformat(), **changes,
    })
    assert response.status_code == 422, response.text
    assert session.scalar(select(RecurringOccurrenceException.recurring_rule_id).limit(1)) is None


@pytest.mark.parametrize("field", ["recurring_rule_id", "occurrence_date"])
def test_create_requires_both_identity_fields(exception_client, field):
    client, session = exception_client
    body = {"recurring_rule_id": make_rule(session).id, "occurrence_date": DAY.isoformat()}
    del body[field]
    assert client.post(URL, json=body).status_code == 422


def test_missing_schedule_returns_404_without_saving(exception_client):
    client, session = exception_client
    response = client.post(URL, json={
        "recurring_rule_id": 2_147_483_647, "occurrence_date": DAY.isoformat(),
    })
    assert response.status_code == 404
    assert session.scalar(select(RecurringOccurrenceException.recurring_rule_id).limit(1)) is None


@pytest.mark.parametrize("method", ["get", "delete"])
def test_missing_skip_returns_404(exception_client, method):
    client, session = exception_client
    rule_id = make_rule(session).id
    assert getattr(client, method)(skip_path(rule_id)).status_code == 404


@pytest.mark.parametrize(
    "suffix", ["0/2026-10-13", "2147483648/2026-10-13", "7/2026-02-30", "bad/2026-10-13"],
)
def test_invalid_identity_returns_422(exception_client, suffix):
    client, _ = exception_client
    assert client.get(f"{URL}/{suffix}").status_code == 422
    assert client.delete(f"{URL}/{suffix}").status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"recurring_rule_id": 0},
        {"recurring_rule_id": 2_147_483_648},
        {"occurrence_date": "2026-02-30"},
    ],
)
def test_invalid_list_filters_return_422(exception_client, params):
    client, _ = exception_client
    assert client.get(URL, params=params).status_code == 422


@pytest.mark.parametrize("completed", [False, True])
@pytest.mark.parametrize("legacy", [False, True])
def test_existing_task_blocks_a_new_skip_without_changing_history(
    exception_client, completed, legacy,
):
    client, session = exception_client
    rule = make_rule(session, source_id=1_781_204_330_006)
    rule_id = rule.id
    task_id = make_task(session, rule, completed=completed, legacy=legacy).id
    # Save the setup savepoint before exercising an intentionally rejected
    # request. The fixture's outer transaction still rolls everything back.
    session.commit()
    task_path = f"/api/v1/tasks/{task_id}"
    before_response = client.get(task_path)
    assert before_response.status_code == 200, before_response.text
    before = before_response.json()

    response = client.post(URL, json={
        "recurring_rule_id": rule_id, "occurrence_date": DAY.isoformat(),
    })
    assert response.status_code == 409, response.text
    assert stored_skip(session, rule_id) is None
    after_response = client.get(task_path)
    assert after_response.status_code == 200, after_response.text
    assert after_response.json() == before


def test_skip_does_not_match_another_native_schedule_by_stale_source_id(exception_client):
    client, session = exception_client
    old = make_rule(session, source_id=1_781_204_330_006)
    actual = make_rule(session)
    old_id = old.id
    task_id = make_task(session, actual, source_recurring_rule_id=old.source_recurring_rule_id).id
    before = client.get(f"/api/v1/tasks/{task_id}").json()

    create_skip(client, old_id)
    assert client.get(f"/api/v1/tasks/{task_id}").json() == before


def test_skip_blocks_task_creation_until_removed(exception_client):
    client, session = exception_client
    rule_id = make_rule(session).id
    create_skip(client, rule_id)
    body = {
        "title": "Regenerated occurrence", "recurring_rule_id": rule_id,
        "recurrence_occurrence_date": DAY.isoformat(),
    }
    assert client.post("/api/v1/tasks", json=body).status_code == 409
    assert session.scalar(select(Task.id).limit(1)) is None

    response = client.delete(skip_path(rule_id))
    assert response.status_code == 204
    assert response.content == b""
    assert stored_skip(session, rule_id) is None
    # Removing the skip permits generation but does not generate a task itself.
    assert session.scalar(select(Task.id).limit(1)) is None
    response = client.post("/api/v1/tasks", json=body)
    assert response.status_code == 201, response.text
    assert response.json()["recurrence_occurrence_date"] == DAY.isoformat()


def test_delete_removes_only_the_requested_skip_and_keeps_pause_state(exception_client):
    client, session = exception_client
    rule_id = make_rule(session, active=False).id
    other_rule_id = make_rule(session).id
    create_skip(client, rule_id)
    later = create_skip(client, rule_id, date(2026, 10, 14))
    other = create_skip(client, other_rule_id)

    assert client.delete(skip_path(rule_id)).status_code == 204
    assert client.get(skip_path(rule_id)).status_code == 404
    assert client.get(skip_path(rule_id, date(2026, 10, 14))).json() == later
    assert client.get(skip_path(other_rule_id)).json() == other
    session.expire_all()
    assert session.get(RecurringRule, rule_id).active is False
    assert session.scalar(select(Task.id).limit(1)) is None


def test_task_deletion_records_original_date_and_skip_retry_is_unchanged(exception_client):
    client, session = exception_client
    rule = make_rule(session, source_id=1_781_204_330_006)
    rule_id = rule.id
    task_id = make_task(session, rule).id
    response = client.delete(f"/api/v1/tasks/{task_id}")
    assert response.status_code == 204, response.text
    assert client.get(f"/api/v1/tasks/{task_id}").status_code == 404

    original_skip = client.get(skip_path(rule_id))
    assert original_skip.status_code == 200
    # The task was due on the 20th, but its recurring identity was the 13th.
    assert client.get(skip_path(rule_id, date(2026, 10, 20))).status_code == 404
    retry = client.post(URL, json={
        "recurring_rule_id": rule_id, "occurrence_date": DAY.isoformat(),
    })
    assert retry.status_code == 200
    assert retry.json() == original_skip.json()


def test_removing_imported_skip_keeps_completed_task_history(exception_client):
    client, session = exception_client
    rule = make_rule(session, source_id=1_781_204_330_006)
    rule_id = rule.id
    task_id = make_task(session, rule, completed=True).id
    # Backups may retain a skip alongside completed historical work.
    session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=DAY))
    session.flush()
    before = client.get(f"/api/v1/tasks/{task_id}").json()

    assert client.delete(skip_path(rule_id)).status_code == 204
    assert client.get(f"/api/v1/tasks/{task_id}").json() == before
    assert stored_skip(session, rule_id) is None


@pytest.mark.parametrize("operation", ["create", "delete"])
def test_failed_write_rolls_back_skip_and_allows_retry(exception_client, monkeypatch, operation):
    client, session = exception_client
    rule_id = make_rule(session).id
    if operation == "delete":
        session.add(RecurringOccurrenceException(recurring_rule_id=rule_id, occurrence_date=DAY))
    session.commit()
    existing = stored_skip(session, rule_id)
    original_created_at = existing.created_at if existing is not None else None

    def fail_commit():
        session.flush()
        raise IntegrityError("test commit", {}, Exception("forced test failure"))

    def request():
        if operation == "create":
            return client.post(URL, json={
                "recurring_rule_id": rule_id, "occurrence_date": DAY.isoformat(),
            })
        return client.delete(skip_path(rule_id))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = request()

    assert response.status_code == 409, response.text
    restored = stored_skip(session, rule_id)
    if operation == "create":
        assert restored is None
    else:
        assert restored is not None
        assert restored.created_at == original_created_at
    assert session.get(RecurringRule, rule_id) is not None
    assert request().status_code == (201 if operation == "create" else 204)
