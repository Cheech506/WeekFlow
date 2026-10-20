"""PostgreSQL tests for Brain Dump notes and atomic Inbox conversion.

The shared fixture uses test-owned schemas and rolls back all records.
"""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import BrainDump, CycleReview, PlanningCycle, Task, WeeklyReview
from app.services.backup_import import MODELS
from test_backup_refresh_api import refresh_client


URL = "/api/v1/brain-dumps"
STAMP = datetime(2001, 1, 1, 12, tzinfo=UTC)
SOURCE_ID = 1_781_204_330_005


@pytest.fixture
def brain_client(refresh_client):
    return refresh_client


def create(client, body="  Save this idea  "):
    response = client.post(URL, json={"body": body})
    assert response.status_code == 201, response.text
    return response.json()


def make_note(session, **changes):
    values = dict(body="Historical note", archived=False, archived_at=None, created_at=STAMP)
    values.update(changes)
    if values["archived"] and "archived_at" not in changes:
        values["archived_at"] = STAMP
    note = BrainDump(**values)
    session.add(note)
    session.flush()
    return note.id


def snapshot(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return deepcopy({column.name: getattr(row, column.name) for column in model.__table__.columns})


def database_state(session):
    session.expire_all()
    return {
        name: [deepcopy({column.name: getattr(row, column.name) for column in model.__table__.columns})
               for row in session.scalars(select(model).order_by(*model.__table__.primary_key.columns)).all()]
        for name, model in MODELS.items()
    }


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def test_create_read_and_list_active_note(brain_client):
    client, session = brain_client
    assert client.get(URL).json() == []
    row = create(client)
    assert row["id"] > 0 and row["source_brain_dump_id"] is None
    assert row["body"] == "Save this idea"
    assert row["archived"] is False and row["archived_at"] is None
    assert row["created_at"]
    assert client.get(f"{URL}/{row['id']}").json() == row
    assert client.get(URL).json() == [row]
    assert count(session, Task) == 0


def test_long_multiline_notes_are_not_truncated(brain_client):
    client, _ = brain_client
    text = "First line\n" + "x" * 20000 + "\nLast line"
    row = create(client, f"  {text}  ")
    assert row["body"] == text
    revised = f"Updated\n{text}"
    response = client.patch(f"{URL}/{row['id']}", json={"body": revised})
    assert response.status_code == 200, response.text
    assert response.json()["body"] == revised


@pytest.mark.parametrize("archived", [False, True])
def test_edit_preserves_imported_identity_creation_time_and_archive_state(brain_client, archived):
    client, session = brain_client
    identity = make_note(session, archived=archived, source_brain_dump_id=SOURCE_ID)
    session.commit()
    before = snapshot(session, BrainDump, identity)
    response = client.patch(f"{URL}/{identity}", json={"body": "  Revised\nNote  "})
    assert response.status_code == 200, response.text
    assert snapshot(session, BrainDump, identity) == {**before, "body": "Revised\nNote"}


def test_archive_retry_restore_and_rearchive_keep_consistent_timestamps(brain_client):
    client, session = brain_client
    row = create(client)
    identity = row["id"]
    archived = client.patch(f"{URL}/{identity}", json={"archived": True})
    assert archived.status_code == 200, archived.text
    first = snapshot(session, BrainDump, identity)
    assert first["archived"] is True and first["archived_at"] is not None
    assert client.patch(f"{URL}/{identity}", json={"archived": True}).status_code == 200
    assert snapshot(session, BrainDump, identity) == first
    response = client.patch(f"{URL}/{identity}", json={"archived": False})
    assert response.status_code == 200, response.text
    restored = snapshot(session, BrainDump, identity)
    assert restored == {**first, "archived": False, "archived_at": None}
    assert client.patch(f"{URL}/{identity}", json={"archived": False}).status_code == 200
    assert snapshot(session, BrainDump, identity) == restored
    response = client.patch(f"{URL}/{identity}", json={"archived": True})
    assert response.status_code == 200, response.text
    assert snapshot(session, BrainDump, identity)["archived_at"] >= first["archived_at"]
    assert response.json()["created_at"] == row["created_at"]


def test_text_and_archive_can_change_in_one_patch(brain_client):
    client, session = brain_client
    row = create(client)
    response = client.patch(f"{URL}/{row['id']}", json={"body": "  Finished idea  ", "archived": True})
    assert response.status_code == 200, response.text
    assert response.json()["body"] == "Finished idea"
    assert response.json()["archived"] is True and response.json()["archived_at"] is not None
    assert count(session, BrainDump) == 1


def test_empty_patch_changes_nothing(brain_client):
    client, session = brain_client
    identity = make_note(session, archived=True, source_brain_dump_id=SOURCE_ID)
    session.commit()
    before = snapshot(session, BrainDump, identity)
    response = client.patch(f"{URL}/{identity}", json={})
    assert response.status_code == 200, response.text
    assert snapshot(session, BrainDump, identity) == before


def test_list_filters_and_deterministic_order(brain_client):
    client, session = brain_client
    older = make_note(session, created_at=STAMP)
    newer = make_note(session, created_at=STAMP + timedelta(days=1))
    archived = make_note(session, created_at=STAMP + timedelta(days=1), archived=True)
    session.commit()
    for params, expected in [({}, [archived, newer, older]), ({"archived": "true"}, [archived]), ({"archived": "false"}, [newer, older])]:
        response = client.get(URL, params=params)
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == expected
    assert client.get(URL, params={"archived": "invalid"}).status_code == 422


@pytest.mark.parametrize("incoming", [
    {}, {"body": None}, {"body": ""}, {"body": "   "}, {"body": "\n\t"},
    {"body": 7}, {"body": True}, {"body": ["note"]},
    {"body": "Valid", "archived": True}, {"body": "Valid", "id": 7},
    {"body": "Valid", "source_brain_dump_id": SOURCE_ID},
    {"body": "Valid", "created_at": "2026-10-19T00:00:00Z"},
    {"body": "Valid", "archived_at": None},
])
def test_invalid_create_does_not_save_note(brain_client, incoming):
    client, session = brain_client
    response = client.post(URL, json=incoming)
    assert response.status_code == 422, response.text
    assert count(session, BrainDump) == 0 and count(session, Task) == 0


@pytest.mark.parametrize("changes", [
    {"body": None}, {"body": ""}, {"body": " \t\n"}, {"body": 7},
    {"archived": None}, {"archived": 1}, {"archived": "true"},
    {"id": 7}, {"source_brain_dump_id": 123},
    {"created_at": "2026-10-19T00:00:00Z"}, {"archived_at": None},
])
def test_invalid_patch_preserves_note(brain_client, changes):
    client, session = brain_client
    identity = make_note(session, source_brain_dump_id=SOURCE_ID)
    session.commit()
    before = snapshot(session, BrainDump, identity); session.commit()
    response = client.patch(f"{URL}/{identity}", json=changes)
    assert response.status_code == 422, response.text
    assert snapshot(session, BrainDump, identity) == before


@pytest.mark.parametrize("method,suffix", [("get", ""), ("patch", ""), ("delete", ""), ("post", "/convert-to-task")])
def test_missing_note_returns_404_without_creating_task(brain_client, method, suffix):
    client, session = brain_client
    kwargs = {"json": {"body": "Revised"}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/999999{suffix}", **kwargs)
    assert response.status_code == 404, response.text
    assert count(session, Task) == 0


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_647 + 1])
@pytest.mark.parametrize("method,suffix", [("get", ""), ("patch", ""), ("delete", ""), ("post", "/convert-to-task")])
def test_invalid_note_id_returns_422(brain_client, identity, method, suffix):
    client, _ = brain_client
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/{identity}{suffix}", **kwargs)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("archived", [False, True])
def test_delete_note_does_not_delete_existing_tasks(brain_client, archived):
    client, session = brain_client
    identity = make_note(session, archived=archived)
    task = Task(title="Existing independent task")
    session.add(task); session.flush()
    task_id = task.id; session.commit()
    before = snapshot(session, Task, task_id)
    response = client.delete(f"{URL}/{identity}")
    assert response.status_code == 204 and response.content == b"", response.text
    assert snapshot(session, BrainDump, identity) is None
    assert snapshot(session, Task, task_id) == before


