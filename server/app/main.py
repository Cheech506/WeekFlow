from fastapi import FastAPI

from app.config import API_VERSION, APP_NAME, APP_VERSION


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Self-hosted API backend for WeekFlow.",
)


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
    return {
        "status": "ok",
        "service": APP_NAME,
    }

@app.get("/api/v1/info")
def api_info():
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "apiVersion": API_VERSION,
    }