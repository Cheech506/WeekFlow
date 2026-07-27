# WF-022 — Calendar Task Scheduling

## Summary

Added real calendar-based scheduling to WeekFlow so Inbox tasks can be assigned to Today, Tomorrow, or any selected calendar date. Task creation remains centered in Inbox, while Daily and Weekly remain focused on viewing and managing scheduled work.

## Changes

### Inbox Scheduling

- Kept the existing task-creation workflow unchanged.
- Added scheduling controls directly to the bottom of each Inbox task.
- Added four scheduling choices:
  - Inbox
  - Today
  - Tomorrow
  - Choose Date
- Removed the temporary post-creation **Added to Inbox** scheduling panel so scheduling appears in only one consistent location.
- Kept unscheduled tasks in Inbox until a date is selected.

### Calendar Date Picker

- Added a reusable month-by-month calendar picker.
- Supported moving between months and years.
- Added Today and Tomorrow shortcuts.
- Added selected-date confirmation before saving.
- Supported leap years and varying month lengths.

### Daily and Weekly Rescheduling

- Added direct rescheduling from Daily.
- Added direct rescheduling from Weekly.
- Allowed scheduled tasks to be returned to Inbox.
- Preserved the original task creation date while changing only the working scheduled date.

### Recurring Task Protection

- Rescheduling one generated recurring occurrence changes only that occurrence's scheduled date.
- Preserved the original recurring occurrence identity used by the parent schedule.
- Prevented one rescheduled occurrence from changing future generated tasks or deleted-occurrence exceptions.

### Storage and Date Handling

- Reused the existing `due_date` task field and date migration foundation.
- Added task-storage support for updating and clearing scheduled dates.
- Added shared date utilities for Today, Tomorrow, month navigation, and calendar-grid generation.
- No new SQLite migration or backup-version increase was required because scheduled dates were already included in the existing data model and backup structure.

### Testing

- Added unit coverage for calendar and date utility behavior.
- Added integration coverage for scheduling, rescheduling, clearing dates, and recurring-occurrence identity.
- Preserved existing overdue, Daily, Weekly, recurrence, backup, and restore behavior.

## Validation

- The updated Inbox scheduling layout was tested and confirmed working.
- Today, Tomorrow, and Choose Date scheduling were confirmed in the app.
- The duplicate post-creation scheduling panel was removed.
- Run the complete TypeScript and Jest validation immediately before committing this batch.
