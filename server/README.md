# WeekFlow API

WeekFlow’s backend uses Python, FastAPI, Pydantic, SQLAlchemy, Psycopg, PostgreSQL, Alembic, and Docker Compose.

The core data API supports tasks, planning cycles, goals, goal milestones, recurring schedules, skipped occurrences, weekly commitments, weekly reviews, weekly task decisions, cycle reviews and their goal outcomes, brain dumps, and task templates. Cycle goal outcomes are saved together with their parent review. It also generates missing recurring tasks transactionally, converts existing tasks into recurring schedules, revises a series from a selected occurrence while preserving earlier and completed task history, and detaches one unfinished occurrence while retaining its task and skipping its old recurring slot. Complete-backup tools export, validate, preview, import, and refresh all 13 supported record collections, including recurring schedules and review history.

**Current app storage:** The main app's six data providers use the Python API and PostgreSQL for everyday records. React contexts hold the loaded records for the screens. SQLite remains for device preferences, legacy migration tools, and deferred offline foundations; it is not an automatic fallback for failed API requests.

**Authentication status:** Owner setup, password login, database-backed sessions, logout, login-attempt limits, and feature API protection are implemented. The frontend account form, session provider, native secure storage, browser cookie/CSRF handling, and authenticated startup boundary are connected. Saved login material is verified with the API before private data providers mount. First-run browser setup/login was confirmed through a shared private HTTPS address. The Settings sign-out control, remaining live phone/lifecycle checks, and full deployment packaging are follow-up work.

## Frontend API clients and integration status

The frontend has typed clients for all 13 domain record collections, recurring task actions, authentication, and the existing migration tools. They live in `lib/api/` at the repository root. Shared transport uses `EXPO_PUBLIC_API_BASE_URL` and receives a verified in-memory session from `AuthContext`. It adds native bearer credentials or CSRF headers for protected browser writes, scopes credentials to the configured HTTPS server, rejects credential overrides, and notifies the provider when that session receives HTTP 401. Feature clients validate request fields, translate camelCase app fields to snake_case API fields, and validate/map responses into UI shapes.

| Client in `../lib/api/` | Responsibility |
|---|---|
| `apiClient.ts` | Shared transport, scoped authentication headers, session rejection, cancellation, timeouts, HTTP errors, and response validation |
| `authApi.ts` | Setup status, first-owner creation, browser/native login, session verification, and logout |
| `taskApi.ts` | Task CRUD, native goal/schedule links, and task response decoding |
| `planningCycleApi.ts` | Cycle CRUD, the current cycle, and shared cycle decoding |
| `goalApi.ts` | Goal CRUD, completion reflections/totals, and reopening |
| `goalMilestoneApi.ts` | Milestone CRUD and completion |
| `recurringRuleApi.ts` | Schedule CRUD, deletion modes, and explicit generation |
| `recurringExceptionApi.ts` | Skips identified by schedule ID and original occurrence date |
| `recurringTaskWorkflowApi.ts` | Task conversion, series editing, and detaching one occurrence |
| `taskTemplateApi.ts` | Template CRUD and independent Inbox tasks created from a template |
| `brainDumpApi.ts` | Note CRUD, archive/restore, and atomic note-to-task conversion |
| `weeklyReviewApi.ts` | Weekly reflections and their frozen initial snapshots |
| `weeklyCommitmentApi.ts` | Standalone promises, live task selections, and linked completion |
| `weeklyTaskDecisionApi.ts` | Atomic task actions with preserved weekly decision history |
| `cycleGoalOutcomeApi.ts` | Read outcome history and validate selections for a review draft |
| `cycleReviewApi.ts` | Whole draft saves, report/detail reads, draft deletion, and finalization |
| `taskMigrationApi.ts` | Existing task-only migration preview |
| `backupMigrationApi.ts` | Complete-backup import and confirmed JSON refresh |
| `backupExportApi.ts` | Request and validate a complete current PostgreSQL JSON backup |

Normal create/PATCH endpoints reject source IDs; normal writes and parent links use native PostgreSQL IDs. Existing source metadata preserves imported identities. A server export assigns stable, positive, JavaScript-safe backup identities in missing source metadata fields for API-created records, without changing PostgreSQL primary keys, user content, links, or timestamps. Type-only imports from storage modules reuse the app's data shapes without executing SQLite queries.

Each client HTTP call sends one request. A provider workflow can make several explicit calls, such as saving a schedule, generating occurrences, and refreshing lists. The transport does not automatically retry writes, fall back to SQLite, or upload an outbox. A lost write response can mean PostgreSQL committed successfully; `ApiError.mutationMayHaveSucceeded` distinguishes this uncertainty from an ordinary rejected request. HTTP 409/422 responses remain visible errors.

The connected providers are `TaskContext`, `GoalContext`, `CycleContext`, `BrainDumpContext`, `WeeklyReviewContext`, and `CycleReviewContext`. They serialize their own operations, block overlapping writes to the same record, retain last-loaded data when a read fails, and expose loading, saving, and error state. Screens call context methods; the contexts call the typed clients; FastAPI handles the requests and commits PostgreSQL transactions.

`ApiDataBoundary` wraps navigation inside these providers. It shows initial loading or connection errors before presenting the app, then keeps the screens mounted while showing later request errors and background progress. Its Refresh action reloads data without replaying the failed edit. Task refresh also explicitly generates missing recurring occurrences for a 30-day window using the device's local date. There is no background generation scheduler.

Linked actions refresh affected providers: goal deletion reloads task, schedule, and template goal links; note conversion reloads tasks; weekly task decisions perform one backend action before reloading related state; cycle finalization reloads cycles, goals, weekly data, and reports. The Weekly screen no longer moves a task separately before recording its decision. Screen and milestone controls catch request failures, preserve failed forms, and guard the updated actions against duplicate taps.

Settings displays counts from the API-backed providers. Its Server connection page performs a read-only task check and retains the last successful result if a later check fails. The page no longer offers SQLite migration preview/import/refresh buttons, which could overwrite newer PostgreSQL data with an old device copy.

Settings has **Export JSON** and **Import JSON** buttons directly in its Backups section. Export requests the complete current PostgreSQL data, then starts a browser download on web or opens the phone's native share sheet. On a phone, save or share the file before dismissing the sheet to keep a copy. Import reads a selected WeekFlow JSON file, validates it locally, displays its export date and all collection counts, and requires explicit confirmation before updating PostgreSQL. Supported older device JSON backups are normalized to the current format; repaired missing goal links are disclosed before confirmation. Raw database files are not accepted. Device-level celebration preferences remain local and are not part of the server JSON export.

The confirmed import creates new records and updates matching backup identities, including completion status. Existing PostgreSQL primary keys and server records absent from the file are retained. It is a merge/update import, not a full replacement restore. An older backup can overwrite newer values on matching records, so review the file date and confirmation before importing.

After a successful import, Settings reloads all six providers and shows created, updated, and unchanged counts. Task reload also performs normal missing-occurrence generation. A failed reload does not repeat the acknowledged import. If the import result is uncertain after a lost connection, another import is blocked until the user reloads and explicitly acknowledges checking the server data; reloading itself does not establish whether the earlier import committed. Backup requests and imports are never automatically retried.

Task-sync database, cache, outbox, and backend tracking-table foundations exist, but offline upload and reconciliation remain deferred. They do not provide a sync endpoint, an active upload queue, or an API/SQLite runtime switch.

## Requirements

- Python 3.12
- Docker Engine or Docker Desktop with Docker Compose
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

