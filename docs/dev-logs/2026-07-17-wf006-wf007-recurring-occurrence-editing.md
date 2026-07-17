# WeekFlow Dev Log — WF-006 / WF-007

**Date:** July 17, 2026  
**Branch:** `dev`

## What I worked on

I finished the recurring task edit options.

Before this update, I could edit the saved recurring schedule, but I could not choose whether I wanted to change only one occurrence or change that occurrence and everything after it.

I added two choices when editing a task that came from a recurring schedule:

- **This Occurrence Only**
- **This & Future Occurrences**

## This Occurrence Only

This option only changes the task I selected.

The recurring schedule stays the same, and the other occurrences do not change.

I tested this by moving one recurring task back to Inbox, editing it, and changing:

- the title
- the priority
- the notes

Only that one task changed.

The task kept the **Recurring Occurrence** label, so it was still connected to the schedule.

## This & Future Occurrences

This option updates the selected occurrence and rebuilds the unfinished occurrences after it.

I can now change:

- title
- notes
- priority
- linked goal
- repeat frequency
- selected weekdays
- repeat end date

Earlier occurrences stay the same.

Completed tasks in History are also left alone.

Future unfinished tasks are removed and rebuilt from the selected date forward so the updated schedule does not create duplicate tasks.

## Manual testing

I created recurring test tasks and checked both edit options.

### Single occurrence test

I changed one occurrence to:

```text
WF recurring task - SINGLE
```

I also changed its priority to High and added a note.

The single occurrence changed correctly, and the other recurring tasks stayed the same.

### This and future test

I changed a later occurrence to:

```text
WF recurring task - FUTURE
```

I also changed the note and extended the recurring schedule end date.

The selected occurrence and the future unfinished occurrences updated correctly.

The earlier single-edited task stayed unchanged.

Completed History items were not changed.

I also checked for duplicate occurrences and did not find any.

## Files changed

```text
app/(tabs)/inbox.tsx
context/TaskContext.tsx
lib/recurringStorage.ts
__tests__/integration/recurringStorage.integration.test.ts
```

## Testing

I ran the TypeScript check:

```bash
npx tsc --noEmit
```

It completed without errors.

I also ran the full test suite:

```bash
npm test
```

Results:

```text
Test Suites: 11 passed, 11 total
Tests:       61 passed, 61 total
Snapshots:   0 total
```

The recurring storage integration tests now include coverage for the new edit behavior.

## Data safety

This update does not add a database migration.

It does not reset or remove saved WeekFlow data.

Completed tasks and earlier recurring occurrences are preserved when using **This & Future Occurrences**.

## Result

Recurring tasks can now be edited without forcing every occurrence to change.

I can make a one-time change to a single task, or update the selected task and everything after it while keeping the earlier history intact.
