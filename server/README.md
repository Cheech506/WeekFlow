# WeekFlow API

WeekFlow’s backend uses Python, FastAPI, Pydantic, SQLAlchemy, Psycopg, PostgreSQL, Alembic, and Docker Compose.

The API supports everyday operations for tasks, planning cycles, goals, and goal milestones. Complete-backup tools validate, preview, import, and refresh all 13 supported record collections, including recurring schedules and review history.

**Current app storage:** WeekFlow still uses SQLite for everyday activity. The app’s Task API tools screen can read server tasks and copy or refresh the device’s current data into PostgreSQL. Real WeekFlow data has been imported and refreshed successfully. This migration does not switch the main app to PostgreSQL or enable automatic synchronization.

## Requirements

- Python 3.12
- Docker Desktop with Docker Compose
- For the Expo web app: Node.js 22 and the repository’s npm dependencies

## First-time setup

From the WeekFlow repository root:

```bash
cd server
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Create `.env` from the example if you do not already have one:

```bash
cp -n .env.example .env
```

Replace the placeholder password in `server/.env` with a private local password. Do not commit `.env`.

Unless a section says otherwise, the commands below run from the `server` directory.

## Start PostgreSQL and apply migrations

```bash
docker compose up --detach --wait db
source .venv/bin/activate
python -m alembic upgrade head
```

Inspect the applied revision and check that the models agree with the database structure:

```bash
python -m alembic current
python -m alembic check
```

When they agree, Alembic reports `No new upgrade operations detected.` Alembic manages table structure. Backup import and refresh services move application records into those tables.

The migrations include native task foreign keys for goals and recurring schedules. Existing SQLite source IDs are retained as migration references.

## Start the API and Expo web app

In a terminal in `server`:

```bash
source .venv/bin/activate
python -m uvicorn app.main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Open `http://127.0.0.1:8000/docs` for interactive Swagger documentation. `/health` checks the API process; `/api/v1/database/health` checks its PostgreSQL connection.

In a second terminal at the WeekFlow repository root:

```bash
nvm use 22
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 npm run web
```

This address is for a browser on the same computer as the API. The configured browser origins are `http://localhost:8081` and `http://127.0.0.1:8081`; a different frontend origin needs a corresponding CORS configuration change.

Open Settings → Check server tasks to reach Task API tools. Keep both terminals open during a demo. Docker Compose starts PostgreSQL; Uvicorn starts the API; Expo starts the frontend. Press Control+C in a server terminal to stop that process.

## Available endpoints

### Service information

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Basic service information |
| `GET` | `/health` | Check that the API process is running |
| `GET` | `/api/v1/info` | Application and API versions |
| `GET` | `/api/v1/database/health` | Check the PostgreSQL connection |
| `GET` | `/docs` | Interactive API documentation |

### Tasks

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/tasks` | Create a task using PostgreSQL parent IDs |
| `GET` | `/api/v1/tasks` | Read tasks, optionally filtered by `goal_id` and `recurring_rule_id` |
| `GET` | `/api/v1/tasks/{task_id}` | Read one task |
| `PATCH` | `/api/v1/tasks/{task_id}` | Edit supplied fields, including completion and the goal link |
| `DELETE` | `/api/v1/tasks/{task_id}` | Delete a task; record an exception when its recurring schedule can be resolved |
| `POST` | `/api/v1/tasks/import/preview` | Compare SQLite tasks without changing PostgreSQL |
| `POST` | `/api/v1/tasks/import` | Import a validated SQLite task batch with strict conflict handling |

### Planning cycles

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/planning-cycles` | Read current and historical cycles |
| `POST` | `/api/v1/planning-cycles` | Close the previous active cycle and create a new one atomically |
| `GET` | `/api/v1/planning-cycles/current` | Read the active cycle, or return null |
| `GET` | `/api/v1/planning-cycles/{cycle_id}` | Read one cycle |
| `PATCH` | `/api/v1/planning-cycles/{cycle_id}` | Edit the active cycle |
| `DELETE` | `/api/v1/planning-cycles/{cycle_id}` | Delete a cycle only when no protected goals, reviews, or commitments reference it |

Cycle creation currently calculates a 12-week period: `end_date = start_date + 83 days`, including the starting day. Variable-length cycles and further cycle lifecycle operations remain future work.

