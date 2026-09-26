"""API tests for transactional complete-backup imports."""

from collections.abc import Generator
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import engine, get_db
from app.main import app
from app.models import (
    BrainDump,
    CycleGoalOutcome,
    CycleReview,
    Goal,
    GoalMilestone,
    PlanningCycle,
    RecurringOccurrenceException,
    RecurringRule,
    Task,
    TaskTemplate,
    WeeklyCommitment,
    WeeklyReview,
    WeeklyTaskDecision,
)
from test_backup_import_schemas import (
    BRAIN_DUMP_ID,
    COMMITMENT_ID,
    CYCLE_ID,
    CYCLE_OUTCOME_ID,
    CYCLE_REVIEW_ID,
    DECISION_ID,
    GOAL_ID,
    MILESTONE_ID,
    RECURRING_RULE_ID,
    TASK_ID,
    TEMPLATE_ID,
    WEEKLY_REVIEW_ID,
    make_valid_backup,
)


@pytest.fixture
def isolated_backup_import() -> Generator[
    tuple[TestClient, Session],
    None,
    None,
]:
    """Run endpoint commits inside a transaction rolled back by the test."""

    with engine.connect() as connection:
        outer_transaction = connection.begin()
        session = Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
        )

        def override_get_db():
            yield session

        app.dependency_overrides[get_db] = override_get_db

        try:
            with TestClient(app) as client:
                yield client, session
        finally:
            app.dependency_overrides.clear()
            session.close()
            outer_transaction.rollback()


def test_complete_backup_import_creates_all_relationships(
    isolated_backup_import: tuple[TestClient, Session],
):
    """Create all 13 record types with PostgreSQL foreign keys intact."""

    client, session = isolated_backup_import
    response = client.post(
        "/api/v1/backups/import",
        json=make_valid_backup(),
    )

    assert response.status_code == 200
    result = response.json()

    assert result["total_records"] == 13
    assert result["created_count"] == 13
    assert result["already_imported_count"] == 0
    assert result["database_changed"] is True
    assert all(
        count == 1
        for count in result["created_counts"].values()
    )

    cycle = session.scalar(
        select(PlanningCycle).where(
            PlanningCycle.source_planning_cycle_id == CYCLE_ID
        )
    )
    goal = session.scalar(
        select(Goal).where(
            Goal.source_goal_id == GOAL_ID
        )
    )
    milestone = session.scalar(
        select(GoalMilestone).where(
            GoalMilestone.source_goal_milestone_id
            == MILESTONE_ID
        )
    )
    rule = session.scalar(
        select(RecurringRule).where(
            RecurringRule.source_recurring_rule_id
            == RECURRING_RULE_ID
        )
    )
    task = session.scalar(
        select(Task).where(
            Task.source_task_id == TASK_ID
        )
    )
    template = session.scalar(
        select(TaskTemplate).where(
            TaskTemplate.source_task_template_id
            == TEMPLATE_ID
        )
    )
    weekly_review = session.scalar(
        select(WeeklyReview).where(
            WeeklyReview.source_weekly_review_id
            == WEEKLY_REVIEW_ID
        )
    )
    commitment = session.scalar(
        select(WeeklyCommitment).where(
            WeeklyCommitment.source_weekly_commitment_id
            == COMMITMENT_ID
        )
    )
    decision = session.scalar(
        select(WeeklyTaskDecision).where(
            WeeklyTaskDecision.source_weekly_task_decision_id
            == DECISION_ID
        )
    )
    cycle_review = session.scalar(
        select(CycleReview).where(
            CycleReview.source_cycle_review_id
            == CYCLE_REVIEW_ID
        )
    )
    outcome = session.scalar(
        select(CycleGoalOutcome).where(
            CycleGoalOutcome.source_cycle_goal_outcome_id
            == CYCLE_OUTCOME_ID
        )
    )

    assert cycle is not None
    assert goal is not None
    assert milestone is not None
    assert rule is not None
    assert task is not None
    assert template is not None
    assert weekly_review is not None
    assert commitment is not None
    assert decision is not None
    assert cycle_review is not None
    assert outcome is not None

    exception = session.scalar(
        select(RecurringOccurrenceException).where(
            RecurringOccurrenceException.recurring_rule_id
            == rule.id
        )
    )
    assert exception is not None

    assert goal.cycle_id == cycle.id
    assert milestone.goal_id == goal.id
    assert template.goal_id == goal.id
    assert rule.goal_id == goal.id
    assert task.source_goal_id == GOAL_ID
    assert task.source_recurring_rule_id == RECURRING_RULE_ID
    assert weekly_review.cycle_id == cycle.id
    assert commitment.cycle_id == cycle.id
    assert commitment.task_id == task.id
    assert decision.task_id == task.id
    assert decision.source_recurring_rule_id == RECURRING_RULE_ID
    assert cycle_review.cycle_id == cycle.id
    assert outcome.cycle_review_id == cycle_review.id
    assert outcome.goal_id == goal.id


def test_complete_backup_import_is_idempotent(
    isolated_backup_import: tuple[TestClient, Session],
):
    """Treat an identical retry as already imported."""

    client, _ = isolated_backup_import
    backup = make_valid_backup()

    first_response = client.post(
        "/api/v1/backups/import",
        json=backup,
    )
    retry_response = client.post(
        "/api/v1/backups/import",
        json=backup,
    )

    assert first_response.status_code == 200
    assert retry_response.status_code == 200

    result = retry_response.json()

    assert result["total_records"] == 13
    assert result["created_count"] == 0
    assert result["already_imported_count"] == 13
    assert result["database_changed"] is False
    assert all(
        count == 1
        for count in result["already_imported_counts"].values()
    )


def test_complete_backup_conflict_creates_nothing(
    isolated_backup_import: tuple[TestClient, Session],
):
    """Return 409 before writing any nonconflicting records."""

    client, session = isolated_backup_import
    backup = make_valid_backup()

    first_response = client.post(
        "/api/v1/backups/import",
        json=backup,
    )
    assert first_response.status_code == 200

    changed_backup = deepcopy(backup)
    data = changed_backup["data"]
    assert isinstance(data, dict)

    brain_dumps = data["brainDumps"]
    assert isinstance(brain_dumps, list)

    existing = brain_dumps[0]
    assert isinstance(existing, dict)
    existing["body"] = "Conflicting changed text"

    new_source_id = BRAIN_DUMP_ID + 500
    new_brain_dump = deepcopy(existing)
    new_brain_dump["id"] = new_source_id
    new_brain_dump["body"] = "This must not be imported"
    brain_dumps.append(new_brain_dump)

    conflict_response = client.post(
        "/api/v1/backups/import",
        json=changed_backup,
    )

    assert conflict_response.status_code == 409
    assert conflict_response.json()["detail"]["conflicts"] == {
        "brain_dumps": [str(BRAIN_DUMP_ID)],
    }

    unexpected_row = session.scalar(
        select(BrainDump).where(
            BrainDump.source_brain_dump_id
            == new_source_id
        )
    )
    assert unexpected_row is None