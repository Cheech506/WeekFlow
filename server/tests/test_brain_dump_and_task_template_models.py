"""Tests for PostgreSQL BrainDump and TaskTemplate models."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import BrainDump, Goal, TaskTemplate


CREATED_AT = datetime(
    2026,
    9,
    23,
    12,
    tzinfo=UTC,
)

ARCHIVED_AT = datetime(
    2026,
    9,
    24,
    12,
    tzinfo=UTC,
)

EXPECTED_BRAIN_DUMP_COLUMNS = {
    "id",
    "source_brain_dump_id",
    "body",
    "archived",
    "created_at",
    "archived_at",
}

EXPECTED_TASK_TEMPLATE_COLUMNS = {
    "id",
    "source_task_template_id",
    "goal_id",
    "title",
    "notes",
    "priority",
    "created_at",
    "updated_at",
}


def make_goal(
    *,
    internal_id: int,
    source_id: int,
) -> Goal:
    """Create a valid Goal for template tests."""

    return Goal(
        id=internal_id,
        source_goal_id=source_id,
        title="Finish WeekFlow migration",
        completed=False,
        completed_at=None,
        start_date=date(2026, 9, 23),
        end_date=date(2026, 12, 22),
    )


def make_brain_dump(
    *,
    internal_id: int,
    source_id: int,
) -> BrainDump:
    """Create a valid active Brain Dump note."""

    return BrainDump(
        id=internal_id,
        source_brain_dump_id=source_id,
        body="Turn this idea into a task",
        archived=False,
        created_at=CREATED_AT,
        archived_at=None,
    )


def make_task_template(
    *,
    internal_id: int,
    source_id: int,
    goal_id: int | None = None,
) -> TaskTemplate:
    """Create a valid reusable task template."""

    return TaskTemplate(
        id=internal_id,
        source_task_template_id=source_id,
        goal_id=goal_id,
        title="Weekly planning session",
        notes="Review the current cycle before planning.",
        priority=1,
        created_at=CREATED_AT,
        updated_at=CREATED_AT,
    )


def test_brain_dumps_table_matches_model():
    """Verify that PostgreSQL matches the BrainDump model."""

    inspector = inspect(engine)

    assert inspector.has_table(BrainDump.__tablename__)

    inspected_columns = inspector.get_columns(
        BrainDump.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        BrainDump.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_BRAIN_DUMP_COLUMNS
    assert model_columns == EXPECTED_BRAIN_DUMP_COLUMNS

    column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    assert column_types["source_brain_dump_id"] == "BIGINT"

    primary_key = inspector.get_pk_constraint(
        BrainDump.__tablename__
    )

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            BrainDump.__tablename__
        )
    }

    assert "ck_brain_dumps_source_id_positive" in check_names
    assert "ck_brain_dumps_body_not_blank" in check_names
    assert "ck_brain_dumps_archive_pair" in check_names

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            BrainDump.__tablename__
        )
    }

    assert (
        "uq_brain_dumps_source_brain_dump_id"
        in unique_names
    )

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            BrainDump.__tablename__
        )
    }

    assert indexes[
        "ix_brain_dumps_archived_created_at"
    ] == [
        "archived",
        "created_at",
    ]


def test_task_templates_table_matches_model():
    """Verify that PostgreSQL matches the TaskTemplate model."""

    inspector = inspect(engine)

    assert inspector.has_table(TaskTemplate.__tablename__)

    inspected_columns = inspector.get_columns(
        TaskTemplate.__tablename__
    )

    database_columns = {
        column["name"]
        for column in inspected_columns
    }

    model_columns = set(
        TaskTemplate.__table__.columns.keys()
    )

    assert database_columns == EXPECTED_TASK_TEMPLATE_COLUMNS
    assert model_columns == EXPECTED_TASK_TEMPLATE_COLUMNS

    column_types = {
        column["name"]: str(column["type"])
        for column in inspected_columns
    }

    assert (
        column_types["source_task_template_id"]
        == "BIGINT"
    )
    assert column_types["priority"] == "SMALLINT"

    primary_key = inspector.get_pk_constraint(
        TaskTemplate.__tablename__
    )

    assert primary_key["constrained_columns"] == ["id"]

    check_names = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            TaskTemplate.__tablename__
        )
    }

    assert (
        "ck_task_templates_source_id_positive"
        in check_names
    )
    assert "ck_task_templates_title_not_blank" in check_names
    assert "ck_task_templates_priority_range" in check_names

    unique_names = {
        constraint["name"]
        for constraint in inspector.get_unique_constraints(
            TaskTemplate.__tablename__
        )
    }

    assert (
        "uq_task_templates_source_task_template_id"
        in unique_names
    )

    indexes = {
        index["name"]: index["column_names"]
        for index in inspector.get_indexes(
            TaskTemplate.__tablename__
        )
    }

    assert indexes["ix_task_templates_goal_id"] == [
        "goal_id"
    ]
    assert indexes["ix_task_templates_updated_at"] == [
        "updated_at"
    ]

    foreign_keys = inspector.get_foreign_keys(
        TaskTemplate.__tablename__
    )

    goal_foreign_key = next(
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"] == ["goal_id"]
    )

    assert goal_foreign_key["referred_table"] == "goals"
    assert goal_foreign_key["referred_columns"] == ["id"]
    assert (
        goal_foreign_key["options"].get("ondelete")
        == "SET NULL"
    )


def test_brain_dump_round_trip_without_persisting():
    """Save and read an archived note, then roll it back."""

    internal_id = -9000
    source_id = 1_781_204_329_000

    with Session(engine) as session:
        brain_dump = BrainDump(
            id=internal_id,
            source_brain_dump_id=source_id,
            body="Historical idea",
            archived=True,
            created_at=CREATED_AT,
            archived_at=ARCHIVED_AT,
        )

        session.add(brain_dump)
        session.flush()
        session.expunge_all()

        saved_brain_dump = session.get(
            BrainDump,
            internal_id,
        )

        assert saved_brain_dump is not None
        assert saved_brain_dump.source_brain_dump_id == source_id
        assert saved_brain_dump.body == "Historical idea"
        assert saved_brain_dump.archived is True
        assert saved_brain_dump.created_at == CREATED_AT
        assert saved_brain_dump.archived_at == ARCHIVED_AT

        session.rollback()

    with Session(engine) as session:
        assert session.get(BrainDump, internal_id) is None


def test_task_template_round_trip_without_persisting():
    """Save a Goal-linked template, then roll it back."""

    goal_id = -9001
    template_id = -9002

    with Session(engine) as session:
        session.add(
            make_goal(
                internal_id=goal_id,
                source_id=1_781_204_329_001,
            )
        )
        session.flush()

        session.add(
            make_task_template(
                internal_id=template_id,
                source_id=1_781_204_329_002,
                goal_id=goal_id,
            )
        )
        session.flush()
        session.expunge_all()

        saved_template = session.get(
            TaskTemplate,
            template_id,
        )

        assert saved_template is not None
        assert (
            saved_template.source_task_template_id
            == 1_781_204_329_002
        )
        assert saved_template.goal_id == goal_id
        assert saved_template.title == "Weekly planning session"
        assert (
            saved_template.notes
            == "Review the current cycle before planning."
        )
        assert saved_template.priority == 1
        assert saved_template.created_at == CREATED_AT
        assert saved_template.updated_at == CREATED_AT

        session.rollback()

    with Session(engine) as session:
        assert session.get(TaskTemplate, template_id) is None
        assert session.get(Goal, goal_id) is None


def test_source_brain_dump_id_must_be_unique():
    """Prevent importing one SQLite note twice."""

    source_id = 1_781_204_329_003

    with Session(engine) as session:
        session.add_all(
            [
                make_brain_dump(
                    internal_id=-9003,
                    source_id=source_id,
                ),
                make_brain_dump(
                    internal_id=-9004,
                    source_id=source_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_source_task_template_id_must_be_unique():
    """Prevent importing one SQLite template twice."""

    source_id = 1_781_204_329_004

    with Session(engine) as session:
        session.add_all(
            [
                make_task_template(
                    internal_id=-9005,
                    source_id=source_id,
                ),
                make_task_template(
                    internal_id=-9006,
                    source_id=source_id,
                ),
            ]
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize("source_id", [0, -1])
def test_brain_dump_source_id_must_be_positive(
    source_id: int,
):
    """Reject nonpositive SQLite Brain Dump IDs."""

    with Session(engine) as session:
        session.add(
            make_brain_dump(
                internal_id=-9007,
                source_id=source_id,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize("source_id", [0, -1])
def test_task_template_source_id_must_be_positive(
    source_id: int,
):
    """Reject nonpositive SQLite template IDs."""

    with Session(engine) as session:
        session.add(
            make_task_template(
                internal_id=-9008,
                source_id=source_id,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_brain_dump_body_cannot_be_blank():
    """Reject a Brain Dump containing only whitespace."""

    with Session(engine) as session:
        brain_dump = make_brain_dump(
            internal_id=-9009,
            source_id=1_781_204_329_005,
        )
        brain_dump.body = "   "

        session.add(brain_dump)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize(
    ("archived", "archived_at"),
    [
        (True, None),
        (False, ARCHIVED_AT),
    ],
)
def test_brain_dump_archive_state_must_match_timestamp(
    archived: bool,
    archived_at: datetime | None,
):
    """Require archived state and archived time to agree."""

    with Session(engine) as session:
        brain_dump = make_brain_dump(
            internal_id=-9010,
            source_id=1_781_204_329_006,
        )
        brain_dump.archived = archived
        brain_dump.archived_at = archived_at

        session.add(brain_dump)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_task_template_title_cannot_be_blank():
    """Reject a template containing only whitespace."""

    with Session(engine) as session:
        template = make_task_template(
            internal_id=-9011,
            source_id=1_781_204_329_007,
        )
        template.title = "   "

        session.add(template)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.parametrize("priority", [-1, 3])
def test_task_template_rejects_invalid_priority(
    priority: int,
):
    """Accept only Low, Medium, or High priority values."""

    with Session(engine) as session:
        template = make_task_template(
            internal_id=-9012,
            source_id=1_781_204_329_008,
        )
        template.priority = priority

        session.add(template)

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_task_template_requires_existing_goal():
    """Reject a template linked to a missing PostgreSQL Goal."""

    with Session(engine) as session:
        session.add(
            make_task_template(
                internal_id=-9013,
                source_id=1_781_204_329_009,
                goal_id=-999_999,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


def test_deleting_goal_unlinks_task_template():
    """Keep a template when its linked Goal is deleted."""

    goal_id = -9014
    template_id = -9015

    with Session(engine) as session:
        goal = make_goal(
            internal_id=goal_id,
            source_id=1_781_204_329_010,
        )
        template = make_task_template(
            internal_id=template_id,
            source_id=1_781_204_329_011,
            goal_id=goal_id,
        )

        session.add(goal)
        session.flush()

        session.add(template)
        session.flush()

        session.delete(goal)
        session.flush()
        session.expire(template, ["goal_id"])

        assert template.goal_id is None

        session.rollback()