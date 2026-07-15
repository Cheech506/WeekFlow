# Dev Log — WF-008 Convert Existing Tasks to Recurring

## Date

July 15, 2026

## Project

WeekFlow

## Branch

`dev`

## Ticket

`WF-008`

## Summary

I completed WF-008, which allows an existing normal task to be converted into a recurring task while editing it.

Previously, recurring schedules could only be created from the Quick Task form. This update adds repeat controls to the existing task editor so a task that is already in the Inbox can become the first occurrence of a new recurring schedule.

## New Editing Options

When editing a normal task, I can now choose:

- Does Not Repeat
- Daily
- Weekly
- Certain Days
- Monthly

The editor also supports the first scheduled date and an optional repeat end date. For Certain Days schedules, the first date must match one of the selected weekdays.

## Conversion Behavior

When I save a normal task as recurring:

- The existing task is reused as the first occurrence.
- The task is scheduled on the selected first date.
- A new recurring schedule is created.
- Future occurrences are generated.
- The first occurrence is not duplicated.
- Title, notes, priority, and linked goal carry into the recurring rule.
- The task leaves the unscheduled Inbox after it receives its first date.

## Duplicate Prevention

The existing task is linked to the new recurring rule before future occurrences are generated. This lets the original task serve as the first occurrence instead of creating a second task on the same date.

Manual testing confirmed that only one task appeared on the first occurrence date.

## Conversion Restrictions

WeekFlow prevents invalid conversions:

- Completed tasks cannot be converted.
- Tasks already belonging to a recurring schedule cannot be converted again.
- Certain Days schedules require the first date to match a selected weekday.
- Invalid or incomplete repeat settings are rejected.

## Existing Recurring Behavior

I confirmed that the recurring-task manager still works:

- The new schedule appears in Manage Recurring Tasks.
- Frequency, start date, end date, priority, and active status display correctly.
- Pause behavior still works.
- Schedule-removal choices still work.
- Removing a schedule updates the saved-schedule count.

## Files Updated

```text
app/(tabs)/inbox.tsx
context/TaskContext.tsx
lib/recurringStorage.ts
__tests__/integration/recurringStorage.integration.test.ts
```

## Data Safety

WF-008 does not add a new table or require a schema migration.

It does not reset or replace the SQLite database and does not modify unrelated tasks, completed history, goals, Brain Dump notes, weekly reviews, or backups.

## Automated Testing

I ran:

```text
npx tsc --noEmit
npm test
```

TypeScript completed without errors, and the full automated test suite passed.

The recurring-storage integration test verifies that the existing task becomes the first recurring occurrence and that future generation does not duplicate it.

## Manual Testing

I manually confirmed:

1. A normal Inbox task can be edited.
2. A repeat option can be selected.
3. The first date and optional end date can be saved.
4. The task leaves the unscheduled Inbox.
5. The new recurring schedule appears in Manage Recurring Tasks.
6. Only one task appears on the first occurrence date.
7. Future occurrences are generated.
8. Existing recurring controls continue to work.

## Current Status

WF-008 is complete and tested on the `dev` branch.

## Suggested Git Commit

```text
feat: convert existing tasks into recurring schedules
```

## Next Step

The next recurring-task work should add editing for saved recurring schedules and allow changes to apply to one occurrence or this and future occurrences while preserving completed history.
