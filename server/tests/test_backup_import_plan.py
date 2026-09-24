"""Unit tests for database-aware backup import planning."""

from datetime import date, datetime, timezone

from app.models import BrainDump, PlanningCycle
from app.schemas import (
    BackupBrainDumpItem,
    BackupPlanningCycleItem,
)
from app.services.backup_import import (
    MODELS,
    classify_collection,
    source_maps_for,
)


TIMESTAMP = datetime(2026, 9, 24, 16, tzinfo=timezone.utc)


def empty_stored_rows() -> dict[str, list[object]]:
    """Return every collection with no PostgreSQL rows."""

    return {name: [] for name in MODELS}


def make_brain_dump() -> BackupBrainDumpItem:
    """Return one validated SQLite Brain Dump."""

    return BackupBrainDumpItem.model_validate(
        {
            "id": 1_781_204_330_004,
            "body": "Finish the migration preview",
            "archived": False,
            "createdAt": TIMESTAMP.isoformat(),
            "archivedAt": None,
        }
    )


def stored_brain_dump(item: BackupBrainDumpItem) -> BrainDump:
    """Return the PostgreSQL form of a Brain Dump."""

    return BrainDump(
        id=41,
        source_brain_dump_id=item.source_brain_dump_id,
        body=item.body,
        archived=item.archived,
        created_at=item.created_at,
        archived_at=item.archived_at,
    )


def test_matching_source_record_is_already_imported():
    """Recognize a safe retry when identity and data match."""

    item = make_brain_dump()
    row = stored_brain_dump(item)
    stored = empty_stored_rows()
    stored["brain_dumps"] = [row]

    plan = classify_collection(
        name="brain_dumps",
        items=[item],
        stored_rows=[row],
        source_maps=source_maps_for(stored),
    )

    assert plan.already_imported == [item]
    assert plan.would_create == []
    assert plan.conflicts == []


def test_changed_source_record_is_a_conflict():
    """Reject a reused source ID whose saved data changed."""

    item = make_brain_dump()
    row = stored_brain_dump(item)
    row.body = "Different PostgreSQL text"
    stored = empty_stored_rows()
    stored["brain_dumps"] = [row]

    plan = classify_collection(
        name="brain_dumps",
        items=[item],
        stored_rows=[row],
        source_maps=source_maps_for(stored),
    )

    assert plan.already_imported == []
    assert plan.would_create == []
    assert plan.conflicts == [item]
    assert plan.conflict_identities == [
        str(item.source_brain_dump_id)
    ]


def test_second_active_cycle_is_a_conflict():
    """Catch a database uniqueness conflict before importing."""

    item = BackupPlanningCycleItem.model_validate(
        {
            "id": 1_781_204_330_007,
            "name": "Fall 2026",
            "primaryFocus": "Finish WeekFlow",
            "theme": None,
            "startDate": "2026-09-21",
            "endDate": "2026-12-13",
            "active": True,
            "createdAt": TIMESTAMP.isoformat(),
            "completedAt": None,
        }
    )
    row = PlanningCycle(
        id=51,
        source_planning_cycle_id=1_700_000_000_001,
        name="Existing active cycle",
        primary_focus="Current focus",
        theme=None,
        start_date=date(2026, 6, 29),
        end_date=date(2026, 9, 20),
        active=True,
        created_at=TIMESTAMP,
        completed_at=None,
    )
    stored = empty_stored_rows()
    stored["planning_cycles"] = [row]

    plan = classify_collection(
        name="planning_cycles",
        items=[item],
        stored_rows=[row],
        source_maps=source_maps_for(stored),
    )

    assert plan.would_create == []
    assert plan.conflicts == [item]