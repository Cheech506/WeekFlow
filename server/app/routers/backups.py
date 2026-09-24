"""API routes for WeekFlow backup migration tools."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import API_PREFIX
from app.database import get_db
from app.schemas import (
    BackupImportPreviewResult,
    WeekFlowBackupImportRequest,
)
from app.services import preview_backup_import


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