"""API tests for WeekFlow task endpoints."""

from collections.abc import Generator

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