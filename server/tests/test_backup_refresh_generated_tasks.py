"""Match independently generated occurrences without replacing PostgreSQL IDs."""

from copy import deepcopy
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from app.models import Task, WeeklyCommitment
from app.schemas import WeekFlowBackupImportRequest
from app.services.backup_import import model_from_backup_item
from app.services.backup_refresh import match_generated_occurrences
from test_backup_import_schemas import TASK_ID, make_valid_backup
from test_backup_refresh_api import IMPORT_URL, REFRESH_URL, refresh_client


def matching_case():
    backup = WeekFlowBackupImportRequest.model_validate(make_valid_backup())
    item = backup.data.tasks[0]
    ids = {"tasks": {}, "goals": {item.source_goal_id: 5},
           "recurring_rules": {item.source_recurring_rule_id: 9}}
    row = model_from_backup_item("tasks", item, ids)
    row.id = 77
    row.source_task_id = None
    row.created_at = datetime(2026, 10, 29, tzinfo=UTC)
    rows_by_source = {}
    source_maps = {"tasks": {row.id: None}}
    return item, row, rows_by_source, ids, source_maps


def match(case, rows=None):
    item, row, stored, ids, sources = case
    return match_generated_occurrences([item], rows or [row], stored, ids, sources)


def test_identical_unfinished_occurrence_reuses_the_existing_postgres_task():
    case = matching_case()
    item, row, stored, ids, sources = case
    assert match(case) == {item.source_task_id}
    assert row.id == 77
    assert row.source_task_id == item.source_task_id
    assert stored[item.source_task_id] is row
    assert ids["tasks"][item.source_task_id] == 77
    assert sources["tasks"][77] == item.source_task_id


@pytest.mark.parametrize("field,value", [
    ("title", "Different server content"), ("notes", "Different notes"),
    ("priority", 0), ("due_date", date(2026, 9, 24)),
    ("day", "Inbox"), ("goal_id", 999),
])
def test_different_content_is_not_automatically_merged(field, value):
    case = matching_case()
    setattr(case[1], field, value)
    assert match(case) == set()
    assert case[1].source_task_id is None


@pytest.mark.parametrize("side", ["server", "backup"])
def test_completed_history_is_not_automatically_matched(side):
    case = matching_case()
    record = case[1] if side == "server" else case[0]
    record.completed = True
    record.completed_at = datetime(2026, 10, 29, tzinfo=UTC)
    assert match(case) == set()
    assert case[1].source_task_id is None


def test_an_existing_backup_identity_is_never_replaced():
    case = matching_case()
    case[1].source_task_id = TASK_ID + 900
    assert match(case) == set()
    assert case[1].source_task_id == TASK_ID + 900


@pytest.mark.parametrize("links", ["native-only", "source-only"])
def test_equivalent_native_or_legacy_parent_links_can_be_matched(links):
    case = matching_case()
    if links == "native-only":
        case[1].source_recurring_rule_id = None
        case[1].source_goal_id = None
    else:
        case[1].recurring_rule_id = None
        case[1].goal_id = None
    assert match(case) == {case[0].source_task_id}


def test_original_occurrence_date_is_used_after_moving_to_inbox():
    case = matching_case()
    for row in (case[0], case[1]):
        row.day = "Inbox"
        row.due_date = None
    assert match(case) == {case[0].source_task_id}
    assert case[1].recurrence_occurrence_date == date(2026, 9, 23)


def test_ambiguous_native_and_source_owners_are_not_guessed():
    case = matching_case()
    other = deepcopy(case[1])
    other.id = 88
    case[1].source_recurring_rule_id = None
    other.recurring_rule_id = None
    assert match(case, [case[1], other]) == set()
    assert case[1].source_task_id is None
    assert other.source_task_id is None


def test_existing_primary_identity_takes_priority_over_occurrence_matching():
    case = matching_case()
    case[2][case[0].source_task_id] = object()
    assert match(case) == set()
    assert case[1].source_task_id is None


def test_conflicting_source_and_native_schedule_links_are_not_matched():
    case = matching_case()
    case[1].source_recurring_rule_id += 999
    assert match(case) == set()


