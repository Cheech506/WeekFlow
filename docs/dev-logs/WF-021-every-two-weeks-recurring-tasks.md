# WF-021 — Every 2 Weeks Recurring Tasks

## Summary

Added an **Every 2 Weeks** recurrence option to WeekFlow so recurring tasks can repeat every fourteen calendar days from the selected start date.

## Changes

### Recurring Task Creation

- Added **Every 2 Weeks** to the recurrence options in Inbox.
- Supported creating a new recurring task with a two-week interval.
- Supported converting an existing Inbox task into an every-two-weeks recurring schedule.
- Displayed the schedule in clear language such as **Every 2 weeks on Monday**.

### Recurrence Calculations

- Added recurrence logic that advances occurrences by fourteen calendar days.
- Used the selected start date as the recurrence anchor.
- Preserved the original weekday for future occurrences.
- Used calendar-date calculations so schedules remain correct across daylight-saving time changes.

### Schedule Editing and Exceptions

- Supported changing an existing recurring schedule to or from **Every 2 Weeks**.
- Preserved individual occurrence edits and deleted-occurrence exceptions.
- Supported editing the full schedule or changing the schedule from a selected occurrence forward.
- Kept pause, resume, and schedule deletion behavior consistent with the existing recurrence types.

### Backup and Restore

- Added **Every 2 Weeks** to recurrence validation.
- Preserved every-two-weeks schedules during backup export and restore.
- Kept the existing backup version because the backup structure did not change.
- No SQLite migration was required because recurrence frequency is already stored as text.

### Testing

- Added unit coverage for fourteen-day recurrence generation.
- Added coverage for recurrence behavior across daylight-saving transitions.
- Updated recurring storage integration tests.
- Updated backup validation and restore tests.
- Confirmed deleted occurrence exceptions remain excluded from regenerated schedules.

## Validation

Before committing this batch, confirm:

- TypeScript validation passes.
- The Jest test suite passes.
- Creating and editing an every-two-weeks recurring task works correctly.
- Generated occurrences remain on the correct weekday.
- Individual occurrence edits and deletions remain intact.
- Backup export and restore preserves the recurrence schedule.
