from fastapi import FastAPI, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from app.routers.tasks import router as tasks_router

from app.config import (
    API_PREFIX,
    API_VERSION,
    APP_NAME,
    APP_VERSION,
    POSTGRES_DB,
)
from app.database import check_database_connection

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Self-hosted API backend for WeekFlow.",
)

# Attach the task endpoints to the main FastAPI application.
app.include_router(tasks_router)


@app.get("/")
def root():
    """Return basic information confirming the WeekFlow API is running."""
    return {
        "service": APP_NAME,
        "version": APP_VERSION,
        "apiVersion": API_VERSION,
        "message": "WeekFlow API is running",
    }

@app.get("/health")
def health_check():
    """Confirm that the WeekFlow API process is running."""

    return {
        "status": "ok",
        "service": APP_NAME,
    }

@app.get(f"{API_PREFIX}/database/health")
def database_health():
    """Confirm that the API can communicate with PostgreSQL."""

    try:
        check_database_connection()
    except SQLAlchemyError as error:
        # 503 means the API is running but a required service is unavailable.
        # We return a safe message instead of exposing database error details.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from error

    return {
        "status": "ok",
        "database": POSTGRES_DB,
    }

@app.get(f"{API_PREFIX}/info")
def api_info():
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "apiVersion": API_VERSION,
    }