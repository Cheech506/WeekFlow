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
    WeekFlowBackupImportRequest,
)
from app.services import (
    BackupImportConflictError,
    import_backup,
    preview_backup_import,
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