"""PostgreSQL tests for cycle-review drafts and atomic finalization.

The shared fixture uses isolated schemas and rolls back all test records.
Setup commits below checkpoint savepoints, not the application's tables.
"""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models import (
    CycleGoalOutcome, CycleReview, Goal, GoalMilestone, PlanningCycle,
    RecurringRule, Task, WeeklyCommitment,
)
from app.services.backup_import import MODELS
from test_backup_refresh_api import refresh_client


URL = "/api/v1/cycle-reviews"
OUTCOMES_URL = "/api/v1/cycle-goal-outcomes"
START = date(2026, 7, 20)
END = START + timedelta(days=83)
NEXT = date(2026, 10, 21)  # Wednesday; first commitments belong to Monday Oct 19.
STAMP = datetime(2026, 9, 1, 12, tzinfo=UTC)
ACTIONS = ("complete", "carryForward", "archive", "replace")


@pytest.fixture
def cycle_client(refresh_client):
    return refresh_client


def make_cycle(session, *, active=True):
    row = PlanningCycle(
        name="Original cycle", start_date=START, end_date=END,
        active=active, completed_at=None if active else STAMP,
    )
    session.add(row)
    session.flush()
    return row.id


def make_goal(session, cycle_id, *, title="Original goal", source_id=None, completed=False):
    row = Goal(
        cycle_id=cycle_id, title=title, source_goal_id=source_id,
        start_date=START, end_date=END, reward="A reward", purpose="Purpose",
        success_definition="Definition", notes="Historical notes",
        completion_what_helped="Keep this reflection", completed=completed,
        completed_at=STAMP if completed else None,
    )
    session.add(row)
    session.flush()
    return row.id


def statistics(**changes):
    return {
        "goal_total": 4, "goal_completed": 0, "task_completed": 3,
        "milestone_total": 4, "milestone_completed": 2,
        "weekly_reviews_completed": 2, "longest_streak": 1,
        "best_week_number": 1, "best_week_count": 3, "best_day": "Monday", "best_day_count": 3,
        "high_priority_completed": 3, "recurring_completed": 0, "rewards_unlocked": 0,
        "brain_dumps_archived": 0, **changes,
    }


def payload(cycle_identity, selections=None, **changes):
    return {
        "cycle_id": cycle_identity,
        "reflection": {"what_learned": "  Keep good history  "},
        "snapshot": statistics(),
        "next_cycle": {
            "name": "  Next cycle  ", "primary_focus": "Focus", "theme": "Theme",
            "start_date": NEXT.isoformat(),
            "first_week_commitments": ["  First promise  ", "", "Second promise"],
        },
        "outcomes": [] if selections is None else selections,
        **changes,
    }


def save(client, data):
    response = client.post(f"{URL}/draft", json=data)
    assert response.status_code == 200, response.text
    return response.json()


def finalize(client, review_id):
    response = client.post(f"{URL}/{review_id}/finalize")
    assert response.status_code == 200, response.text
    return response.json()


def row_state(session, model, identity):
    session.expire_all()
    row = session.get(model, identity)
    if row is None:
        return None
    return deepcopy({column.name: getattr(row, column.name) for column in model.__table__.columns})


def database_state(session):
    session.expire_all()
    return {
        name: [deepcopy({column.name: getattr(row, column.name) for column in model.__table__.columns})
               for row in session.scalars(select(model).order_by(*model.__table__.primary_key.columns)).all()]
        for name, model in MODELS.items()
    }


def count(session, model):
    return session.scalar(select(func.count()).select_from(model))


