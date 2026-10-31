"""Build a complete, validated JSON backup from PostgreSQL records."""

from datetime import UTC, date, datetime, time
from secrets import randbelow
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.config import APP_VERSION
from app.schemas import WeekFlowBackupImportRequest
from app.schemas.backup_common import MAX_JS_SAFE_INTEGER
from app.schemas.backup_import import WeekFlowBackupData
from app.services.backup_import import (
    MODELS,
    RELATION_FIELDS,
    SCHEMAS,
    SOURCE_ID_FIELDS,
)


class BackupExportError(ValueError):
    """The stored records cannot be exported as a complete valid backup."""


def portable_id(name: str, row: Any) -> int:
    """Read a stable backup identity, separate from the PostgreSQL primary key."""

    source_id = getattr(row, SOURCE_ID_FIELDS[name])
    if source_id is None:
        raise BackupExportError("A stored record is missing its backup identity.")
    return source_id


def _json_value(value: Any) -> Any:
    """Supply the strict backup validators with JSON-shaped dates and lists."""

    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise BackupExportError("A stored timestamp has no timezone.")
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def build_backup_export(
    stored: dict[str, list[Any]],
    *,
    exported_at: datetime | None = None,
    app_version: str = APP_VERSION,
) -> WeekFlowBackupImportRequest:
    """Translate every record and relationship into the existing JSON format.

    This pure builder never changes a row. The caller supplies stable backup
    identities, and the entire file is validated before being returned.
    """

    if set(stored) != set(MODELS):
        raise BackupExportError("The export is missing a WeekFlow collection.")

    ids: dict[str, dict[int, int]] = {}
    for name in SOURCE_ID_FIELDS:
        mapped = {row.id: portable_id(name, row) for row in stored[name]}
        if len(mapped) != len(stored[name]) or len(set(mapped.values())) != len(mapped):
            raise BackupExportError(f"Backup identities collide in {name}.")
        if any(type(value) is not int or not 0 < value <= MAX_JS_SAFE_INTEGER for value in mapped.values()):
            raise BackupExportError(f"A backup identity is invalid in {name}.")
        ids[name] = mapped

    def relationship(row: Any, field: str, parent: str, source_field: str) -> int | None:
        native_id = getattr(row, field)
        if native_id is not None:
            if native_id not in ids[parent]:
                raise BackupExportError(f"A record references a missing {parent} record.")
            return ids[parent][native_id]

        # Tasks imported before native relationships existed may still name
        # their parent through legacy metadata. Do not silently erase that link.
        legacy_id = getattr(row, source_field, None)
        if legacy_id is not None:
            if legacy_id not in ids[parent].values():
                raise BackupExportError(f"A legacy link references a missing {parent} record.")
            return legacy_id
        return None

    data: dict[str, list[dict[str, Any]]] = {}
    for name, schema in SCHEMAS.items():
        exported_rows = []
        relationships = dict(RELATION_FIELDS.get(name, {}))
        if name == "tasks":
            relationships.update({
                "source_goal_id": ("goal_id", "goals"),
                "source_recurring_rule_id": ("recurring_rule_id", "recurring_rules"),
            })

        for row in stored[name]:
            values = {}
            for field, definition in schema.model_fields.items():
                alias = definition.alias or field
                if field == SOURCE_ID_FIELDS.get(name):
                    value = ids[name][row.id]
                elif field in relationships:
                    native_field, parent = relationships[field]
                    value = relationship(row, native_field, parent, field)
                elif name == "weekly_task_decisions" and field == "source_recurring_rule_id":
                    native_id = row.recurring_rule_id
                    # Decision history deliberately retains a deleted schedule's
                    # identity without requiring that schedule to remain alive.
                    if native_id in ids["recurring_rules"]:
                        value = ids["recurring_rules"][native_id]
                    else:
                        value = row.source_recurring_rule_id or native_id
                else:
                    value = getattr(row, field)

                if name == "goals" and field in {"start_date", "end_date"}:
                    # Goal dates are calendar dates in PostgreSQL; the existing
                    # portable format represents them as timezone-aware ISO text.
                    value = datetime.combine(value, time(12), tzinfo=UTC)
                values[alias] = _json_value(value)
            exported_rows.append(values)

        alias = WeekFlowBackupData.model_fields[name].alias or name
        data[alias] = exported_rows

    try:
        return WeekFlowBackupImportRequest.model_validate({
            "format": "weekflow-backup",
            "version": 12,
            "exportedAt": _json_value(exported_at or datetime.now(UTC)),
            "metadata": {"appVersion": app_version, "dataModelVersion": 1},
            "data": data,
        })
    except ValidationError as error:
        raise BackupExportError(
            "Stored WeekFlow records could not form a complete valid JSON backup."
        ) from error


def assign_backup_identities(db: Session, stored: dict[str, list[Any]]) -> None:
    """Assign missing portable identities using existing migration columns.

    Previously imported IDs remain unchanged. API-created records receive a
    random, positive JavaScript-safe backup ID once. Repeated exports therefore
    retain identity even after edits, and unrelated instances do not both
    identify their first native task as backup task 1. PostgreSQL IDs, content,
    relationships, and user-facing timestamps never change.

    The caller must hold the collection locks and commit only after validating
    the complete backup. A failure rolls these metadata assignments back too.
    """

    used = {
        value
        for name, field in SOURCE_ID_FIELDS.items()
        for row in stored[name]
        if (value := getattr(row, field)) is not None
    }
    for name, field in SOURCE_ID_FIELDS.items():
        model = MODELS[name]
        for row in stored[name]:
            if getattr(row, field) is not None:
                continue
            identity = None
            for _ in range(100):
                candidate = randbelow(MAX_JS_SAFE_INTEGER) + 1
                if candidate not in used:
                    identity = candidate
                    break
            if identity is None:
                raise BackupExportError("A unique backup identity could not be allocated.")

            values = {field: identity}
            # Explicitly retain timestamps to suppress SQLAlchemy onupdate.
            if "updated_at" in model.__table__.columns:
                values["updated_at"] = row.updated_at
            db.execute(update(model).where(model.id == row.id).values(**values)
                       .execution_options(synchronize_session=False))
            set_committed_value(row, field, identity)
            used.add(identity)


def export_backup(db: Session) -> WeekFlowBackupImportRequest:
    """Create one complete server backup in a locked transaction.

    Expose this action with POST because the first export may assign missing
    backup metadata. Locks keep all thirteen reads consistent while other
    devices save. Readers can continue; writers wait until export completes.
    No app records are created or deleted, and PostgreSQL IDs stay unchanged.
    """

    if db.in_transaction():
        raise BackupExportError("The backup export requires a fresh database session.")

    with db.no_autoflush, db.begin():
        tables = ", ".join(f'"{MODELS[name].__tablename__}"' for name in sorted(MODELS))
        db.execute(text(f"LOCK TABLE {tables} IN SHARE ROW EXCLUSIVE MODE"))
        stored = {
            name: list(db.scalars(select(model).order_by(*model.__table__.primary_key.columns)))
            for name, model in MODELS.items()
        }
        assign_backup_identities(db, stored)
        return build_backup_export(stored)
