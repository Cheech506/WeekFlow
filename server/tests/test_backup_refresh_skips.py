"""Skipped recurring occurrences survive a complete JSON backup refresh.

Every test owns a throwaway PostgreSQL schema inside an outer transaction.
No public tables or live WeekFlow records are read or changed.
"""

from copy import deepcopy
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema

from app.database import Base, engine
from app.models import (
    Goal, RecurringOccurrenceException, RecurringRule, Task,
    WeeklyCommitment, WeeklyTaskDecision,
)
from app.schemas import WeekFlowBackupImportRequest
from app.services.backup_export import build_backup_export
from app.services.backup_import import BackupImportConflictError, MODELS
from app.services.backup_refresh import refresh_backup
from app.services.recurrence_generation import generate_recurring_tasks
from test_backup_import_schemas import RECURRING_RULE_ID, TASK_ID, make_valid_backup


@pytest.fixture
def isolated_db():
    schema = f"wf_skip_refresh_{uuid4().hex}"
    with engine.connect() as connection:
        outer = connection.begin()
        session = None
        try:
            connection.execute(CreateSchema(schema))
            # No public fallback: raw import locks also resolve only test tables.
            connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            connection = connection.execution_options(schema_translate_map={None: schema})
            Base.metadata.create_all(connection, checkfirst=False)
            session = Session(bind=connection, join_transaction_mode="create_savepoint")
            yield session
        finally:
            if session is not None:
                session.close()
            outer.rollback()


def refresh(db, document):
    return refresh_backup(WeekFlowBackupImportRequest.model_validate(document), db)


def initial(db):
    document = make_valid_backup()
    refresh(db, document)
    return document, db.scalar(select(Task).where(Task.source_task_id == TASK_ID))


def add_skip(document):
    document["data"]["recurringExceptions"].append({
        "recurringRuleId": RECURRING_RULE_ID,
        "occurrenceDate": "2026-09-23",
        "createdAt": "2026-09-24T12:00:00.000Z",
    })


def after_deletion(document):
    document = deepcopy(document)
    document["data"]["tasks"] = []
    # Existing server history should remain with its task link cleared.
    document["data"]["weeklyCommitments"] = []
    document["data"]["weeklyTaskDecisions"] = []
    add_skip(document)
    return document


def copy_row(row, **changes):
    values = {column.key: getattr(row, column.key)
              for column in row.__table__.columns if column.key != "id"}
    return type(row)(**(values | changes))


def test_delete_export_import_removes_stale_task_and_preserves_history(isolated_db):
    db = isolated_db
    document, task = initial(db)
    task_id, rule_id = task.id, task.recurring_rule_id
    commitment = db.scalar(select(WeeklyCommitment))
    decision = db.scalar(select(WeeklyTaskDecision))
    snapshot = (commitment.id, commitment.title, decision.id, decision.task_title)

    result = refresh(db, after_deletion(document))

    assert db.get(Task, task_id) is None
    assert db.get(RecurringOccurrenceException, (rule_id, date(2026, 9, 23))) is not None
    assert commitment.task_id is None
    assert decision.task_id is None
    assert (commitment.id, commitment.title, decision.id, decision.task_title) == snapshot
    assert result.removed_recurring_tasks_count == 1
    assert result.created_count == 1  # The new skip, not a replacement task.
    assert result.database_changed is True

    # Cleanup must still produce a portable backup with valid history links.
    exported = build_backup_export({
        name: list(db.scalars(select(model))) for name, model in MODELS.items()
    })
    assert exported.data.tasks == []
    assert exported.data.weekly_commitments[0].source_task_id is None
    assert exported.data.weekly_task_decisions[0].source_task_id is None


def test_identical_retry_keeps_skip_and_reports_no_further_changes(isolated_db):
    document, _ = initial(isolated_db)
    deleted = after_deletion(document)
    refresh(isolated_db, deleted)
    result = refresh(isolated_db, deleted)
    assert result.removed_recurring_tasks_count == 0
    assert result.created_count == result.updated_count == 0
    assert result.database_changed is False
    assert result.total_records == result.already_imported_count == 11


def test_generator_does_not_recreate_the_occurrence_after_import_cleanup(isolated_db):
    db = isolated_db
    document, task = initial(db)
    rule_id = task.recurring_rule_id
    refresh(db, after_deletion(document))
    generated = generate_recurring_tasks(db=db, current_date=date(2026, 9, 23),
                                        horizon_days=1, recurring_rule_id=rule_id)
    assert generated.skipped_count == 1
    assert generated.created_count == 0
    assert db.scalar(select(Task).where(Task.recurring_rule_id == rule_id,
                                      Task.recurrence_occurrence_date == date(2026, 9, 23))) is None


def test_skipped_task_conflict_has_an_actionable_public_message():
    from app.routers.backups import refresh_conflict_message
    message = refresh_conflict_message(BackupImportConflictError({
        "skipped_recurring_tasks": [str(TASK_ID)],
    }))
    assert "No changes were saved" in message
    assert "already marked skipped" in message
    assert "backup made after deletion" in message


def test_removal_only_refresh_reports_database_changed(isolated_db):
    db = isolated_db
    document, task = initial(db)
    db.add(RecurringOccurrenceException(recurring_rule_id=task.recurring_rule_id,
                                       occurrence_date=date(2026, 9, 23)))
    db.commit()
    deleted = after_deletion(document)
    # Match the already stored skip timestamp, so deletion is the only change.
    skip = db.get(RecurringOccurrenceException, (task.recurring_rule_id, date(2026, 9, 23)))
    deleted["data"]["recurringExceptions"][-1]["createdAt"] = skip.created_at.isoformat()
    result = refresh(db, deleted)
    assert result.created_count == result.updated_count == 0
    assert result.removed_recurring_tasks_count == 1
    assert result.database_changed is True
    assert result.total_records == result.already_imported_count == 11


