# WeekFlow API

WeekFlow’s backend uses Python, FastAPI, SQLAlchemy, Alembic, Psycopg, PostgreSQL, and Docker Compose.

The backend provides health checks and a PostgreSQL-backed Task API. Tasks can be created, read, partially updated, completed, reopened, and deleted.

The app still stores its primary data locally in SQLite. Its Task API tools can read PostgreSQL tasks and preview a migration, but no SQLite task data has been imported into PostgreSQL.

## Requirements

- Python 3.12
- Docker Desktop with Docker Compose

## First-time setup

From the WeekFlow repository root:

```bash
cd server
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Create `server/.env` from the example if you do not already have one:

```bash
cp -n .env.example .env
```

Open `.env` and replace the placeholder password with a private local password. Do not commit `.env`.

All commands below run from the `server` directory.

## Start PostgreSQL and apply migrations

Start the database:

```bash
docker compose up --detach --wait db
```

Create or update its tables using Alembic:

```bash
python -m alembic upgrade head
```

Check which migration the database is using:

```bash
python -m alembic current
```

Check that the SQLAlchemy models and PostgreSQL table structure agree:

```bash
python -m alembic check
```

When they agree, Alembic reports `No new upgrade operations detected.` Alembic manages **table structure**; it does not carry normal task requests between the API and PostgreSQL.

## Start the API

```bash
source .venv/bin/activate
python -m uvicorn app.main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Open `http://127.0.0.1:8000/docs` to try the endpoints in Swagger. Keep the terminal open while using the API; press Control+C to stop it.

Docker Compose starts PostgreSQL, but it does **not** start the FastAPI server.

## Available endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Basic service information |
| `GET` | `/health` | Check that the API process is running |
| `GET` | `/api/v1/info` | Application and API versions |
| `GET` | `/api/v1/database/health` | Check the PostgreSQL connection |
| `POST` | `/api/v1/tasks` | Create a task |
| `GET` | `/api/v1/tasks` | Read all tasks, newest first |
| `GET` | `/api/v1/tasks/{task_id}` | Read one task |
| `PATCH` | `/api/v1/tasks/{task_id}` | Change only the supplied fields |
| `DELETE` | `/api/v1/tasks/{task_id}` | Permanently delete a task |
| `GET` | `/docs` | Interactive API documentation |
| `POST` | `/api/v1/tasks/import` | Safely import a validated batch of SQLite tasks |
| `POST` | `/api/v1/tasks/import/preview` | Preview a SQLite task migration without changing PostgreSQL |
| `POST` | `/api/v1/backups/import/preview` | Preview a complete backup against PostgreSQL without changing data |

Creating a task returns `201 Created`. Successful reads and updates return `200 OK`. Deleting a task returns `204 No Content`, so there is no response body. A missing task returns `404 Not Found`; invalid request data returns `422`.

## How task data moves

For a create request, the flow is:

`JSON request → TaskCreate validation → FastAPI route → SQLAlchemy Task → PostgreSQL → TaskRead → JSON response`

For a PATCH request, `TaskUpdate` validates the supplied fields. Fields left out of the request keep their existing database values. For example, `{"priority": 2}` changes only the priority.

The server calculates `day` from `due_date`; a task without a due date belongs in `Inbox`. It also manages IDs and timestamps. The client does not send those generated values when creating a task.

## SQLite task-import preparation

The PostgreSQL `tasks` table includes nullable migration metadata for existing SQLite tasks:

- `source_task_id`
- `source_goal_id`
- `source_recurring_rule_id`
- `recurrence_occurrence_date`

PostgreSQL continues generating its own permanent task `id`. The source fields preserve the original SQLite identities so later migrations can reconnect goals, recurring schedules, commitments, and other related records.

SQLite source identifiers use `BIGINT` because existing WeekFlow IDs may exceed PostgreSQL’s regular `INTEGER` range. PostgreSQL prevents duplicate source task IDs and duplicate recurring rule/date identities.

The dedicated `POST /api/v1/tasks/import` endpoint accepts task batches in the backup’s camelCase format. Pydantic validates and translates those fields to the server’s snake_case names before the service writes them to PostgreSQL.

The import is transactional and idempotent:

- New source task IDs create PostgreSQL tasks.
- An identical retry returns `unchanged` without creating duplicates.
- An existing source task ID with changed data returns `409 Conflict`.
- If one task conflicts, all new tasks from that request are rolled back.

The application does not call this import endpoint yet, and no real SQLite task data has been imported into PostgreSQL.

## Run backend tests

Start PostgreSQL if needed:

```bash
docker compose up --detach --wait db
```

Then run:

```bash
source .venv/bin/activate
python -m pytest
```

The current suite contains **235 tests** covering API and database health, Tasks, planning cycles, Goals, milestones, recurring schedules, skipped recurring occurrences, request validation, migration metadata, source-ID uniqueness, relationship integrity, and safe deletion behavior. The tests include checks that unknown fields are rejected rather than silently ignored.

The FastAPI development server does not need to be running during pytest. A known FastAPI/Starlette deprecation warning may appear even when all tests pass.

## Stop and restart PostgreSQL

Stop the database without deleting its data:

```bash
docker compose stop db
```

Start it again:

```bash
docker compose start db
```

`docker compose down` removes the container and network but preserves the named database volume. **Do not use `docker compose down -v` unless you intentionally want to delete the stored PostgreSQL data.**

## Configuration and database code

`app/config.py` defines the application name, version, and API prefix. It also loads the `POSTGRES_*` settings from `server/.env`.

`app/database.py` provides the SQLAlchemy engine, session factory, shared model base, FastAPI database-session dependency, and database connection check.

`app/models/task.py` defines the PostgreSQL `tasks` table. `app/schemas/task.py` defines what the API accepts and returns. `app/routers/tasks.py` contains the task endpoints. Alembic migration files in `alembic/versions/` define changes to database structure.

## Current scope

The PostgreSQL database, Alembic migration, SQLAlchemy Task model, request validation, and complete Task CRUD API are working.

The mobile application still uses its existing local SQLite database. Authentication, additional backend models, and mobile-to-server synchronization are future work.