def test_convert_creates_plain_inbox_task_and_removes_only_source_note(brain_client):
    client, session = brain_client
    identity = make_note(session, body="  First line\nSecond line  ", source_brain_dump_id=SOURCE_ID)
    other_id = make_note(session, body="Other note")
    session.add(Task(title="Existing task")); session.commit()
    other_before = snapshot(session, BrainDump, other_id)
    response = client.post(f"{URL}/{identity}/convert-to-task")
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["id"] > 0 and result["title"] == "First line\nSecond line"
    assert result["day"] == "Inbox" and result["priority"] == 0
    assert result["completed"] is False
    for field in ["due_date", "notes", "goal_id", "recurring_rule_id", "recurrence_occurrence_date", "completed_at", "source_task_id", "source_goal_id", "source_recurring_rule_id"]:
        assert result[field] is None
    assert snapshot(session, Task, result["id"])["created_at"] != STAMP
    assert snapshot(session, BrainDump, identity) is None
    assert snapshot(session, BrainDump, other_id) == other_before
    assert count(session, Task) == 2
    assert client.get(f"/api/v1/tasks/{result['id']}").status_code == 200


def test_archive_blocks_conversion_until_restored(brain_client):
    client, session = brain_client
    identity = make_note(session, archived=True)
    session.commit()
    before = snapshot(session, BrainDump, identity); session.commit()
    response = client.post(f"{URL}/{identity}/convert-to-task")
    assert response.status_code == 409, response.text
    assert snapshot(session, BrainDump, identity) == before
    assert count(session, Task) == 0
    assert client.patch(f"{URL}/{identity}", json={"archived": False}).status_code == 200
    assert client.post(f"{URL}/{identity}/convert-to-task").status_code == 201
    assert snapshot(session, BrainDump, identity) is None and count(session, Task) == 1


