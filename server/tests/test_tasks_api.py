"""API tests for WeekFlow task endpoints."""

from collections.abc import Generator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import engine, get_db
from app.main import app


@pytest.fixture
def isolated_client() -> Generator[TestClient, None, None]:
    """
    Give each test a controlled database session.

    The real endpoint can call commit(), but the outer transaction lets
    the test roll all created task rows back afterward.
    """

    with engine.connect() as connection:
        # Begin an outer transaction controlled by the test.
        outer_transaction = connection.begin()

        # Endpoint commits become savepoints inside the outer transaction.
        session = Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
        )

        # Replace FastAPI's normal database session with our test session.
        def override_get_db():
            yield session

        app.dependency_overrides[get_db] = override_get_db

        try:
            with TestClient(app) as client:
                yield client
        finally:
            # Always restore FastAPI and remove test rows.
            app.dependency_overrides.clear()
            session.close()
            outer_transaction.rollback()


def test_create_and_read_task(isolated_client: TestClient):
    """Create one task and retrieve it through both GET endpoints."""

    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "  Finish physics homework  ",
            "due_date": "2026-09-10",
            "priority": 2,
        },
    )

    assert create_response.status_code == 201

    created_task = create_response.json()

    assert created_task["id"] > 0
    assert created_task["title"] == "Finish physics homework"
    assert created_task["due_date"] == "2026-09-10"
    assert created_task["day"] == "Thursday"
    assert created_task["notes"] is None
    assert created_task["priority"] == 2
    assert created_task["completed"] is False
    assert created_task["created_at"] is not None
    assert created_task["completed_at"] is None
    # Ordinary server-created tasks do not come from SQLite.
    assert created_task["source_task_id"] is None
    assert created_task["source_goal_id"] is None
    assert created_task["source_recurring_rule_id"] is None
    assert created_task["recurrence_occurrence_date"] is None

    # Retrieve the same task using its generated ID.
    task_response = isolated_client.get(
        f"/api/v1/tasks/{created_task['id']}"
    )

    assert task_response.status_code == 200
    assert task_response.json() == created_task

    # Confirm that the task also appears in the list endpoint.
    list_response = isolated_client.get("/api/v1/tasks")

    assert list_response.status_code == 200
    assert created_task in list_response.json()


def test_create_task_rejects_invalid_input(
    isolated_client: TestClient,
):
    """Return 422 before invalid task data reaches PostgreSQL."""

    response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "   ",
            "priority": 5,
        },
    )

    assert response.status_code == 422

    invalid_fields = {
        error["loc"][-1]
        for error in response.json()["detail"]
    }

    assert invalid_fields == {
        "title",
        "priority",
    }

def test_create_task_rejects_migration_metadata(
    isolated_client: TestClient,
):
    """Keep SQLite migration metadata out of the normal create endpoint."""

    response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Attempt to forge migration metadata",
            "source_task_id": 1_781_204_320_207,
            "source_goal_id": 1_782_503_210_780,
            "source_recurring_rule_id": 1_781_999_999_999,
            "recurrence_occurrence_date": "2026-09-16",
        },
    )

    assert response.status_code == 422

    invalid_fields = {
        error["loc"][-1]
        for error in response.json()["detail"]
    }

    assert invalid_fields == {
        "source_task_id",
        "source_goal_id",
        "source_recurring_rule_id",
        "recurrence_occurrence_date",
    }


def test_read_task_returns_404_when_missing(
    isolated_client: TestClient,
):
    """Return a clear response when the requested task does not exist."""

    response = isolated_client.get(
        "/api/v1/tasks/-999999999"
    )

    assert response.status_code == 404
    assert response.json() == {
        "detail": "Task not found",
    }

def test_update_task_changes_only_supplied_fields(
    isolated_client: TestClient,
):
    """Update selected fields without erasing fields that were omitted."""

    # Create a task owned by this test.
    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Original title",
            "due_date": "2026-09-10",
            "notes": "Keep these notes",
            "priority": 1,
        },
    )

    assert create_response.status_code == 201

    original_task = create_response.json()
    task_id = original_task["id"]

    # Only send title and due_date.
    #
    # Notes and priority are intentionally omitted, so PATCH should
    # preserve their existing PostgreSQL values.
    update_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "title": "  Updated title  ",
            "due_date": "2026-09-11",
        },
    )

    assert update_response.status_code == 200

    updated_task = update_response.json()

    # These values were supplied, so they should change.
    assert updated_task["title"] == "Updated title"
    assert updated_task["due_date"] == "2026-09-11"
    assert updated_task["day"] == "Friday"

    # These values were omitted, so they should remain unchanged.
    assert updated_task["notes"] == original_task["notes"]
    assert updated_task["priority"] == original_task["priority"]
    assert updated_task["completed"] is False
    assert updated_task["created_at"] == original_task["created_at"]

