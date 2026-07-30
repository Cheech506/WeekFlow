# WF-024 — Goal Review and Completion

## Summary

Expanded WeekFlow's goal system with focused analytics, a simple and explainable goal-health status, optional completion reflections, completion snapshots, and a more detailed completed-goal History experience.

The purpose of this batch was to make goal completion meaningful and reviewable without introducing a large standalone analytics system or an artificial productivity score.

## User-Facing Changes

### Goal Analytics

Active goal cards now include a focused analytics section showing:

- Linked tasks completed
- Linked tasks remaining
- Total linked tasks
- Linked-task completion percentage
- Milestones completed
- Milestones remaining
- Total milestones
- High-priority linked tasks completed
- Most recent completed task or milestone

The analytics are generated from the goal's existing linked tasks and milestone records. No duplicate analytics data is stored for active goals.

### Simple Goal Health

Active goals now receive one clear health status:

- **Healthy** — linked work was completed within the last seven days.
- **Needs Attention** — linked work exists, but nothing has been completed within the last seven days.
- **No Activity Yet** — no linked task or milestone has been completed.
- **Completed** — the goal has been marked complete.

Each health status includes a plain-language explanation. WeekFlow does not use a hidden score, goal-pace prediction, or complicated formula.

Examples:

- `A linked task was completed today.`
- `No linked task or milestone has been completed in 20 days.`
- `Complete a linked task or milestone to begin tracking activity.`

### Goal Completion Reflection

Pressing **Mark Complete** now opens a completion panel before the goal is finalized.

The reflection includes four optional prompts:

- What helped you succeed?
- What was the hardest part?
- What did you learn?
- What would you do differently next time?

Every reflection field is optional. A goal can still be completed without entering any written response.

If a completed goal is reopened and later completed again, the previous reflection is loaded back into the completion form so it can be reviewed or updated.

### Goal Completion Snapshot

When a goal is completed, WeekFlow records a snapshot of the goal's results at that moment.

The snapshot stores:

- Linked tasks completed
- Total linked tasks
- Milestones completed
- Total milestones
- High-priority linked tasks completed
- Completion timestamp
- Reflection responses

This snapshot prevents later task or milestone edits from silently rewriting the historical result shown for a completed goal.

Active-goal analytics continue to use current live data. Completed-goal History uses the saved completion snapshot when available.

### Better Completed-Goal History

Completed goals now show a richer summary containing:

- Planned start date
- Planned end date
- Actual completion date
- Goal duration
- Linked-task completion result
- Milestone completion result
- High-priority linked tasks completed
- Reward unlocked
- Reopen Goal action

Each completed goal also includes a collapsed **View Goal Review** section.

The review section can show:

- Purpose
- Success definition
- Goal notes
- Individual milestone results
- Milestone target dates
- Milestone notes
- Goal-completion reflection

The section remains collapsed by default to keep History readable when many completed goals exist.

### Goal Reopening

Reopening a goal:

- Returns it to the active Goals screen
- Preserves purpose, success definition, and notes
- Preserves milestones and milestone completion state
- Preserves the previous completion reflection
- Preserves the previous completion snapshot
- Allows the goal to be completed again with updated results

Completing the reopened goal creates a new current completion result using the latest task, milestone, and reflection data.

## Goal Review Calculations

Added a shared goal-review utility module responsible for:

- Counting linked tasks
- Counting completed and remaining tasks
- Calculating linked-task completion percentage
- Counting completed and remaining milestones
- Counting completed high-priority tasks
- Finding the most recent linked completion activity
- Calculating the goal-health status
- Producing plain-language health explanations
- Calculating completed-goal duration
- Creating completion snapshots

Keeping these calculations in a shared utility prevents the Goals and History screens from implementing different versions of the same logic.

## Database Changes

The goals table now includes optional columns for completion reflections:

- What helped
- Hardest part
- What was learned
- What would be done differently

The goals table also includes completion-snapshot fields for:

- Completed linked-task count
- Total linked-task count
- Completed milestone count
- Total milestone count
- Completed high-priority linked-task count

The snapshot fields are nullable because active goals and goals completed before this migration may not have a saved snapshot.

## Database Migration

Existing WeekFlow databases upgrade automatically.

The migration:

1. Checks which WF-024 columns already exist.
2. Adds only missing reflection and snapshot columns.
3. Preserves all existing goal, task, milestone, reward, and cycle data.
4. Leaves older completed goals valid even when they do not yet have a completion snapshot.
5. Allows History to fall back to available current data for legacy completed goals.

No existing user data needs to be deleted or recreated.

## Goal Context and Storage

Goal storage now supports completing a goal with:

- Optional reflection responses
- A calculated completion snapshot
- The completion timestamp

GoalContext coordinates:

1. Loading the current linked tasks and milestones.
2. Building the completion analytics snapshot.
3. Normalizing optional reflection fields.
4. Saving the completion information in SQLite.
5. Refreshing the goal and milestone state.
6. Updating the Goals and History screens.

The existing architecture remains:

`Screen → GoalContext → goal storage → SQLite → context refresh → updated UI`

## Backup and Restore

The WeekFlow backup format increased from version 7 to version 8.

Version 8 backups include:

- Goal-completion reflection fields
- Linked-task completion snapshot
- Milestone completion snapshot
- High-priority completion snapshot

Backups from versions 1 through 7 remain supported.

During a legacy backup import:

- Existing goal data is preserved.
- Missing reflection fields are initialized as empty.
- Missing completion snapshots are initialized as unavailable.
- The imported data is upgraded into the current version 8 structure before restoration.

Backup validation checks the new fields while still allowing valid older backup formats.

## Testing Added or Updated

WF-024 added or updated automated coverage for:

- Active goal task analytics
- Milestone analytics
- High-priority completion counts
- Recent goal activity
- Healthy goal status
- Needs Attention goal status
- No Activity Yet status
- Clear health explanations
- Goal duration calculation
- Completion snapshot creation
- Completing a goal with reflection responses
- Completing a goal without reflection responses
- Reopening a completed goal
- Preserving goal planning and milestone data
- Re-completing a reopened goal
- Database migration for reflection and snapshot fields
- Version 8 backup validation
- Version 7 backup upgrade
- Reflection backup and restore
- Completion-snapshot backup and restore

A date-construction issue in the new goal-review unit test was corrected. The production calculation was working correctly; the test mixed the project's one-based date helper with JavaScript's zero-based `Date` month argument. The test now uses the shared date helper consistently.

## Files Added

- `components/GoalAnalyticsCard.tsx`
- `components/GoalCompletionPanel.tsx`
- `lib/goalReviewUtils.ts`
- `__tests__/goalReviewUtils.test.ts`

## Files Updated

- `app/(tabs)/index.tsx`
- `app/(tabs)/history.tsx`
- `context/GoalContext.tsx`
- `lib/db.ts`
- `lib/goalStorage.ts`
- `lib/backupValidation.ts`
- `lib/backupStorage.ts`
- `jest.config.js`
- `__tests__/testFactories.ts`
- `__tests__/backupValidation.test.ts`
- `__tests__/integration/goalBrainDump.integration.test.ts`
- `__tests__/integration/backupStorage.integration.test.ts`
- `__tests__/integration/db.integration.test.ts`

## Validation

WF-024 passed the final local validation on the development Mac:

- TypeScript: passed with no errors
- Jest test suites: 19 passed, 19 total
- Jest tests: 139 passed, 139 total
- Snapshots: 0
- Goal-review date regression test: passed
- Existing integration suites: passed

The Node experimental SQLite warning is expected for the current Node test adapter and did not affect the test result.
