from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "ok"
    assert data["service"] == "WeekFlow API"

def test_api_info_endpoint():
    response = client.get("/api/v1/info")

    assert response.status_code == 200

    data = response.json()

    assert data["name"] == "WeekFlow API"
    assert data["version"] == "0.1.0"
    assert data["apiVersion"] == "v1"

def test_database_health_endpoint():
    response = client.get("/api/v1/database/health")

    assert response.status_code == 200

    data = response.json()

    assert data["status"] == "ok"
    assert data["database"] == "weekflow"

def test_database_health_returns_503_when_database_is_unavailable():
    """Return a safe response when PostgreSQL cannot be reached."""

    # Temporarily replace the real connection check with a simulated error.
    with patch(
        "app.main.check_database_connection",
        side_effect=SQLAlchemyError("Simulated database failure"),
    ):
        response = client.get("/api/v1/database/health")

    # The API remains running, but its database dependency is unavailable.
    assert response.status_code == 503

    # Clients receive a safe message without internal database details.
    assert response.json() == {
        "detail": "Database is unavailable",
    }