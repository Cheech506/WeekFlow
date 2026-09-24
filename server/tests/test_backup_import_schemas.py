"""Tests for validation of complete WeekFlow backups."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.schemas import WeekFlowBackupImportRequest


TASK_ID = 1_781_204_330_001
GOAL_ID = 1_781_204_330_002
MILESTONE_ID = 1_781_204_330_003
BRAIN_DUMP_ID = 1_781_204_330_004
TEMPLATE_ID = 1_781_204_330_005
RECURRING_RULE_ID = 1_781_204_330_006
CYCLE_ID = 1_781_204_330_007
WEEKLY_REVIEW_ID = 1_781_204_330_008
COMMITMENT_ID = 1_781_204_330_009
DECISION_ID = 1_781_204_330_010
CYCLE_REVIEW_ID = 1_781_204_330_011
CYCLE_OUTCOME_ID = 1_781_204_330_012


def make_valid_backup() -> dict[str, object]:
    """Return one small but fully connected version 12 backup."""

    timestamp = "2026-09-23T16:00:00.000Z"

    return {
        "format": "weekflow-backup",
        "version": 12,
        "exportedAt": timestamp,
        "metadata": {
            "appVersion": "1.0.0",
            "dataModelVersion": 1,
        },
        "data": {
            "tasks": [
                {
                    "id": TASK_ID,
                    "title": "Review migration plan",
                    "day": "Wednesday",
                    "dueDate": "2026-09-23",
                    "notes": None,
                    "priority": 2,
                    "goalId": GOAL_ID,
                    "completed": False,
                    "createdAt": timestamp,
                    "completedAt": None,
                    "recurringRuleId": RECURRING_RULE_ID,
                    "recurrenceOccurrenceDate": "2026-09-23",
                }
            ],
            "goals": [
                {
                    "id": GOAL_ID,
                    "cycleId": CYCLE_ID,
                    "title": "Finish WeekFlow migration",
                    "completed": False,
                    "createdAt": timestamp,
                    "completedAt": None,
                    "startDate": "2026-09-21T00:00:00.000Z",
                    "endDate": "2026-12-13T00:00:00.000Z",
                    "reward": "Take a weekend trip",
                    "purpose": "Own the complete data stack",
                    "successDefinition": "WeekFlow runs on PostgreSQL",
                    "notes": None,
                    "completionWhatHelped": None,
                    "completionHardestPart": None,
                    "completionLearned": None,
                    "completionDoDifferently": None,
                    "completionTaskTotal": None,
                    "completionTaskCompleted": None,
                    "completionMilestoneTotal": None,
                    "completionMilestoneCompleted": None,
                    "completionHighPriorityCompleted": None,
                }
            ],
            "goalMilestones": [
                {
                    "id": MILESTONE_ID,
                    "goalId": GOAL_ID,
                    "title": "Validate the backup",
                    "notes": None,
                    "targetDate": "2026-09-30",
                    "completed": False,
                    "createdAt": timestamp,
                    "completedAt": None,
                }
            ],
            "brainDumps": [
                {
                    "id": BRAIN_DUMP_ID,
                    "body": "Add a migration progress screen",
                    "archived": False,
                    "createdAt": timestamp,
                    "archivedAt": None,
                }
            ],
            "taskTemplates": [
                {
                    "id": TEMPLATE_ID,
                    "title": "Weekly migration check",
                    "notes": "Run the focused tests",
                    "priority": 1,
                    "goalId": GOAL_ID,
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                }
            ],
            "recurringRules": [
                {
                    "id": RECURRING_RULE_ID,
                    "title": "Review migration plan",
                    "notes": None,
                    "priority": 2,
                    "goalId": GOAL_ID,
                    "frequency": "certainDays",
                    "startDate": "2026-09-21",
                    "endDate": "2026-12-13",
                    "weekdays": [3],
                    "active": True,
                    "createdAt": timestamp,
                }
            ],
            "recurringExceptions": [
                {
                    "recurringRuleId": RECURRING_RULE_ID,
                    "occurrenceDate": "2026-09-30",
                    "createdAt": timestamp,
                }
            ],
            "planningCycles": [
                {
                    "id": CYCLE_ID,
                    "name": "Fall 2026",
                    "primaryFocus": "Finish WeekFlow",
                    "theme": "Consistency",
                    "startDate": "2026-09-21",
                    "endDate": "2026-12-13",
                    "active": False,
                    "createdAt": timestamp,
                    "completedAt": "2026-12-14T16:00:00.000Z",
                }
            ],
            "weeklyReviews": [
                {
                    "id": WEEKLY_REVIEW_ID,
                    "weekStart": "2026-09-21",
                    "cycleId": CYCLE_ID,
                    "whatWentWell": "The schemas stayed focused.",
                    "whatCausedProblems": None,
                    "whatLearned": "Validate before writing.",
                    "whatChangeNextWeek": None,
                    "nextWeekFocus": "Build the preview.",
                    "completedCount": 1,
                    "unfinishedCount": 1,
                    "overdueCount": 1,
                    "completionRate": 50,
                    "goalsProgressedCount": 1,
                    "bestDay": "Wednesday",
                    "bestDayCount": 1,
                    "archivedBrainDumpCount": 0,
                    "highPriorityCompletedCount": 1,
                    "recurringCompletedCount": 1,
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                    "reviewedAt": timestamp,
                }
            ],
            "weeklyCommitments": [
                {
                    "id": COMMITMENT_ID,
                    "weekStart": "2026-09-21",
                    "cycleId": CYCLE_ID,
                    "taskId": TASK_ID,
                    "title": "Review migration plan",
                    "completed": False,
                    "createdAt": timestamp,
                    "completedAt": None,
                }
            ],
            "weeklyTaskDecisions": [
                {
                    "id": DECISION_ID,
                    "weekStart": "2026-09-21",
                    "taskId": TASK_ID,
                    "taskTitle": "Review migration plan",
                    "originalDueDate": "2026-09-23",
                    "action": "keep",
                    "resolvedDueDate": None,
                    "recurringRuleId": RECURRING_RULE_ID,
                    "recurrenceOccurrenceDate": "2026-09-23",
                    "decidedAt": timestamp,
                }
            ],
            "cycleReviews": [
                {
                    "id": CYCLE_REVIEW_ID,
                    "cycleId": CYCLE_ID,
                    "biggestAccomplishment": "Built migration safeguards.",
                    "biggestChallenge": None,
                    "whatWorkedWell": "Small verified changes.",
                    "whatChangeNextCycle": None,
                    "whatStopDoing": None,
                    "whatContinueDoing": "Keep testing relationships.",
                    "whatLearned": "Source IDs are migration metadata.",
                    "goalTotal": 1,
                    "goalCompleted": 0,
                    "taskCompleted": 1,
                    "milestoneTotal": 1,
                    "milestoneCompleted": 0,
                    "weeklyReviewsCompleted": 1,
                    "longestStreak": 1,
                    "bestWeekNumber": 1,
                    "bestWeekCount": 1,
                    "bestDay": "Wednesday",
                    "bestDayCount": 1,
                    "highPriorityCompleted": 1,
                    "recurringCompleted": 1,
                    "rewardsUnlocked": 0,
                    "brainDumpsArchived": 0,
                    "nextCycleName": None,
                    "nextCyclePrimaryFocus": None,
                    "nextCycleTheme": None,
                    "nextCycleStartDate": None,
                    "nextCycleFirstWeekCommitments": [],
                    "nextCycleId": None,
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                    "finalizedAt": None,
                }
            ],
            "cycleGoalOutcomes": [
                {
                    "id": CYCLE_OUTCOME_ID,
                    "cycleReviewId": CYCLE_REVIEW_ID,
                    "goalId": GOAL_ID,
                    "goalTitle": "Finish WeekFlow migration",
                    "action": "archive",
                    "replacementTitle": None,
                    "destinationGoalId": None,
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                }
            ],
        },
    }


def test_complete_backup_accepts_all_thirteen_collections():
    """Parse one complete, related version 12 backup."""

    parsed = WeekFlowBackupImportRequest.model_validate(
        make_valid_backup()
    )

    assert parsed.format == "weekflow-backup"
    assert parsed.version == 12
    assert parsed.metadata.app_version == "1.0.0"
    assert parsed.data.tasks[0].source_task_id == TASK_ID
    assert parsed.data.goals[0].source_goal_id == GOAL_ID
    assert (
        parsed.data.task_templates[0].source_goal_id
        == GOAL_ID
    )
    assert len(parsed.data.model_fields_set) == 13


@pytest.mark.parametrize(
    "field",
    [
        "tasks",
        "goals",
        "goalMilestones",
        "brainDumps",
        "taskTemplates",
        "recurringRules",
        "recurringExceptions",
        "planningCycles",
        "weeklyReviews",
        "weeklyCommitments",
        "weeklyTaskDecisions",
        "cycleReviews",
        "cycleGoalOutcomes",
    ],
)
def test_complete_backup_requires_every_collection(field: str):
    """Do not silently skip a missing backup section."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    del data[field]

    with pytest.raises(ValidationError):
        WeekFlowBackupImportRequest.model_validate(backup)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("format",), "another-format"),
        (("version",), 11),
        (("metadata", "dataModelVersion"), 2),
        (("metadata", "appVersion"), "   "),
    ],
)
def test_complete_backup_rejects_wrong_identity(
    path: tuple[str, ...],
    value: object,
):
    """Accept only the current WeekFlow backup contract."""

    backup = make_valid_backup()
    target = backup

    for key in path[:-1]:
        next_target = target[key]
        assert isinstance(next_target, dict)
        target = next_target

    target[path[-1]] = value

    with pytest.raises(ValidationError):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_unknown_fields():
    """Reject fields the server does not understand."""

    backup = make_valid_backup()
    backup["unexpected"] = True

    with pytest.raises(ValidationError):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_duplicate_source_ids():
    """Reject two records claiming one SQLite identity."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    tasks = data["tasks"]
    assert isinstance(tasks, list)
    tasks.append(deepcopy(tasks[0]))

    with pytest.raises(ValidationError, match="duplicate task"):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_duplicate_recurring_occurrences():
    """Allow one generated task for each recurring rule and date."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    tasks = data["tasks"]
    assert isinstance(tasks, list)

    duplicate_occurrence = deepcopy(tasks[0])
    duplicate_occurrence["id"] = TASK_ID + 100
    tasks.append(duplicate_occurrence)

    with pytest.raises(
        ValidationError,
        match="duplicate recurring task occurrence",
    ):
        WeekFlowBackupImportRequest.model_validate(backup)


