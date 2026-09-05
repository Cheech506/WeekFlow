# WeekFlow API

WeekFlow’s backend uses Python, FastAPI, SQLAlchemy, Psycopg, PostgreSQL,
and Docker Compose.

The backend currently provides service information, health checks, and
a tested PostgreSQL connection. The mobile application still stores its
data locally in SQLite and is not connected to this backend yet.

## Requirements

- Python 3.12
- Docker Desktop
- Docker Compose

## First-time Python setup

From the WeekFlow repository root:

```bash
cd server
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## First-time database setup

Create the private environment file from the provided example:

```bash
cd server
cp .env.example .env
```

Open `.env` and replace the placeholder password with a private local password.

The real `.env` file is ignored by Git. Do not commit it.

Start PostgreSQL:

```bash
docker compose up --detach --wait db
```

Confirm that the container is healthy:

```bash
docker compose ps
```

Test PostgreSQL directly:

```bash
docker compose exec db \
  psql -U weekflow -d weekflow \
  -c "SELECT current_database(), current_user;"
```

## Start the development server

PostgreSQL must be running before testing database-backed routes.

From the WeekFlow repository root:

```bash
cd server
source .venv/bin/activate
python -m uvicorn app.main:app --reload
```

Keep this terminal open while using the API.
Press Control+C to stop the API server.

The `--reload` option restarts the development server when its source files change.

## Available endpoints

| Address | Purpose |
|---|---|
| http://127.0.0.1:8000/ | Basic service information |
| http://127.0.0.1:8000/health | Check that the API process is running |
| http://127.0.0.1:8000/api/v1/info | Application and API versions |
| http://127.0.0.1:8000/api/v1/database/health | Check the PostgreSQL connection |
| http://127.0.0.1:8000/docs | Interactive API documentation |

## Run backend tests

Ensure PostgreSQL is running:

```bash
cd server
docker compose up --detach --wait db
```

Activate the Python environment and run the tests:

```bash
source .venv/bin/activate
python -m pytest
```

The current suite contains five tests covering:

- API process health
- API version information
- Direct Python-to-PostgreSQL communication
- Successful database-health responses
- Safe `503` responses when the database is unavailable

The FastAPI development server does not need to be running during pytest.

## Stop and restart PostgreSQL

Stop the database without deleting its data:

```bash
docker compose stop db
```

Start it again:

```bash
docker compose start db
```

Remove the container and network while preserving the database volume:

```bash
docker compose down
```

Running `docker compose up --detach --wait db` again recreates the container
and reconnects the existing database volume.

## Configuration

Application and database settings are loaded in `app/config.py`.

Application configuration includes:

- `APP_NAME`
- `APP_VERSION`
- `API_VERSION`
- `API_PREFIX`

Database configuration includes:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_HOST`
- `POSTGRES_PORT`

The committed `.env.example` file documents the required database settings.
The ignored `.env` file contains the private local values.

## Database connection layer

`app/database.py` provides:

- A SQLAlchemy database URL
- A shared SQLAlchemy engine
- A database session factory
- A declarative base for future models
- A reusable FastAPI database-session dependency
- A PostgreSQL connection check

## Current scope

The PostgreSQL container and Python connection foundation are working.

Database tables, Alembic migrations, authentication, task API endpoints,
and mobile-to-server communication will be added during later capstone work.