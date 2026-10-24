# WeekFlow API

WeekFlow’s backend uses Python, FastAPI, Pydantic, SQLAlchemy, Psycopg, PostgreSQL, Alembic, and Docker Compose.

The core data API supports tasks, planning cycles, goals, goal milestones, recurring schedules, skipped occurrences, weekly commitments, weekly reviews, weekly task decisions, cycle reviews and their goal outcomes, brain dumps, and task templates. Cycle goal outcomes are saved together with their parent review. It also generates missing recurring tasks transactionally, converts existing tasks into recurring schedules, revises a series from a selected occurrence while preserving earlier and completed task history, and detaches one unfinished occurrence while retaining its task and skipping its old recurring slot. Complete-backup tools validate, preview, import, and refresh all 13 supported record collections, including recurring schedules and review history.

**Current app storage:** WeekFlow still uses SQLite for everyday activity. The app’s Task API tools screen can read server tasks and copy or refresh the device’s current data into PostgreSQL. Real WeekFlow data has been imported and refreshed successfully. This migration does not switch the main app to PostgreSQL or enable automatic synchronization.

## Frontend API clients and integration status

The frontend now has typed clients for all 13 domain record collections, plus recurring task actions and the existing migration tools. They live in `lib/api/` at the repository root. Shared transport sends requests to `EXPO_PUBLIC_API_BASE_URL`; feature clients validate request fields, translate camelCase app fields to snake_case API fields, and validate/map responses back into the existing UI shapes.

| Client in `../lib/api/` | Responsibility |
|---|---|
| `apiClient.ts` | Shared transport, timeouts, cancellation, HTTP errors, and response validation |
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
| `backupMigrationApi.ts` | Existing complete-backup import and refresh tools |

Source IDs remain read-only migration metadata. Normal writes and parent links use native PostgreSQL IDs. Type-only imports from storage modules reuse the app's data shapes without executing SQLite queries.

Clients make one request per operation and do not automatically retry writes, fall back to SQLite, or upload an outbox. A lost write response can mean PostgreSQL committed successfully; `ApiError.mutationMayHaveSucceeded` distinguishes this uncertainty from an ordinary rejected request. HTTP 409/422 responses remain visible errors.

The main providers still call the SQLite storage modules. Adding these clients does not switch everyday storage. Task-sync database, cache, outbox, and backend tracking-table foundations exist, but offline upload and reconciliation are deferred until the online app integration is working. The tracking tables do not provide a sync endpoint by themselves.

The next phase is to connect related providers and direct storage callers together, refresh affected app state after linked actions, and avoid mixing SQLite and PostgreSQL IDs. PostgreSQL will serve ordinary app operations; connection errors will remain visible during the initial online integration. Offline fallback is a later phase. The authoritative SQLite backup refresh must be guarded or retired at cutover so it cannot overwrite newer PostgreSQL changes.

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

Conversion and series editing use the selected task's native PostgreSQL ID. Their requests supply the device's local `current_date` and may set `horizon_days` from 0 to 366, defaulting to 30. The inclusive generation window follows the same rules as the generation endpoint. These actions generate only for their own schedule. They do not start background generation or connect the main app to PostgreSQL.

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
- Each occurrence keeps its own goal link. Ordinary schedule PATCH does not retroactively reassign existing tasks. The explicit series-edit action revises the selected task and later unfinished occurrences while preserving earlier and completed history.
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

The backend suite currently collects **1,563 tests** (October 23, 2026). This includes **131** conversion/series-edit tests, **36** recurring-task detachment tests, **48** standalone generation API tests, and **55** task-sync tracking model/migration tests. Run the commands above against PostgreSQL to verify this checkout before committing; collection alone does not confirm execution passed.

Coverage includes request validation, model constraints, task relationships, historical goal links, goal completion and deletion, planning cycles, milestones, migration backfills, backup previews, strict imports, refreshes, duplicate protection, recurrence date calculations, schedule and exception APIs, transactional occurrence generation, existing-task conversion, atomic occurrence detachment and skip preservation, series edits from original occurrence dates, retained historical goal links and task placements, rebuild-dependent weekly links, weekly commitment task links and completion, frozen review snapshots, atomic weekly task decisions, recurring deletion skips, cycle draft editing and finalization, goal carry-forward and replacement, preserved cycle history, brain dump archive/restore and conversion, independent template-created tasks, and rollback behavior.

