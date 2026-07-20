# WeekFlow Dev Log — WF-009

**Date:** July 20, 2026  
**Branch:** `dev`

## What I worked on

I worked on making recurring tasks safer and more predictable.

The main goal was to stop recurring occurrences from being created more than once and to clean up a few edge cases that could cause bad schedule data.

## Duplicate protection

I added stronger checks around recurring occurrence generation.

WeekFlow now keeps track of the occurrence date and avoids creating another linked task for the same recurring schedule and date.

This also covers occurrences that were:

- moved back to Inbox
- completed
- deleted
- already generated before the app was reloaded

Moving an occurrence to Inbox should not cause WeekFlow to create a replacement copy when the app loads again.

Completed occurrences should also stay as a single History entry.

## Legacy duplicate handling

I added cleanup for older duplicate recurring occurrences.

When duplicate linked tasks are found for the same schedule and date, WeekFlow keeps one official recurring occurrence.

Extra copies are detached from the recurring schedule instead of being deleted. This keeps the task data available and avoids silently removing something the user may still need.

When one of the duplicates is completed, the completed task is preferred as the official occurrence so History stays intact.

## Recurrence edge cases

I hardened the recurring date generation logic so it handles bad generation windows safely.

This includes:

- negative generation windows
- decimal generation windows
- infinite values
- invalid values

The generator now normalizes the input instead of attempting to loop with an unsafe value.

## Safer schedule actions

Recurring schedule pause and delete operations now report when the selected schedule no longer exists.

The recurring delete function also validates the requested delete option before changing any tasks or schedules.

This prevents an invalid option from partially changing saved data.

## Manual testing

I manually checked the recurring task behavior in WeekFlow.

I tested:

- moving a recurring occurrence back to Inbox
- reloading the app
- deleting an occurrence
- reloading again
- completing an occurrence
- checking History for duplicates

The occurrences stayed in the expected state and I did not find duplicate generated tasks during the test.

## Files changed

```text
lib/db.ts
lib/recurrenceUtils.ts
lib/recurringStorage.ts
__tests__/integration/db.integration.test.ts
__tests__/recurrenceUtils.test.ts
__tests__/integration/recurringStorage.integration.test.ts
```

## Tests added

I added test coverage for:

- duplicate recurring occurrence cleanup
- preferring a completed duplicate
- moved-to-Inbox occurrence protection
- deleted occurrence protection
- completed occurrence protection
- invalid recurring delete options
- missing recurring schedules
- unsafe generation-window values

## Data safety

This update does not add any new database tables or columns.

The duplicate cleanup does not delete the extra task data. Extra duplicate tasks are converted into normal standalone tasks by removing their recurring schedule link.

Completed History entries are preserved.

## Result

Recurring task generation is now more defensive.

Reloading WeekFlow should not recreate moved, deleted, or completed occurrences, and older duplicate data can be repaired without deleting the underlying tasks.