def test_update_task_can_clear_nullable_fields(
    isolated_client: TestClient,
):
    """Clear the due date and notes without affecting other fields."""

    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Move this task to Inbox",
            "due_date": "2026-09-10",
            "notes": "Remove these notes",
            "priority": 1,
        },
    )

    task_id = create_response.json()["id"]

    # These fields are included with null values.
    #
    # That means "clear them," which is different from omitting them.
    update_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "due_date": None,
            "notes": None,
        },
    )

    assert update_response.status_code == 200

    updated_task = update_response.json()

    assert updated_task["due_date"] is None
    assert updated_task["notes"] is None

    # A task without a due date belongs in Inbox.
    assert updated_task["day"] == "Inbox"

    # This field was omitted, so it should remain unchanged.
    assert updated_task["priority"] == 1

def test_update_task_synchronizes_completion_time(
    isolated_client: TestClient,
):
    """Set a completion time when done and clear it when reopened."""

    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Complete this task",
        },
    )

    task_id = create_response.json()["id"]

    # Mark the task complete.
    complete_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "completed": True,
        },
    )

    assert complete_response.status_code == 200

    completed_task = complete_response.json()

    assert completed_task["completed"] is True
    assert completed_task["completed_at"] is not None

    first_completion_time = completed_task["completed_at"]

    # Sending completed=true again should not create a new timestamp.
    repeat_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "completed": True,
        },
    )

    assert repeat_response.status_code == 200
    assert (
        repeat_response.json()["completed_at"]
        == first_completion_time
    )

    # Reopen the task.
    reopen_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "completed": False,
        },
    )

    assert reopen_response.status_code == 200
    assert reopen_response.json()["completed"] is False
    assert reopen_response.json()["completed_at"] is None

def test_update_task_rejects_invalid_input(
    isolated_client: TestClient,
):
    """Return 422 before invalid changes reach PostgreSQL."""

    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Valid original task",
        },
    )

    task_id = create_response.json()["id"]

    update_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            "title": "   ",
            "priority": 5,
        },
    )

    assert update_response.status_code == 422

    # Confirm that both invalid fields appear in FastAPI's explanation.
    invalid_fields = {
        error["loc"][-1]
        for error in update_response.json()["detail"]
    }

    assert invalid_fields == {
        "title",
        "priority",
    }

def test_update_task_returns_404_when_missing(
    isolated_client: TestClient,
):
    """Return a clear response when the task being updated does not exist."""

    response = isolated_client.patch(
        "/api/v1/tasks/-999999999",
        json={
            "title": "This task does not exist",
        },
    )

    assert response.status_code == 404
    assert response.json() == {
        "detail": "Task not found",
    }

def test_delete_task_removes_task(
    isolated_client: TestClient,
):
    """Delete one task and confirm PostgreSQL can no longer return it."""

    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Delete this test task",
        },
    )

    assert create_response.status_code == 201

    task_id = create_response.json()["id"]

    delete_response = isolated_client.delete(
        f"/api/v1/tasks/{task_id}"
    )

    # 204 means deletion succeeded with no response body.
    assert delete_response.status_code == 204
    assert delete_response.content == b""

    # Reading the deleted ID should now produce 404.
    read_response = isolated_client.get(
        f"/api/v1/tasks/{task_id}"
    )

    assert read_response.status_code == 404
    assert read_response.json() == {
        "detail": "Task not found",
    }

    # Deleting the already-missing task should also produce 404.
    second_delete_response = isolated_client.delete(
        f"/api/v1/tasks/{task_id}"
    )

    assert second_delete_response.status_code == 404
    assert second_delete_response.json() == {
        "detail": "Task not found",
    }

def test_create_task_rejects_unknown_fields(
    isolated_client: TestClient,
):
    """Reject a misspelled creation field at the API boundary."""

    response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Finish homework",
            # This typo should not be silently ignored.
            "priorty": 2,
        },
    )

    assert response.status_code == 422

    error = response.json()["detail"][0]

    assert error["loc"][-1] == "priorty"
    assert error["type"] == "extra_forbidden"

