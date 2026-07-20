# WeekFlow Dev Log — WF-010 Referential Integrity

**Date:** July 20, 2026  
**Branch:** `dev`

## What I worked on

I worked on protecting the relationships between WeekFlow data.

Tasks, goals, recurring schedules, recurring occurrences, and recurrence exceptions are connected with database IDs. If one record is deleted or restored incorrectly, another record can be left pointing to something that no longer exists.

This update adds cleanup and database-level protection so those broken links do not stay in the app.

## Goal relationship cleanup

Tasks and recurring schedules can both be linked to a goal.

I added startup cleanup that checks whether each saved `goal_id` still points to a real goal.

When the goal no longer exists, WeekFlow clears the broken goal link instead of deleting the task or recurring schedule.

The task or schedule stays available and becomes unlinked from a goal.

This protects older databases and restored data that may already contain missing goal references.

## Recurring task relationship cleanup

A generated recurring task uses two values together:

```text
recurring_rule_id
recurrence_occurrence_date
```

The schedule ID identifies the recurring schedule, and the occurrence date identifies which generated occurrence the task represents.

I added cleanup for cases where:

- the recurring schedule no longer exists
- only one of the two recurring values is present
- the recurring occurrence data is incomplete

When this happens, WeekFlow keeps the task but removes the broken recurring link. The task becomes a normal standalone task.

This prevents a damaged recurring reference from causing duplicate generation or broken editing behavior.

## Recurrence exception cleanup

WeekFlow saves recurrence exceptions when an individual generated occurrence is removed.

The exception tells the schedule not to generate that date again.

I added cleanup for exceptions whose recurring schedule no longer exists. These exception rows no longer have a purpose, so WeekFlow safely removes them.

No tasks or History records are removed during this cleanup.

## Database guardrails

I added SQLite triggers that protect the same relationships when data is inserted, updated, or deleted.

The triggers prevent WeekFlow from saving:

- a task linked to a missing goal
- a recurring schedule linked to a missing goal
- a recurring task linked to a missing schedule
- a recurring task with an incomplete occurrence identity
- a recurrence exception linked to a missing schedule

I also added cleanup triggers for direct deletes.

When a goal is deleted directly, its links are cleared from tasks and recurring schedules.

When a recurring schedule is deleted directly, linked tasks are detached and its recurrence exceptions are removed.

The normal storage functions already perform most of this cleanup. The triggers provide a second layer of protection in case a future code path or restored database bypasses those functions.

I added comments around the trigger and repair logic so it is clear why each check exists.

## Brain Dump conversion

I changed Brain Dump conversion so creating the Inbox task and deleting the original Brain Dump happen in one database transaction.

Before this change, the conversion was two separate operations:

```text
Create task
Delete Brain Dump
```

If the second operation failed, the app could keep both the new task and the original Brain Dump.

The new transaction makes the conversion all-or-nothing.

Either:

- the task is created and the Brain Dump is removed, or
- the whole conversion is rolled back and the original Brain Dump remains

This prevents duplicate content after a partial failure.

I also added comments in the Brain Dump storage and context files explaining why the conversion is handled inside the storage transaction.

## Backup and restore review

I reviewed the existing backup validation and restore process while working on this ticket.

The backup code already checks for missing goals, missing recurring schedules, missing exception schedules, duplicate IDs, and duplicate recurring occurrences.

Restore also already runs inside a database transaction.

Because those checks were already in place, I did not change the backup files just to duplicate existing protection.

## Files changed

```text
app/(tabs)/inbox.tsx
context/BrainDumpContext.tsx
lib/brainDumpStorage.ts
lib/db.ts
__tests__/integration/db.integration.test.ts
__tests__/integration/goalBrainDump.integration.test.ts
__tests__/integration/recurringStorage.integration.test.ts
```

## Testing

I ran the TypeScript check:

```bash
npx tsc --noEmit
```

It completed without errors.

I ran the full Jest test suite:

```bash
npm test
```

Results:

```text
Test Suites: 11 passed, 11 total
Tests:       73 passed, 73 total
Snapshots:   0 total
```

Five new integrity tests were added.

The new tests cover:

- repairing missing goal references
- repairing broken recurring task references
- removing orphaned recurrence exceptions
- database trigger protection
- atomic Brain Dump conversion behavior

I also started the web version of WeekFlow after the automated tests.

Expo still reports the existing SDK 55 package patch-version warnings. Those warnings were already being tracked separately and are not part of WF-010.

## Data safety

This update does not add new tables or columns.

The startup repairs preserve tasks and recurring schedules whenever possible.

Broken goal links are cleared.

Broken recurring links are detached.

Only recurrence exceptions that point to a missing schedule are removed.

Brain Dump conversion now uses a transaction so a partial conversion cannot leave duplicate data.

## Result

WeekFlow now has stronger protection against broken relationships between goals, tasks, recurring schedules, recurring occurrences, and Brain Dump conversions.

The app can repair older broken references during startup, and the SQLite triggers help prevent the same invalid data from being saved again.
