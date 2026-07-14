# Dev Log — WF-011 Collapsible Linked Tasks

## Date

July 14, 2026

## Project

WeekFlow

## Branch

`dev`

## Ticket

`WF-011`

## Summary

I completed WF-011 by adding collapsible Linked Tasks sections to each goal card.

The goal cards now remain compact by default while still showing the number of linked tasks and their completion progress. Users can expand only the goals they want to inspect.

---

## New Behavior

Each active goal now includes a Linked Tasks header such as:

```text
Linked Tasks (4)
2 of 4 done
```

The linked-task list is collapsed by default.

Selecting the Linked Tasks header expands the task list. Selecting it again collapses the list.

Each goal maintains its own expanded or collapsed state, so opening one goal does not open every other goal.

---

## Linked Task Details

When expanded, the section continues to show the existing linked-task information:

- Task title
- Completion state
- Current location or status
- Priority
- Notes

Completed tasks remain visually marked as completed.

---

## Empty State

Goals with no linked tasks still show:

```text
Linked Tasks (0)
0 of 0 done
```

The section can still be expanded without causing an error.

---

## Data Safety

WF-011 is a user-interface change only.

It does not modify:

- SQLite tables
- Database migrations
- Goal records
- Task records
- Goal-to-task relationships
- Completed history
- Recurring schedules
- Backup data

The expanded and collapsed state exists only while the Goals screen is open and is not written to the database.

---

## File Updated

```text
app/(tabs)/index.tsx
```

No other project files were replaced.

---

## Automated Testing

I ran:

```text
npx tsc --noEmit
npm test
```

Results:

```text
Test Suites: 11 passed, 11 total
Tests:       54 passed, 54 total
Snapshots:   0 total
```

TypeScript completed without errors.

---

## Manual Testing

I confirmed:

- Goal Linked Tasks sections start collapsed.
- The linked-task count remains visible while collapsed.
- The completion count remains visible while collapsed.
- Expanding a goal displays its linked tasks.
- Collapsing a goal hides the linked-task list.
- Each goal expands independently.
- Completed and incomplete tasks still display correctly.
- Goals with zero linked tasks display correctly.
- Existing Edit Dates, Mark Complete, and Delete controls remain visible.
- The desktop layout remains intact.

---

## Current Status

WF-011 is complete and ready to be committed to the `dev` branch.

---

## Suggested Git Commit

```text
feat: add collapsible linked tasks to goals
```

---

## Next Step

The next planned feature is converting a normal task into a recurring task while editing it.