### Goals and milestones

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/goals` | Read goals, optionally filtered by `cycle_id` |
| `POST` | `/api/v1/goals` | Create a goal |
| `GET` | `/api/v1/goals/{goal_id}` | Read one goal |
| `PATCH` | `/api/v1/goals/{goal_id}` | Edit supplied goal fields |
| `DELETE` | `/api/v1/goals/{goal_id}` | Delete an unreviewed goal while retaining its tasks and schedules |
| `POST` | `/api/v1/goals/{goal_id}/complete` | Complete a goal and save reflections and progress totals |
| `POST` | `/api/v1/goals/{goal_id}/reopen` | Reopen a goal while retaining its last reflections and totals |
| `GET` | `/api/v1/goal-milestones` | Read milestones, optionally filtered by `goal_id` |
| `POST` | `/api/v1/goal-milestones` | Create a milestone |
| `GET` | `/api/v1/goal-milestones/{milestone_id}` | Read one milestone |
| `PATCH` | `/api/v1/goal-milestones/{milestone_id}` | Edit a milestone, including completion |
| `DELETE` | `/api/v1/goal-milestones/{milestone_id}` | Delete a milestone |

Completing a goal saves task and milestone totals without completing unfinished tasks. Reopening retains the saved reflections and totals; completing again recalculates the totals. Goals with completion history cannot be deleted. Deleting an eligible goal removes its milestones and clears the applicable goal links on retained records.

### Complete backups

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/backups/import/preview` | Validate and compare a complete backup without changing data |
| `POST` | `/api/v1/backups/import` | Import new records and reject changed existing records |
| `POST` | `/api/v1/backups/import/refresh` | Create new records and update matching records from the backup |

Successful creates return `201`, reads and updates normally return `200`, and deletes return `204` without a response body. Missing records return `404`, invalid requests return `422`, and conflicting writes return `409`.

## How task requests work

`JSON request → Pydantic validation → FastAPI route → SQLAlchemy session → Psycopg → PostgreSQL → response schema → JSON response`

Pydantic checks the request’s fields and types. The route applies application rules and adds or edits a SQLAlchemy model in a database session. SQLAlchemy prepares SQL and bound values; Psycopg sends them to PostgreSQL. A commit saves the transaction, while a rollback undoes its writes. Response schemas describe the data returned to the client.

The server calculates `day` from `due_date`; a task without a due date belongs in `Inbox`. PostgreSQL generates task IDs, and the server manages completion timestamps. Ordinary creates and updates reject the `source_*` migration fields.

For PATCH requests, omitted fields retain their current values. For example, `{"priority": 2}` changes only the priority, while `{"goal_id": null}` explicitly unlinks the goal.

## Native task relationships and history

- `Task.id` is the PostgreSQL primary key. `goal_id` and `recurring_rule_id` reference PostgreSQL goals and schedules.
- `source_task_id`, `source_goal_id`, and `source_recurring_rule_id` preserve the original SQLite identities for migration matching. They use `BIGINT` because SQLite IDs may exceed PostgreSQL’s regular `INTEGER` range.
- Imports map source identities to PostgreSQL parent IDs; they do not substitute SQLite IDs for PostgreSQL primary keys.
- Creating a recurring task requires both `recurring_rule_id` and `recurrence_occurrence_date`. The occurrence inherits the schedule’s goal only at creation unless a goal, including explicit null, is supplied.
- Each occurrence keeps its own goal link. Changing a schedule’s goal does not retroactively reassign older task occurrences.
- Changing a task’s due date preserves its original occurrence date. Ordinary PATCH requests cannot rewrite the recurring identity.
- Unique constraints protect both source and native schedule/date identities from duplicate occurrences.
- Deleting a recurring task records a skipped occurrence when its schedule exists. Creating that skipped occurrence again returns `409`.
- A referenced recurring schedule cannot be deleted directly until its retained tasks are explicitly detached. Deleting an eligible goal keeps its tasks and clears their applicable goal links.

Native relationships are authoritative when present. Legacy source-only imports remain supported, and import retries can fill missing native task links after their parents become available.

## Strict imports, previews, and refreshes

All complete-backup endpoints accept validated WeekFlow version 12 backups. The 13 supported collections are tasks, goals, goal milestones, brain dumps, task templates, recurring rules, recurring exceptions, planning cycles, weekly reviews, weekly commitments, weekly task decisions, cycle reviews, and cycle goal outcomes.

### Preview

Preview endpoints compare incoming data with stored records and report new, matching, and conflicting records. They do not import, update, or delete anything. A task preview covers tasks; the complete-backup preview covers all 13 collections.

