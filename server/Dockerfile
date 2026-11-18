# syntax=docker/dockerfile:1

# Build this image using server/ as the build context.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FORWARDED_ALLOW_IPS=127.0.0.1

WORKDIR /app

# Install dependencies separately so code edits can reuse this build layer.
COPY requirements.txt ./requirements.txt
RUN python -m pip install -r requirements.txt \
    && python -m pip check

# Run the API as an ordinary user. Application files remain owned by root.
RUN groupadd --system --gid 10001 weekflow \
    && useradd --uid 10001 --gid weekflow --create-home \
       --no-log-init --shell /usr/sbin/nologin weekflow

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./alembic.ini

USER 10001:10001

# This documents the internal API port; it does not publish a host port.
EXPOSE 8000

# Process health only. Compose will separately check PostgreSQL readiness
# and finish migrations before starting the API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; response = urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3); assert response.status == 200"]

# Compose supplies database settings and the trusted gateway addresses.
# The same image can run Alembic or owner-setup commands by overriding CMD.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
