# WF-017 — Active Task Search and Filtering

## Summary

Added reusable search and filtering controls to the active-task screens so users can quickly narrow down Inbox, Daily, and Weekly tasks without changing or deleting the underlying task data.

## Changes

- Added a shared **Search & Filters** dropdown to:
  - Inbox
  - Daily
  - Weekly
- Added text search across task titles and notes.
- Added filtering by:
  - Priority
  - Linked goal
  - Tasks without a linked goal
  - Recurring tasks
  - Standalone tasks
  - Exact due date
  - Schedule status
- Added schedule-status options appropriate to each screen:
  - Inbox: unscheduled tasks
  - Daily: overdue or due today
  - Weekly: overdue, due today, or upcoming
- Added a matching-task count.
- Added an active-filter count.
- Added a **Clear All Filters** action.
- Added an empty-state message when tasks exist but none match the selected filters.
- Kept Daily and Weekly as view-only screens.
- Preserved Weekly Review and progress calculations so filtering only changes the visible task cards.
- Added reusable filter logic in `lib/activeTaskFilters.ts`.
- Added a shared filter UI component in `components/ActiveTaskFilters.tsx`.
- Added automated test coverage for search and filter combinations.

## Validation

- Search worked across task titles and notes.
- Priority, goal, recurrence, due-date, and schedule-status filters worked correctly.
- Multiple filters could be combined.
- Matching-task and active-filter counts updated correctly.
- Clear All Filters restored the full task list.
- Inbox, Daily, and Weekly continued to behave correctly.
- TypeScript validation completed without errors.
- All 13 Jest test suites passed.
- All 97 automated tests passed.

## Notes

The filters only affect which active tasks are displayed. They do not modify task records, recurring schedules, progress calculations, or Weekly Review data.