Authentication adds three migrations: `a8e24d7b931c` creates accounts and sessions, `c91f2e6a4b70` creates first-run setup-code state, and `d7a4c92e6b13` creates shared login-attempt counters. The latest revision is `d7a4c92e6b13`. These migrations do not create an owner or a default password. Their downgrades refuse to discard stored authentication state.

## Owner setup and authentication

Each installation has one owner account and can have separate sessions on several devices. All application records belong to that installation; this is not a multi-user tenancy system. Independent installations need separate database/storage configuration. Different HTTP ports alone do not separate their records.

### Create the owner in a terminal

After applying migrations, run on the server:

```bash
python -m app.create_owner
```

The command prompts for the username, password, and password confirmation, with hidden password input. It requires an interactive terminal and refuses password arguments or piped input. Usernames are normalized to lowercase ASCII, are 3–64 characters, start with a letter or number, and otherwise permit letters, numbers, dots, underscores, and hyphens. New passwords are 15–128 characters; Unicode and spaces are preserved, and an all-whitespace password is rejected. Passwords are stored as salted Argon2id hashes through `pwdlib`, never as plaintext.

An existing owner, including an inactive owner, is never replaced or reactivated by setup. Creating the owner does not log in a device; login creates a separate session.

### Create the owner through the HTTPS setup endpoint

For first-run setup through a client, obtain the one-time code in an interactive server terminal:

```bash
python -m app.issue_setup_code
```

The raw code is displayed locally after its database transaction succeeds. Only its hash is stored. It expires after 30 minutes; five incorrect code attempts cause a five-minute block. An active code is not silently replaced. If its raw value was lost, explicit local rotation invalidates it:

```bash
python -m app.issue_setup_code --rotate
```

The client submits `setup_code`, `username`, and `password` to `POST /api/v1/auth/setup` over HTTPS. Owner creation and code consumption commit together. Setup closes once the owner exists. There is no HTTP endpoint to issue or rotate codes. The first-run frontend form is implemented. Automatic container-start issuance remains future work; an operator currently issues the code in a trusted server terminal.

Use either the terminal owner command or the one-time-code workflow for a new installation. Neither workflow replaces an existing owner.

### Login and session behavior

Browser and native login endpoints accept only `username` and `password`. Login accepts an existing password of 1–128 characters rather than applying the creation minimum again. Passwords are not trimmed or lowercased. Client type and session deadlines are selected by the server.

- Browser login sets the `__Host-weekflow_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`, with no Domain attribute. Its JSON response contains safe session information and a separate CSRF token, not the session token.
- Phone/native login returns the session token and `token_type: "Bearer"` in its HTTPS JSON response. The frontend saves it with Expo SecureStore and sends it in `Authorization: Bearer <token>`. Native routes reject browser session cookies and browser provenance headers.
- PostgreSQL stores only hashes of session and CSRF tokens. The session UUID identifies a record and is not a login credential.
- The initial session lifetime is eight hours, with a 30-minute inactivity timeout. Valid use updates activity without extending the absolute deadline. Revoked sessions, inactive accounts, wrong client types, and sessions predating a password-change timestamp are rejected.
- Browser requests that change protected data require the matching token in `X-CSRF-Token`. The server compares it against that session's stored hash. Mixing cookie and bearer credentials is rejected.
- Logout revokes only the presented session. Browser logout clears its cookie; a native client must erase its saved token too. Other devices stay logged in.

The login-limit service reserves capacity in PostgreSQL before checking a password. Each source has five reservations per 60-second fixed window, and the installation has 20 per five-minute fixed window. Correct passwords, wrong passwords, and abandoned reservations all consume capacity. A rejected request does not extend the window. A fixed-window boundary can permit a burst across adjacent windows; these are not exact rolling-window limits. A blocked login returns `429` with `Retry-After`. Counters are shared across workers and survive process restarts. The source comes from the server's trusted client address, not request JSON or manually parsed untrusted forwarded headers.

### Access rules and transport

`main.py` registers login and setup separately, then attaches all feature routers to `protected_api` with `Depends(require_authenticated_session)`. Database diagnostics and the documentation pages/schema use the same guard. `/` and `/health` remain public basic diagnostics. Setup and login have their own HTTPS, input, origin, credential, and attempt checks; session checking and logout still verify credentials internally.

Authentication and protected requests require HTTPS. Browser pages and the API must share an HTTPS origin: scheme, hostname, and port. CORS configuration does not override the authentication origin rules. Browser credentials use cookies; native credentials use bearer headers. The dependency enforces CSRF for unsafe browser methods. A logout does not cancel a request that already passed authentication and is executing business work.

API responses carry `Cache-Control: no-store` and other privacy headers. Authentication errors use fixed messages rather than returning raw validation inputs or credential-bearing exceptions. A `401` means the session is unavailable or invalid; `403` can indicate HTTPS, origin, or CSRF rejection; `429` means login capacity is exhausted; `503` means authentication/storage could not be confirmed. A connection loss during a commit can leave an uncertain outcome, so writes are not automatically retried.

Keep the API behind the intended private HTTPS gateway and configure its proxy trust explicitly. Tailscale network access and application authentication are separate layers. PostgreSQL is published on loopback in the supplied Compose configuration. The Compose file starts the database only; it does not deploy a complete frontend/API stack.

## Start the API and Expo web app

Start Uvicorn in a terminal in `server`, with a private HTTPS reverse proxy forwarding to its loopback listener:

```bash
source .venv/bin/activate
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --proxy-headers --forwarded-allow-ips 127.0.0.1
```

This example trusts forwarded scheme/client information only from a proxy connecting on IPv4 loopback. Use the actual trusted proxy address for another deployment. The router does not accept an arbitrary client-supplied `X-Forwarded-Proto` as proof of HTTPS. Do not use wildcard proxy trust for an exposed listener.

`http://127.0.0.1:8000/health` remains a local process check. Protected API routes and authentication reject plain HTTP. `/docs`, `/redoc`, and `/openapi.json` require a valid session and are not public login pages. A browser session must also satisfy same-origin checks; opening a protected page without the required session/provenance can return `401` or `403`.

At the WeekFlow repository root, configure the API's real private HTTPS address in `.env.local`, for example:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://your-private-weekflow-host
```

Replace the example host with your own reachable HTTPS address. `EXPO_PUBLIC_*` values are bundled client configuration, not secret storage; never place passwords or session tokens there. The current frontend uses its configured API address; automatic web-origin selection and a native server-address setup screen are still follow-up work. On a phone, `127.0.0.1` refers to that phone, not the API computer. An Expo tunnel delivers the frontend bundle and does not tunnel the Python API. Each device must be able to reach and resolve the chosen API address.

Start the existing frontend development server from the repository root:

```bash
nvm use 22
npm run web
```

Reload the frontend bundle after changing its configured API address. For this development setup, restart Expo when changing `.env.local`. Browser pages and the API must share the same HTTPS scheme, hostname, and port. Opening `http://localhost:8081` while the API uses a private HTTPS hostname intentionally shows a configuration error. Retained development CORS entries do not override the authentication origin rules.

For the tested private development arrangement, run Expo on port 8081 and Uvicorn on IPv4 loopback port 8000, then configure Tailscale Serve in another terminal. On macOS:

```bash
WF_TAILSCALE=/Applications/Tailscale.app/Contents/MacOS/Tailscale
"$WF_TAILSCALE" serve --bg --set-path=/api/ http://127.0.0.1:8000/api
"$WF_TAILSCALE" serve --bg --set-path=/health http://127.0.0.1:8000/health
"$WF_TAILSCALE" serve --bg http://127.0.0.1:8081
"$WF_TAILSCALE" serve status
```

