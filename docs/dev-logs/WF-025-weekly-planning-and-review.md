# WF-025 — Weekly Planning and Review

## Summary

Expanded WeekFlow's Weekly screen into a structured planning and reflection workspace while preserving its role as a focus and review screen rather than a general task-creation screen.

WF-025 adds:

- Weekly commitments
- Task-linked commitments
- Guided weekly reviews
- Stable weekly summary snapshots
- Unfinished-task decisions
- Safe recurring-occurrence handling
- Cleaner Daily and Weekly task actions
- Backup and restore support
- Database migrations and automated tests

The final interface keeps the Weekly screen useful without filling every task card with large action buttons.

---

## Weekly Commitments

### Manual Commitments

Users can create short weekly commitments that represent important outcomes for a selected week.

Examples:

- Finish the MySQL backup documentation
- Complete the capstone requirements draft
- Finish the WeekFlow weekly review

Manual commitments are separate from tasks and can be:

- Created
- Completed
- Reopened
- Removed
- Viewed again when returning to a previous week

### Task-Linked Commitments

Existing WeekFlow tasks can now be used as weekly commitments without retyping or duplicating them.

A task can be linked from:

- Inbox
- Daily
- Weekly
- The **Choose Existing Task** control inside Weekly Commitments

The task chooser groups available work into:

- Unscheduled Inbox tasks
- Tasks scheduled during the selected week

A linked commitment keeps a relationship to the original task rather than creating a second task record.

### Completion Synchronization

Task-linked commitments stay synchronized with the original task.

- Completing the task completes the commitment.
- Completing the commitment completes the task.
- Reopening the commitment reopens the task.
- Editing the task title updates the linked commitment display.
- Scheduling or rescheduling the task does not break the commitment link.

This preserves one source of truth for task completion.

### Duplicate Protection

The database prevents the same task from being linked more than once to the same week.

Already-linked tasks are excluded from the task chooser and display as an existing commitment rather than another add button.

### Safe Commitment Removal

Removing a commitment requires two deliberate actions:

1. Press **Remove Weekly Commitment**.
2. Press **Confirm Remove**.

The user can cancel before confirmation.

Removing a linked commitment:

- Does not delete the task
- Does not complete or reopen the task
- Does not change its scheduled date
- Only removes it from that week's commitment list

### Task Deletion Safety

If a linked task is deleted, WeekFlow preserves the commitment's historical title and completion state while clearing the broken task relationship.

This prevents deleted tasks from corrupting weekly review history.

---

## Guided Weekly Review

Current and previous weeks include a collapsible **Guided Weekly Review** section.

The review includes five optional reflection prompts:

- What went well?
- What caused problems?
- What did you learn?
- What should change next week?
- What is your number-one focus next week?

Future weeks do not show the review because there is no completed work to reflect on yet.

Saved reviews remain available when navigating between weeks or restarting the app.

---

## Weekly Review Snapshot

The first time a weekly review is saved, WeekFlow stores a stable snapshot of that week's calculated results.

The snapshot includes:

- Tasks completed
- Tasks unfinished
- Overdue tasks
- Completion percentage
- Goals worked on
- Most productive weekday
- High-priority tasks completed
- Recurring tasks completed
- Brain Dump notes archived

Later task edits, deletions, completion changes, or rescheduling do not rewrite the original saved weekly result.

Written reflection answers can still be edited without changing the historical snapshot.

This ensures a saved review describes what was true when the review was completed.

---

## Unfinished-Task Decisions

Current and previous weeks include a collapsible **Unfinished Task Decisions** section.

For each unfinished task, users can choose:

- **Next Week** — moves the task exactly seven calendar days forward
- **Choose Date** — selects a new date using the calendar picker
- **Inbox** — clears the scheduled date and returns the task to Inbox
- **Keep Date** — records an intentional decision to leave it in place
- **Delete** — removes the task while preserving decision history

A saved Keep Date decision can be undone.

### Current-Week Protection

During the current week, unfinished-task decisions only include tasks due through the current day.

For example, on Wednesday, WeekFlow does not ask the user to reschedule a task due on Friday.

Previous weeks show all unfinished tasks from that completed week.

Future weeks do not display unfinished-task decisions.

### Recurring-Occurrence Protection

Decisions involving a recurring task preserve:

- Recurring rule ID
- Original occurrence date
- Working scheduled date

Rescheduling or deleting one occurrence does not modify the full recurring series or future occurrences.

---

## Daily and Weekly Task-Card Cleanup

The first WF-025 design introduced too many visible action buttons on Daily and Weekly task cards.

The final design keeps only:

- **Done**
- A compact `•••` actions menu
- A small **Weekly Commitment** badge when applicable