def test_conversion_retry_returns_404_and_never_creates_duplicate(brain_client):
    client, session = brain_client
    identity = make_note(session); session.commit()
    first = client.post(f"{URL}/{identity}/convert-to-task")
    assert first.status_code == 201, first.text
    before = database_state(session); session.commit()
    repeated = client.post(f"{URL}/{identity}/convert-to-task")
    assert repeated.status_code == 404, repeated.text
    assert database_state(session) == before


def test_legacy_whitespace_only_note_cannot_be_converted(brain_client):
    client, session = brain_client
    # PostgreSQL btrim(text) removes spaces, so legacy tab-only data can exist.
    identity = make_note(session, body="\t")
    session.commit()
    before = snapshot(session, BrainDump, identity); session.commit()
    response = client.post(f"{URL}/{identity}/convert-to-task")
    assert response.status_code == 409, response.text
    assert snapshot(session, BrainDump, identity) == before
    assert count(session, Task) == 0


@pytest.mark.parametrize("operation", ["edit", "archive", "restore", "delete", "convert"])
def test_note_operations_preserve_saved_review_statistics(brain_client, operation):
    client, session = brain_client
    identity = make_note(session, archived=(operation == "restore"))
    cycle = PlanningCycle(start_date=date(2026, 7, 20), end_date=date(2026, 10, 11), active=False, completed_at=STAMP)
    session.add(cycle); session.flush()
    cycle_review = CycleReview(cycle_id=cycle.id, what_learned="Saved cycle", snapshot_brain_dumps_archived=7)
    weekly_review = WeeklyReview(week_start=date(2026, 10, 12), what_learned="Saved week", snapshot_archived_brain_dump_count=7)
    session.add_all([cycle_review, weekly_review]); session.flush()
    cycle_review_id, weekly_review_id = cycle_review.id, weekly_review.id
    session.commit()
    before_cycle = snapshot(session, CycleReview, cycle_review_id)
    before_week = snapshot(session, WeeklyReview, weekly_review_id)
    if operation == "delete": response = client.delete(f"{URL}/{identity}")
    elif operation == "convert": response = client.post(f"{URL}/{identity}/convert-to-task")
    else:
        changes = {"body": "Revised"} if operation == "edit" else {"archived": operation == "archive"}
        response = client.patch(f"{URL}/{identity}", json=changes)
    assert response.status_code in {200, 201, 204}, response.text
    assert snapshot(session, CycleReview, cycle_review_id) == before_cycle
    assert snapshot(session, WeeklyReview, weekly_review_id) == before_week