@pytest.mark.parametrize(
    ("collection", "field", "missing_id"),
    [
        ("tasks", "goalId", GOAL_ID + 100),
        ("taskTemplates", "goalId", GOAL_ID + 101),
        ("recurringRules", "goalId", GOAL_ID + 102),
        ("goalMilestones", "goalId", GOAL_ID + 103),
    ],
)
def test_complete_backup_rejects_missing_goal_relationships(
    collection: str,
    field: str,
    missing_id: int,
):
    """Require every Goal relationship to resolve inside the backup."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    rows = data[collection]
    assert isinstance(rows, list)
    row = rows[0]
    assert isinstance(row, dict)
    row[field] = missing_id

    with pytest.raises(ValidationError, match="missing goal"):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_missing_recurring_rule():
    """Require recurring tasks to include their schedule."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    tasks = data["tasks"]
    assert isinstance(tasks, list)
    task = tasks[0]
    assert isinstance(task, dict)
    task["recurringRuleId"] = RECURRING_RULE_ID + 100

    with pytest.raises(
        ValidationError,
        match="missing recurring schedule",
    ):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_missing_planning_cycle():
    """Require a Goal's planning cycle to exist in the backup."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    goals = data["goals"]
    assert isinstance(goals, list)
    goal = goals[0]
    assert isinstance(goal, dict)
    goal["cycleId"] = CYCLE_ID + 100

    with pytest.raises(
        ValidationError,
        match="missing planning cycle",
    ):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_missing_task_history_link():
    """Require linked commitments to include their task."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    commitments = data["weeklyCommitments"]
    assert isinstance(commitments, list)
    commitment = commitments[0]
    assert isinstance(commitment, dict)
    commitment["taskId"] = TASK_ID + 100

    with pytest.raises(ValidationError, match="missing task"):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_inconsistent_weekly_analytics():
    """Reject a saved weekly rate that disagrees with its counts."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    reviews = data["weeklyReviews"]
    assert isinstance(reviews, list)
    review = reviews[0]
    assert isinstance(review, dict)
    review["completionRate"] = 51

    with pytest.raises(ValidationError, match="completionRate"):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_matches_javascript_rounding():
    """Use JavaScript Math.round behavior for weekly rates."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    reviews = data["weeklyReviews"]
    assert isinstance(reviews, list)
    review = reviews[0]
    assert isinstance(review, dict)
    review["completedCount"] = 1
    review["unfinishedCount"] = 7
    review["overdueCount"] = 1
    review["completionRate"] = 13
    review["goalsProgressedCount"] = 1
    review["bestDayCount"] = 1
    review["highPriorityCompletedCount"] = 1
    review["recurringCompletedCount"] = 1

    parsed = WeekFlowBackupImportRequest.model_validate(backup)

    assert (
        parsed.data.weekly_reviews[0].snapshot_completion_rate
        == 13
    )