def test_update_task_rejects_unknown_fields(
    isolated_client: TestClient,
):
    """Reject a misspelled update without changing the saved task."""

    create_response = isolated_client.post(
        "/api/v1/tasks",
        json={
            "title": "Do not complete this task",
        },
    )

    task_id = create_response.json()["id"]

    update_response = isolated_client.patch(
        f"/api/v1/tasks/{task_id}",
        json={
            # The correct field name is completed.
            "complete": True,
        },
    )

    assert update_response.status_code == 422

    error = update_response.json()["detail"][0]

    assert error["loc"][-1] == "complete"
    assert error["type"] == "extra_forbidden"

    # Read the task again to prove the rejected request changed nothing.
    read_response = isolated_client.get(
        f"/api/v1/tasks/{task_id}"
    )

    assert read_response.status_code == 200
    assert read_response.json()["completed"] is False
    assert read_response.json()["completed_at"] is None

def make_import_api_task(
    task_id: int = 8_900_000_000_000_001,
    **changes,
) -> dict[str, object]:
    """Build one synthetic task using the SQLite backup format."""

    task: dict[str, object] = {
        "id": task_id,
        "title": "Synthetic imported task",
        "day": "Wednesday",
        "dueDate": "2026-09-16",
        "notes": "Preserve these synthetic notes",
        "priority": 1,
        "goalId": None,
        "completed": False,
        "createdAt": "2026-06-11T18:58:40.207Z",
        "completedAt": None,
        "recurringRuleId": None,
        "recurrenceOccurrenceDate": None,
    }

    task.update(changes)

    return task


def test_import_tasks_preserves_plain_and_recurring_tasks(
    isolated_client: TestClient,
):
    """Import synthetic tasks while preserving their SQLite values."""

    plain_task = make_import_api_task(
        task_id=8_900_000_000_000_001,
        title="Synthetic plain task",
    )
    recurring_task = make_import_api_task(
        task_id=8_900_000_000_000_002,
        title="Synthetic recurring task",
        day="Friday",
        dueDate="2026-09-18",
        goalId=8_900_000_000_000_102,
        completed=True,
        completedAt="2026-09-18T15:45:00.000Z",
        recurringRuleId=8_900_000_000_000_202,
        recurrenceOccurrenceDate="2026-09-18",
    )

    response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [
                plain_task,
                recurring_task,
            ]
        },
    )

    assert response.status_code == 200

    result = response.json()

    assert result["received_count"] == 2
    assert result["created_count"] == 2
    assert result["unchanged_count"] == 0

    mappings = {
        mapping["source_task_id"]: mapping
        for mapping in result["mappings"]
    }

    assert set(mappings) == {
        plain_task["id"],
        recurring_task["id"],
    }
    assert mappings[plain_task["id"]]["status"] == "created"
    assert mappings[recurring_task["id"]]["status"] == "created"

    plain_response = isolated_client.get(
        f"/api/v1/tasks/{mappings[plain_task['id']]['task_id']}"
    )
    recurring_response = isolated_client.get(
        f"/api/v1/tasks/{mappings[recurring_task['id']]['task_id']}"
    )

    assert plain_response.status_code == 200
    assert recurring_response.status_code == 200

    saved_plain_task = plain_response.json()
    saved_recurring_task = recurring_response.json()

    assert saved_plain_task["source_task_id"] == plain_task["id"]
    assert saved_plain_task["title"] == "Synthetic plain task"
    assert saved_plain_task["day"] == "Wednesday"
    assert saved_plain_task["due_date"] == "2026-09-16"
    assert saved_plain_task["notes"] == "Preserve these synthetic notes"
    assert saved_plain_task["priority"] == 1
    assert saved_plain_task["source_goal_id"] is None
    assert saved_plain_task["completed"] is False
    assert saved_plain_task["completed_at"] is None
    assert saved_plain_task["source_recurring_rule_id"] is None
    assert saved_plain_task["recurrence_occurrence_date"] is None

    assert datetime.fromisoformat(
        saved_plain_task["created_at"]
    ) == datetime(
        2026,
        6,
        11,
        18,
        58,
        40,
        207_000,
        tzinfo=UTC,
    )

    assert (
        saved_recurring_task["source_task_id"]
        == recurring_task["id"]
    )
    assert (
        saved_recurring_task["source_goal_id"]
        == recurring_task["goalId"]
    )
    assert (
        saved_recurring_task["source_recurring_rule_id"]
        == recurring_task["recurringRuleId"]
    )
    assert (
        saved_recurring_task["recurrence_occurrence_date"]
        == "2026-09-18"
    )
    assert saved_recurring_task["completed"] is True

    assert datetime.fromisoformat(
        saved_recurring_task["completed_at"]
    ) == datetime(
        2026,
        9,
        18,
        15,
        45,
        tzinfo=UTC,
    )


