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