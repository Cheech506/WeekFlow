"""API routes for WeekFlow backup migration tools."""

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.schemas import (
    BackupImportPreviewResult,
    BackupImportResult,
    BackupRefreshResult,
    WeekFlowBackupImportRequest,
)
from app.services import (
    BackupImportConflictError,
    import_backup,
    preview_backup_import,
    refresh_backup,
)


router = APIRouter(
    prefix=f"{API_PREFIX}/backups",
    tags=["backups"],
)


@router.post(
    "/import/preview",
    response_model=BackupImportPreviewResult,
)
def preview_complete_backup(
    backup: WeekFlowBackupImportRequest,
    db: Session = Depends(get_db),
) -> BackupImportPreviewResult:
    """
    Validate and inventory one complete WeekFlow backup.

    This endpoint never inserts, updates, or deletes database rows.
    """

    return preview_backup_import(
        backup=backup,
        db=db,
    )


@router.post(
    "/import",
    response_model=BackupImportResult,
)
def import_complete_backup(
    backup: WeekFlowBackupImportRequest,
    db: Session = Depends(get_db),
) -> BackupImportResult:
    """Import one complete validated backup in one transaction."""

    try:
        return import_backup(
            backup=backup,
            db=db,
        )

    except BackupImportConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    "The backup conflicts with data already "
                    "stored in PostgreSQL."
                ),
                "conflicts": error.conflict_identities,
            },
        ) from error

def refresh_conflict_message(error: BackupImportConflictError) -> str:
    """Report the failed rule without exposing SQL or backup contents."""

    message = (
        "The backup refresh could not be applied safely. "
        "No changes were saved."
    )

    # The service chains the SQLAlchemy IntegrityError after rollback.
    database_error = getattr(error.__cause__, "orig", None)
    diagnostics = getattr(database_error, "diag", None)
    table_name = getattr(diagnostics, "table_name", None)
    constraint_name = getattr(diagnostics, "constraint_name", None)
    sqlstate = getattr(database_error, "sqlstate", None)

    reasons = {
        "23505": "Another record already uses a value that must be unique.",
        "23503": "A record references a missing parent record.",
        "23514": "A record failed a database validation rule.",
        "23502": "A required field is missing.",
    }
    reason = reasons.get(sqlstate)
    if reason:
        message += f" {reason}"
    if table_name:
        message += f" Table: {table_name}."
    if constraint_name:
        message += f" Rule: {constraint_name}."

    return message


@router.post(
    "/import/refresh",
    response_model=BackupRefreshResult,
)
def refresh_complete_backup(
    backup: WeekFlowBackupImportRequest,
    db: Session = Depends(get_db),
) -> BackupRefreshResult:
    """Refresh imported records while preserving PostgreSQL IDs."""

    try:
        return refresh_backup(
            backup=backup,
            db=db,
        )

    except BackupImportConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": refresh_conflict_message(error),
                "conflicts": error.conflict_identities,
            },
        ) from error