def setup_four(session):
    cycle_id = make_cycle(session)
    goal_ids = [make_goal(session, cycle_id, title=f"Goal {action}", source_id=1_781_204_330_100 + index) for index, action in enumerate(ACTIONS)]
    rule = RecurringRule(title="Keep this schedule", goal_id=goal_ids[2], source_recurring_rule_id=1_781_204_330_006, frequency="daily", start_date=START)
    session.add(rule)
    session.flush()
    rule_id = rule.id
    session.add_all([
        Task(title="Completed", goal_id=goal_ids[0], completed=True, completed_at=STAMP, priority=2),
        Task(title="Unfinished", goal_id=goal_ids[0], completed=False),
        Task(title="Legacy goal link", source_goal_id=1_781_204_330_100, completed=True, completed_at=STAMP, priority=2),
        Task(title="Native link wins", goal_id=goal_ids[1], source_goal_id=1_781_204_330_100, completed=True, completed_at=STAMP, priority=2),
        Task(title="Old recurring occurrence", goal_id=goal_ids[1], recurring_rule_id=rule_id, source_recurring_rule_id=rule.source_recurring_rule_id, recurrence_occurrence_date=START, due_date=START, day="Monday"),
    ])
    for goal_id in goal_ids[:2]:
        session.add_all([
            GoalMilestone(goal_id=goal_id, title="Completed milestone", notes="Saved note", target_date=START, completed=True, completed_at=STAMP, created_at=STAMP),
            GoalMilestone(goal_id=goal_id, title="Unfinished milestone", target_date=END, completed=False, created_at=STAMP),
        ])
    session.commit()
    selections = [{"goal_id": identity, "action": action, **({"replacement_title": "  Replacement goal  "} if action == "replace" else {})} for identity, action in zip(goal_ids, ACTIONS)]
    return {"cycle_id": cycle_id, "goal_ids": goal_ids, "rule_id": rule_id, "payload": payload(cycle_id, selections)}


