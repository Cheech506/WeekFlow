"""Configuration values for the WeekFlow API."""

import os
from pathlib import Path

from dotenv import load_dotenv


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_FILE)


APP_NAME = "WeekFlow API"
APP_VERSION = "0.1.0"
API_VERSION = "v1"
API_PREFIX = f"/api/{API_VERSION}"


POSTGRES_DB = os.getenv("POSTGRES_DB", "weekflow")
POSTGRES_USER = os.getenv("POSTGRES_USER", "weekflow")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))