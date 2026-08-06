# WF-029 — Inbox Overview and History Improvements

## Summary

Improved WeekFlow's Inbox and History screens without changing their core responsibilities.

Inbox remains the primary task-capture and scheduling location, but now includes a compact overview and broader active-task organization.

History now provides structured searching and filtering across completed tasks, completed goals, archived Brain Dump notes, and finalized Week 13 cycle reports.

WF-029 uses existing WeekFlow records and does not introduce a database migration or backup-format change.

---

## Inbox Overview

Added a compact Inbox Overview card showing:

- Unscheduled tasks
- Tasks scheduled for today
- Overdue tasks
- Recurring tasks
- Goal-linked tasks
- Total active tasks
- Brain Dump notes
- Task templates

The primary counts are tappable and immediately apply the corresponding task filter.

Inbox continues to default to unscheduled tasks so the screen remains focused on capture and scheduling.

---

## Task Organizer

The former Unscheduled Tasks area now acts as a broader Task Organizer.

It can display:

- All active tasks
- Unscheduled tasks
- Tasks scheduled for today
- Overdue tasks
- Upcoming tasks
- Recurring task occurrences
- Standalone tasks
- Goal-linked tasks
- Tasks associated with a specific goal
- Tasks due on a specific date
- Priority-filtered results
- Search results

Existing task creation remains in Inbox.

---

## Scheduled Task Controls in Inbox

Scheduled tasks displayed through Inbox filters now show their scheduled date clearly.

Available actions remain consistent with the rest of WeekFlow:

- Reschedule for Today
- Reschedule for Tomorrow
- Choose another date
- Move back to Inbox
- Edit
- Complete
- Delete
- Add or remove as a weekly commitment

Recurring-task protections remain intact.

---

## History Search and Filtering

Added a consolidated History filter system.

### Content Filters

History can show:

- All content
- Completed tasks
- Completed goals
- Finalized cycle reports
- Archived Brain Dump notes

### Date Filters

Supported date ranges include:

- All time
- Last 7 days
- Last 30 days
- Last 90 days
- Custom date range

Custom dates use the `YYYY-MM-DD` format.

Invalid dates and reversed date ranges produce a visible validation message instead of silently returning confusing results.

### Task Filters

Completed tasks can be filtered by:

- Priority
- Recurring or standalone
- Linked goal
- No linked goal
- Specific goal
- Completed cycle

Task-specific filters automatically focus History on completed tasks.

---

## Completed Cycle Filtering

Completed tasks are associated with planning cycles using the following order:

1. Use the linked goal's cycle when the task belongs to a goal.
2. Otherwise, use the cycle containing the task's completion date.

This allows both goal-linked and standalone tasks to be located within historical cycle results.

---

## Cycle Reports in History

Finalized Week 13 reports are now accessible directly from History.

Each report preserves the existing WF-027 information:

- Cycle statistics
- Goal outcomes
- Week 13 reflections
- Carried-forward goals
- Replaced goals
- Archived unfinished goals
- Next-cycle plan
- First-week commitments
- Markdown report export

Reports remain collapsed by default to keep History manageable.

---

## Expanded Search Coverage

History search now checks:

- Completed task titles
- Completed task notes
- Goal titles
- Goal purpose and planning notes
- Goal completion reflections
- Milestone titles and notes
- Cycle names
- Cycle focus
- Cycle theme
- Week 13 reflection answers
- Goal outcome snapshots
- Replacement-goal titles
- Archived Brain Dump notes

This makes older decisions and reflections discoverable through normal text search.

---

## Historical Cycle Labels

Completed task and goal entries now display their associated planning cycle when available.

This provides additional context when reviewing older work.

---

## Data and Backup Impact

WF-029 does not add or alter SQLite tables.

There is:

- No database migration
- No backup-format increase
- No duplicated analytics storage
- No change from backup version 12

Inbox overview totals and History results are derived from existing WeekFlow records.

---

## Files Added

- `components/InboxOverviewCard.tsx`
- `components/HistoryFilters.tsx`
- `lib/inboxOverviewUtils.ts`
- `lib/historyFilters.ts`
- `__tests__/inboxOverviewUtils.test.ts`
- `__tests__/historyFilters.test.ts`

## Files Updated

- `app/(tabs)/inbox.tsx`
- `app/(tabs)/history.tsx`
- `components/ActiveTaskFilters.tsx`
- `lib/activeTaskFilters.ts`
- `__tests__/activeTaskFilters.test.ts`
- `jest.config.js`

---

## Validation

Manual UI validation confirmed:

- Inbox opens with Unscheduled selected.
- Overview counts and quick filters display correctly.
- Scheduled tasks can be viewed and managed through Inbox.
- Existing task creation and recurring-task workflows remain available.
- History content filters work.
- Date filters work.
- Priority, recurrence, goal, and cycle filters work.
- Cycle reports appear in History.
- Search finds historical notes, reflections, and outcomes.
- Existing completed tasks, goals, and Brain Dump history remain visible.

Recommended final automated validation before commit:

```bash
npx tsc --noEmit
npm test
```

Expected automated totals after WF-029:

- 26 test suites
- 187 tests
- 0 snapshots

The Node experimental SQLite warning during Jest is expected.