On Linux, use `WF_TAILSCALE=tailscale` when the CLI is on PATH. These commands update this node's root, API, and health routes; inspect existing routes first if the node hosts other services. Serve removes its mount prefix, so the API target includes `/api` to preserve FastAPI's `/api/v1/...` paths. Open the HTTPS hostname printed by Serve and configure that same origin in `.env.local`. The commands above leave documentation paths on the frontend route; forward `/docs`, `/redoc`, and `/openapi.json` separately when using those protected backend pages.

Tailscale is the currently tested private access method, not a requirement embedded in authentication. Other deployments can provide the same HTTPS frontend/API origin through a correctly configured reverse proxy such as Caddy. A packaged non-Tailscale deployment is not yet supplied. Plain HTTP is rejected by the current authentication flow.

For first-run browser setup, issue the code with `python -m app.issue_setup_code` in a separate interactive server terminal, refresh the HTTPS account page, and select **Check setup again** if needed. Enter the code, username, password, and confirmation; account creation then leads to sign-in. The code is not printed through a web endpoint or included in application backups.

Keep the database, API, HTTPS gateway, and frontend available during an end-to-end check. Docker Compose starts PostgreSQL; Uvicorn starts the API; Expo starts the frontend. Press Control+C to stop the foreground process. In tmux, detach with Control+B, release both keys, then D. Detaching preserves a running process, but tmux does not restart a crashed service or keep the computer awake.

## Available endpoints

All domain endpoints listed below require a verified login session. Browser writes also require the matching CSRF header. Endpoint bodies and business rules remain as described; authentication is a shared prerequisite.

### Authentication and setup

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/auth/setup/status` | Read non-secret owner/setup readiness |
| `POST` | `/api/v1/auth/setup` | Create the owner using a locally issued one-time code |
| `POST` | `/api/v1/auth/web/login` | Log in a browser; set the HttpOnly cookie and return its CSRF token |
| `POST` | `/api/v1/auth/native/login` | Log in a native client and return its bearer token |
| `GET` | `/api/v1/auth/session` | Read the current verified session identity |
| `POST` | `/api/v1/auth/logout` | Revoke the current session; no request body |

### Service information

| Method | Path | Access and purpose |
|---|---|---|
| `GET` | `/` | Public basic service information |
| `GET` | `/health` | Public API process check |
| `GET` | `/api/v1/info` | Authenticated application and API versions |
| `GET` | `/api/v1/database/health` | Authenticated PostgreSQL connection check |
| `GET` | `/docs` | Authenticated Swagger UI |
| `GET` | `/redoc` | Authenticated ReDoc |
| `GET` | `/openapi.json` | Authenticated OpenAPI schema |

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

Cycle creation currently calculates a 12-week period: `end_date = start_date + 83 days`, including the starting day. The cycle review finalization endpoint closes the current cycle and starts its successor transactionally. Variable-length cycles remain an optional future extension.

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

Ordinary schedule PATCH preserves all existing tasks, including their own goal links and completion history. Frequency changes through PATCH do not delete or rebuild previously generated tasks. The separate series-edit action below explicitly rebuilds later unfinished occurrences. Pausing stops future generation requests from creating occurrences; it does not remove existing tasks. Resuming permits the next generation request to create missing occurrences.

Deleting a schedule defaults to `mode=stopOnly`, which keeps all tasks as standalone tasks. `mode=deleteUnfinished` removes incomplete occurrences, including rescheduled and Inbox tasks, while retaining completed tasks as standalone history. Retained tasks keep their IDs, details, goal links, and completion state; their recurrence identity fields are cleared together. Skip records are removed with the schedule. Weekly commitments and decisions survive deleted tasks through their historical fields and nullable live task links.

A new skip returns `201`; retrying an existing skip returns `200` and preserves its timestamp. A new skip for an occurrence that already has a task returns `409` without changing the task. Delete that occurrence through the Task API when appropriate; task deletion records the skip atomically. Removing a skip makes the occurrence eligible for a later generation request, subject to the schedule's dates, pattern, and active status.

### Recurring task actions

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/tasks/{task_id}/convert-to-recurring` | Convert an existing unfinished standalone task into a schedule's first occurrence and generate upcoming tasks |
| `POST` | `/api/v1/tasks/{task_id}/edit-recurring-from-occurrence` | Revise a series from the selected original occurrence date and rebuild later unfinished tasks |
| `POST` | `/api/v1/tasks/{task_id}/detach-recurring` | Keep one unfinished occurrence as a standalone task and skip its old recurring slot atomically |
| `POST` | `/api/v1/recurring-rules/{rule_id}/edit-series` | Edit a saved schedule and rebuild its unfinished occurrences from today forward |

Conversion and series editing use the selected task's native PostgreSQL ID. Their requests supply the device's local `current_date` and may set `horizon_days` from 0 to 366, defaulting to 30. The inclusive generation window follows the same rules as the generation endpoint. These actions generate only for their own schedule. They do not start background generation; the app calls them through its API-backed task provider.

**Edit a saved schedule.** The recurring schedule editor calls `POST /api/v1/recurring-rules/{rule_id}/edit-series` with the full schedule details, `start_date`, local `current_date`, and optional generation horizon. Unlike ordinary PATCH, this action updates earlier unfinished tasks' details without moving them and rebuilds unfinished occurrences whose original occurrence dates are today or later, including those currently moved to Inbox or beyond the generation horizon. New occurrences are generated only within the requested window. Completed history, schedule IDs, source identities, skip records, and pause state are preserved. Deleted tasks' weekly links become null while their saved history survives. The response contains `rule`, `generation`, `deleted_task_ids`, and `updated_task_ids`.

Schedule editing locks related writes, validates the response, and commits once. Failure rolls back the complete operation. Retrying a confirmed edit can rebuild future tasks with new IDs, so the frontend does not automatically retry this action after an uncertain response.

**Convert an existing task.** Call the conversion endpoint with a complete schedule form, for example:

```json
{
  "title": "Study regularly",
  "notes": "Review the next chapter",
  "priority": 2,
  "goal_id": null,
  "frequency": "weekly",
  "start_date": "2026-10-20",
  "end_date": null,
  "weekdays": [],
  "current_date": "2026-10-20",
  "horizon_days": 30
}
```

The action returns `201`. It creates an active schedule and retains the selected task's PostgreSQL ID, original `source_task_id`, and creation timestamp. The supplied details and goal replace that task's editable details; `start_date` becomes its due date and original recurrence date. The task is linked before generation so the first occurrence is not duplicated. For `certainDays`, the first date must be one of the selected weekdays. A future first date remains saved even when it is outside the generation window. Completed tasks and tasks with an existing native or source recurring identity return `409`. Retrying a successful conversion returns `409` without creating a second schedule.

**Edit from a selected occurrence.** Call the series-edit endpoint with the full editable form and window:

```json
{
  "title": "Study on Tuesdays and Thursdays",
  "notes": null,
  "priority": 1,
  "goal_id": null,
  "frequency": "certainDays",
  "end_date": null,
  "weekdays": [2, 4],
  "current_date": "2026-10-20",
  "horizon_days": 30
}
```

