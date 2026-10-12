"""Refresh SQLite data while preserving PostgreSQL IDs."""

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.schemas import (
    BackupImportCounts,
    BackupRefreshResult,
    WeekFlowBackupImportRequest,
)
from app.services.backup_import import (
    IMPORT_ORDER,
    MODELS,
    RELATION_FIELDS,
    SCHEMAS,
    SOURCE_ID_FIELDS,
    BackupImportConflictError,
    internal_ids_by_source,
    model_from_backup_item,
    primary_identity,
    source_maps_for,
)


def refresh_values(
    name: str,
    item: Any,
    internal_ids: dict[str, dict[int, int]],
) -> dict[str, Any]:
    """Prepare updated values without changing row identities."""

    candidate = model_from_backup_item(
        name,
        item,
        internal_ids,
    )

    relationships = RELATION_FIELDS.get(name, {})

    identity_columns = {
        column.key
        for column in MODELS[name].__table__.primary_key.columns
    }

    source_field = SOURCE_ID_FIELDS.get(name)

    if source_field is not None:
        identity_columns.add(source_field)

    values = {}

    for field_name in SCHEMAS[name].model_fields:
        relationship = relationships.get(field_name)

        attribute = (
            relationship[0]
            if relationship is not None
            else field_name
        )

        if attribute not in identity_columns:
            values[attribute] = getattr(
                candidate,
                attribute,
            )

    if name == "tasks":
        # These native links are derived from the preserved source IDs.
        # Update them together with the task's content and completion
        # fields. The task's own primary key stays unchanged.
        values["goal_id"] = candidate.goal_id
        values["recurring_rule_id"] = candidate.recurring_rule_id

    return values


def prepare_task_identity_changes(
    items: list[Any],
    rows_by_source: dict[Any, Any],
    internal_ids: dict[str, dict[int, int]],
    db: Session,
) -> set[int]:
    """Release changing occurrence keys before any task claims its new key.

    Only tasks present in this backup are touched. Their PostgreSQL IDs,
    source task IDs, goal links, and completion history are retained here.
    The loop below immediately applies their final backup values inside
    the same locked transaction. A failure rolls back both steps.
    """

    released_source_ids: set[int] = set()
    identity_fields = (
        "source_recurring_rule_id",
        "recurring_rule_id",
        "recurrence_occurrence_date",
    )

    for item in items:
        row = rows_by_source.get(item.source_task_id)
        if row is None:
            continue

        desired = refresh_values("tasks", item, internal_ids)
        if all(
            getattr(row, field) == desired[field]
            for field in identity_fields
        ):
            continue

        # Clear the complete identity together to satisfy the pair check.
        # This also supports exchanging two occurrence keys in one backup.
        for field in identity_fields:
            setattr(row, field, None)
        released_source_ids.add(item.source_task_id)

    if released_source_ids:
        db.flush()

    return released_source_ids


def refresh_backup(
    backup: WeekFlowBackupImportRequest,
    db: Session,
) -> BackupRefreshResult:
    """Add and update backup records in one transaction."""

    try:
        # Names come from our models, never from user input.
        table_names = ", ".join(
            f'"{MODELS[name].__tablename__}"'
            for name in sorted(MODELS)
        )

        # Readers can continue. Competing writes wait until we finish.
        db.execute(
            text(
                f"LOCK TABLE {table_names} "
                "IN SHARE ROW EXCLUSIVE MODE"
            )
        )

        stored = {
            name: list(
                db.scalars(select(model)).all()
            )
            for name, model in MODELS.items()
        }

        source_maps = source_maps_for(stored)
        internal_ids = internal_ids_by_source(stored)

        created = {name: 0 for name in MODELS}
        updated = {name: 0 for name in MODELS}
        unchanged = {name: 0 for name in MODELS}

        for name in IMPORT_ORDER:
            rows_by_source = {
                primary_identity(
                    name,
                    row,
                    True,
                    source_maps,
                ): row
                for row in stored[name]
            }

            items = list(
                getattr(backup.data, name)
            )

            # Close the old cycle before activating a new one.
            if name == "planning_cycles":
                items.sort(
                    key=lambda item: item.active
                )

            released_task_ids: set[int] = set()
            if name == "tasks":
                released_task_ids = prepare_task_identity_changes(
                    items, rows_by_source, internal_ids, db
                )
                # Apply existing rows before inserting newly generated tasks.
                items.sort(
                    key=lambda item: item.source_task_id not in rows_by_source
                )

            for item in items:
                identity = primary_identity(
                    name,
                    item,
                    False,
                    source_maps,
                )

                row = rows_by_source.get(identity)

                if row is None:
                    row = model_from_backup_item(
                        name,
                        item,
                        internal_ids,
                    )

                    db.add(row)
                    db.flush()

                    created[name] += 1

                    source_field = SOURCE_ID_FIELDS.get(
                        name
                    )

                    if source_field is not None:
                        source_id = getattr(
                            row,
                            source_field,
                        )

                        internal_ids[name][source_id] = row.id

                    continue

                values = refresh_values(
                    name,
                    item,
                    internal_ids,
                )

                changed = (
                    name == "tasks" and identity in released_task_ids
                ) or any(
                    getattr(row, attribute) != value
                    for attribute, value in values.items()
                )

                if not changed:
                    unchanged[name] += 1
                    continue

                # Update the existing row in place.
                for attribute, value in values.items():
                    setattr(row, attribute, value)

                db.flush()
                updated[name] += 1

        created_count = sum(created.values())
        updated_count = sum(updated.values())
        unchanged_count = sum(unchanged.values())

        result = BackupRefreshResult(
            format=backup.format,
            version=backup.version,
            exported_at=backup.exported_at,
            app_version=backup.metadata.app_version,
            data_model_version=(
                backup.metadata.data_model_version
            ),
            total_records=(
                created_count
                + updated_count
                + unchanged_count
            ),
            created_count=created_count,
            updated_count=updated_count,
            already_imported_count=unchanged_count,
            created_counts=BackupImportCounts(
                **created
            ),
            updated_counts=BackupImportCounts(
                **updated
            ),
            already_imported_counts=BackupImportCounts(
                **unchanged
            ),
            database_changed=(
                created_count + updated_count > 0
            ),
        )

        db.commit()
        return result

    except IntegrityError as error:
        db.rollback()

        raise BackupImportConflictError(
            {
                "database": [
                    "Refresh would violate a uniqueness "
                    "or relationship constraint. "
                    "No changes were saved."
                ],
            }
        ) from error

    except Exception:
        db.rollback()
        raise