def test_complete_backup_rejects_multiple_active_cycles():
    """Allow at most one current planning cycle."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    cycles = data["planningCycles"]
    assert isinstance(cycles, list)
    first_cycle = cycles[0]
    assert isinstance(first_cycle, dict)
    first_cycle["active"] = True
    first_cycle["completedAt"] = None

    second_cycle = deepcopy(first_cycle)
    second_cycle["id"] = CYCLE_ID + 100
    second_cycle["startDate"] = "2026-12-14"
    second_cycle["endDate"] = "2027-03-07"
    cycles.append(second_cycle)

    with pytest.raises(
        ValidationError,
        match="more than one active",
    ):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_duplicate_first_commitments():
    """Reject equivalent first-week commitments in one cycle review."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    reviews = data["cycleReviews"]
    assert isinstance(reviews, list)
    review = reviews[0]
    assert isinstance(review, dict)
    review["nextCycleFirstWeekCommitments"] = [
        "Plan Monday",
        "  plan monday  ",
    ]

    with pytest.raises(ValidationError, match="duplicates"):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_rejects_blank_replacement_title():
    """Stop a replace outcome that PostgreSQL cannot store."""

    backup = make_valid_backup()
    data = backup["data"]
    assert isinstance(data, dict)
    outcomes = data["cycleGoalOutcomes"]
    assert isinstance(outcomes, list)
    outcome = outcomes[0]
    assert isinstance(outcome, dict)
    outcome["action"] = "replace"
    outcome["replacementTitle"] = "   "

    with pytest.raises(ValidationError, match="blank"):
        WeekFlowBackupImportRequest.model_validate(backup)