Backup write, refresh, task relationship, weekly-history write, recurrence and recurring task workflow, cycle review, brain dump, and task template API tests use isolated schemas inside the existing PostgreSQL database. Endpoint commits run within test-owned transactions, and teardown rolls back their data and schema. Schema inspection tests still check the migrated application tables. The FastAPI development server does not need to be running during pytest. A known FastAPI/Starlette deprecation warning may appear even when all tests pass.

Useful focused checks:

```bash
python -m pytest tests/test_task_model.py tests/test_task_relationship_schemas.py tests/test_task_relationships_api.py -q
python -m pytest tests/test_backup_refresh_api.py tests/test_backup_refresh_order.py -q
python -m pytest tests/test_backup_import_write_api.py tests/test_weekly_history_models.py -q
python -m pytest tests/test_recurring_rules_api.py tests/test_recurring_exceptions_api.py -q
python -m pytest tests/test_recurrence_dates.py tests/test_recurrence_generation_api.py -q
python -m pytest tests/test_recurring_task_workflows_api.py tests/test_recurring_task_detach_api.py -q
python -m pytest tests/test_weekly_commitments_api.py tests/test_weekly_reviews_api.py tests/test_weekly_task_decisions_api.py -q
python -m pytest tests/test_cycle_reviews_api.py tests/test_brain_dumps_api.py tests/test_task_templates_api.py -q
```

Run the complete frontend suite and type checker from the WeekFlow repository root:

```bash
npm test -- --watchman=false
npx tsc --noEmit
```

On October 23, 2026, all **1,428 frontend tests across 49 suites** passed, and the frontend type check passed. Feature-client tests simulate HTTP responses; SQLite integration tests use disposable local databases. These do not replace a PostgreSQL backend test run or a live app integration check.

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
| `app/routers/` | Core data and workflow HTTP endpoints, including weekly/cycle history, brain dumps, templates, and backups |
| `app/services/task_import.py` | Task-batch comparison, strict import, and relationship mapping |
| `app/services/backup_import.py` | Complete-backup comparison plan and strict import |
| `app/services/backup_refresh.py` | Transactional create/update refresh with stable PostgreSQL IDs |
| `app/services/recurrence.py` | Calendar occurrence calculations and generation-window limits |
| `app/services/recurrence_generation.py` | Standalone generation and a caller-owned transaction helper, with skip, duplicate, and history protection |
| `app/services/recurring_task_workflows.py` | Atomic task conversion, series edits, and occurrence detachment with skip/history preservation |
| `app/services/cycle_reviews.py` | Atomic draft saves and finalization, goal outcomes, successor cycles, and first commitments |
| `alembic/versions/` | Versioned database structure changes |
| `tests/` | Backend validation, database, migration, and API tests |
| `../lib/api/` | Shared HTTP transport, feature clients, and migration clients with runtime response validation |
| `../lib/taskSync*.ts` | Deferred offline cache, outbox, database, and type foundations |
| `app/models/task_sync.py` | Persistent server identity, client-task mappings, and sync receipt table definitions |
| `../app/server-tasks.tsx` | Task API tools, task preview, confirmed refresh, and server task reads |

## Remaining work

The planned core data APIs, three specialized recurring task actions, and typed frontend clients are implemented. The main app storage switch remains pending. Run the full PostgreSQL suite and Alembic check before committing this batch. Remaining work before completing the intended app migration includes:

- Connect the main app's storage operations to the PostgreSQL APIs, verify each feature, and complete the final data refresh and storage switch.
- Add any agreed extensions to cycle duration; current cycles remain twelve weeks.
- Complete the deferred offline fallback/upload and reconciliation behavior after online integration; the current foundations do not upload changes.
- Add authentication according to the deployment scope.

Successful backup migration verifies a copy of the data in PostgreSQL. It does not complete the frontend storage switch.