@pytest.mark.parametrize("links", ["native", "source-only", "native-only"])
def test_original_occurrence_controls_deletion_even_after_rescheduling(isolated_db, links):
    db = isolated_db
    document, task = initial(db)
    task_id = task.id
    task.due_date, task.day = date(2026, 10, 1), "Thursday"
    if links == "source-only":
        task.recurring_rule_id = None
    if links == "native-only":
        task.source_recurring_rule_id = None
    db.commit()
    assert refresh(db, after_deletion(document)).removed_recurring_tasks_count == 1
    assert db.get(Task, task_id) is None


def test_completed_history_and_unrelated_tasks_are_preserved(isolated_db):
    db = isolated_db
    document, task = initial(db)
    task.completed = True
    task.completed_at = datetime(2026, 9, 23, 18, tzinfo=UTC)
    completed_id = task.id
    plain = copy_row(task, source_task_id=TASK_ID + 100, title="Unrelated task",
        recurring_rule_id=None, source_recurring_rule_id=None,
        recurrence_occurrence_date=None, completed=False, completed_at=None)
    another_date = copy_row(task, source_task_id=TASK_ID + 101,
        recurrence_occurrence_date=date(2026, 9, 24), completed=False, completed_at=None)
    db.add_all([plain, another_date])
    db.commit()
    ids = (plain.id, another_date.id)
    assert refresh(db, after_deletion(document)).removed_recurring_tasks_count == 0
    assert db.get(Task, completed_id).completed is True
    assert db.get(Task, completed_id).completed_at == datetime(2026, 9, 23, 18, tzinfo=UTC)
    assert all(db.get(Task, identifier) is not None for identifier in ids)


def test_native_schedule_link_takes_precedence_over_legacy_metadata(isolated_db):
    db = isolated_db
    document, task = initial(db)
    second_rule = copy_row(db.get(RecurringRule, task.recurring_rule_id),
                          source_recurring_rule_id=RECURRING_RULE_ID + 100)
    db.add(second_rule)
    db.flush()
    task.recurring_rule_id = second_rule.id
    task_id = task.id
    db.commit()
    assert refresh(db, after_deletion(document)).removed_recurring_tasks_count == 0
    assert db.get(Task, task_id).recurring_rule_id == second_rule.id


def test_omission_without_an_explicit_skip_does_not_delete_tasks(isolated_db):
    document, task = initial(isolated_db)
    task_id = task.id
    document["data"]["tasks"] = []
    document["data"]["weeklyCommitments"] = []
    document["data"]["weeklyTaskDecisions"] = []
    assert refresh(isolated_db, document).removed_recurring_tasks_count == 0
    assert isolated_db.get(Task, task_id) is not None


def test_incoming_unfinished_task_and_skip_conflict_rolls_back_all_updates(isolated_db):
    db = isolated_db
    document, task = initial(db)
    task_id = task.id
    goal = db.scalar(select(Goal))
    original_title = goal.title
    document["data"]["goals"][0]["title"] = "Must roll back"
    add_skip(document)
    with pytest.raises(BackupImportConflictError) as caught:
        refresh(db, document)
    assert caught.value.conflict_identities == {"skipped_recurring_tasks": [str(TASK_ID)]}
    assert db.get(Task, task_id) is not None
    assert goal.title == original_title
    assert db.get(RecurringOccurrenceException, (task.recurring_rule_id, date(2026, 9, 23))) is None


def test_old_backup_cannot_revive_an_already_deleted_occurrence(isolated_db):
    db = isolated_db
    old_backup, task = initial(db)
    task_id = task.id
    refresh(db, after_deletion(old_backup))
    with pytest.raises(BackupImportConflictError):
        refresh(db, old_backup)
    assert db.get(Task, task_id) is None
    assert db.scalar(select(Task).where(Task.source_task_id == TASK_ID)) is None


def test_incoming_completed_task_can_coexist_with_a_skip(isolated_db):
    document = make_valid_backup()
    document["data"]["tasks"][0].update(completed=True, completedAt="2026-09-23T18:00:00Z")
    add_skip(document)
    result = refresh(isolated_db, document)
    assert result.removed_recurring_tasks_count == 0
    assert isolated_db.scalar(select(Task)).completed is True


def test_reconciliation_uses_final_imported_identity(isolated_db):
    db = isolated_db
    document, task = initial(db)
    task_id = task.id
    db.add(RecurringOccurrenceException(recurring_rule_id=task.recurring_rule_id,
                                       occurrence_date=date(2026, 9, 23)))
    db.commit()
    document["data"]["tasks"][0]["recurrenceOccurrenceDate"] = "2026-09-24"
    result = refresh(db, document)
    assert result.removed_recurring_tasks_count == 0
    assert db.get(Task, task_id).recurrence_occurrence_date == date(2026, 9, 24)


def test_commit_failure_restores_removed_tasks_and_history_links(isolated_db, monkeypatch):
    db = isolated_db
    document, task = initial(db)
    task_id = task.id
    rule_id = task.recurring_rule_id

    def failed_commit():
        # The delete was flushed, but has not become permanent.
        assert db.get(Task, task_id) is None
        raise RuntimeError("Simulated failure before commit")

    monkeypatch.setattr(db, "commit", failed_commit)
    with pytest.raises(RuntimeError, match="Simulated failure"):
        refresh(db, after_deletion(document))
    assert db.get(Task, task_id) is not None
    assert db.scalar(select(WeeklyCommitment)).task_id == task_id
    assert db.scalar(select(WeeklyTaskDecision)).task_id == task_id
    assert db.get(RecurringOccurrenceException, (rule_id, date(2026, 9, 23))) is None