def test_complete_backup_validation_does_not_change_input():
    """Validation must remain read-only."""

    backup = make_valid_backup()
    original = deepcopy(backup)

    WeekFlowBackupImportRequest.model_validate(backup)

    assert backup == original


def replace_backup_value(
    backup: dict[str, object],
    path: tuple[str | int, ...],
    value: object,
) -> None:
    """Replace one nested backup value for a validation test."""

    target: object = backup

    for part in path[:-1]:
        if isinstance(part, int):
            assert isinstance(target, list)
            target = target[part]
        else:
            assert isinstance(target, dict)
            target = target[part]

    final_part = path[-1]

    if isinstance(final_part, int):
        assert isinstance(target, list)
        target[final_part] = value
    else:
        assert isinstance(target, dict)
        target[final_part] = value


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("version",), 12.0),
        (("metadata", "dataModelVersion"), True),
        (("data", "tasks", 0, "id"), str(TASK_ID)),
        (("data", "tasks", 0, "priority"), "2"),
        (("data", "brainDumps", 0, "archived"), 0),
        (("data", "recurringRules", 0, "active"), "true"),
        (("data", "recurringRules", 0, "weekdays", 0), 3.0),
        (("data", "weeklyReviews", 0, "completedCount"), "1"),
        (("data", "weeklyReviews", 0, "completionRate"), 50.0),
        (("data", "cycleReviews", 0, "bestWeekNumber"), True),
    ],
)
def test_complete_backup_rejects_coerced_primitive_types(
    path: tuple[str | int, ...],
    value: object,
):
    """Reject strings, floats, and booleans posing as another type."""

    backup = make_valid_backup()
    replace_backup_value(backup, path, value)

    with pytest.raises(ValidationError):
        WeekFlowBackupImportRequest.model_validate(backup)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (
            ("data", "tasks", 0, "dueDate"),
            "2026-09-23T00:00:00Z",
        ),
        (
            ("data", "recurringRules", 0, "startDate"),
            1_790_035_200,
        ),
        (
            ("data", "weeklyReviews", 0, "weekStart"),
            "09/21/2026",
        ),
    ],
)
def test_complete_backup_requires_exact_date_keys(
    path: tuple[str | int, ...],
    value: object,
):
    """Accept calendar dates only in the backup's YYYY-MM-DD form."""

    backup = make_valid_backup()
    replace_backup_value(backup, path, value)

    with pytest.raises(ValidationError):
        WeekFlowBackupImportRequest.model_validate(backup)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("exportedAt",), "2026-09-23"),
        (
            ("data", "tasks", 0, "createdAt"),
            "2026-09-23T16:00:00",
        ),
        (
            ("data", "brainDumps", 0, "createdAt"),
            1_790_179_200,
        ),
    ],
)
def test_complete_backup_requires_timezone_aware_timestamp_strings(
    path: tuple[str | int, ...],
    value: object,
):
    """Reject date-only, timezone-free, and numeric timestamps."""

    backup = make_valid_backup()
    replace_backup_value(backup, path, value)

    with pytest.raises(ValidationError):
        WeekFlowBackupImportRequest.model_validate(backup)  