A changed completion status can appear as a preview conflict because the stored and incoming values differ. This does not by itself mean the data is invalid. A refresh can apply changed values, while duplicate occurrences and invalid relationships still need correction.

### Strict import

The task-batch and complete-backup import endpoints create records with new source identities. An identical retry reports them as already imported. Changed records with the same source identities return `409`; the request is rolled back rather than partially imported.

The complete import inserts parents before children and maps their PostgreSQL foreign keys. It can also repair missing task relationships on otherwise matching records without replacing populated native task links.

### Refresh from this device

The Task API tools screen’s **Import and update from this device** action builds a complete backup from the device’s current SQLite data and calls `/api/v1/backups/import/refresh` after confirmation.

The backup is authoritative for matching records in this operation:

- New source identities create new records.
- Changed matching records are updated in place, including completion state and supported relationships.
- Existing PostgreSQL primary keys are preserved.
- PostgreSQL records absent from the backup are retained.
- SQLite records are not changed or deleted.
- Repeating an identical refresh creates and updates nothing.
- Any invalid relationship or remaining uniqueness conflict rolls back the entire refresh.

Recurring identity changes release old occurrence keys and update existing tasks before new occurrences are inserted, within the same transaction. This handles a moved or replaced occurrence even when the backup lists its replacement first. It does not disable duplicate protection or delete conflicting tasks.

The response reports created, updated, and unchanged counts, both overall and by collection. `already_imported_count` is displayed as **Unchanged** for refresh results. A full-backup record count includes the other collections and is therefore larger than the task count alone.

## Run checks

Start PostgreSQL and apply migrations if needed, then run from `server`:

```bash
source .venv/bin/activate
python -m alembic check
python -m pytest -q
```

Latest reported verification on October 12, 2026: **594 backend tests passed**, and Alembic reported no new upgrade operations.

Coverage includes request validation, model constraints, task relationships, historical goal links, goal completion and deletion, planning cycles, milestones, migration backfills, backup previews, strict imports, refreshes, duplicate protection, and rollback behavior.

Backup write, refresh, task relationship, and weekly-history write tests use isolated schemas inside the existing PostgreSQL database. Endpoint commits run within test-owned transactions, and teardown rolls back their data and schema. Schema inspection tests still check the migrated application tables. The FastAPI development server does not need to be running during pytest. A known FastAPI/Starlette deprecation warning may appear even when all tests pass.

Useful focused checks:

```bash
python -m pytest tests/test_task_model.py tests/test_task_relationship_schemas.py tests/test_task_relationships_api.py -q
python -m pytest tests/test_backup_refresh_api.py tests/test_backup_refresh_order.py -q
python -m pytest tests/test_backup_import_write_api.py tests/test_weekly_history_models.py -q
```

For frontend type checking, run from the WeekFlow repository root:

```bash
npx tsc --noEmit
```

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

## Code layout

| Location | Responsibility |
|---|---|
| `app/main.py` | FastAPI application, router registration, CORS, and health endpoints |
| `app/config.py` | Application settings and `POSTGRES_*` environment configuration |
| `app/database.py` | SQLAlchemy engine, sessions, shared model base, and connection check |
| `app/models/` | PostgreSQL table definitions and relationships |
| `app/schemas/` | Pydantic request, response, and backup validation |
| `app/routers/` | Task, planning-cycle, goal, milestone, and backup HTTP endpoints |
| `app/services/task_import.py` | Task-batch comparison, strict import, and relationship mapping |
| `app/services/backup_import.py` | Complete-backup comparison plan and strict import |
| `app/services/backup_refresh.py` | Transactional create/update refresh with stable PostgreSQL IDs |
| `alembic/versions/` | Versioned database structure changes |
| `tests/` | Backend validation, database, migration, and API tests |
| `../lib/backupMigrationApi.ts` | Frontend clients and response validation for complete import and refresh |
| `../app/server-tasks.tsx` | Task API tools, task preview, confirmed refresh, and server task reads |

## Remaining work

- Finish planning-cycle lifecycle behavior and any agreed changes to cycle duration.
- Add everyday APIs for recurring schedules, exceptions, commitments, reviews, brain dumps, templates, and other remaining features. Their models and backup import support already exist.
- Connect frontend features to their PostgreSQL APIs and verify behavior before the final storage switch.
- Add authentication and define any future synchronization or offline behavior.

Successful backup migration verifies a copy of the data in PostgreSQL. It does not complete the frontend storage switch.