def test_create_constraint_failure_leaves_database_unchanged(brain_client):
    client, session = brain_client
    before = database_state(session); session.commit()

    def blank_body(mapper, connection, target): target.body = ""

    event.listen(BrainDump, "before_insert", blank_body)
    try: response = client.post(URL, json={"body": "Valid input"})
    finally: event.remove(BrainDump, "before_insert", blank_body)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert client.post(URL, json={"body": "Valid input"}).status_code == 201


def test_archive_constraint_failure_rolls_back_text_and_state(brain_client):
    client, session = brain_client
    identity = make_note(session); session.commit()
    before = database_state(session); session.commit()

    def break_pair(mapper, connection, target): target.archived_at = None

    event.listen(BrainDump, "before_update", break_pair)
    try: response = client.patch(f"{URL}/{identity}", json={"body": "Replacement", "archived": True})
    finally: event.remove(BrainDump, "before_update", break_pair)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert client.patch(f"{URL}/{identity}", json={"archived": True}).status_code == 200


@pytest.mark.parametrize("failure", ["task_insert", "note_delete"])
def test_conversion_failure_restores_note_and_removes_partial_task(brain_client, failure):
    client, session = brain_client
    identity = make_note(session, source_brain_dump_id=SOURCE_ID)
    session.commit()
    before = database_state(session); session.commit()
    inserted = []

    def remember_task(mapper, connection, target): inserted.append(target.id)

    def fail_write(mapper, connection, target):
        if failure == "task_insert": target.priority = 3  # Real PostgreSQL CHECK failure.
        else: raise IntegrityError("simulated delete failure", {}, Exception("private test detail"))

    model, event_name = (Task, "before_insert") if failure == "task_insert" else (BrainDump, "before_delete")
    event.listen(Task, "after_insert", remember_task)
    event.listen(model, event_name, fail_write)
    try: response = client.post(f"{URL}/{identity}/convert-to-task")
    finally:
        event.remove(model, event_name, fail_write)
        event.remove(Task, "after_insert", remember_task)
    assert response.status_code == 409, response.text
    assert "private test detail" not in response.text
    if failure == "note_delete": assert inserted  # A task INSERT occurred before the failure.
    assert database_state(session) == before
    retried = client.post(f"{URL}/{identity}/convert-to-task")
    assert retried.status_code == 201, retried.text
    assert snapshot(session, BrainDump, identity) is None and count(session, Task) == 1


@pytest.mark.parametrize("operation", ["create", "patch", "delete", "convert"])
def test_commit_failure_rolls_back_operation_and_allows_retry(brain_client, monkeypatch, operation):
    client, session = brain_client
    identity = make_note(session, source_brain_dump_id=SOURCE_ID); session.commit()
    before = database_state(session); session.commit()

    def request():
        if operation == "create": return client.post(URL, json={"body": "New note"})
        if operation == "patch": return client.patch(f"{URL}/{identity}", json={"body": "Replacement", "archived": True})
        if operation == "delete": return client.delete(f"{URL}/{identity}")
        return client.post(f"{URL}/{identity}/convert-to-task")

    def fail_commit():
        session.flush()
        raise IntegrityError("simulated commit failure", {}, Exception("private test detail"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = request()
    assert response.status_code == 409 and "private test detail" not in response.text, response.text
    assert database_state(session) == before
    retried = request()
    assert retried.status_code == {"create": 201, "patch": 200, "delete": 204, "convert": 201}[operation], retried.text