def test_draft_save_and_read_do_not_apply_outcomes(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    before = database_state(session)
    result = save(client, setup["payload"])
    review = result["review"]
    assert review["cycle_id"] == setup["cycle_id"]
    assert review["what_learned"] == "Keep good history"
    assert review["next_cycle_name"] == "Next cycle"
    assert review["next_cycle_first_commitments"] == ["First promise", "Second promise"]
    assert review["finalized_at"] is None and review["next_cycle_id"] is None
    assert review["source_cycle_review_id"] is None
    assert len(result["outcomes"]) == 4
    for outcome, goal_id, action in zip(result["outcomes"], setup["goal_ids"], ACTIONS):
        assert outcome["goal_id"] == goal_id and outcome["action"] == action
        assert outcome["goal_title"] == f"Goal {action}"
        assert outcome["destination_goal_id"] is None
        assert outcome["source_cycle_goal_outcome_id"] is None
    after = database_state(session)
    for name in MODELS:
        if name not in {"cycle_reviews", "cycle_goal_outcomes"}:
            assert after[name] == before[name]
    assert client.get(f"{URL}/{review['id']}").json() == result


def test_draft_edits_preserve_review_and_retained_outcome_ids(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    first = save(client, setup["payload"])
    review_id = first["review"]["id"]
    session.get(CycleReview, review_id).source_cycle_review_id = 1_781_204_331_001
    for index, row in enumerate(first["outcomes"]):
        session.get(CycleGoalOutcome, row["id"]).source_cycle_goal_outcome_id = 1_781_204_331_010 + index
    session.commit()
    before = row_state(session, CycleReview, review_id)
    changed = deepcopy(setup["payload"])
    changed["reflection"] = {"biggest_accomplishment": "New reflection"}
    changed["snapshot"]["task_completed"] = 40
    changed["next_cycle"]["name"] = "Updated plan"
    changed["outcomes"][1] = {"goal_id": setup["goal_ids"][1], "action": "archive"}
    result = save(client, changed)
    assert result["review"]["id"] == review_id
    assert result["review"]["source_cycle_review_id"] == before["source_cycle_review_id"]
    assert row_state(session, CycleReview, review_id)["created_at"] == before["created_at"]
    assert result["review"]["what_learned"] is None  # Complete-draft replacement.
    assert result["review"]["snapshot_task_completed"] == 40
    assert result["review"]["next_cycle_name"] == "Updated plan"
    assert [row["id"] for row in result["outcomes"]] == [row["id"] for row in first["outcomes"]]
    assert [row["source_cycle_goal_outcome_id"] for row in result["outcomes"]] == [1_781_204_331_010 + index for index in range(4)]
    assert count(session, PlanningCycle) == 1 and count(session, Goal) == 4


def test_empty_outcomes_explicitly_remove_only_draft_selections(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    first = save(client, setup["payload"])
    before = database_state(session)
    changed = {**setup["payload"], "outcomes": []}
    result = save(client, changed)
    assert result["review"]["id"] == first["review"]["id"] and result["outcomes"] == []
    after = database_state(session)
    for name in MODELS:
        if name not in {"cycle_reviews", "cycle_goal_outcomes"}:
            assert after[name] == before[name]


@pytest.mark.parametrize("problem", ["missing_goal", "other_cycle", "completed_goal"])
def test_invalid_goal_selection_preserves_existing_draft(cycle_client, problem):
    client, session = cycle_client
    setup = setup_four(session)
    save(client, setup["payload"])
    if problem == "missing_goal":
        goal_id = 999999
    elif problem == "other_cycle":
        goal_id = make_goal(session, make_cycle(session, active=False))
    else:
        goal = session.get(Goal, setup["goal_ids"][0])
        goal.completed, goal.completed_at = True, STAMP
        goal_id = goal.id
    session.commit()
    before = database_state(session)
    session.commit()
    changed = {**setup["payload"], "outcomes": [{"goal_id": goal_id, "action": "archive"}]}
    response = client.post(f"{URL}/draft", json=changed)
    assert response.status_code == 409, response.text
    assert database_state(session) == before


def test_finalize_applies_all_outcomes_and_keeps_old_task_relationships(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    draft = save(client, setup["payload"])
    before = database_state(session)
    result = finalize(client, draft["review"]["id"])
    assert result["already_finalized"] is False
    review, successor = result["review"], result["next_cycle"]
    assert review["finalized_at"] is not None
    assert review["next_cycle_id"] == successor["id"]
    assert successor["start_date"] == NEXT.isoformat()
    assert successor["end_date"] == (NEXT + timedelta(days=83)).isoformat()
    assert successor["name"] == "Next cycle" and successor["active"] is True
    assert successor["source_planning_cycle_id"] is None
    original = row_state(session, PlanningCycle, setup["cycle_id"])
    assert original["active"] is False and original["completed_at"] is not None
    assert count(session, PlanningCycle) == 2
    assert session.scalar(select(func.count()).select_from(PlanningCycle).where(PlanningCycle.active.is_(True))) == 1
    by_action = {outcome["action"]: outcome for outcome in result["outcomes"]}
    completed = row_state(session, Goal, setup["goal_ids"][0])
    assert completed["completed"] is True
    assert (completed["completion_task_total"], completed["completion_task_completed"], completed["completion_high_priority_completed"]) == (3, 2, 2)
    assert (completed["completion_milestone_total"], completed["completion_milestone_completed"]) == (2, 1)
    assert completed["completion_what_helped"] == "Keep this reflection"
    assert by_action["complete"]["destination_goal_id"] is None
    assert review["snapshot_goal_completed"] == 1 and review["snapshot_rewards_unlocked"] == 1
    carried = row_state(session, Goal, by_action["carryForward"]["destination_goal_id"])
    original_carried = row_state(session, Goal, setup["goal_ids"][1])
    for field in ["title", "reward", "purpose", "success_definition", "notes"]:
        assert carried[field] == original_carried[field]
    assert carried["cycle_id"] == successor["id"] and carried["source_goal_id"] is None
    assert carried["completed"] is False and carried["completed_at"] is None
    assert carried["completion_what_helped"] is None and carried["completion_task_total"] is None
    assert (carried["start_date"], carried["end_date"]) == (NEXT, NEXT + timedelta(days=83))
    old_milestones = [row for row in before["goal_milestones"] if row["goal_id"] == setup["goal_ids"][1]]
    session.expire_all()
    copies = list(session.scalars(select(GoalMilestone).where(GoalMilestone.goal_id == carried["id"]).order_by(GoalMilestone.id)).all())
    assert len(copies) == 2
    for old, copy in zip(old_milestones, copies):
        assert copy.id != old["id"] and copy.source_goal_milestone_id is None
        for field in ["title", "notes", "target_date", "completed", "created_at", "completed_at"]:
            assert getattr(copy, field) == old[field]
    replacement = row_state(session, Goal, by_action["replace"]["destination_goal_id"])
    assert replacement["title"] == "Replacement goal" and replacement["cycle_id"] == successor["id"]
    assert all(replacement[field] is None for field in ["source_goal_id", "purpose", "notes", "reward", "completion_task_total"])
    assert session.scalar(select(func.count()).select_from(GoalMilestone).where(GoalMilestone.goal_id == replacement["id"])) == 0
    assert by_action["archive"]["destination_goal_id"] is None
    after = database_state(session)
    assert after["tasks"] == before["tasks"] and after["recurring_rules"] == before["recurring_rules"]
    for identity in setup["goal_ids"][1:]:
        assert row_state(session, Goal, identity) == next(row for row in before["goals"] if row["id"] == identity)
    assert count(session, Goal) == 6
    promises = after["weekly_commitments"]
    assert [row["title"] for row in promises] == ["First promise", "Second promise"]
    assert all(row["cycle_id"] == successor["id"] and row["task_id"] is None and row["week_start"] == date(2026, 10, 19) and not row["completed"] for row in promises)


def test_finalize_retry_does_not_rewrite_report_or_create_duplicates(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    draft = save(client, setup["payload"])
    first = finalize(client, draft["review"]["id"])
    before = database_state(session)
    second = finalize(client, draft["review"]["id"])
    assert second == {**first, "already_finalized": True}
    assert database_state(session) == before


def test_retry_old_report_does_not_reopen_its_successor(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    draft = save(client, setup["payload"])
    first = finalize(client, draft["review"]["id"])
    next_start = date.fromisoformat(first["next_cycle"]["end_date"]) + timedelta(days=1)
    newer = client.post("/api/v1/planning-cycles", json={"start_date": next_start.isoformat()})
    assert newer.status_code == 201, newer.text
    before = database_state(session)
    repeated = finalize(client, draft["review"]["id"])
    assert repeated["already_finalized"] is True and repeated["next_cycle"]["active"] is False
    assert database_state(session) == before


def test_finalize_cycle_with_no_goals(cycle_client):
    client, session = cycle_client
    cycle_id = make_cycle(session)
    session.commit()
    stats = {key: (None if key in {"best_week_number", "best_day"} else 0) for key in statistics()}
    saved = save(client, payload(cycle_id, snapshot=stats))
    result = finalize(client, saved["review"]["id"])
    assert result["outcomes"] == [] and result["next_cycle"]["active"] is True
    assert count(session, Goal) == 0


@pytest.mark.parametrize("problem", ["missing_outcome", "new_goal", "completed_goal", "deleted_goal", "moved_goal", "inactive_cycle"])
def test_changed_cycle_state_blocks_finalization_without_partial_changes(cycle_client, problem):
    client, session = cycle_client
    setup = setup_four(session)
    data = deepcopy(setup["payload"])
    if problem == "missing_outcome":
        data["outcomes"].pop()
    saved = save(client, data)
    if problem == "new_goal":
        make_goal(session, setup["cycle_id"], title="Added after draft")
    elif problem == "completed_goal":
        goal = session.get(Goal, setup["goal_ids"][0]); goal.completed, goal.completed_at = True, STAMP
    elif problem == "deleted_goal":
        session.delete(session.get(Goal, setup["goal_ids"][0]))
    elif problem == "moved_goal":
        session.get(Goal, setup["goal_ids"][0]).cycle_id = make_cycle(session, active=False)
    elif problem == "inactive_cycle":
        cycle = session.get(PlanningCycle, setup["cycle_id"]); cycle.active, cycle.completed_at = False, STAMP
    session.commit()
    before = database_state(session)
    session.commit()
    response = client.post(f"{URL}/{saved['review']['id']}/finalize")
    assert response.status_code == 409, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("next_start", [END.isoformat(), (END - timedelta(days=1)).isoformat()])
def test_successor_must_start_after_reviewed_cycle(cycle_client, next_start):
    client, session = cycle_client
    setup = setup_four(session)
    data = deepcopy(setup["payload"]); data["next_cycle"]["start_date"] = next_start
    saved = save(client, data)
    before = database_state(session); session.commit()
    response = client.post(f"{URL}/{saved['review']['id']}/finalize")
    assert response.status_code == 409, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("field,value", [("next_cycle_start_date", None), ("snapshot_best_day", "Invalid weekday")])
def test_invalid_imported_draft_plan_or_snapshot_blocks_finalization(cycle_client, field, value):
    client, session = cycle_client
    setup = setup_four(session)
    saved = save(client, setup["payload"])
    setattr(session.get(CycleReview, saved["review"]["id"]), field, value)
    session.commit()
    before = database_state(session); session.commit()
    response = client.post(f"{URL}/{saved['review']['id']}/finalize")
    assert response.status_code == 409, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("operation", ["save", "delete"])
def test_finalized_reports_are_read_only(cycle_client, operation):
    client, session = cycle_client
    setup = setup_four(session)
    saved = save(client, setup["payload"])
    finalize(client, saved["review"]["id"])
    before = database_state(session); session.commit()
    response = client.post(f"{URL}/draft", json=setup["payload"]) if operation == "save" else client.delete(f"{URL}/{saved['review']['id']}")
    assert response.status_code == 409, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("field", ["next_cycle_id", "destination_goal_id"])
def test_partial_successor_links_are_protected(cycle_client, field):
    client, session = cycle_client
    setup = setup_four(session)
    saved = save(client, setup["payload"])
    if field == "next_cycle_id":
        session.get(CycleReview, saved["review"]["id"]).next_cycle_id = make_cycle(session, active=False)
    else:
        session.get(CycleGoalOutcome, saved["outcomes"][0]["id"]).destination_goal_id = setup["goal_ids"][1]
    session.commit()
    before = database_state(session); session.commit()
    for operation in ["finalize", "save", "delete"]:
        if operation == "finalize": response = client.post(f"{URL}/{saved['review']['id']}/finalize")
        elif operation == "save": response = client.post(f"{URL}/draft", json=setup["payload"])
        else: response = client.delete(f"{URL}/{saved['review']['id']}")
        assert response.status_code == 409, response.text
        assert database_state(session) == before
        session.commit()


def test_missing_successor_link_on_finalized_history_does_not_create_another_cycle(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    saved = save(client, setup["payload"])
    first = finalize(client, saved["review"]["id"])
    session.delete(session.get(PlanningCycle, first["next_cycle"]["id"]))
    session.commit()
    before = database_state(session)
    repeated = finalize(client, saved["review"]["id"])
    assert repeated["already_finalized"] is True and repeated["next_cycle"] is None
    assert repeated["review"]["finalized_at"] == first["review"]["finalized_at"]
    assert database_state(session) == before


def test_delete_draft_cascades_only_its_selections(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    saved = save(client, setup["payload"])
    other_id = make_cycle(session, active=False); session.commit()
    other = save(client, payload(other_id))
    before = database_state(session)
    response = client.delete(f"{URL}/{saved['review']['id']}")
    assert response.status_code == 204 and response.content == b"", response.text
    assert row_state(session, CycleReview, saved["review"]["id"]) is None
    assert count(session, CycleGoalOutcome) == 0
    after = database_state(session)
    for name in MODELS:
        if name not in {"cycle_reviews", "cycle_goal_outcomes"}: assert after[name] == before[name]
    assert row_state(session, CycleReview, other["review"]["id"]) is not None


def test_review_and_outcome_filters_and_historical_title(cycle_client):
    client, session = cycle_client
    setup = setup_four(session)
    assert client.get(URL).json() == [] and client.get(OUTCOMES_URL).json() == []
    saved = save(client, setup["payload"])
    rid = saved["review"]["id"]
    assert client.get(URL, params={"cycle_id": setup["cycle_id"], "finalized": "false"}).json()[0]["id"] == rid
    assert client.get(URL, params={"finalized": "true"}).json() == []
    result = finalize(client, rid)
    assert client.get(URL, params={"finalized": "false"}).json() == []
    assert client.get(URL, params={"finalized": "true"}).json()[0]["id"] == rid
    for outcome in result["outcomes"]:
        assert client.get(f"{OUTCOMES_URL}/{outcome['id']}").json() == outcome
        for params in [{"cycle_review_id": rid, "goal_id": outcome["goal_id"]}, {"action": outcome["action"]}]:
            response = client.get(OUTCOMES_URL, params=params)
            assert response.status_code == 200, response.text
            assert [row["id"] for row in response.json()] == [outcome["id"]]
        if outcome["destination_goal_id"] is not None:
            assert client.get(OUTCOMES_URL, params={"destination_goal_id": outcome["destination_goal_id"]}).json()[0]["id"] == outcome["id"]
    archived = next(row for row in result["outcomes"] if row["action"] == "archive")
    session.delete(session.get(Goal, archived["goal_id"])); session.commit()
    historical = client.get(f"{OUTCOMES_URL}/{archived['id']}").json()
    assert historical["goal_id"] is None and historical["goal_title"] == archived["goal_title"]


@pytest.mark.parametrize("changes", [
    {"cycle_id": 0}, {"cycle_id": True}, {"cycle_id": "1"}, {"cycle_id": 2_147_483_648},
    {"id": 12}, {"source_cycle_review_id": 123}, {"next_cycle_id": 123},
    {"finalized_at": "2026-10-19T12:00:00Z"}, {"snapshot": {}}, {"outcomes": None},
])
def test_invalid_draft_request_saves_nothing(cycle_client, changes):
    client, session = cycle_client
    setup = setup_four(session)
    before = database_state(session); session.commit()
    response = client.post(f"{URL}/draft", json={**setup["payload"], **changes})
    assert response.status_code == 422, response.text
    assert database_state(session) == before


@pytest.mark.parametrize("field", ["cycle_id", "reflection", "snapshot", "next_cycle", "outcomes"])
def test_missing_draft_section_returns_422(cycle_client, field):
    client, session = cycle_client
    setup = setup_four(session)
    data = deepcopy(setup["payload"]); del data[field]
    response = client.post(f"{URL}/draft", json=data)
    assert response.status_code == 422, response.text
    assert count(session, CycleReview) == 0


@pytest.mark.parametrize("selections", [
    [{"goal_id": 1, "action": "archive"}, {"goal_id": 1, "action": "complete"}],
    [{"goal_id": 1, "action": "replace"}],
    [{"goal_id": 1, "action": "replace", "replacement_title": "x" * 181}],
    [{"goal_id": 1, "action": "complete", "replacement_title": "Unexpected"}],
    [{"goal_id": 1, "action": "archive", "destination_goal_id": 3}],
    [{"goal_id": 1, "action": "archive", "goal_title": "Forged"}],
])
def test_invalid_outcome_selections_return_422(cycle_client, selections):
    client, session = cycle_client
    setup = setup_four(session)
    response = client.post(f"{URL}/draft", json={**setup["payload"], "outcomes": selections})
    assert response.status_code == 422, response.text
    assert count(session, CycleReview) == 0


@pytest.mark.parametrize("commitments", [["One"] * 6, ["Study", " study "], ["x" * 181], [None], [["Nested"]]])
def test_invalid_first_commitments_return_422(cycle_client, commitments):
    client, session = cycle_client
    setup = setup_four(session)
    data = deepcopy(setup["payload"]); data["next_cycle"]["first_week_commitments"] = commitments
    response = client.post(f"{URL}/draft", json=data)
    assert response.status_code == 422, response.text
    assert count(session, CycleReview) == 0


@pytest.mark.parametrize("field", ["biggest_accomplishment", "biggest_challenge", "what_worked_well", "what_change_next_cycle", "what_stop_doing", "what_continue_doing", "what_learned"])
def test_oversized_reflection_returns_422(cycle_client, field):
    client, session = cycle_client
    setup = setup_four(session)
    data = deepcopy(setup["payload"]); data["reflection"][field] = "x" * 2001
    response = client.post(f"{URL}/draft", json=data)
    assert response.status_code == 422, response.text
    assert count(session, CycleReview) == 0


@pytest.mark.parametrize("changes", [{"goal_completed": 5}, {"milestone_completed": 5}, {"high_priority_completed": 4}, {"rewards_unlocked": 1}, {"best_week_number": None}, {"best_day_count": 0}, {"task_completed": True}])
def test_invalid_snapshot_returns_422(cycle_client, changes):
    client, session = cycle_client
    setup = setup_four(session)
    data = deepcopy(setup["payload"]); data["snapshot"].update(changes)
    response = client.post(f"{URL}/draft", json=data)
    assert response.status_code == 422, response.text
    assert count(session, CycleReview) == 0


@pytest.mark.parametrize("path", ["/cycle-reviews?cycle_id=0", "/cycle-reviews?finalized=invalid", "/cycle-goal-outcomes?cycle_review_id=-1", "/cycle-goal-outcomes?goal_id=2147483648", "/cycle-goal-outcomes?destination_goal_id=0", "/cycle-goal-outcomes?action=invalid"])
def test_invalid_list_filters_return_422(cycle_client, path):
    client, _ = cycle_client
    response = client.get(f"/api/v1{path}")
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("method,path", [("get", "/cycle-reviews/999999"), ("post", "/cycle-reviews/999999/finalize"), ("delete", "/cycle-reviews/999999"), ("get", "/cycle-goal-outcomes/999999")])
def test_missing_record_returns_404(cycle_client, method, path):
    client, _ = cycle_client
    response = getattr(client, method)(f"/api/v1{path}")
    assert response.status_code == 404, response.text


def test_missing_cycle_returns_404(cycle_client):
    client, session = cycle_client
    response = client.post(f"{URL}/draft", json=payload(999999))
    assert response.status_code == 404, response.text
    assert count(session, CycleReview) == 0


@pytest.mark.parametrize("identity", [0, -1, 2_147_483_648])
@pytest.mark.parametrize("method,pattern", [("get", "/cycle-reviews/{}"), ("post", "/cycle-reviews/{}/finalize"), ("delete", "/cycle-reviews/{}"), ("get", "/cycle-goal-outcomes/{}")])
def test_invalid_path_ids_return_422(cycle_client, identity, method, pattern):
    client, _ = cycle_client
    response = getattr(client, method)(f"/api/v1{pattern.format(identity)}")
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("existing", [False, True])
def test_draft_constraint_failure_rolls_back_parent_and_children(cycle_client, existing):
    client, session = cycle_client
    setup = setup_four(session)
    if existing: save(client, setup["payload"])
    before = database_state(session); session.commit()
    data = deepcopy(setup["payload"])
    if existing: data["outcomes"] = [{"goal_id": setup["goal_ids"][0], "action": "archive"}]

    def break_action(mapper, connection, target): target.action = "invalid"

    event_name = "before_update" if existing else "before_insert"
    event.listen(CycleGoalOutcome, event_name, break_action)
    try: response = client.post(f"{URL}/draft", json=data)
    finally: event.remove(CycleGoalOutcome, event_name, break_action)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    assert client.post(f"{URL}/draft", json=data).status_code == 200


@pytest.mark.parametrize("stage", ["successor", "goal", "milestone", "commitment", "report"])
def test_finalization_constraint_failure_rolls_back_whole_transition(cycle_client, stage):
    client, session = cycle_client
    setup = setup_four(session)
    saved = save(client, setup["payload"])
    before = database_state(session); session.commit()
    model, event_name = {
        "successor": (PlanningCycle, "before_insert"), "goal": (Goal, "before_insert"),
        "milestone": (GoalMilestone, "before_insert"), "commitment": (WeeklyCommitment, "before_insert"),
        "report": (CycleReview, "before_update"),
    }[stage]

    def reject_write(mapper, connection, target):
        if stage == "successor": target.end_date = target.start_date
        elif stage in {"goal", "milestone", "commitment"}: target.title = ""
        elif target.finalized_at is not None: target.snapshot_goal_completed = target.snapshot_goal_total + 1

    event.listen(model, event_name, reject_write)
    try: response = client.post(f"{URL}/{saved['review']['id']}/finalize")
    finally: event.remove(model, event_name, reject_write)
    assert response.status_code == 409, response.text
    assert database_state(session) == before
    retried = finalize(client, saved["review"]["id"])
    assert retried["already_finalized"] is False
    assert count(session, PlanningCycle) == 2 and count(session, Goal) == 6


@pytest.mark.parametrize("operation", ["new_draft", "update_draft", "finalize", "delete"])
def test_commit_failure_restores_database_and_allows_retry(cycle_client, monkeypatch, operation):
    client, session = cycle_client
    setup = setup_four(session)
    saved = None if operation == "new_draft" else save(client, setup["payload"])
    before = database_state(session); session.commit()
    changed = deepcopy(setup["payload"]); changed["reflection"] = {"what_learned": "Replacement"}

    def request():
        if operation in {"new_draft", "update_draft"}: return client.post(f"{URL}/draft", json=changed)
        if operation == "finalize": return client.post(f"{URL}/{saved['review']['id']}/finalize")
        return client.delete(f"{URL}/{saved['review']['id']}")

    def fail_commit():
        session.flush()
        raise IntegrityError("simulated commit failure", {}, Exception("private test detail"))

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", fail_commit)
        response = request()
    assert response.status_code == 409 and "private test detail" not in response.text, response.text
    assert database_state(session) == before
    retried = request()
    assert retried.status_code == (204 if operation == "delete" else 200), retried.text
