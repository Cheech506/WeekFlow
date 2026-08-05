# WF-028 — Goal-Centered Dashboard

## Summary

Upgraded the Goals tab into WeekFlow's main dashboard while keeping the app's existing workflow intact:

- Inbox remains the task-capture and scheduling center.
- Daily remains the focused execution view.
- Weekly remains the planning and review view.
- Goals now acts as the cycle command center.

The dashboard surfaces the most useful current-cycle information without adding a new tab or creating a large analytics screen.

WF-028 also fixes completed-cycle date editing so a cycle whose end date has passed can still be corrected until its Week 13 review is finalized.

---

## Goal-Centered Dashboard

The Goals tab title now presents the screen as the WeekFlow Dashboard.

The active-cycle section continues to show:

- Cycle name
- Current week
- Cycle dates
- Days remaining
- Primary focus
- Theme
- Calendar progress

The dashboard then adds focused summaries for today, the current week, streaks, and active goals.

---

## Today Summary

The dashboard displays:

- Tasks completed today
- Scheduled tasks still remaining today
- Overdue tasks
- Today's completion percentage

An **Open Daily** action navigates directly to the Daily tab.

All values are derived from existing task data and completion timestamps.

No duplicate analytics records are stored.

---

## Weekly Commitments

The current week's commitments are summarized directly on the dashboard.

The section shows:

- Completed commitment count
- Total commitment count
- Up to the first three commitments
- Whether a commitment is linked to a task
- Live linked-task titles
- Live linked-task completion state

An **Open Weekly** action navigates directly to the Weekly tab.

Linked commitments continue to use the same synchronization behavior already implemented in WF-025.

---

## Streak Summary

The dashboard includes:

- Current completion streak
- Longest completion streak

These values reuse WeekFlow's existing task-completion history instead of introducing a second streak calculation system.

---

## Goal Health Overview

Each active goal in the current cycle receives a compact dashboard row showing:

- Goal title
- Completed linked tasks
- Total linked tasks
- Task progress percentage
- Completed milestones
- Total milestones
- Goal-health status
- Plain-language health explanation

Goals are ordered so the most actionable items appear first:

1. Needs Attention
2. No Activity Yet
3. Healthy

The full existing goal cards remain below the dashboard for editing, milestone management, completion, reflection, and other detailed goal work.

---

## Cycle Details

The previous cycle-wide totals were preserved but moved into a collapsed **Cycle Details** section.

This section includes:

- Days remaining
- Active goals
- Completed goals
- Completed tasks
- Linked-task progress
- Cycle-wide totals

Keeping these details collapsed reduces visual clutter while preserving all previously available information.

---

## Navigation

The dashboard adds direct navigation to:

- Daily
- Weekly

This provides quick access to execution and planning without duplicating those screens inside the dashboard.

No new tab was added.

---

## Completed-Cycle Date Editing Fix

A cycle whose end date has passed is not automatically treated as historically locked.

The corrected behavior is:

### End Date Passed, Review Not Finalized

The Week 13 review remains visible.

An **Edit Cycle Dates** action is also available so the user can correct:

- Cycle start date
- Calculated end date
- Cycle name
- Primary focus
- Theme

The editor warns that changing the dates may hide the Week 13 review until the cycle ends again.

### Week 13 Review Finalized

Once the Week 13 review is finalized and the next cycle is created, the prior cycle becomes historical and remains locked.

This protects:

- Historical cycle-report snapshots
- Goal outcomes
- Carried-forward goal relationships
- Replacement-goal relationships
- Next-cycle relationships

The fix distinguishes a cycle that is merely date-complete from a cycle that is formally finalized.

---

## Data and Backup Impact

WF-028 introduces no new database tables and requires no migration.

All dashboard values are derived from existing:

- Tasks
- Goals
- Goal milestones
- Weekly commitments
- Planning cycles
- Completion history

The backup format remains version 12.

No backup-validation or restore changes were required.

---

## Files Added

- `components/GoalDashboardOverview.tsx`
- `lib/dashboardUtils.ts`
- `__tests__/dashboardUtils.test.ts`

## Files Updated

- `app/(tabs)/index.tsx`
- `jest.config.js`

---

## Validation

The following behavior was manually confirmed:

- The dashboard renders correctly.
- The active cycle remains visible.
- Today's task summary appears.
- Weekly commitments appear.
- Goal-health summaries appear.
- Goals needing attention are prioritized.
- Daily and Weekly navigation works.
- Cycle Details expands and collapses.
- Existing goal workflows remain available.
- Week 13 remains visible after the cycle end date.
- Edit Cycle Dates appears before finalization.
- Restoring the real cycle date returns the cycle to active status.
- Week 13 hides again when the cycle is no longer complete.
- Finalized historical cycles remain protected.

Recommended final automated validation before commit:

```bash
npx tsc --noEmit
npm test
```

Expected suite total after WF-028:

- 24 test suites
- 173 tests