def postgres_case(client, session):
    backup = make_valid_backup()
    response = client.post(IMPORT_URL, json=backup)
    assert response.status_code == 200, response.text
    original = session.scalar(select(Task).where(Task.source_task_id == TASK_ID))
    extra = deepcopy(backup["data"]["tasks"][0])
    extra.update(id=TASK_ID + 100, dueDate="2026-09-24", day="Thursday",
                 recurrenceOccurrenceDate="2026-09-24")
    response = client.post("/api/v1/tasks", json={
        "title": extra["title"], "notes": extra["notes"], "priority": extra["priority"],
        "goal_id": original.goal_id, "recurring_rule_id": original.recurring_rule_id,
        "due_date": extra["dueDate"], "recurrence_occurrence_date": extra["recurrenceOccurrenceDate"],
    })
    assert response.status_code == 201, response.text
    postgres_id = response.json()["id"]
    backup["data"]["tasks"].append(extra)
    return backup, postgres_id


def task_row(session, postgres_id):
    session.expire_all()
    return session.get(Task, postgres_id)


@pytest.mark.parametrize("links", ["both", "native-only", "source-only"])
def test_postgres_generated_occurrence_is_updated_in_place_and_retry_is_unchanged(refresh_client, links):
    client, session = refresh_client
    backup, postgres_id = postgres_case(client, session)
    row = task_row(session, postgres_id)
    assert row.source_task_id is None
    if links == "native-only":
        row.source_recurring_rule_id = None
        row.source_goal_id = None
    elif links == "source-only":
        row.recurring_rule_id = None
        row.goal_id = None
    session.commit()
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["created_count"], result["updated_count"], result["already_imported_count"]) == (0, 1, 13)
    row = task_row(session, postgres_id)
    assert row.source_task_id == TASK_ID + 100
    assert row.goal_id is not None and row.recurring_rule_id is not None
    assert row.id == postgres_id
    assert len(list(session.scalars(select(Task)))) == 2
    again = client.post(REFRESH_URL, json=backup)
    assert again.status_code == 200, again.text
    assert (again.json()["created_count"], again.json()["updated_count"], again.json()["already_imported_count"]) == (0, 0, 14)


def test_postgres_existing_weekly_link_keeps_the_same_task_and_incoming_links_map_to_it(refresh_client):
    client, session = refresh_client
    backup, postgres_id = postgres_case(client, session)
    commitment = session.scalar(select(WeeklyCommitment))
    commitment.task_id = postgres_id
    session.commit()
    # The file's existing commitment is deliberately changed to the adopted
    # task's incoming identity. The resulting native FK must stay postgres_id.
    backup["data"]["weeklyCommitments"][0]["taskId"] = TASK_ID + 100
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 200, response.text
    session.expire_all()
    assert session.scalar(select(WeeklyCommitment)).task_id == postgres_id


def test_postgres_metadata_only_match_still_reports_an_update(refresh_client):
    client, session = refresh_client
    backup, postgres_id = postgres_case(client, session)
    task_row(session, postgres_id).created_at = datetime.fromisoformat(backup["data"]["tasks"][-1]["createdAt"].replace("Z", "+00:00"))
    session.commit()
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 200, response.text
    assert response.json()["updated_counts"]["tasks"] == 1
    assert response.json()["database_changed"] is True


@pytest.mark.parametrize("side", ["server", "backup"])
def test_postgres_completed_unmatched_occurrence_remains_a_conflict(refresh_client, side):
    client, session = refresh_client
    backup, postgres_id = postgres_case(client, session)
    if side == "server":
        row = task_row(session, postgres_id)
        row.completed = True
        row.completed_at = datetime(2026, 10, 29, tzinfo=UTC)
        session.commit()
    else:
        backup["data"]["tasks"][-1].update(completed=True, completedAt="2026-10-29T00:00:00Z")
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 409, response.text
    assert task_row(session, postgres_id).source_task_id is None


def test_postgres_later_conflict_rolls_back_the_matched_task_metadata(refresh_client):
    client, session = refresh_client
    backup, postgres_id = postgres_case(client, session)
    valid = deepcopy(backup)
    backup["data"]["weeklyReviews"][0]["id"] += 900
    response = client.post(REFRESH_URL, json=backup)
    assert response.status_code == 409, response.text
    assert task_row(session, postgres_id).source_task_id is None
    response = client.post(REFRESH_URL, json=valid)
    assert response.status_code == 200, response.text
    assert task_row(session, postgres_id).source_task_id == TASK_ID + 100
