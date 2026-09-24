"""API tests for complete WeekFlow backup previews."""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def empty_database():
    """Give every preview an isolated, empty PostgreSQL view."""

    db = MagicMock(spec=Session)
    db.scalars.return_value.all.return_value = []
    app.dependency_overrides[get_db] = lambda: db

    yield db

    app.dependency_overrides.clear()


def make_empty_backup() -> dict[str, object]:
    """Return a valid version 12 backup with empty collections."""

    return {
        "format": "weekflow-backup",
        "version": 12,
        "exportedAt": "2026-09-24T16:00:00.000Z",
        "metadata": {
            "appVersion": "1.0.0",
            "dataModelVersion": 1,
        },
        "data": {
            "tasks": [],
            "goals": [],
            "goalMilestones": [],
            "brainDumps": [],
            "taskTemplates": [],
            "recurringRules": [],
            "recurringExceptions": [],
            "planningCycles": [],
            "weeklyReviews": [],
            "weeklyCommitments": [],
            "weeklyTaskDecisions": [],
            "cycleReviews": [],
            "cycleGoalOutcomes": [],
        },
    }


def test_preview_accepts_and_counts_empty_backup():
    """Return zero counts without claiming a database change."""

    response = client.post(
        "/api/v1/backups/import/preview",
        json=make_empty_backup(),
    )

    assert response.status_code == 200

    result = response.json()

    assert result["format"] == "weekflow-backup"
    assert result["version"] == 12
    assert result["app_version"] == "1.0.0"
    assert result["data_model_version"] == 1
    assert result["total_records"] == 0
    assert result["validation_passed"] is True
    assert result["database_changed"] is False
    assert result["would_create_count"] == 0
    assert result["already_imported_count"] == 0
    assert result["conflict_count"] == 0
    assert result["can_import"] is True

    assert all(
        count == 0
        for count in result["counts"].values()
    )


def test_preview_counts_every_supplied_collection():
    """Report the records that passed complete-backup validation."""

    backup = make_empty_backup()
    data = backup["data"]
    assert isinstance(data, dict)

    data["brainDumps"] = [
        {
            "id": 1_781_204_330_004,
            "body": "Finish the migration preview",
            "archived": False,
            "createdAt": "2026-09-24T16:00:00.000Z",
            "archivedAt": None,
        }
    ]

    data["planningCycles"] = [
        {
            "id": 1_781_204_330_007,
            "name": "Fall 2026",
            "primaryFocus": "Finish WeekFlow",
            "theme": "Consistency",
            "startDate": "2026-09-21",
            "endDate": "2026-12-13",
            "active": True,
            "createdAt": "2026-09-24T16:00:00.000Z",
            "completedAt": None,
        }
    ]

    response = client.post(
        "/api/v1/backups/import/preview",
        json=backup,
    )

    assert response.status_code == 200

    result = response.json()

    assert result["total_records"] == 2
    assert result["counts"]["brain_dumps"] == 1
    assert result["counts"]["planning_cycles"] == 1
    assert result["counts"]["tasks"] == 0
    assert result["would_create_count"] == 2
    assert result["would_create_counts"]["brain_dumps"] == 1
    assert result["would_create_counts"]["planning_cycles"] == 1
    assert result["already_imported_count"] == 0
    assert result["conflict_count"] == 0
    assert result["can_import"] is True
    assert result["database_changed"] is False


def test_preview_rejects_invalid_backup_relationships():
    """Return 422 when a task names a Goal missing from the backup."""

    backup = make_empty_backup()
    data = backup["data"]
    assert isinstance(data, dict)

    data["tasks"] = [
        {
            "id": 1_781_204_330_001,
            "title": "Orphaned task",
            "day": "Thursday",
            "dueDate": "2026-09-24",
            "notes": None,
            "priority": 1,
            "goalId": 1_781_204_330_002,
            "completed": False,
            "createdAt": "2026-09-24T16:00:00.000Z",
            "completedAt": None,
            "recurringRuleId": None,
            "recurrenceOccurrenceDate": None,
        }
    ]

    response = client.post(
        "/api/v1/backups/import/preview",
        json=backup,
    )

    assert response.status_code == 422


def test_preview_rejects_old_backup_version():
    """Accept only the current version 12 migration contract."""

    backup = make_empty_backup()
    backup["version"] = 11

    response = client.post(
        "/api/v1/backups/import/preview",
        json=backup,
    )

    assert response.status_code == 422


def test_preview_never_writes_to_database(empty_database):
    """Allow SELECTs while forbidding every database write."""

    response = client.post(
        "/api/v1/backups/import/preview",
        json=make_empty_backup(),
    )

    assert response.status_code == 200
    assert response.json()["database_changed"] is False
    assert empty_database.scalars.call_count == 13
    empty_database.add.assert_not_called()
    empty_database.add_all.assert_not_called()
    empty_database.delete.assert_not_called()
    empty_database.flush.assert_not_called()
    empty_database.commit.assert_not_called()
    empty_database.rollback.assert_not_called()