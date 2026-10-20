"""PostgreSQL tests for reusable templates and independent task creation.

The shared fixture isolates all tables and rolls back test-owned records.
"""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import Goal, Task, TaskTemplate
from app.services.backup_import import MODELS
from test_backup_refresh_api import refresh_client


URL = "/api/v1/task-templates"
STAMP = datetime(2001, 1, 1, 12, tzinfo=UTC)
SOURCE_TEMPLATE = 1_781_204_330_007
SOURCE_GOAL = 1_781_204_330_002


@pytest.fixture
def template_client(refresh_client):
    return refresh_client


def make_goal(session, *, source_id=None):
    goal = Goal(title="Saved goal", source_goal_id=source_id, start_date=date(2026, 10, 12), end_date=date(2027, 1, 3))
    session.add(goal); session.flush()
    return goal.id


def make_template(session, **changes):
    values = dict(title="Historical template", notes="Saved notes", priority=2, goal_id=None, created_at=STAMP, updated_at=STAMP)
    values.update(changes)
    row = TaskTemplate(**values)
    session.add(row); session.flush()
    return row.id


def create(client, **changes):
    response = client.post(URL, json={"title": "  Study  ", "notes": "  Details  ", "priority": 2, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def use(client, identity):
    response = client.post(f"{URL}/{identity}/create-task")
    assert response.status_code == 201, response.text
    return response.json()


def snapshot(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None: return None
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


def test_create_defaults_read_and_list_without_creating_task(template_client):
    client, session = template_client
    assert client.get(URL).json() == []
    response = client.post(URL, json={"title": "  Reusable task  "})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["id"] > 0 and row["source_task_template_id"] is None
    assert row["title"] == "Reusable task"
    assert row["notes"] is None and row["goal_id"] is None and row["priority"] == 0
    assert row["created_at"] == row["updated_at"]
    assert client.get(f"{URL}/{row['id']}").json() == row
    assert client.get(URL).json() == [row]
    assert count(session, Task) == 0


@pytest.mark.parametrize("priority", [0, 1, 2])
def test_create_accepts_each_priority_and_native_goal_link(template_client, priority):
    client, session = template_client
    goal_id = make_goal(session, source_id=SOURCE_GOAL); session.commit()
    goal_before = snapshot(session, Goal, goal_id)
    row = create(client, priority=priority, goal_id=goal_id)
    assert row["title"] == "Study" and row["notes"] == "Details"
    assert row["priority"] == priority and row["goal_id"] == goal_id
    assert snapshot(session, Goal, goal_id) == goal_before
    assert count(session, Task) == 0


def test_long_template_text_is_preserved(template_client):
    client, _ = template_client
    row = create(client, title="x" * 20000, notes="First line\n" + "y" * 30000)
    assert row["title"] == "x" * 20000
    assert row["notes"] == "First line\n" + "y" * 30000
    task = use(client, row["id"])
    assert task["title"] == row["title"] and task["notes"] == row["notes"]


def test_partial_edit_preserves_ids_creation_time_and_omitted_fields(template_client):
    client, session = template_client
    identity = make_template(session, source_task_template_id=SOURCE_TEMPLATE)
    session.commit()
    before = snapshot(session, TaskTemplate, identity)
    response = client.patch(f"{URL}/{identity}", json={"title": "  Revised  "})
    assert response.status_code == 200, response.text
    after = snapshot(session, TaskTemplate, identity)
    assert after["title"] == "Revised" and after["updated_at"] >= before["updated_at"]
    for field in before:
        if field not in {"title", "updated_at"}: assert after[field] == before[field]


@pytest.mark.parametrize("notes", [None, "", "   "])
def test_notes_can_be_cleared(template_client, notes):
    client, _ = template_client
    row = create(client)
    response = client.patch(f"{URL}/{row['id']}", json={"notes": notes})
    assert response.status_code == 200, response.text
    assert response.json()["notes"] is None
    assert response.json()["priority"] == row["priority"]


def test_goal_link_can_change_and_be_cleared(template_client):
    client, session = template_client
    first_goal = make_goal(session, source_id=SOURCE_GOAL)
    second_goal = make_goal(session); session.commit()
    row = create(client, goal_id=first_goal)
    for goal_id in [second_goal, None]:
        response = client.patch(f"{URL}/{row['id']}", json={"goal_id": goal_id})
        assert response.status_code == 200, response.text
        assert response.json()["goal_id"] == goal_id
        assert response.json()["created_at"] == row["created_at"]
    assert count(session, Goal) == 2


def test_empty_patch_leaves_updated_time_unchanged(template_client):
    client, session = template_client
    identity = make_template(session, source_task_template_id=SOURCE_TEMPLATE)
    session.commit()
    before = snapshot(session, TaskTemplate, identity)
    response = client.patch(f"{URL}/{identity}", json={})
    assert response.status_code == 200, response.text
    assert snapshot(session, TaskTemplate, identity) == before


def test_list_order_goal_filter_and_unknown_goal(template_client):
    client, session = template_client
    first_goal, second_goal = make_goal(session), make_goal(session)
    older = make_template(session, goal_id=first_goal)
    newer = make_template(session, goal_id=second_goal, updated_at=STAMP + timedelta(days=1))
    latest = make_template(session, updated_at=STAMP + timedelta(days=1))
    session.commit()
    for params, expected in [({}, [latest, newer, older]), ({"goal_id": first_goal}, [older]), ({"goal_id": second_goal}, [newer]), ({"goal_id": 999999}, [])]:
        response = client.get(URL, params=params)
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == expected


@pytest.mark.parametrize("imported_goal", [False, True])
def test_use_creates_plain_inbox_task_and_preserves_template(template_client, imported_goal):
    client, session = template_client
    goal_id = make_goal(session, source_id=SOURCE_GOAL if imported_goal else None)
    identity = make_template(session, goal_id=goal_id, source_task_template_id=SOURCE_TEMPLATE, title="  Study\nChapter  ", notes="  Details  ")
    session.commit()
    template_before = snapshot(session, TaskTemplate, identity)
    goal_before = snapshot(session, Goal, goal_id)
    task = use(client, identity)
    assert task["title"] == "Study\nChapter" and task["notes"] == "Details" and task["priority"] == 2
    assert task["goal_id"] == goal_id
    assert task["source_goal_id"] == (SOURCE_GOAL if imported_goal else None)
    assert task["day"] == "Inbox" and task["completed"] is False
    for field in ["due_date", "completed_at", "source_task_id", "recurring_rule_id", "source_recurring_rule_id", "recurrence_occurrence_date"]:
        assert task[field] is None
    assert snapshot(session, Task, task["id"])["created_at"] != STAMP
    assert snapshot(session, TaskTemplate, identity) == template_before
    assert snapshot(session, Goal, goal_id) == goal_before


def test_each_use_intentionally_creates_another_task(template_client):
    client, session = template_client
    row = create(client)
    before = snapshot(session, TaskTemplate, row["id"])
    first = use(client, row["id"])
    second = use(client, row["id"])
    assert first["id"] != second["id"] and count(session, Task) == 2
    assert snapshot(session, TaskTemplate, row["id"]) == before


def test_edit_and_delete_template_preserve_previously_created_tasks(template_client):
    client, session = template_client
    first_goal = make_goal(session, source_id=SOURCE_GOAL)
    second_goal = make_goal(session, source_id=SOURCE_GOAL + 1); session.commit()
    row = create(client, goal_id=first_goal)
    first = use(client, row["id"])
    first_before = snapshot(session, Task, first["id"])
    edited = client.patch(f"{URL}/{row['id']}", json={"title": "New title", "notes": "New notes", "priority": 0, "goal_id": second_goal})
    assert edited.status_code == 200, edited.text
    assert snapshot(session, Task, first["id"]) == first_before
    second = use(client, row["id"])
    assert (second["title"], second["notes"], second["priority"], second["goal_id"]) == ("New title", "New notes", 0, second_goal)
    second_before = snapshot(session, Task, second["id"])
    response = client.delete(f"{URL}/{row['id']}")
    assert response.status_code == 204 and response.content == b"", response.text
    assert snapshot(session, TaskTemplate, row["id"]) is None
    assert snapshot(session, Task, first["id"]) == first_before
    assert snapshot(session, Task, second["id"]) == second_before
    assert count(session, Goal) == 2


def test_deleting_created_task_leaves_template_unchanged(template_client):
    client, session = template_client
    row = create(client)
    task = use(client, row["id"])
    before = snapshot(session, TaskTemplate, row["id"])
    response = client.delete(f"/api/v1/tasks/{task['id']}")
    assert response.status_code == 204, response.text
    assert snapshot(session, TaskTemplate, row["id"]) == before


def test_goal_deletion_unlinks_template_and_future_task(template_client):
    client, session = template_client
    goal_id = make_goal(session, source_id=SOURCE_GOAL); session.commit()
    row = create(client, goal_id=goal_id)
    response = client.delete(f"/api/v1/goals/{goal_id}")
    assert response.status_code == 204, response.text
    assert snapshot(session, TaskTemplate, row["id"])["goal_id"] is None
    task = use(client, row["id"])
    assert task["goal_id"] is None and task["source_goal_id"] is None


def test_task_uses_current_goal_source_metadata(template_client):
    client, session = template_client
    goal_id = make_goal(session, source_id=SOURCE_GOAL); session.commit()
    row = create(client, goal_id=goal_id)
    session.get(Goal, goal_id).source_goal_id = SOURCE_GOAL + 10
    session.commit()
    task = use(client, row["id"])
    assert task["goal_id"] == goal_id and task["source_goal_id"] == SOURCE_GOAL + 10


@pytest.mark.parametrize("notes", [None, "   "])
def test_use_normalizes_legacy_empty_notes_without_rewriting_template(template_client, notes):
    client, session = template_client
    identity = make_template(session, notes=notes); session.commit()
    before = snapshot(session, TaskTemplate, identity)
    assert use(client, identity)["notes"] is None
    assert snapshot(session, TaskTemplate, identity) == before


def test_legacy_whitespace_only_title_blocks_task_creation(template_client):
    client, session = template_client
    identity = make_template(session, title="\t"); session.commit()
    before = database_state(session); session.commit()
    response = client.post(f"{URL}/{identity}/create-task")
    assert response.status_code == 409, response.text
    assert database_state(session) == before


def test_missing_goal_create_and_update_leave_database_unchanged(template_client):
    client, session = template_client
    response = client.post(URL, json={"title": "Valid", "goal_id": 999999})
    assert response.status_code == 404, response.text
    assert count(session, TaskTemplate) == 0
    row = create(client)
    before = database_state(session); session.commit()
    response = client.patch(f"{URL}/{row['id']}", json={"title": "Must not save", "goal_id": 999999})
    assert response.status_code == 404, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("changes", [
    {"title": None}, {"title": ""}, {"title": " \n\t"}, {"title": True}, {"notes": 3},
    {"priority": None}, {"priority": -1}, {"priority": 3}, {"priority": True}, {"priority": "1"}, {"priority": 1.5},
    {"goal_id": 0}, {"goal_id": True}, {"goal_id": "1"}, {"goal_id": 2_147_483_648},
    {"id": 7}, {"source_task_template_id": SOURCE_TEMPLATE}, {"created_at": "2026-10-19T00:00:00Z"},
    {"updated_at": None}, {"due_date": "2026-10-19"}, {"completed": True}, {"recurring_rule_id": 1},
])
@pytest.mark.parametrize("method", ["post", "patch"])
def test_invalid_write_rejects_bad_values_and_server_metadata(template_client, changes, method):
    client, session = template_client
    if method == "post":
        response = client.post(URL, json={"title": "Valid", **changes})
        assert count(session, TaskTemplate) == 0
    else:
        row = create(client)
        before = snapshot(session, TaskTemplate, row["id"]); session.commit()
        response = client.patch(f"{URL}/{row['id']}", json=changes)
        assert snapshot(session, TaskTemplate, row["id"]) == before
    assert response.status_code == 422, response.text


def test_missing_create_title_returns_422(template_client):
    client, session = template_client
    response = client.post(URL, json={"priority": 1})
    assert response.status_code == 422, response.text
    assert count(session, TaskTemplate) == 0


@pytest.mark.parametrize("method,suffix", [("get", ""), ("patch", ""), ("delete", ""), ("post", "/create-task")])
def test_missing_template_returns_404(template_client, method, suffix):
    client, session = template_client
    kwargs = {"json": {"title": "Revised"}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/999999{suffix}", **kwargs)
    assert response.status_code == 404, response.text
    assert count(session, Task) == 0


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648])
@pytest.mark.parametrize("method,suffix", [("get", ""), ("patch", ""), ("delete", ""), ("post", "/create-task")])
def test_invalid_template_path_id_returns_422(template_client, identity, method, suffix):
    client, _ = template_client
    kwargs = {"json": {}} if method == "patch" else {}
    response = getattr(client, method)(f"{URL}/{identity}{suffix}", **kwargs)
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("goal_id", [0, -1, 2_147_483_648, "invalid"])
def test_invalid_goal_filter_returns_422(template_client, goal_id):
    client, _ = template_client
    response = client.get(URL, params={"goal_id": goal_id})
    assert response.status_code == 422, response.text


def test_template_insert_constraint_failure_saves_nothing(template_client):
    client, session = template_client
    before = database_state(session); session.commit()

    def bad_priority(mapper, connection, target): target.priority = 3

    event.listen(TaskTemplate, "before_insert", bad_priority)
    try: response = client.post(URL, json={"title": "Valid"})
    finally: event.remove(TaskTemplate, "before_insert", bad_priority)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert client.post(URL, json={"title": "Valid"}).status_code == 201


@pytest.mark.parametrize("field,value", [("title", ""), ("priority", 3), ("goal_id", 999999)])
def test_template_update_constraint_failure_rolls_back_all_changes(template_client, field, value):
    client, session = template_client
    row = create(client)
    before = database_state(session); session.commit()

    def reject_update(mapper, connection, target): setattr(target, field, value)

    event.listen(TaskTemplate, "before_update", reject_update)
    try: response = client.patch(f"{URL}/{row['id']}", json={"title": "Revised", "notes": "Replacement"})
    finally: event.remove(TaskTemplate, "before_update", reject_update)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert client.patch(f"{URL}/{row['id']}", json={"title": "Revised"}).status_code == 200


def test_task_insert_failure_preserves_template_and_creates_no_task(template_client):
    client, session = template_client
    row = create(client)
    before = database_state(session); session.commit()

    def bad_priority(mapper, connection, target): target.priority = 3

    event.listen(Task, "before_insert", bad_priority)
    try: response = client.post(f"{URL}/{row['id']}/create-task")
    finally: event.remove(Task, "before_insert", bad_priority)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert client.post(f"{URL}/{row['id']}/create-task").status_code == 201
    assert count(session, Task) == 1


@pytest.mark.parametrize("operation", ["create", "patch", "delete", "use"])
def test_commit_failure_rolls_back_operation_and_allows_retry(template_client, monkeypatch, operation):
    client, session = template_client
    identity = make_template(session, source_task_template_id=SOURCE_TEMPLATE); session.commit()
    before = database_state(session); session.commit()

    def request():
        if operation == "create": return client.post(URL, json={"title": "New template"})
        if operation == "patch": return client.patch(f"{URL}/{identity}", json={"title": "Revised", "priority": 0})
        if operation == "delete": return client.delete(f"{URL}/{identity}")
        return client.post(f"{URL}/{identity}/create-task")

    def fail_commit():
        session.flush()
        raise IntegrityError("simulated commit failure", {}, Exception("private test detail"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = request()
    assert response.status_code == 409 and "private test detail" not in response.text, response.text
    assert database_state(session) == before
    retried = request()
    assert retried.status_code == {"create": 201, "patch": 200, "delete": 204, "use": 201}[operation], retried.text