The action returns `200`. This is a complete form, not a partial PATCH: omitted optional notes, goal, and end date clear those values; omitted priority defaults to zero. Do not supply `start_date` or `active`. The saved task's original `recurrence_occurrence_date` becomes the schedule's new anchor, even when its editable due date differs or it was moved to Inbox. An end date before that original date returns `422`.

The selected task keeps its ID, source task ID, creation timestamp, due date, and Inbox/scheduled state while receiving the revised title, notes, priority, and goal. The schedule retains its own PostgreSQL ID, source identity, and creation timestamp. Paused schedules remain paused. Source-only selected occurrences can resolve their imported schedule and gain a native link; other historical tasks are not rewritten.

Earlier unfinished tasks and all completed tasks retain their details and individual goal links. Only later unfinished occurrences of the selected schedule are deleted, using original occurrence dates rather than moved due dates. This includes later tasks moved to Inbox or outside the generation window. Revised occurrences are generated within the requested window; dates beyond it can be generated later. A selected task may remain on a date outside its revised weekday pattern, while new tasks follow that pattern.

Existing skips are retained. A selected occurrence that is itself marked skipped returns `409`; the action does not silently remove the skip. Native rule links take precedence over stale source metadata when selecting tasks to rebuild. Deleted tasks' weekly commitments and decision records retain their saved history with live task links cleared; those links are not reassigned to generated replacement tasks.

Conversion and series-edit responses contain `task`, `rule`, `generation`, and `deleted_task_ids`. Generation counts describe only generation: the retained selected task is not newly created, and `generation.database_changed` can be false even when the workflow edited a task or schedule. Conversion returns an empty deletion list. Repeating a successful series edit can rebuild later unfinished tasks again with fresh IDs; it is not an idempotent retry operation.

Conversion and series editing commit once after schedule edits, selected-task changes, deletions, generation, and response validation succeed. Missing required records return `404`, invalid values return `422`, and protected states or database conflicts return `409`. A failed operation rolls back its entire transaction. The generation service exposes a helper without its own commit so the workflow controls that transaction; the standalone generation endpoint still commits its own complete operation.

**Detach one occurrence.** Send a bodyless `POST /api/v1/tasks/{task_id}/detach-recurring` using the unfinished task's native ID. The service reads the saved schedule and original occurrence date, creates or reuses that slot's skip, and clears `recurring_rule_id`, `source_recurring_rule_id`, and `recurrence_occurrence_date` together. It retains the task's PostgreSQL ID, source task ID, goal links, title, notes, priority, creation timestamp, due date or Inbox placement, and weekly history links. Other tasks and the schedule remain unchanged.

Detachment returns the standalone `TaskRead` directly. Completed tasks, already detached tasks, and duplicate logical occurrences return `409`; missing required records return `404`. An existing skip retains its first timestamp. All changes roll back if the task update, skip insertion, response validation, or commit fails. A later generation request skips the detached slot and can continue generating the schedule's other dates. Repeating a successful detach returns `409`, so clients reconcile an uncertain write by reading the task instead of automatically repeating it.

### Weekly commitments

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/weekly-commitments` | Read commitments, optionally filtered by `week_start`, `cycle_id`, `task_id`, and displayed `completed` state |
| `POST` | `/api/v1/weekly-commitments` | Create a standalone promise or select an existing PostgreSQL task for a week |
| `GET` | `/api/v1/weekly-commitments/{commitment_id}` | Read one commitment |
| `PATCH` | `/api/v1/weekly-commitments/{commitment_id}` | Edit a standalone title, or complete/reopen a commitment and its linked task atomically |
| `DELETE` | `/api/v1/weekly-commitments/{commitment_id}` | Delete the commitment while preserving its task and planning cycle |

A commitment belongs to a Monday-based week and may reference a current or historical planning cycle. Standalone commitments require a nonblank title of at most 180 characters. Task-linked commitments accept a native `task_id` and copy the task's title and completion state; omit `title` when creating one. The linked task must initially have a title that fits the commitment's limit. Selecting the same task for the same week returns `409`; selecting it for different weeks is allowed.

Reads display the linked task's current title, completion status, and completion timestamp. Reopening the task displays a null completion timestamp, even when the commitment's saved snapshot was completed. Reading does not rewrite that saved snapshot. Edit a linked title through the Task API. Commitment PATCH cannot change the week, task link, or cycle link.

Completing or reopening a linked commitment changes its task and that commitment's saved completion fields in one transaction. Repeating completion preserves the existing completion timestamp. Other commitments linked to the same task display its live state. Deleting a task clears the commitment's live link and retains its stored title and completion fields; those fallback values are the saved snapshot and may differ from later direct edits to the task.

### Weekly reviews

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/weekly-reviews` | Read saved reviews, optionally filtered by Monday `week_start` and `cycle_id` |
| `POST` | `/api/v1/weekly-reviews` | Save a week's reflection and its initial statistics snapshot |
| `GET` | `/api/v1/weekly-reviews/{review_id}` | Read one saved review |
| `PATCH` | `/api/v1/weekly-reviews/{review_id}` | Edit written responses or the optional planning-cycle link |
| `DELETE` | `/api/v1/weekly-reviews/{review_id}` | Delete only the review, retaining tasks, commitments, and task decisions |

There is one saved review per Monday-based week, regardless of its cycle link. Creating a second review for that week returns `409`; use PATCH to edit the existing review. Written responses are trimmed, limited to 2,000 characters each, and stored as null when blank. PATCH retains omitted fields and allows explicit null to clear a response or cycle link.

Create requests supply a nested `snapshot` with `completed_count`, `unfinished_count`, `overdue_count`, `completion_rate`, `goals_progressed_count`, `best_day`, `best_day_count`, `archived_brain_dump_count`, `high_priority_completed_count`, and `recurring_completed_count`. The API validates integer ranges, rounded completion rate, count relationships, and best-day consistency. It validates the supplied statistics; it does not independently calculate them from PostgreSQL tasks. Responses expose the persisted values as `snapshot_*` fields.

The first snapshot is frozen. Later task completions, reschedules, deletions, and reflection edits do not recalculate it. Ordinary PATCH requests reject snapshot fields, the week identity, source IDs, and timestamps. Editing supplied fields updates `updated_at` and `reviewed_at`, retaining `created_at`; an empty PATCH changes nothing. These rules apply to the everyday review API; the separate, explicitly requested backup refresh can update matching imported records.

