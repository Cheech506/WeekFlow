"""PostgreSQL tests for weekly reflections and immutable saved statistics.

The shared fixture creates test-owned tables and rolls back the whole test.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    PlanningCycle, Task, WeeklyCommitment, WeeklyReview, WeeklyTaskDecision,
)
from test_backup_refresh_api import refresh_client


URL = "/api/v1/weekly-reviews"
WEEK = date(2026, 10, 12)
STAMP = datetime(2026, 10, 13, 12, tzinfo=UTC)
REFLECTION_FIELDS = (
    "what_went_well", "what_caused_problems", "what_learned",
    "what_change_next_week", "next_week_focus",
)
COUNT_FIELDS = (
    "completed_count", "unfinished_count", "overdue_count",
    "goals_progressed_count", "best_day_count", "archived_brain_dump_count",
    "high_priority_completed_count", "recurring_completed_count",
)


@pytest.fixture
def review_client(refresh_client):
    return refresh_client


def analytics(**changes):
    return {
        "completed_count": 3, "unfinished_count": 5, "overdue_count": 2,
        "completion_rate": 38, "goals_progressed_count": 2,
        "best_day": "Tuesday", "best_day_count": 2,
        "archived_brain_dump_count": 4, "high_priority_completed_count": 1,
        "recurring_completed_count": 2, **changes,
    }


def payload(**changes):
    return {
        "week_start": WEEK.isoformat(), "snapshot": analytics(),
        **{field: f"  Response for {field}  " for field in REFLECTION_FIELDS},
        **changes,
    }


def create(client, **changes):
    response = client.post(URL, json=payload(**changes))
    assert response.status_code == 201, response.text
    return response.json()


def make_cycle(session):
    cycle = PlanningCycle(
        name="Historical cycle", start_date=WEEK,
        end_date=WEEK + timedelta(days=83), active=False, completed_at=STAMP,
    )
    session.add(cycle)
    session.flush()
    return cycle.id


def snapshot(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return {column.name: getattr(row, column.name) for column in model.__table__.columns}


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def frozen_values(row):
    return {key: value for key, value in row.items() if key.startswith("snapshot_")}


def test_create_read_and_list_all_saved_fields(review_client):
    client, session = review_client
    row = create(client)
    assert row["id"] > 0
    assert row["source_weekly_review_id"] is None
    assert row["cycle_id"] is None
    assert row["week_start"] == WEEK.isoformat()
    for field in REFLECTION_FIELDS:
        assert row[field] == f"Response for {field}"
    assert frozen_values(row) == {f"snapshot_{key}": value for key, value in analytics().items()}
    assert row["created_at"] == row["updated_at"] == row["reviewed_at"]
    assert datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).utcoffset() == timedelta(0)
    assert client.get(f"{URL}/{row['id']}").json() == row
    assert client.get(URL).json() == [row]
    assert count(session, Task) == 0


def test_list_empty_and_filter_by_week_and_cycle(review_client):
    client, session = review_client
    assert client.get(URL).json() == []
    cycle_id = make_cycle(session)
    session.commit()
    first = create(client, cycle_id=cycle_id)
    second = create(client, week_start=(WEEK + timedelta(days=7)).isoformat())
    third = create(client, week_start=(WEEK - timedelta(days=7)).isoformat(), cycle_id=cycle_id)
    for params, expected in [
        ({}, [second["id"], first["id"], third["id"]]),
        ({"week_start": WEEK.isoformat()}, [first["id"]]),
        ({"cycle_id": cycle_id}, [first["id"], third["id"]]),
        ({"week_start": WEEK.isoformat(), "cycle_id": cycle_id}, [first["id"]]),
        ({"cycle_id": 999_999}, []),
        ({"week_start": "2020-01-06"}, []),
    ]:
        response = client.get(URL, params=params)
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == expected


@pytest.mark.parametrize("identical", [True, False])
def test_duplicate_week_never_overwrites_saved_review(review_client, identical):
    client, session = review_client
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    session.commit()  # Keep fixture setup outside the deliberately rejected savepoint.
    incoming = payload()
    if not identical:
        incoming.update(what_went_well="Replacement", snapshot=analytics(archived_brain_dump_count=99))
    response = client.post(URL, json=incoming)
    assert response.status_code == 409, response.text
    assert snapshot(session, WeeklyReview, row["id"]) == before
    assert count(session, WeeklyReview) == 1


def test_duplicate_week_is_global_even_with_different_cycle(review_client):
    client, session = review_client
    first_cycle = make_cycle(session)
    second_cycle = make_cycle(session)
    session.commit()
    row = create(client, cycle_id=first_cycle)
    before = snapshot(session, WeeklyReview, row["id"])
    session.commit()
    response = client.post(URL, json=payload(cycle_id=second_cycle))
    assert response.status_code == 409, response.text
    assert snapshot(session, WeeklyReview, row["id"]) == before


@pytest.mark.parametrize("field", REFLECTION_FIELDS)
def test_partial_reflection_edit_preserves_other_fields_and_snapshot(review_client, field):
    client, session = review_client
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    response = client.patch(f"{URL}/{row['id']}", json={field: "  Revised reflection  "})
    assert response.status_code == 200, response.text
    after = snapshot(session, WeeklyReview, row["id"])
    assert after[field] == "Revised reflection"
    for key in before:
        if key not in {field, "updated_at", "reviewed_at"}:
            assert after[key] == before[key]
    assert after["updated_at"] >= before["updated_at"]
    assert after["updated_at"] == after["reviewed_at"]


@pytest.mark.parametrize("value", [None, "", "   "])
def test_explicit_empty_response_clears_it_without_erasing_other_responses(review_client, value):
    client, session = review_client
    row = create(client)
    response = client.patch(f"{URL}/{row['id']}", json={"what_learned": value})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["what_learned"] is None
    assert result["next_week_focus"] == row["next_week_focus"]
    assert frozen_values(result) == frozen_values(row)


def test_empty_patch_preserves_timestamps_and_all_saved_values(review_client):
    client, session = review_client
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    response = client.patch(f"{URL}/{row['id']}", json={})
    assert response.status_code == 200, response.text
    assert response.json() == row
    assert snapshot(session, WeeklyReview, row["id"]) == before


def test_change_and_clear_cycle_link_without_changing_statistics(review_client):
    client, session = review_client
    first_cycle = make_cycle(session)
    second_cycle = make_cycle(session)
    session.commit()
    row = create(client, cycle_id=first_cycle)
    for cycle_id in [second_cycle, None]:
        response = client.patch(f"{URL}/{row['id']}", json={"cycle_id": cycle_id})
        assert response.status_code == 200, response.text
        assert response.json()["cycle_id"] == cycle_id
        assert frozen_values(response.json()) == frozen_values(row)
        assert response.json()["created_at"] == row["created_at"]
    assert count(session, PlanningCycle) == 2


def test_missing_cycle_create_and_update_leave_history_unchanged(review_client):
    client, session = review_client
    response = client.post(URL, json=payload(cycle_id=999_999))
    assert response.status_code == 404, response.text
    assert count(session, WeeklyReview) == 0
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    session.commit()
    response = client.patch(f"{URL}/{row['id']}", json={"cycle_id": 999_999, "what_learned": "Must roll back"})
    assert response.status_code == 404, response.text
    assert snapshot(session, WeeklyReview, row["id"]) == before


def test_review_snapshot_survives_task_completion_reschedule_and_deletion(review_client):
    client, session = review_client
    task = Task(title="Task", day="Monday", due_date=WEEK)
    session.add(task)
    session.flush()
    task_id = task.id
    session.commit()
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    for changes in [{"completed": True}, {"completed": False, "due_date": "2026-11-02"}]:
        response = client.patch(f"/api/v1/tasks/{task_id}", json=changes)
        assert response.status_code == 200, response.text
        assert snapshot(session, WeeklyReview, row["id"]) == before
    response = client.delete(f"/api/v1/tasks/{task_id}")
    assert response.status_code == 204, response.text
    assert snapshot(session, WeeklyReview, row["id"]) == before
    edited = client.patch(f"{URL}/{row['id']}", json={"what_learned": "Still the original numbers"})
    assert edited.status_code == 200, edited.text
    assert frozen_values(edited.json()) == frozen_values(row)


def test_edit_imported_review_preserves_source_identity_and_snapshot(review_client):
    client, session = review_client
    review = WeeklyReview(
        source_weekly_review_id=1_781_204_323_111, week_start=WEEK,
        what_went_well="Imported reflection", created_at=STAMP, updated_at=STAMP,
        reviewed_at=STAMP,
        **{f"snapshot_{key}": value for key, value in analytics().items()},
    )
    session.add(review)
    session.flush()
    review_id = review.id
    session.commit()
    before = snapshot(session, WeeklyReview, review_id)
    response = client.patch(f"{URL}/{review_id}", json={"next_week_focus": "New focus"})
    assert response.status_code == 200, response.text
    after = snapshot(session, WeeklyReview, review_id)
    assert after["id"] == before["id"]
    assert after["source_weekly_review_id"] == before["source_weekly_review_id"]
    assert after["created_at"] == before["created_at"]
    assert frozen_values(after) == frozen_values(before)


@pytest.mark.parametrize("changes", [
    {"week_start": "2026-10-13"}, {"week_start": None}, {"week_start": "bad"},
    {"cycle_id": 0}, {"cycle_id": -1}, {"cycle_id": True}, {"cycle_id": "1"},
    {"cycle_id": 2_147_483_648}, {"snapshot": None}, {"snapshot": {}},
    {"source_weekly_review_id": 123}, {"id": 123},
    {"created_at": "2026-10-12T00:00:00Z"},
    {"updated_at": "2026-10-12T00:00:00Z"},
    {"reviewed_at": "2026-10-12T00:00:00Z"}, {"snapshot_completed_count": 3},
])
def test_invalid_create_returns_422_without_saving(review_client, changes):
    client, session = review_client
    response = client.post(URL, json=payload(**changes))
    assert response.status_code == 422, response.text
    assert count(session, WeeklyReview) == 0


@pytest.mark.parametrize("field", ["week_start", "snapshot"])
def test_missing_required_create_field_returns_422(review_client, field):
    client, session = review_client
    incoming = payload()
    incoming.pop(field)
    response = client.post(URL, json=incoming)
    assert response.status_code == 422, response.text
    assert count(session, WeeklyReview) == 0


@pytest.mark.parametrize("field", REFLECTION_FIELDS)
@pytest.mark.parametrize("method", ["post", "patch"])
def test_oversized_response_rejected_on_create_and_edit(review_client, field, method):
    client, session = review_client
    if method == "post":
        response = client.post(URL, json=payload(**{field: "x" * 2001}))
        assert count(session, WeeklyReview) == 0
    else:
        row = create(client)
        before = snapshot(session, WeeklyReview, row["id"])
        session.commit()
        response = client.patch(f"{URL}/{row['id']}", json={field: "x" * 2001})
        assert snapshot(session, WeeklyReview, row["id"]) == before
    assert response.status_code == 422, response.text


def test_maximum_response_lengths_can_be_saved(review_client):
    client, _ = review_client
    row = create(client, **{field: "x" * 2000 for field in REFLECTION_FIELDS})
    assert all(row[field] == "x" * 2000 for field in REFLECTION_FIELDS)


@pytest.mark.parametrize("changes", [
    {"completion_rate": 37}, {"completion_rate": -1}, {"completion_rate": 101},
    {"completion_rate": True}, {"overdue_count": 6}, {"goals_progressed_count": 4},
    {"best_day_count": 4}, {"high_priority_completed_count": 4},
    {"recurring_completed_count": 4}, {"best_day": "Funday"},
    {"best_day": None}, {"best_day_count": 0},
    {"unfinished_count": 2_147_483_647}, {"unexpected_count": 1},
])
def test_inconsistent_snapshot_rejected_without_saving(review_client, changes):
    client, session = review_client
    response = client.post(URL, json=payload(snapshot=analytics(**changes)))
    assert response.status_code == 422, response.text
    assert count(session, WeeklyReview) == 0


@pytest.mark.parametrize("field", COUNT_FIELDS)
@pytest.mark.parametrize("value", [-1, True, 1.5, "1"])
def test_snapshot_counts_require_nonnegative_integers(review_client, field, value):
    client, session = review_client
    response = client.post(URL, json=payload(snapshot=analytics(**{field: value})))
    assert response.status_code == 422, response.text
    assert count(session, WeeklyReview) == 0


@pytest.mark.parametrize("completed,unfinished,rate", [(0, 0, 0), (1, 7, 13), (3, 5, 38), (1, 2, 33)])
def test_valid_snapshot_rounding_matches_postgresql(review_client, completed, unfinished, rate):
    client, _ = review_client
    row = create(client, snapshot=analytics(
        completed_count=completed, unfinished_count=unfinished, completion_rate=rate,
        overdue_count=0, goals_progressed_count=0, best_day=None, best_day_count=0,
        high_priority_completed_count=0, recurring_completed_count=0,
    ))
    assert row["snapshot_completion_rate"] == rate


@pytest.mark.parametrize("changes", [
    {"snapshot": analytics()}, {"snapshot_completed_count": 100},
    {"week_start": "2026-10-19"}, {"source_weekly_review_id": 123}, {"id": 123},
    {"created_at": "2026-10-12T00:00:00Z"}, {"updated_at": None}, {"reviewed_at": None},
    {"cycle_id": True}, {"cycle_id": "1"}, {"cycle_id": 0},
])
def test_patch_cannot_rewrite_identity_or_statistics(review_client, changes):
    client, session = review_client
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    session.commit()
    response = client.patch(f"{URL}/{row['id']}", json={"what_learned": "Must not save", **changes})
    assert response.status_code == 422, response.text
    assert snapshot(session, WeeklyReview, row["id"]) == before


@pytest.mark.parametrize("params", [
    {"week_start": "2026-10-13"}, {"week_start": "bad"},
    {"cycle_id": 0}, {"cycle_id": -1}, {"cycle_id": 2_147_483_648},
])
def test_invalid_list_filter_returns_422(review_client, params):
    client, _ = review_client
    response = client.get(URL, params=params)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_missing_review_returns_404(review_client, method):
    client, _ = review_client
    kwargs = {"json": {"what_learned": "New"}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/999999", **kwargs)
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648])
@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_invalid_path_id_returns_422(review_client, identity, method):
    client, _ = review_client
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/{identity}", **kwargs)
    assert response.status_code == 422, response.text


def test_cycle_deletion_retains_reflection_and_frozen_statistics(review_client):
    client, session = review_client
    cycle_id = make_cycle(session)
    session.commit()
    row = create(client, cycle_id=cycle_id)
    before = snapshot(session, WeeklyReview, row["id"])
    session.delete(session.get(PlanningCycle, cycle_id))
    session.commit()
    assert snapshot(session, WeeklyReview, row["id"]) == {**before, "cycle_id": None}
    assert frozen_values(client.get(f"{URL}/{row['id']}").json()) == frozen_values(row)


def test_delete_review_preserves_other_week_and_related_records(review_client):
    client, session = review_client
    cycle_id = make_cycle(session)
    task = Task(title="Keep task", day="Monday", due_date=WEEK)
    session.add(task)
    session.flush()
    task_id = task.id
    commitment = WeeklyCommitment(week_start=WEEK, cycle_id=cycle_id, task_id=task_id, title="Keep commitment")
    decision = WeeklyTaskDecision(week_start=WEEK, task_id=task_id, task_title="Keep task", original_due_date=WEEK, action="keep")
    session.add_all([commitment, decision])
    session.flush()
    commitment_id, decision_id = commitment.id, decision.id
    session.commit()
    row = create(client, cycle_id=cycle_id)
    other = create(client, week_start=(WEEK + timedelta(days=7)).isoformat())
    records = [(PlanningCycle, cycle_id), (Task, task_id), (WeeklyCommitment, commitment_id), (WeeklyTaskDecision, decision_id), (WeeklyReview, other["id"])]
    before = {(model, identity): snapshot(session, model, identity) for model, identity in records}
    response = client.delete(f"{URL}/{row['id']}")
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert snapshot(session, WeeklyReview, row["id"]) is None
    for model, identity in records:
        assert snapshot(session, model, identity) == before[(model, identity)]


@pytest.mark.parametrize("operation", ["create", "update", "delete"])
def test_failed_commit_rolls_back_and_allows_retry(review_client, monkeypatch, operation):
    client, session = review_client
    row = create(client)
    before = snapshot(session, WeeklyReview, row["id"])
    session.commit()
    other_week = (WEEK + timedelta(days=7)).isoformat()

    def fail_commit():
        session.flush()
        raise IntegrityError("simulated commit failure", {}, Exception("private test detail"))

    def request():
        if operation == "create":
            return client.post(URL, json=payload(week_start=other_week))
        if operation == "update":
            return client.patch(f"{URL}/{row['id']}", json={"what_learned": "Replacement"})
        return client.delete(f"{URL}/{row['id']}")

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = request()
    assert response.status_code == 409, response.text
    assert "private test detail" not in response.text
    assert snapshot(session, WeeklyReview, row["id"]) == before
    assert count(session, WeeklyReview) == 1
    retried = request()
    assert retried.status_code == {"create": 201, "update": 200, "delete": 204}[operation], retried.text