def test_import_tasks_accepts_identical_retry(
    isolated_client: TestClient,
):
    """Return unchanged without creating a duplicate task."""

    task = make_import_api_task(
        task_id=8_900_000_000_000_011,
    )
    request_body = {
        "tasks": [task],
    }

    first_response = isolated_client.post(
        "/api/v1/tasks/import",
        json=request_body,
    )
    second_response = isolated_client.post(
        "/api/v1/tasks/import",
        json=request_body,
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200

    first_result = first_response.json()
    second_result = second_response.json()

    assert first_result["created_count"] == 1
    assert first_result["unchanged_count"] == 0
    assert first_result["mappings"][0]["status"] == "created"

    assert second_result["created_count"] == 0
    assert second_result["unchanged_count"] == 1
    assert second_result["mappings"][0]["status"] == "unchanged"

    assert (
        second_result["mappings"][0]["task_id"]
        == first_result["mappings"][0]["task_id"]
    )

    list_response = isolated_client.get(
        "/api/v1/tasks"
    )

    matching_tasks = [
        saved_task
        for saved_task in list_response.json()
        if saved_task["source_task_id"] == task["id"]
    ]

    assert len(matching_tasks) == 1


def test_import_tasks_rolls_back_batch_when_retry_conflicts(
    isolated_client: TestClient,
):
    """Reject changed data and remove new rows from the same batch."""

    existing_task_id = 8_900_000_000_000_021
    new_task_id = 8_900_000_000_000_022

    original_task = make_import_api_task(
        task_id=existing_task_id,
        title="Keep this original title",
    )

    first_response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [original_task],
        },
    )

    assert first_response.status_code == 200

    conflicting_task = make_import_api_task(
        task_id=existing_task_id,
        title="Attempted changed title",
    )
    new_task = make_import_api_task(
        task_id=new_task_id,
        title="This task must be rolled back",
    )

    conflict_response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [
                conflicting_task,
                new_task,
            ]
        },
    )

    assert conflict_response.status_code == 409
    assert (
        conflict_response.json()["detail"]["source_task_ids"]
        == [existing_task_id]
    )

    list_response = isolated_client.get(
        "/api/v1/tasks"
    )

    matching_tasks = [
        saved_task
        for saved_task in list_response.json()
        if saved_task["source_task_id"]
        in {
            existing_task_id,
            new_task_id,
        }
    ]

    # The original remains unchanged, while the new task was rolled back.
    assert len(matching_tasks) == 1
    assert matching_tasks[0]["source_task_id"] == existing_task_id
    assert (
        matching_tasks[0]["title"]
        == "Keep this original title"
    )


def test_import_tasks_rejects_duplicate_recurring_identity(
    isolated_client: TestClient,
):
    """Prevent two source tasks from owning one recurring occurrence."""

    recurring_rule_id = 8_900_000_000_000_232

    first_task = make_import_api_task(
        task_id=8_900_000_000_000_031,
        recurringRuleId=recurring_rule_id,
        recurrenceOccurrenceDate="2026-09-16",
    )

    second_task = make_import_api_task(
        task_id=8_900_000_000_000_032,
        recurringRuleId=recurring_rule_id,
        recurrenceOccurrenceDate="2026-09-16",
    )

    first_response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [first_task],
        },
    )
    conflict_response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [second_task],
        },
    )

    assert first_response.status_code == 200
    assert conflict_response.status_code == 409
    assert (
        conflict_response.json()["detail"]["source_task_ids"]
        == [second_task["id"]]
    )

    list_response = isolated_client.get(
        "/api/v1/tasks"
    )

    matching_tasks = [
        saved_task
        for saved_task in list_response.json()
        if saved_task["source_task_id"]
        in {
            first_task["id"],
            second_task["id"],
        }
    ]

    assert len(matching_tasks) == 1
    assert (
        matching_tasks[0]["source_task_id"]
        == first_task["id"]
    )


