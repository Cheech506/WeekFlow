# WeekFlow API

WeekFlow’s backend uses Python, FastAPI, Pydantic, SQLAlchemy, Psycopg, PostgreSQL, Alembic, and Docker Compose.

The API supports everyday operations for tasks, planning cycles, goals, goal milestones, recurring schedules, and skipped occurrences. It also generates missing recurring tasks transactionally. Complete-backup tools validate, preview, import, and refresh all 13 supported record collections, including recurring schedules and review history.

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

### Recurring schedules and exceptions

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/recurring-rules` | Read schedules, optionally filtered by `goal_id` and `active` |
| `POST` | `/api/v1/recurring-rules` | Create a recurring schedule |
| `GET` | `/api/v1/recurring-rules/{rule_id}` | Read one schedule |
| `PATCH` | `/api/v1/recurring-rules/{rule_id}` | Edit details and goal links, or pause/resume a schedule |
| `DELETE` | `/api/v1/recurring-rules/{rule_id}` | Delete using `stopOnly` or `deleteUnfinished` mode |
| `POST` | `/api/v1/recurring-rules/generate` | Create missing occurrences for one schedule or all schedules |
| `GET` | `/api/v1/recurring-exceptions` | Read skips, optionally filtered by `recurring_rule_id` and `occurrence_date` |
| `POST` | `/api/v1/recurring-exceptions` | Skip an occurrence that has no task; identical retries return the existing skip |
| `GET` | `/api/v1/recurring-exceptions/{rule_id}/{occurrence_date}` | Read one skip by its composite identity |
| `DELETE` | `/api/v1/recurring-exceptions/{rule_id}/{occurrence_date}` | Remove a skip without immediately generating a task |

Schedule writes validate PostgreSQL goal IDs, date order, priority, frequency, and selected weekdays. PATCH validates the supplied changes together with the saved schedule. Omitted fields retain their values; explicit null clears optional goal links, notes, or end dates. Source identities and timestamps cannot be supplied through ordinary writes.

Editing a schedule preserves all existing tasks, including their own goal links and completion history. Frequency changes do not delete or rebuild previously generated tasks. Pausing stops future generation requests from creating occurrences; it does not remove existing tasks. Resuming permits the next generation request to create missing occurrences.

Deleting a schedule defaults to `mode=stopOnly`, which keeps all tasks as standalone tasks. `mode=deleteUnfinished` removes incomplete occurrences, including rescheduled and Inbox tasks, while retaining completed tasks as standalone history. Retained tasks keep their IDs, details, goal links, and completion state; their recurrence identity fields are cleared together. Skip records are removed with the schedule. Weekly commitments and decisions survive deleted tasks through their historical fields and nullable live task links.

A new skip returns `201`; retrying an existing skip returns `200` and preserves its timestamp. A new skip for an occurrence that already has a task returns `409` without changing the task. Delete that occurrence through the Task API when appropriate; task deletion records the skip atomically. Removing a skip makes the occurrence eligible for a later generation request, subject to the schedule's dates, pattern, and active status.

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

## Recurring-task generation

Call `POST /api/v1/recurring-rules/generate` with an explicit user-local calendar date:

```json
{
  "current_date": "2026-10-13",
  "horizon_days": 30
}
```

Omit `recurring_rule_id`, or supply null, to process all schedules. To process one schedule, supply its PostgreSQL ID. A missing selected schedule returns `404`. No schedules, paused schedules, and schedules outside the requested window return a successful summary with no created tasks.

The default horizon is 30 days, meaning today and the following 30 days: up to 31 inclusive dates per daily schedule. Zero checks only the supplied date. The maximum horizon is 366 days. Invalid horizons, dates, identifiers, and windows beyond the supported date range return `422`.

Supported frequencies match the app's existing calendar calculations:

- `daily`: every date in range.
- `weekly`: the start date's weekday.
- `everyTwoWeeks`: every 14 calendar days from the start date, unaffected by daylight-saving changes.
- `certainDays`: selected weekdays using Sunday=0 through Saturday=6.
- `monthly`: the start date's day number, clamped to the last day of shorter months. A January 31 anchor generates on February's last day and returns to March 31.

Generation locks the related tables, checks skip records and native/source occurrence identities, and creates only missing tasks. New tasks copy the schedule's current title, notes, priority, and goal, receive PostgreSQL primary keys, and start incomplete. Imported schedule and goal references remain available as source metadata; generated tasks have no SQLite `source_task_id`.

Existing tasks are preserved exactly, including completed tasks, tasks moved to another due date or Inbox, historical goal links, and legacy source-only occurrences. Repeating a request creates no duplicates. Extending its window creates only additional missing occurrences. Genuine source-identity or database conflicts return `409` and roll back the whole request, including tasks created earlier in the same call.

The result reports `current_date`, `horizon_days`, `window_end`, `rules_checked`, `candidate_count`, `created_count`, `existing_count`, `skipped_count`, `created_task_ids`, and `database_changed`. Candidate totals equal created + existing + skipped. If a skip and historical task share the same occurrence, the candidate counts as skipped and the task remains unchanged.

Generation runs when this endpoint is called. There is no automatic background scheduler or frontend storage switch in this change.

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

Latest reported verification on October 13, 2026: **783 backend tests passed**, and Alembic reported no new upgrade operations.

Coverage includes request validation, model constraints, task relationships, historical goal links, goal completion and deletion, planning cycles, milestones, migration backfills, backup previews, strict imports, refreshes, duplicate protection, recurrence date calculations, schedule and exception APIs, transactional occurrence generation, and rollback behavior.

Backup write, refresh, task relationship, weekly-history write, and recurrence API tests use isolated schemas inside the existing PostgreSQL database. Endpoint commits run within test-owned transactions, and teardown rolls back their data and schema. Schema inspection tests still check the migrated application tables. The FastAPI development server does not need to be running during pytest. A known FastAPI/Starlette deprecation warning may appear even when all tests pass.

Useful focused checks:

```bash
python -m pytest tests/test_task_model.py tests/test_task_relationship_schemas.py tests/test_task_relationships_api.py -q
python -m pytest tests/test_backup_refresh_api.py tests/test_backup_refresh_order.py -q
python -m pytest tests/test_backup_import_write_api.py tests/test_weekly_history_models.py -q
python -m pytest tests/test_recurring_rules_api.py tests/test_recurring_exceptions_api.py -q
python -m pytest tests/test_recurrence_dates.py tests/test_recurrence_generation_api.py -q
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
| `app/routers/` | Task, planning-cycle, goal, milestone, recurrence, and backup HTTP endpoints |
| `app/services/task_import.py` | Task-batch comparison, strict import, and relationship mapping |
| `app/services/backup_import.py` | Complete-backup comparison plan and strict import |
| `app/services/backup_refresh.py` | Transactional create/update refresh with stable PostgreSQL IDs |
| `app/services/recurrence.py` | Calendar occurrence calculations and generation-window limits |
| `app/services/recurrence_generation.py` | Transactional generation with skip, duplicate, and history protection |
| `alembic/versions/` | Versioned database structure changes |
| `tests/` | Backend validation, database, migration, and API tests |
| `../lib/backupMigrationApi.ts` | Frontend clients and response validation for complete import and refresh |
| `../app/server-tasks.tsx` | Task API tools, task preview, confirmed refresh, and server task reads |

## Remaining work

- Add everyday APIs for commitments, weekly reviews and task decisions, cycle reviews and goal outcomes, brain dumps, and task templates. Their models and backup import support already exist.
- Add recurrence-specific actions for task conversion and editing from a selected occurrence before those frontend flows switch to the API.
- Add any agreed extensions to planning-cycle lifecycle behavior or cycle duration.
- Connect frontend features to their PostgreSQL APIs and verify behavior before the final storage switch.
- Add authentication and define any future synchronization or offline behavior.

Successful backup migration verifies a copy of the data in PostgreSQL. It does not complete the frontend storage switch.