The shared actions menu contains:

- Move to Today for overdue tasks
- Reschedule
- Back to Inbox
- Make Weekly Commitment
- Remove Weekly Commitment
- Delete Task
- Cancel

Commitment removal and task deletion both require confirmation.

This cleanup applies only to Daily and Weekly. The Inbox task-card and calendar scheduling workflow remain unchanged.

A shared `TaskCardActionsMenu` component keeps action behavior consistent across both screens.

---

## Database Changes

WF-025 adds three new relational tables:

### `weekly_reviews`

Stores:

- Week start date
- Optional planning-cycle relationship
- Five reflection responses
- Saved weekly statistics snapshot
- Created timestamp
- Updated timestamp
- Reviewed timestamp

### `weekly_commitments`

Stores:

- Week start date
- Optional planning-cycle relationship
- Commitment title
- Completion state
- Completion timestamp
- Optional linked task ID

Manual commitments have no linked task ID. Task-based commitments point to the existing task.

### `weekly_task_decisions`

Stores:

- Week start date
- Optional related task ID
- Saved task title
- Original scheduled date
- Selected decision
- New scheduled date when applicable
- Recurring rule ID
- Original recurring occurrence date
- Decision timestamp

The saved title and occurrence information preserve historical meaning even when the original task later changes or is deleted.

### Database Protection

WF-025 adds database safeguards for:

- Invalid task relationships
- Duplicate linked commitments
- Invalid weekly decisions
- Linked-task deletion cleanup
- Orphaned relationship repair
- Weekly lookup performance

The integration test that originally used a nonexistent fake task ID was corrected to create and use a real task. The production database trigger remained unchanged because it was correctly protecting data integrity.

---

## Context and Data Flow

A new `WeeklyReviewContext` coordinates weekly review data across Weekly, Daily, Inbox, Settings, and backup restore.

The primary flow is:

`Screen → WeeklyReviewContext → weeklyReviewStorage → SQLite → context refresh → updated interface`

The context manages:

- Weekly review loading and saving
- Commitment creation and removal
- Linked-task commitment synchronization
- Commitment completion and reopening
- Unfinished-task decisions
- Refreshing weekly information after task changes or backup restoration

---

## Backup and Restore

The backup format increased from version 8 to version 9 for the original weekly-review system, then to version 10 when task-linked commitments were added.

Version 10 backups include:

- Weekly reviews
- Reflection responses
- Saved weekly statistics snapshots
- Manual commitments
- Task-linked commitments
- Commitment completion state
- Unfinished-task decisions
- Recurring occurrence information

Backup versions 1 through 9 remain supported.

Older backups import with empty weekly collections or manual commitments without task links, depending on their version.

Settings backup previews and data summaries now include weekly review and commitment counts.

---

## Files Added

- `components/GuidedWeeklyReviewCard.tsx`
- `components/UnfinishedTaskDecisionsCard.tsx`
- `components/TaskWeeklyCommitmentButton.tsx`
- `components/TaskCardActionsMenu.tsx`
- `lib/weeklyReview.ts`
- `lib/weeklyReviewStorage.ts`
- `context/WeeklyReviewContext.tsx`
- `__tests__/weeklyReview.test.ts`
- `__tests__/integration/weeklyReviewStorage.integration.test.ts`

## Files Updated

- `app/_layout.tsx`
- `app/settings.tsx`
- `app/(tabs)/inbox.tsx`
- `app/(tabs)/daily.tsx`
- `app/(tabs)/weekly.tsx`
- `components/WeeklyCommitmentsCard.tsx`
- `lib/db.ts`
- `lib/backupValidation.ts`
- `lib/backupStorage.ts`
- `jest.config.js`
- `__tests__/testFactories.ts`
- `__tests__/backupValidation.test.ts`
- `__tests__/integration/backupStorage.integration.test.ts`
- `__tests__/integration/db.integration.test.ts`

---

## Validation Before Commit

Before committing WF-025, confirm:

- TypeScript validation passes.
- All Jest suites pass.
- Manual commitments can be created, completed, reopened, and removed.
- Inbox and scheduled tasks can be linked as commitments.
- Task and commitment completion remain synchronized.
- Duplicate task commitments are prevented.
- Two-step commitment removal leaves the underlying task unchanged.
- Guided reviews save and reload correctly.
- Saved weekly snapshots remain stable after later task changes.
- All unfinished-task decisions work correctly.
- Current-week future tasks are excluded from premature decisions.
- Recurring occurrence decisions do not modify the parent series.
- Daily and Weekly show only Done and the compact actions menu.
- Inbox remains unchanged.
- Backup export and restore preserves all weekly data and linked commitments.
