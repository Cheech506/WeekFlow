# WF-027 — Week 13 Review and Next-Cycle Planning

## Summary

Completed WeekFlow's full 12-week planning loop by adding a structured Week 13 review, cycle-report snapshots, goal outcome decisions, next-cycle planning, carry-forward support, first-week commitments, historical reporting, and Markdown export.

The final workflow is:

`Plan Cycle → Execute 12 Weeks → Review Cycle → Decide Goal Outcomes → Start Next Cycle`

WF-027 builds on named goal cycles, goal analytics, weekly reviews, commitments, milestones, rewards, recurring schedules, and historical goal data.

---

## Week 13 Cycle Review

When a planning cycle has ended, the Goals screen shows a dedicated Week 13 review panel.

The review summarizes:

- Completed goals
- Unfinished goals
- Completed tasks
- Completed milestones
- Weekly reviews completed
- Longest completion streak
- Most productive cycle week
- Most productive weekday
- High-priority tasks completed
- Recurring tasks completed
- Goal rewards unlocked
- Archived Brain Dump notes

The report can be saved as a draft and finalized later.

### Stable Cycle Snapshot

Finalizing the review saves a historical snapshot of the cycle's results.

Later edits to tasks, goals, milestones, or weekly reviews do not silently rewrite the finalized report.

This preserves historical accuracy and creates a reliable foundation for future cycle comparisons.

---

## Week 13 Reflection

The cycle review includes seven optional reflection prompts:

- What was your biggest accomplishment?
- What was your biggest challenge?
- What worked well?
- What should change next cycle?
- What should you stop doing?
- What should you continue doing?
- What did you learn?

Draft reflection answers persist across app restarts.

The finalized reflection remains stored with the historical cycle.

---

## Unfinished Goal Outcomes

Every unfinished goal requires one deliberate outcome before finalizing the cycle.

### Mark Complete

Marks the original goal complete inside the finishing cycle and saves its completion results.

### Carry Forward

Leaves the original goal unchanged in the historical cycle and creates a separate active copy in the next cycle.

The new goal preserves:

- Title
- Purpose
- Success definition
- Goal notes
- Reward
- Milestones
- Milestone completion states
- Milestone notes
- Milestone target dates

Existing tasks are not duplicated. Fresh tasks can be created or linked to the carried-forward goal.

### Archive Unfinished

Leaves the goal unfinished in the historical cycle and records that it was intentionally archived.

### Replace

Archives the original goal and creates a new goal with a revised title inside the next cycle.

Goal outcome records preserve historical titles even if related records are later changed or removed.

---

## Next-Cycle Planning

The Week 13 workflow collects:

- Next cycle name
- Primary focus
- Theme
- Start date

The default start date leaves a full Week 13 planning period after the previous 12-week cycle.

The user can revise the proposed date before finalization.

### First-Week Commitments

Up to five commitments can be entered for the first week of the new cycle.

These become normal manual weekly commitments after the new cycle is created.

They are not duplicate tasks.

### Recurring Schedule Review

The review shows currently active recurring schedules.

Recurring rules continue normally into the next cycle and are not duplicated or restarted.

They remain editable through the existing recurring-task controls.

---

## Safe Finalization

Finalizing the review requires two deliberate actions:

1. Press **Finish Review & Start Next Cycle**.
2. Press **Confirm & Start Next Cycle**.

Before finalization, WeekFlow validates:

- Every unfinished goal has an outcome
- Replacement goals have valid titles
- The next-cycle start date is valid
- The next cycle begins after the finished cycle
- First-week commitments are valid and unique

The complete finalization process runs inside one SQLite transaction.

If any operation fails, the transaction rolls back so WeekFlow cannot be left with a partially finalized review or partially created cycle.

---

## Historical Cycle Reports

Past cycle folders now include a collapsible Week 13 report.

The report displays:

- Final statistics
- Written reflection
- Goal outcome labels
- Replacement-goal information
- Carry-forward destinations
- Next-cycle identity and start date
- First-week commitments
- Weekly-review summaries

Historical goal outcomes include:

- Completed
- Carried Forward
- Archived Unfinished
- Replaced

---

## Markdown Report Export

Finalized cycle reports can be exported as Markdown.

On web, the report downloads as a file.

On supported mobile platforms, WeekFlow uses the system sharing flow.

The report includes:

- Cycle identity and dates
- Final cycle statistics
- Goal outcomes
- Written reflection
- Next-cycle plan
- First-week commitments
- Weekly-review summaries

