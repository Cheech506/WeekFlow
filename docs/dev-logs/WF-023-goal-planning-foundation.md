# WF-023 — Goal Planning Foundation

## Summary

Expanded WeekFlow goals from simple titles and date ranges into structured planning records. Goals can now include an optional purpose, success definition, planning notes, and milestones while still allowing users to create a basic goal quickly.

The feature was designed to strengthen WeekFlow's 12-week planning workflow without turning goals into a complicated project-management system.

## User-Facing Changes

### Optional Planning Details

The goal creation form now includes a collapsed **Planning Details** section. Keeping this section collapsed preserves the existing quick goal-creation workflow.

Users can optionally add:

- **Purpose** — explains why the goal matters.
- **Success Definition** — describes the specific result that counts as completing the goal.
- **Goal Notes** — stores plans, ideas, links, reminders, or other useful information.

Blank planning fields are stored as no value and are not displayed on the goal card. This prevents empty headings and unnecessary visual clutter.

Planning details can be added, edited, changed, or removed later through **Edit Goal**.

### Goal Milestones

Each active goal now has a collapsible **Milestones** section.

A milestone represents a major checkpoint within a goal rather than an individual task. For example:

- Goal: Build a database portfolio
- Milestone: Complete the MySQL backup and recovery lab
- Task: Write the backup script

Each milestone supports:

- Title
- Optional target date
- Optional notes
- Completion status
- Completion timestamp
- Editing
- Reopening
- Deletion

Goal cards show a compact milestone summary such as:

`2 of 4 completed`

The milestone-management section remains collapsed by default so goal cards do not become unnecessarily large.

## Goal Lifecycle Support

Planning information and milestones remain connected to the goal throughout its lifecycle.

Supported behavior includes:

- Creating a goal with or without planning details
- Editing planning details
- Clearing individual planning fields
- Adding milestones after goal creation
- Completing and reopening milestones
- Editing milestone information
- Deleting milestones
- Completing a goal without deleting its planning information
- Reopening a completed goal with its planning information and milestones intact
- Deleting a goal and automatically removing its milestones

The polished completed-goal presentation is intentionally reserved for the next goal-review batch, but the underlying WF-023 data is already preserved.

## Database Changes

### Goals Table

Added nullable goal fields for:

- `purpose`
- `success_definition`
- `notes`

These fields are optional so existing goals remain valid and simple goals do not require extra information.

### Goal Milestones Table

Added a relational `goal_milestones` table for milestone records.

Milestones are stored separately instead of placing them directly inside the goal record because one goal may contain any number of milestones. This creates a one-to-many relationship:

`One goal → many milestones`

The milestone table stores:

- Unique milestone ID
- Parent goal ID
- Title
- Optional notes
- Optional target date
- Completion state
- Creation timestamp
- Completion timestamp

### Relationship and Cleanup Protection

Added database safeguards to:

- Prevent milestones from referencing nonexistent goals
- Remove milestones when their parent goal is deleted
- Repair orphaned milestone data if invalid records are encountered during migration
- Improve milestone lookup performance with indexes

These protections keep the relational data consistent even if an operation fails or older data contains a problem.

## Database Migration

Existing WeekFlow installations are upgraded automatically.

The migration:

1. Detects whether the new goal-planning columns already exist.
2. Adds only the missing columns.
3. Creates the milestone table when needed.
4. Creates milestone indexes and relationship protections.
5. Repairs invalid orphaned milestone records.
6. Preserves all existing goals, rewards, dates, tasks, and completion information.

Existing goals receive no purpose, success definition, notes, or milestones until the user chooses to add them.

## Goal Context and Storage

The goal storage layer was expanded to read and write the new planning fields.

New milestone storage operations support:

- Loading milestones
- Creating milestones
- Updating milestones
- Completing milestones
- Reopening milestones
- Deleting milestones

GoalContext coordinates these operations with the UI and refreshes goal and milestone state after successful changes.

This preserves the existing WeekFlow flow:

`Screen → GoalContext → storage function → SQLite → context refresh → updated UI`

## Validation and Normalization

Added shared goal-planning validation so the UI and storage layer follow consistent rules.

Validation covers:

- Required milestone titles
- Maximum field lengths
- Optional values
- Blank value normalization
- Valid calendar dates
- Trimming surrounding whitespace

Blank optional text is normalized to no value rather than storing meaningless empty strings.

## Backup and Restore

The WeekFlow backup format was increased from version 6 to version 7.

Version 7 backups now include:

- Goal purpose
- Goal success definition
- Goal notes
- Goal milestones
- Milestone notes
- Milestone target dates
- Milestone completion state
- Milestone completion timestamps

Backup versions 1 through 6 remain supported.

When an older backup is imported:

- Existing goals are preserved.
- Planning fields are initialized as empty.
- No milestones are created unless the backup contains them.
- The backup is upgraded into the current internal structure before restoration.

Backup previews and Settings data summaries now include milestone counts.

## Testing Added or Updated

WF-023 includes automated coverage for:

- Goal-planning validation and normalization
- Creating goals with planning details
- Creating goals without planning details
- Editing and clearing planning fields
- Creating milestones
- Editing milestones
- Completing milestones
- Reopening milestones
- Deleting milestones
- Milestone cleanup when deleting a goal
- Preserving milestones when completing and reopening a goal
- Fresh database creation
- Existing database migration
- Backup version 7 validation
- Legacy backup upgrades
- Backup export and restore
- Restoring goal-planning fields and milestone records

## Files Added

- `components/GoalMilestoneManager.tsx`
- `lib/goalPlanningUtils.ts`
- `lib/goalMilestoneStorage.ts`
- `__tests__/goalPlanningUtils.test.ts`

## Files Updated

- `app/(tabs)/index.tsx`
- `app/settings.tsx`
- `context/GoalContext.tsx`
- `lib/db.ts`
- `lib/goalStorage.ts`
- `lib/backupValidation.ts`
- `lib/backupStorage.ts`
- `__tests__/testFactories.ts`
- `__tests__/backupValidation.test.ts`
- `__tests__/integration/goalBrainDump.integration.test.ts`
- `__tests__/integration/backupStorage.integration.test.ts`
- `__tests__/integration/db.integration.test.ts`

## Validation Before Commit

Before committing WF-023, confirm:

- TypeScript validation passes.
- All Jest suites pass.
- Existing goals remain intact.
- A simple goal can still be created without planning details.
- Purpose, success definition, and notes can be created, edited, and cleared.
- Milestones can be created, edited, completed, reopened, and deleted.
- Goal completion and reopening preserves planning data.
- Settings displays the milestone count.
- Backup export and restore preserves goal-planning information and milestones.
