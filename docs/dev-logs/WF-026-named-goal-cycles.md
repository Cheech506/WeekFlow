# WF-026 — Named Goal Cycles

## Summary

Expanded WeekFlow planning cycles into explicit goal containers. Each 12-week cycle can now have an optional name, primary focus, and theme, while goals store a direct relationship to the cycle they belong to.

This change replaces date-overlap guessing with a clear relational structure:

`Planning Cycle → Goals → Milestones → Linked Tasks`

The goal was to make each 12-week period easier to organize, review, preserve historically, and use later for Week 13 reports and next-cycle planning.

## User-Facing Changes

### Named Planning Cycles

When starting or editing a planning cycle, users can optionally add:

- **Cycle Name** — a recognizable label such as `Summer 2026`
- **Primary Focus** — the main purpose connecting the cycle's goals
- **Cycle Theme** — a short phrase describing the direction of the cycle

All three fields are optional.

When no name is entered, WeekFlow continues using the existing fallback labels:

- Cycle 1
- Cycle 2
- Cycle 3

### Active Cycle Display

The active cycle card now shows:

- Cycle name or fallback number
- Cycle sequence number
- Start and end dates
- Current week
- Calendar progress
- Days remaining
- Primary focus when available
- Theme when available
- Goal and task summary information

The active goal list is labeled using the current cycle identity, such as:

`Goals in Summer 2026`

### Goals as Cycle Contents

Goals now belong to a specific planning cycle through an explicit database relationship.

Goals created while a cycle is active are automatically assigned to that cycle.

Before a cycle exists, goals are shown as waiting for a cycle. Starting the first cycle assigns existing active goals to it so users do not lose or manually recreate their current goals.

Later cycles do not automatically copy or move goals from earlier cycles. Carry-forward remains an intentional decision reserved for the Week 13 workflow.

### Past Cycle Folders

Previous cycles now appear as collapsible historical folders.

Each folder shows:

- Cycle name
- Date range
- Primary focus
- Theme
- Number of completed goals
- Number of unfinished goals
- Goals that belonged to that cycle
- Completion state for each goal

Past cycle folders are read-only in WF-026. Future Week 13 work will add reflection, carry-forward, and next-cycle planning actions.

## Existing Goal Preservation

The migration preserves existing:

- Goal titles
- Start and end dates
- Rewards
- Purpose
- Success definitions
- Goal notes
- Milestones
- Goal analytics
- Completion reflections
- Linked tasks
- Completed-goal History

When the first cycle is created, existing active goals are assigned to it.

Completed legacy goals are assigned only when their dates match the historical cycle being migrated. This prevents unrelated completed goals from being placed into the wrong cycle.

## Database Changes

### Planning Cycles Table

Added optional columns for:

- `name`
- `primary_focus`
- `theme`

### Goals Table

Added:

- `cycle_id`

This creates a one-to-many relationship:

`One planning cycle → many goals`

### Relationship Protection

Added database safeguards to:

- Prevent goals from referencing nonexistent cycles
- Clear or repair invalid cycle links
- Preserve valid goals if a cycle relationship becomes invalid
- Improve goal loading by cycle through indexes

The old date-overlap logic is used only during migration and legacy backup upgrading. Normal application behavior now relies on the explicit `cycle_id` relationship.

## Database Migration

Existing installations upgrade automatically.

The migration:

1. Detects missing cycle identity columns.
2. Adds the optional cycle name, focus, and theme fields.
3. Detects whether goals already contain `cycle_id`.
4. Adds the goal-cycle relationship when needed.
5. Backfills legacy goals into the most appropriate overlapping cycle.
6. Prefers the active or newest matching cycle when date ranges overlap.
7. Creates relationship validation and lookup indexes.
8. Preserves all existing goal and task data.

Goals intentionally left outside a cycle remain unassigned after migration and are not repeatedly reassigned at every startup.

## Context and Storage Changes

### Cycle Storage

Cycle storage now supports:

- Creating a named cycle
- Editing cycle identity
- Loading active and historical cycles
- Loading goal counts by cycle
- Preserving cycle identity through date edits

### Goal Storage

Goal creation now stores the active cycle ID when available.

Goal loading supports:

- Active-cycle goals
- Goals waiting for a cycle
- Historical goals grouped by cycle

### Context Refresh

CycleContext and GoalContext coordinate refreshes after:

- Starting a cycle
- Editing cycle details
- Creating a goal
- Assigning existing goals to the first cycle
- Restoring a backup

This keeps the active cycle card and goal folders synchronized without requiring an app restart.

## Validation and Normalization

Added shared validation for cycle identity fields.

Rules include:

- Cycle name maximum: 80 characters
- Primary focus maximum: 300 characters
- Theme maximum: 120 characters
- Surrounding whitespace is trimmed
- Blank optional values are stored as no value
- Empty focus and theme sections are not rendered

## Backup and Restore

The backup format increased from version 10 to version 11.

Version 11 backups include:

- Cycle names
- Primary focus
- Cycle themes
- Explicit goal-to-cycle relationships
- Historical cycle-folder structure

Backup versions 1 through 10 remain supported.

When importing a legacy backup:

- Missing cycle identity fields become empty
- Existing goals are matched to an appropriate overlapping cycle
- Active or newer matching cycles are preferred
- The backup is upgraded into the version 11 structure before restoration

## Files Added

- `components/CycleIdentityFields.tsx`
- `components/PastCycleFolder.tsx`
- `lib/cycleIdentityUtils.ts`
- `__tests__/cycleIdentityUtils.test.ts`

## Files Updated

- `app/(tabs)/index.tsx`
- `context/CycleContext.tsx`
- `context/GoalContext.tsx`
- `lib/cycleStorage.ts`
- `lib/goalStorage.ts`
- `lib/db.ts`
- `lib/backupValidation.ts`
- `lib/backupStorage.ts`
- `jest.config.js`
- `__tests__/testFactories.ts`
- `__tests__/backupValidation.test.ts`
- `__tests__/integration/cycleStorage.integration.test.ts`
- `__tests__/integration/db.integration.test.ts`
- `__tests__/integration/backupStorage.integration.test.ts`

## Validation

WF-026 passed final local validation:

- TypeScript: passed with no errors
- Jest test suites: 21 passed, 21 total
- Jest tests: 162 passed, 162 total
- Snapshots: 0
- Cycle identity unit tests: passed
- Cycle storage integration tests: passed
- Database migration tests: passed
- Backup validation and restore tests: passed

The Node experimental SQLite warning is expected for the current test adapter and did not affect the test result.

The Expo Go compatibility message shown during device testing is separate from the WF-026 code and automated test results.