def test_preview_reports_fresh_tasks_without_writing(
    isolated_client: TestClient,
):
    """Describe new tasks while leaving PostgreSQL unchanged."""

    before_response = isolated_client.get(
        "/api/v1/tasks"
    )

    assert before_response.status_code == 200

    tasks_before = before_response.json()

    plain_task = make_import_api_task(
        task_id=8_900_000_000_000_041,
        title="Fresh preview task",
    )
    recurring_task = make_import_api_task(
        task_id=8_900_000_000_000_042,
        title="Fresh recurring preview task",
        goalId=8_900_000_000_000_142,
        completed=True,
        completedAt="2026-09-18T15:45:00.000Z",
        recurringRuleId=8_900_000_000_000_242,
        recurrenceOccurrenceDate="2026-09-16",
    )

    preview_response = isolated_client.post(
        "/api/v1/tasks/import/preview",
        json={
            "tasks": [
                plain_task,
                recurring_task,
            ]
        },
    )

    assert preview_response.status_code == 200
    assert preview_response.json() == {
        "received_count": 2,
        "would_create_count": 2,
        "already_imported_count": 0,
        "conflict_count": 0,
        "conflict_source_task_ids": [],
        "goal_linked_count": 1,
        "recurring_count": 1,
        "completed_count": 1,
        "can_import": True,
        "database_changed": False,
    }

    after_response = isolated_client.get(
        "/api/v1/tasks"
    )

    assert after_response.status_code == 200
    assert after_response.json() == tasks_before


def test_preview_classifies_existing_conflicting_and_new_tasks(
    isolated_client: TestClient,
):
    """Classify a mixed preview without changing saved tasks."""

    unchanged_task = make_import_api_task(
        task_id=8_900_000_000_000_051,
        title="Already imported task",
    )
    stored_conflict_task = make_import_api_task(
        task_id=8_900_000_000_000_052,
        title="Original stored title",
    )

    import_response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [
                unchanged_task,
                stored_conflict_task,
            ]
        },
    )

    assert import_response.status_code == 200

    before_response = isolated_client.get(
        "/api/v1/tasks"
    )
    tasks_before = before_response.json()

    changed_retry = make_import_api_task(
        task_id=8_900_000_000_000_052,
        title="Changed retry title",
    )
    new_task = make_import_api_task(
        task_id=8_900_000_000_000_053,
        title="New preview task",
    )

    preview_response = isolated_client.post(
        "/api/v1/tasks/import/preview",
        json={
            "tasks": [
                unchanged_task,
                changed_retry,
                new_task,
            ]
        },
    )

    assert preview_response.status_code == 200
    assert preview_response.json() == {
        "received_count": 3,
        "would_create_count": 1,
        "already_imported_count": 1,
        "conflict_count": 1,
        "conflict_source_task_ids": [
            stored_conflict_task["id"],
        ],
        "goal_linked_count": 0,
        "recurring_count": 0,
        "completed_count": 0,
        "can_import": False,
        "database_changed": False,
    }

    after_response = isolated_client.get(
        "/api/v1/tasks"
    )

    assert after_response.status_code == 200
    assert after_response.json() == tasks_before


def test_preview_detects_recurring_identity_conflict_without_writing(
    isolated_client: TestClient,
):
    """Detect a recurring rule/date collision using a different source ID."""

    recurring_rule_id = 8_900_000_000_000_262

    existing_task = make_import_api_task(
        task_id=8_900_000_000_000_061,
        title="Existing recurring task",
        recurringRuleId=recurring_rule_id,
        recurrenceOccurrenceDate="2026-09-16",
    )

    import_response = isolated_client.post(
        "/api/v1/tasks/import",
        json={
            "tasks": [existing_task],
        },
    )

    assert import_response.status_code == 200

    before_response = isolated_client.get(
        "/api/v1/tasks"
    )
    tasks_before = before_response.json()

    conflicting_task = make_import_api_task(
        task_id=8_900_000_000_000_062,
        title="Conflicting recurring task",
        recurringRuleId=recurring_rule_id,
        recurrenceOccurrenceDate="2026-09-16",
    )

    preview_response = isolated_client.post(
        "/api/v1/tasks/import/preview",
        json={
            "tasks": [conflicting_task],
        },
    )

    assert preview_response.status_code == 200
    assert preview_response.json() == {
        "received_count": 1,
        "would_create_count": 0,
        "already_imported_count": 0,
        "conflict_count": 1,
        "conflict_source_task_ids": [
            conflicting_task["id"],
        ],
        "goal_linked_count": 0,
        "recurring_count": 1,
        "completed_count": 0,
        "can_import": False,
        "database_changed": False,
    }

    after_response = isolated_client.get(
        "/api/v1/tasks"
    )

    assert after_response.status_code == 200
    assert after_response.json() == tasks_before