This provides a readable record for personal review and capstone documentation.

---

## Cycle Comparison Foundation

Each completed cycle now stores a stable report snapshot.

This provides the historical data foundation needed for a later cycle-comparison interface without prematurely adding a large analytics screen.

---

## Database Changes

WF-027 adds two relational tables.

### `cycle_reviews`

Stores:

- Cycle relationship
- Seven reflection answers
- Stable cycle statistics
- Next-cycle name
- Next-cycle primary focus
- Next-cycle theme
- Next-cycle start date
- First-week commitments
- Created timestamp
- Updated timestamp
- Finalized timestamp
- Relationship to the created next cycle

### `cycle_goal_outcomes`

Stores:

- Cycle-review relationship
- Original goal relationship
- Historical goal-title snapshot
- Selected outcome
- Replacement title
- Destination goal relationship
- Created timestamp
- Updated timestamp

### Relationship Protection

Database protections prevent invalid:

- Cycle-review relationships
- Original goal relationships
- Destination goal relationships
- Duplicate goal outcomes
- Multiple finalized next-cycle relationships

Historical snapshots remain usable even if optional linked records are later deleted.

---

## Storage and Context Architecture

A new `CycleReviewContext` coordinates review data and refresh behavior.

The main flow is:

`Goals Screen → CycleReviewContext → cycleReviewStorage → SQLite → context refresh → updated interface`

The storage layer handles:

- Loading draft and finalized reviews
- Saving reflection drafts
- Loading unfinished goals
- Saving goal outcomes
- Finalizing the report
- Creating the next cycle
- Copying carried-forward goals and milestones
- Creating replacement goals
- Creating first-week commitments
- Preserving historical links

---

## Backup and Restore

The WeekFlow backup format increased from version 11 to version 12.

Version 12 includes:

- Cycle reviews
- Reflection answers
- Stable cycle-report snapshots
- Goal outcomes
- Carry-forward relationships
- Replacement-goal relationships
- Next-cycle planning fields
- First-week commitments
- Finalized next-cycle links

Backups from versions 1 through 11 remain supported.

Legacy version 11 backups upgrade with empty cycle-review collections.

Backup validation preserves strict relationship and analytics checks.

---

## Validation Fixes

### Expo SQLite Transaction Return Types

Expo SQLite requires `withTransactionAsync` callbacks to return `Promise<void>`.

Two cycle-review storage operations originally returned result objects directly from transaction callbacks.

The corrected implementation:

1. Captures results in variables inside the transaction.
2. Allows the callback to return `void`.
3. Returns the captured result only after the transaction commits successfully.

This satisfies Expo SQLite's TypeScript contract while preserving atomic behavior.

### Backup Test Fixture Consistency

The shared valid-backup fixture originally contained:

- Zero completed goals
- One reward unlocked

That was an impossible analytics combination, so backup validation correctly rejected it and caused multiple tests to fail before reaching their intended assertions.

The fixture now contains consistent analytics:

- Zero completed goals
- Zero rewards unlocked

The production backup validator was not weakened.

---

## Files Added

- `components/CycleReportSummary.tsx`
- `components/CycleReviewPanel.tsx`
- `context/CycleReviewContext.tsx`
- `lib/cycleReviewUtils.ts`
- `lib/cycleReviewStorage.ts`
- `lib/cycleReportExport.ts`
- `__tests__/cycleReviewUtils.test.ts`
- `__tests__/integration/cycleReviewStorage.integration.test.ts`

## Files Updated

- `app/_layout.tsx`
- `app/settings.tsx`
- `app/(tabs)/index.tsx`
- `components/PastCycleFolder.tsx`
- `lib/db.ts`
- `lib/backupValidation.ts`
- `lib/backupStorage.ts`
- `jest.config.js`
- `__tests__/testFactories.ts`
- `__tests__/backupValidation.test.ts`
- `__tests__/integration/backupStorage.integration.test.ts`
- `__tests__/integration/db.integration.test.ts`

---

## Final Validation

WF-027 passed final local validation on the development Mac:

- TypeScript: passed with no errors
- Jest test suites: 23 passed, 23 total
- Jest tests: 171 passed, 171 total
- Snapshots: 0
- Cycle review utility tests: passed
- Cycle review storage integration tests: passed
- Database migration tests: passed
- Backup validation tests: passed
- Backup export and restore tests: passed
- Recurring, weekly review, goal, cycle, and task regression suites: passed

The Node experimental SQLite warning is expected for the current test adapter and did not affect the result.