### Weekly task decisions

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/weekly-task-decisions` | Read history, optionally filtered by Monday `week_start`, `task_id`, `recurring_rule_id`, and `action` |
| `POST` | `/api/v1/weekly-task-decisions` | Apply an unfinished-task action and save its history in one transaction |
| `GET` | `/api/v1/weekly-task-decisions/{decision_id}` | Read one saved decision, including history for a deleted task |
| `DELETE` | `/api/v1/weekly-task-decisions/{decision_id}` | Delete only the history record without undoing the task action or its skip |

Send the task's native PostgreSQL ID, the selected Monday, its due date before the action, and one of the five supported actions:

```json
{
  "week_start": "2026-10-12",
  "task_id": 123,
  "original_due_date": "2026-10-14",
  "action": "nextWeek"
}
```

| Action | Task effect | Request date rule |
|---|---|---|
| `nextWeek` | Move the task seven days forward, preserving its weekday | Omit `resolved_due_date`, or supply exactly `original_due_date + 7 days` |
| `inbox` | Clear the due date and set `day` to `Inbox` | No non-null resolved date |
| `reschedule` | Move the task to the selected date | Require `resolved_due_date` |
| `keep` | Retain the task's current schedule | No non-null resolved date |
| `delete` | Delete the task and preserve its decision history | No non-null resolved date |

The original due date must belong to the selected week. All actions, including delete, require the existing task's ID. The server copies its title and recurring identity into the decision record. Completed tasks, inconsistent completion data, blank task titles, and stale scheduled dates return `409` without applying changes. Missing tasks return `404`. Call this endpoint before moving or deleting the task; it performs the task action and history write together.

New decision records return `201`. A decision for the same week, task, and original due date can be updated in place while the task is still scheduled on that original date, preserving its PostgreSQL and imported source IDs. A matching retry while the task remains in the expected resulting state returns `200` with the same decision ID and timestamp. A later conflicting task change causes the retry to return `409`. Retrying after task deletion returns `404` without creating duplicate history.

Moves and Inbox actions preserve the task's goal links, original recurring occurrence identity, and completion fields. Recurring deletion records a skip for the original occurrence date when its schedule can be resolved, preventing generation from recreating that occurrence. The task action, decision write, and skip creation commit or roll back together.

Deleting a task clears live links on older decision and commitment records while retaining their stored history. Decision records preserve recurring identity even if the schedule is later deleted. Deleting decision history does not restore a task, reverse a reschedule, or remove a skip. There is no separate decision PATCH: POST applies an action and, when appropriate, updates its existing history record.

### Cycle reviews and goal outcomes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/cycle-reviews` | Read reports, optionally filtered by native `cycle_id` and `finalized` state |
| `POST` | `/api/v1/cycle-reviews/draft` | Create or replace a complete draft and its selected goal outcomes together |
| `GET` | `/api/v1/cycle-reviews/{review_id}` | Read one review together with its goal outcomes |
| `POST` | `/api/v1/cycle-reviews/{review_id}/finalize` | Apply saved outcomes, close the current cycle, and create its successor atomically |
| `DELETE` | `/api/v1/cycle-reviews/{review_id}` | Delete an unfinished draft and its child selections, retaining goals and tasks |
| `GET` | `/api/v1/cycle-goal-outcomes` | Read outcomes, optionally filtered by `cycle_review_id`, `goal_id`, `destination_goal_id`, and `action` |
| `GET` | `/api/v1/cycle-goal-outcomes/{outcome_id}` | Read one saved selection or historical outcome |

Save a draft with five explicit sections: `cycle_id`, `reflection`, `snapshot`, `next_cycle`, and `outcomes`. Both a new draft and an updated draft return `200`. There is one review per cycle. A draft save replaces all supplied draft content; use `reflection: {}` or `outcomes: []` only when intending to clear that section. The next-cycle plan requires `start_date` and accepts optional `name`, `primary_focus`, `theme`, and `first_week_commitments`.

Reflection fields are optional, trimmed, and limited to 2,000 characters each. Next-cycle name, focus, and theme follow the planning-cycle limits. Up to five first-week commitments are accepted, each at most 180 characters; blank rows are omitted and case-insensitive duplicates are rejected. Goal selections require native `goal_id` values belonging to the reviewed cycle. Completed goals cannot receive an unfinished-goal selection. The server copies each goal's title into its saved outcome; source IDs, destination IDs, historical titles, and timestamps are not accepted as ordinary input.

Draft statistics are supplied by the app and validated for ranges and consistency. They may be refreshed while editing the draft. Saving a draft does not modify goals, tasks, schedules, or cycle state. Retained goal selections keep their PostgreSQL primary keys and imported source IDs; removing a selection from `outcomes` removes that draft selection.

To finalize, call `POST /api/v1/cycle-reviews/{review_id}/finalize` with no required request body after saving the complete draft. Only the current cycle may be finalized. Its proposed successor must start after the reviewed cycle ends, and every currently unfinished goal must have exactly one valid outcome. Missing, deleted, completed, or reassigned goals can make a previously saved selection stale and block finalization with `409`.

| Goal outcome | Finalization behavior |
|---|---|
| `complete` | Complete the original goal and save its current task and milestone totals, retaining written completion reflections and leaving task completion states unchanged |
| `carryForward` | Create a new goal in the successor cycle, copying the original title, reward, purpose, success definition, notes, and milestones |
| `archive` | Keep the original goal unfinished in the closed cycle; retain its data |
| `replace` | Create a new goal with the required `replacement_title` in the successor cycle |

Copied milestones receive new PostgreSQL IDs while retaining their titles, notes, target dates, completion states, and timestamps. New goals and milestone copies do not inherit SQLite source identities. Original tasks and recurring schedules retain their own goal links; carry-forward does not move historical tasks to the new goal.

Finalization closes the old cycle before inserting the new active cycle, preserving the single-active-cycle constraint. It creates the next cycle's first commitments in the Monday-based week containing its start date. It then saves the finalized report and destination goal links, adjusting saved completed-goal and reward totals for goals completed by this operation. The entire transition commits or rolls back together.

The response includes `review`, `outcomes`, `next_cycle`, and `already_finalized`. A successful retry returns the saved result with `already_finalized: true` and creates no duplicate cycles, goals, milestones, or commitments. If finalized imported history has no live successor link, `next_cycle` can be null without creating another cycle. Finalized reports cannot be edited or deleted through these review endpoints. Drafts already linked to successor records are also protected from unsafe replacement or deletion.

Goal outcomes have read endpoints because their writes belong to the draft transaction. Add or change selections by saving the draft; remove one by saving the remaining selections, or remove all with `outcomes: []`. Deleting an unfinished draft cascades its child selections. Saved outcome titles remain readable when an original or destination goal link is later cleared. These ordinary API rules are separate from explicitly requested backup refreshes of imported records.

### Brain dumps

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/brain-dumps` | Read notes, optionally filtered by `archived` |
| `POST` | `/api/v1/brain-dumps` | Create an active note |
| `GET` | `/api/v1/brain-dumps/{brain_dump_id}` | Read one note |
| `PATCH` | `/api/v1/brain-dumps/{brain_dump_id}` | Edit `body`, archive with `archived: true`, or restore with `archived: false` |
| `DELETE` | `/api/v1/brain-dumps/{brain_dump_id}` | Delete only the note |
| `POST` | `/api/v1/brain-dumps/{brain_dump_id}/convert-to-task` | Create an Inbox task and remove the active source note in one transaction |

Notes require nonblank trimmed text and support multiline content without an added short text limit. Reads order notes by creation time, newest first, with the ID as a tie-breaker. PATCH retains omitted fields and rejects explicit null for required text or archive state. IDs, source identities, and timestamps are server-managed.

Text edits retain the original creation time and archive state. Archiving records `archived_at`; repeating the same archive request preserves that timestamp. Restoring clears it. Editing or deleting notes does not recalculate previously saved weekly or cycle report statistics.

Conversion takes the source note ID and requires no request body. It returns `201` with a newly generated, incomplete Inbox task using the trimmed note text as its title. The task has priority zero, no due date or notes, no goal or recurring identity, and no SQLite source identity. The source note is deleted only as part of the successful transaction. Archived notes return `409` until restored. A retry after successful conversion returns `404`, preventing another task from that deleted note. If task insertion, note deletion, or commit fails, the original note remains and no task is saved.

### Task templates

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/task-templates` | Read templates, optionally filtered by native `goal_id` |
| `POST` | `/api/v1/task-templates` | Save reusable task details without creating a live task |
| `GET` | `/api/v1/task-templates/{template_id}` | Read one template |
| `PATCH` | `/api/v1/task-templates/{template_id}` | Edit supplied template details or clear optional notes/goal links |
| `DELETE` | `/api/v1/task-templates/{template_id}` | Delete only the template while preserving previously created tasks |
| `POST` | `/api/v1/task-templates/{template_id}/create-task` | Create a new one-time Inbox task from the current template |

