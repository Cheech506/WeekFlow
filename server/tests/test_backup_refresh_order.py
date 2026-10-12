"""Regression tests for recurring occurrence changes during backup refresh."""

from copy import deepcopy
from datetime import date

import pytest
from sqlalchemy import select

from app.models import Task
from test_backup_import_schemas import TASK_ID, make_valid_backup
from test_backup_refresh_api import (
    IMPORT_URL,
    REFRESH_URL,
    assert_counts,
    identities,
    imported_task,
    refresh_client,
)


@pytest.mark.parametrize("change", ["move", "unlink", "swap"])
def test_refresh_releases_old_occurrence_keys_before_reusing_them(
    refresh_client, change,
):
    client, session = refresh_client
    backup = make_valid_backup()
    if change == "swap":
        second = deepcopy(backup["data"]["tasks"][0])
        second.update(
            id=TASK_ID + 100,
            dueDate="2026-09-24",
            day="Thursday",
            recurrenceOccurrenceDate="2026-09-24",
        )
        backup["data"]["tasks"].append(second)
    first = client.post(IMPORT_URL, json=backup)
    assert first.status_code == 200, first.text
    original_ids = {
        row.source_task_id: row.id
        for row in session.scalars(select(Task))
    }
    task = backup["data"]["tasks"][0]
    if change == "unlink":
        task.update(recurringRuleId=None, recurrenceOccurrenceDate=None)
    else:
        task.update(
            dueDate="2026-09-24",
            day="Thursday",
            recurrenceOccurrenceDate="2026-09-24",
        )
    if change == "swap":
        second = backup["data"]["tasks"][1]
    else:
        second = deepcopy(make_valid_backup()["data"]["tasks"][0])
        second["id"] = TASK_ID + 100
    second.update(
        dueDate="2026-09-23",
        day="Wednesday",
        recurrenceOccurrenceDate="2026-09-23",
    )
    # A newest-first SQLite export can put the replacement before the owner.
    backup["data"]["tasks"] = [second, task]
    assert_counts(
        client.post(REFRESH_URL, json=backup),
        created=0 if change == "swap" else 1,
        updated=2 if change == "swap" else 1,
        unchanged=12,
    )
    session.expire_all()
    for source_id, postgres_id in original_ids.items():
        row = session.scalars(
            select(Task).where(Task.source_task_id == source_id)
        ).one()
        assert row.id == postgres_id
    first_task = imported_task(session)
    assert first_task.completed is False
    assert first_task.completed_at is None
    assert first_task.goal_id is not None
    if change == "unlink":
        assert first_task.source_recurring_rule_id is None
        assert first_task.recurring_rule_id is None
        assert first_task.recurrence_occurrence_date is None
    else:
        assert first_task.recurrence_occurrence_date == date(2026, 9, 24)
    second_task = session.scalars(
        select(Task).where(Task.source_task_id == TASK_ID + 100)
    ).one()
    assert second_task.recurrence_occurrence_date == date(2026, 9, 23)
    before_retry = identities(session)
    assert_counts(client.post(REFRESH_URL, json=backup), unchanged=14)
    assert identities(session) == before_retry


def test_failed_refresh_restores_temporarily_released_occurrence_keys(
    refresh_client,
):
    client, session = refresh_client
    backup = make_valid_backup()
    response = client.post(IMPORT_URL, json=backup)
    assert response.status_code == 200, response.text
    task = imported_task(session)
    original_identity = (
        task.id,
        task.source_task_id,
        task.source_recurring_rule_id,
        task.recurring_rule_id,
        task.recurrence_occurrence_date,
    )
    # This PostgreSQL-only occurrence is retained, so a duplicate must fail.
    response = client.post(
        "/api/v1/tasks",
        json={
            "title": "Retained PostgreSQL occurrence",
            "recurring_rule_id": task.recurring_rule_id,
            "recurrence_occurrence_date": "2026-09-24",
        },
    )
    assert response.status_code == 201, response.text
    before = identities(session)
    moved = backup["data"]["tasks"][0]
    moved.update(
        dueDate="2026-09-25",
        day="Friday",
        recurrenceOccurrenceDate="2026-09-25",
    )
    collision = deepcopy(moved)
    collision.update(
        id=TASK_ID + 100,
        dueDate="2026-09-24",
        day="Thursday",
        recurrenceOccurrenceDate="2026-09-24",
    )
    backup["data"]["tasks"].insert(0, collision)
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 409, response.text
    task = imported_task(session)
    assert (
        task.id,
        task.source_task_id,
        task.source_recurring_rule_id,
        task.recurring_rule_id,
        task.recurrence_occurrence_date,
    ) == original_identity
    assert identities(session) == before