Templates store `title`, optional `notes`, priority from zero through two, and an optional native `goal_id`. Titles are trimmed and must be nonblank; blank notes become null. Text fields use the model's unrestricted text storage. A supplied goal must exist. PATCH retains omitted fields; explicit null clears notes or the goal link, while title and priority cannot be null. Editing retains identity and creation time and updates `updated_at`; an empty PATCH changes nothing. Reads order by update time, newest first, then ID.

Using a template requires no request body and returns `201` with an independent Inbox task. It copies the template's current trimmed title, notes, priority, and goal. The task is incomplete, has no due date or recurring identity, and receives a fresh PostgreSQL ID with no SQLite task source identity. When linked to a goal, the server reads that goal's current source metadata for migration consistency. The template and its timestamps remain unchanged.

Each successful use intentionally creates another task. Editing or deleting a template leaves earlier tasks unchanged. Goal deletion clears the template's goal link, so later tasks can be created unlinked. To customize details before creating a task, read the template into the app's task form and submit the normal Task API request. Templates do not represent recurring schedules.

### Complete backups

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/backups/export` | Export all current server collections as an importable JSON backup |
| `POST` | `/api/v1/backups/import/preview` | Validate and compare a complete backup without changing data |
| `POST` | `/api/v1/backups/import` | Import new records and reject changed existing records |
| `POST` | `/api/v1/backups/import/refresh` | Create new records and update matching records from the backup |

Successful creates return `201`, reads and updates normally return `200`, and deletes return `204` without a response body. Missing records return `404`, invalid requests return `422`, and conflicting writes return `409`.

## How task requests work

`HTTPS request with session credentials → shared authentication dependency → task endpoint → SQLAlchemy/Psycopg → PostgreSQL → response schema → JSON response`

FastAPI uses Pydantic to validate request fields and types. The shared dependency verifies the session before the task endpoint runs; browser mutations also need CSRF protection. The route applies application rules and adds or edits a SQLAlchemy model in a database session. SQLAlchemy prepares SQL and bound values; Psycopg sends them to PostgreSQL. A commit saves the transaction, while a rollback undoes its writes. Response schemas describe the data returned to the client.

The server calculates `day` from `due_date`; a task without a due date belongs in `Inbox`. PostgreSQL generates task IDs, and the server manages completion timestamps. Ordinary creates and updates reject the `source_*` migration fields.

For PATCH requests, omitted fields retain their current values. For example, `{"priority": 2}` changes only the priority, while `{"goal_id": null}` explicitly unlinks the goal.

## Native task relationships and history

- `Task.id` is the PostgreSQL primary key. `goal_id` and `recurring_rule_id` reference PostgreSQL goals and schedules.
- `source_task_id`, `source_goal_id`, and `source_recurring_rule_id` preserve original SQLite identities or portable backup identities for matching across exports/imports. They use `BIGINT` because these identities may exceed PostgreSQL’s regular `INTEGER` range.
- Imports map source identities to PostgreSQL parent IDs; they do not substitute SQLite IDs for PostgreSQL primary keys.
- Creating a recurring task requires both `recurring_rule_id` and `recurrence_occurrence_date`. The occurrence inherits the schedule’s goal only at creation unless a goal, including explicit null, is supplied.
- Each occurrence keeps its own goal link. Ordinary schedule PATCH does not retroactively reassign existing tasks. The explicit series-edit action revises the selected task and later unfinished occurrences while preserving earlier and completed history.
- Changing a task’s due date preserves its original occurrence date. Ordinary PATCH requests cannot rewrite the recurring identity.
- Unique constraints protect both source and native schedule/date identities from duplicate occurrences.
- Deleting a recurring task records a skipped occurrence when its schedule exists. Creating that skipped occurrence again returns `409`.
- Schedule deletion uses the explicit `stopOnly` or `deleteUnfinished` workflow, detaching retained tasks before removing the schedule. Deleting an eligible goal keeps its tasks and clears their applicable goal links.

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

Generation locks the related tables, checks skip records and native/source occurrence identities, and creates only missing tasks. New tasks copy the schedule's current title, notes, priority, and goal, receive PostgreSQL primary keys, and start incomplete. Imported schedule and goal references remain available as source metadata. Newly generated tasks start without a `source_task_id`; a later JSON export may assign a portable backup identity in that field.

Existing tasks are preserved exactly, including completed tasks, tasks moved to another due date or Inbox, historical goal links, and legacy source-only occurrences. Repeating a request creates no duplicates. Extending its window creates only additional missing occurrences. Genuine source-identity or database conflicts return `409` and roll back the whole request, including tasks created earlier in the same call.

The result reports `current_date`, `horizon_days`, `window_end`, `rules_checked`, `candidate_count`, `created_count`, `existing_count`, `skipped_count`, `created_task_ids`, and `database_changed`. Candidate totals equal created + existing + skipped. If a skip and historical task share the same occurrence, the candidate counts as skipped and the task remains unchanged.

Generation runs only when requested. The main task provider requests it on startup, on task refresh, and for relevant schedule actions. There is no automatic background scheduler.

## JSON exports, strict imports, previews, and refreshes

Exports produce WeekFlow version 12 backups. Complete-backup import, preview, and refresh endpoints accept validated version 12 backups. The 13 supported collections are tasks, goals, goal milestones, brain dumps, task templates, recurring rules, recurring exceptions, planning cycles, weekly reviews, weekly commitments, weekly task decisions, cycle reviews, and cycle goal outcomes.

### Export and transfer between instances

`POST /api/v1/backups/export` requires no request body. It returns a validated JSON document with camelCase backup fields, an export timestamp, and all 13 collections. The response includes a suggested `.json` attachment filename and `Cache-Control: no-store`.

The export service locks the collections in one transaction so a concurrent phone or web edit cannot leave the file with mismatched parent/child snapshots. Existing imported identities are retained. Records created through the API receive missing backup identities once, using existing metadata columns. This is a POST action because the first export may save that metadata. PostgreSQL primary keys, content, relationships, and user-facing timestamps remain unchanged. The complete file is validated before the transaction commits; an export failure rolls back metadata assignments too. No schema migration is needed for this action.

To transfer logical app data:

1. Open Settings in the source instance and select **Export JSON**. Save the browser download or save/share the file from the phone's share sheet.
2. Open the destination instance, configured for its own API/database, and select Settings → **Import JSON**.
3. Choose the file, review its date, record counts, and any disclosed repairs, then select **Confirm import and update**.
4. Check the result counts and refreshed data. The importer maps portable identities to destination PostgreSQL IDs; destination primary keys can differ from source primary keys.

Phone and web clients pointing at the same API already share one instance. The JSON file includes application records, not PostgreSQL schema, roles, credentials, internal sync tracking, or device preferences. It excludes accounts, login sessions, setup-code state, and login-attempt counters; a destination installation creates its own owner independently. Importing a JSON file does not delete destination records that are absent from it. Existing uniqueness rules, including one active planning cycle, remain enforced; incompatible data returns a conflict rather than a partial import.

### Preview

Preview endpoints compare incoming data with stored records and report new, matching, and conflicting records. They do not import, update, or delete anything. A task preview covers tasks; the complete-backup preview covers all 13 collections.

A changed completion status can appear as a preview conflict because the stored and incoming values differ. This does not by itself mean the data is invalid. A refresh can apply changed values, while duplicate occurrences and invalid relationships still need correction.

### Strict import

The task-batch and complete-backup import endpoints create records with new source identities. An identical retry reports them as already imported. Changed records with the same source identities return `409`; the request is rolled back rather than partially imported.

The complete import inserts parents before children and maps their PostgreSQL foreign keys. It can also repair missing task relationships on otherwise matching records without replacing populated native task links.

### Confirmed JSON import and refresh

Settings calls `POST /api/v1/backups/import/refresh` only after confirmation of an explicitly selected JSON file. This supports server exports and supported legacy device JSON backups after frontend normalization. The main app does not silently build or upload a SQLite backup from the Server connection page. A stale device backup must not be treated as the current server state.

The backup is authoritative for matching records in this operation:

- New source identities create new records.
- Changed matching records are updated in place, including completion state and supported relationships.
- Existing PostgreSQL primary keys are preserved.
- PostgreSQL records absent from the backup are retained.
- SQLite records are not changed or deleted.
- Repeating an identical refresh creates and updates nothing.
- Any invalid relationship or remaining uniqueness conflict rolls back the entire refresh.

Recurring identity changes release old occurrence keys and update existing tasks before new occurrences are inserted, within the same transaction. This handles a moved or replaced occurrence even when the backup lists its replacement first. It does not disable duplicate protection or delete conflicting tasks.

The response reports created, updated, and unchanged counts, both overall and by collection. `already_imported_count` represents unchanged records in refresh results. A full-backup record count includes the other collections and is therefore larger than the task count alone.

## Run checks

Start PostgreSQL and apply migrations if needed, then run from `server`:

```bash
source .venv/bin/activate
python -m pip check
python -m alembic current
python -m alembic check
python -m pytest -q --tb=short
```

The applied head should be `d7a4c92e6b13`; Alembic should report `No new upgrade operations detected.` On November 8, 2026, all **2,526 backend tests passed**. The verification applied all 17 migration upgrades to a generated private PostgreSQL schema before the full suite, then removed that schema. Read-only checks of the configured database confirmed the applied head and no model drift, and `pip check` passed. This is backend verification, not a live frontend login test.

`tests/conftest.py` supplies an authenticated test identity only for explicitly named legacy business test modules, including those that reuse their shared fixtures. This keeps task, goal, cycle, and backup tests focused on their behavior after authentication. It does not run in the server process. Authentication and assembled-app test modules are excluded from that override and combine HTTP boundary checks with real PostgreSQL login, session, CSRF, logout, task-write, and export flows.

Authentication coverage includes Argon2 hashing and upgrades, strict input/output schemas, one-owner constraints, terminal setup, one-time code expiry and consumption, failed-attempt persistence, concurrent owner claims, token hashing and purpose separation, absolute/idle expiry, account/client checks, CSRF, session revocation, shared login limits, concurrent reservations, protected feature/docs routing, safe errors, cookie flags, and commit uncertainty. The assembled-app suite checks every non-public API operation without credentials and exercises authenticated task and backup requests.

Business coverage includes request validation, model constraints, native task relationships, preserved history, goal completion/deletion, cycles and milestones, migration backfills, backup preview/import/refresh/export, duplicate protection, recurrence calendars and generation, task conversion/detachment/series editing, weekly commitments/reviews/decisions, cycle draft saves/finalization, goal outcomes, brain dumps, templates, and transaction rollback.

Database tests use rollback-owned transactions, temporary tables, or generated private schemas. Concurrent setup and throttle tests commit only their generated private schemas so independent connections can share state, then drop those schemas after workers finish. The FastAPI development server does not need to be running during pytest. The known FastAPI/Starlette `httpx` deprecation warning can appear even when all tests pass.

Useful focused authentication checks:

```bash
python -m pytest tests/test_passwords.py tests/test_accounts.py tests/test_session_tokens.py -q --tb=short
python -m pytest tests/test_auth_models.py tests/test_owner_setup_code_model.py tests/test_auth_login_throttle_model.py -q --tb=short
python -m pytest tests/test_owner_setup_code_migration.py tests/test_auth_login_throttle_migration.py -q --tb=short
python -m pytest tests/test_create_owner.py tests/test_issue_setup_code.py tests/test_owner_setup.py -q --tb=short
python -m pytest tests/test_sessions.py tests/test_login_throttle.py -q --tb=short
python -m pytest tests/test_owner_setup_schemas.py tests/test_auth_schemas.py -q --tb=short
python -m pytest tests/test_owner_setup_api.py tests/test_auth_api.py tests/test_main_auth.py -q --tb=short
```

Useful focused business checks:

```bash
python -m pytest tests/test_task_model.py tests/test_task_relationship_schemas.py tests/test_task_relationships_api.py -q
python -m pytest tests/test_backup_refresh_api.py tests/test_backup_refresh_order.py tests/test_backup_refresh_generated_tasks.py -q
python -m pytest tests/test_backup_import_write_api.py tests/test_weekly_history_models.py -q
python -m pytest tests/test_backup_export_api.py -q
python -m pytest tests/test_recurring_rules_api.py tests/test_recurring_exceptions_api.py -q
python -m pytest tests/test_recurrence_dates.py tests/test_recurrence_generation_api.py -q
python -m pytest tests/test_recurring_task_workflows_api.py tests/test_recurring_task_detach_api.py -q
python -m pytest tests/test_recurring_series_edit_api.py -q
python -m pytest tests/test_weekly_commitments_api.py tests/test_weekly_reviews_api.py tests/test_weekly_task_decisions_api.py -q
python -m pytest tests/test_cycle_reviews_api.py tests/test_brain_dumps_api.py tests/test_task_templates_api.py -q
```

Run the frontend suite and type checker from the repository root when changing client code:

```bash
npm test -- --watchman=false
npx tsc --noEmit
```

The current authentication checkpoint passed **2,151 frontend tests across 74 suites**, plus `npx tsc --noEmit`. Authentication tests cover API contracts, storage isolation, provider state transitions, failed/uncertain requests, expiry, logout cleanup, browser-tab changes, the authentication boundary, and root-layout gating. Tests simulate HTTP/native storage and use disposable SQLite databases for legacy integration cases. The browser first-run setup/login was separately confirmed by the operator through private HTTPS; those results do not establish that all phone, lifecycle, deployment, and dependency-audit checks are complete.

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
| `app/main.py` | Public auth/setup registration, shared feature-session guard, protected docs/diagnostics, CORS, and privacy headers |
| `app/config.py` | Application settings and `POSTGRES_*` environment configuration |
| `app/database.py` | SQLAlchemy engine, sessions, shared model base, and connection check |
| `app/models/` | PostgreSQL table definitions and relationships |
| `app/schemas/` | Pydantic request, response, and backup validation |
| `app/routers/` | Domain/workflow endpoints plus owner setup, browser/native login, session checking, and logout |
| `app/models/account.py`, `auth_session.py`, `owner_setup_code.py`, `auth_login_throttle.py` | Owner credentials, login records, one-time setup state, and shared request counters |
| `app/schemas/auth.py`, `owner_setup.py` | Strict authentication inputs and separate safe/browser/native outputs |
| `app/create_owner.py` | Interactive owner creation with hidden password prompts |
| `app/issue_setup_code.py` | Local one-time setup-code issuance and explicit rotation |
| `app/services/passwords.py` | Argon2 password hashing, verification, and rehash support |
| `app/services/accounts.py` | Username normalization and one-owner account creation |
| `app/services/owner_setup.py` | Atomic code issuance/claiming, expiry/blocking, and first-owner creation |
| `app/services/session_tokens.py` | Random token generation, purpose-separated hashing, and digest verification |
| `app/services/sessions.py` | Password login, committed sessions, activity/expiry/client/CSRF checks, and logout |
| `app/services/login_throttle.py` | Atomic attempt reservations and the throttled login entry point |
| `app/services/task_import.py` | Task-batch comparison, strict import, and relationship mapping |
| `app/services/backup_import.py` | Complete-backup comparison plan and strict import |
| `app/services/backup_refresh.py` | Transactional create/update refresh with stable PostgreSQL IDs |
| `app/services/backup_export.py` | Complete server JSON snapshot, portable backup identities, and export validation |
| `app/services/recurrence.py` | Calendar occurrence calculations and generation-window limits |
| `app/services/recurrence_generation.py` | Standalone generation and a caller-owned transaction helper, with skip, duplicate, and history protection |
| `app/services/recurring_task_workflows.py` | Atomic task conversion, series edits, and occurrence detachment with skip/history preservation |
| `app/services/recurring_series_edit.py` | Transactional saved-schedule editing with earlier-task updates and future unfinished rebuilding |
| `app/services/cycle_reviews.py` | Atomic draft saves and finalization, goal outcomes, successor cycles, and first commitments |
| `alembic/versions/` | Versioned database structure changes |
| `tests/` | Backend business, authentication, migration, concurrency, and assembled-app protection tests |
| `../lib/api/` | Shared HTTP transport, feature clients, and migration clients with runtime response validation |
| `../lib/taskSync*.ts` | Deferred offline cache, outbox, database, and type foundations |
| `app/models/task_sync.py` | Persistent server identity, client-task mappings, and sync receipt table definitions |
| `../context/` | API-backed domain providers and device-level celebration preferences |
| `../context/AuthContext.tsx` | Account/session state machine, server verification, login/setup/logout actions, expiry, and transport configuration |
| `../lib/authSessionStorage.ts` | Server-scoped SecureStore bearer material and browser CSRF/session metadata |
| `../components/AuthScreen.tsx` | Account setup/login form, safe errors, password masking, and submission guards |
| `../components/AuthBoundary.tsx` | Account screen before verification; private provider tree after authentication |
| `../app/_layout.tsx` | Fonts/theme, authentication provider/boundary, and private data/navigation composition |
| `../components/ApiDataBoundary.tsx` | Initial API loading/error display and later refresh/error notices around navigation |
| `../app/server-tasks.tsx` | Read-only server connection and task check |
| `../app/settings.tsx` | API-backed inventory, data refresh, device preferences, web/native JSON export, and confirmed JSON import |

## Authentication walkthrough

Use this order when explaining the implementation or reviewing the files together:

1. **`app/_layout.tsx` arranges the app.** It loads fonts, supplies the theme, mounts `AuthProvider`, and places `AuthBoundary` above the six data providers. `AuthenticatedApp` contains the private provider/navigation tree.
2. **`AuthContext.tsx` decides the current account state.** It checks setup status and moves between `checking`, `setup`, `login`, `authenticated`, and `error`. It holds safe identity/status for screens and keeps credential material outside the public context value.
3. **`AuthBoundary.tsx` controls what mounts.** Setup/login/error states render `AuthScreen`. Only an authenticated state with a verified identity mounts the private app. Logout or expiry removes that tree. A replacement session gets a fresh tree so old private screen/context state does not carry across.
4. **`AuthScreen.tsx` collects the form.** It calls the provider actions rather than handling database access. It masks passwords, checks confirmation, blocks repeated taps, and clears submitted secrets. It does not persist passwords or decide whether login credentials are valid.
5. **`authApi.ts` speaks the authentication HTTP contract.** It picks the browser/native route, sends only supported fields, and validates safe response shapes. `apiClient.ts` supplies shared request/error/cancellation behavior. Authentication endpoints use their explicit transport; protected feature requests use the provider's verified session.
6. **The Python router receives the request.** Pydantic schemas validate request fields. The router selects the service, checks transport/origin requirements, and returns an allowed response. `main.py` registers public setup/login separately and places feature endpoints behind the shared session dependency.
7. **Services perform the account/session work.** `passwords.py` hashes/verifies passwords with Argon2id. `login_throttle.py` reserves attempt capacity in PostgreSQL. `sessions.py` checks credentials, creates/revokes sessions, and enforces client type, expiry, inactivity, and browser CSRF. `owner_setup.py` consumes the one-time setup code atomically with first-owner creation.
8. **Models describe the stored tables.** PostgreSQL holds the owner, password hash, session-token/CSRF hashes, setup-code state, and shared attempt counters. A session UUID identifies a row; the separate random session token is the credential. Alembic migrations create/version those tables. Replacing a Python file alone does not change existing database structure.
9. **The client restores a login carefully.** Phone bearer tokens are kept in SecureStore. The browser's session token remains in an HttpOnly cookie; localStorage holds the separate CSRF value, session reference, and deadline. Entries are scoped to the server address. On startup, the provider checks the saved material with Python and matches the session ID before opening the app.
10. **Every protected request is checked again by Python.** The frontend boundary controls display and lifecycle. The backend session dependency authorizes access even if someone skips the normal UI and calls an endpoint directly. After authentication, domain API requests follow the existing router → service/model → SQLAlchemy → PostgreSQL flow. `ApiDataBoundary` then handles ordinary data loading/errors.

For a presentation: **“WeekFlow uses a single-owner account and database-backed sessions. The client verifies its session before loading private data, and the backend independently checks protected requests. HTTPS protects the connection; Tailscale supplies private network access in our tested deployment.”**

## Remaining work

The core data APIs, provider integration, backend authentication, frontend account flow, secure native persistence, authenticated shared transport, and root gate are implemented. This checkpoint records owner setup and session-authenticated app startup. Remaining work includes:

- Add the Settings sign-out button using the implemented provider action, and verify the complete visible logout workflow.
- Finish live phone/browser checks for repeat login, reload/app restart, idle/absolute expiry, logout, rejected direct access, cross-device feature updates, and JSON transfer with authentication enabled.
- Migrate or retire remaining legacy helpers that use direct `fetch` instead of the shared authenticated transport. Settings JSON export/refresh already use shared transport; do not assume all old migration helpers support native authentication.
- Review the reported npm dependency-audit findings before a production deployment. Successful installation/tests do not classify those findings.
- Add password change/recovery, broader session-management actions, and operational cleanup of expired sessions/counters.
- Package a built frontend, API, gateway, and PostgreSQL with durable restart, trusted proxy settings, least-privilege database access, and operator backup/recovery documentation. Current Compose runs PostgreSQL only; Expo/Uvicorn are development processes.
- Keep Tailscale optional in deployment design. Add the packaged standard-HTTPS deployment, automatic browser-origin configuration, and a native server-address setup experience as separate work. Automatic container-start setup-code issuance is not implemented.

Keep backend PostgreSQL tests, migration checks, dependency checks, frontend tests/type checking, and live checks as distinct validation evidence. Portable application JSON backups exclude owner accounts, sessions, setup codes, and login counters.

Other follow-up work includes full replacement restore, deferred offline fallback/upload and reconciliation, and any agreed extension beyond twelve-week cycles. JSON export and merge/update import are implemented. The offline tracking tables do not provide an active synchronization feature.
