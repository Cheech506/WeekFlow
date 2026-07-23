# WF-019 — Settings and Data Management

## Summary

Added a dedicated Settings screen for WeekFlow data management, backup and restore tools, application information, and live database totals. Backup controls were moved out of History so the History screen remains focused on completed tasks, goals, and archived Brain Dumps.

## Changes

### Settings Screen

- Added a Settings screen that opens from a gear icon in the main tab headers.
- Kept Settings outside the permanent bottom-tab navigation.
- Added a safe Back action that returns to the previous screen or falls back to Goals when no navigation history is available.
- Added application and development information, including:
  - WeekFlow version
  - Expo SDK version
  - Node.js development baseline
  - Backup-format version
  - SQLite storage information

### Data Summary

- Added live database counts for:
  - Tasks
  - Goals
  - Brain Dumps
  - Task Templates
  - Recurring schedules
  - Planning cycles
- Added useful active/completed breakdowns where applicable.
- Added a manual Refresh control.

### Backup and Restore

- Moved backup export and import controls from History into Settings.
- Added backup preview information before import.
- Kept destructive restore actions visually separated and clearly explained.
- Preserved compatibility with legacy backups and deleted-goal relationship repair.
- Added device-local tracking for:
  - Last successful export
  - Exported filename
  - Last successful import
  - Imported filename
- Kept device backup activity outside exported WeekFlow backup data.

### Navigation and Context

- Moved shared data providers above the root navigation stack so Settings and the main tabs use the same live application state.
- Removed backup controls from the History screen.
- Added stable task-refresh behavior so refresh functions are not recreated on every render.
- Queued task reloads to prevent overlapping SQLite operations.
- Changed post-import provider refreshes to run sequentially.

### Stability Fixes

- Fixed repeated automatic Settings refreshes.
- Fixed the flashing Refresh button.
- Fixed the maximum-update-depth render loop.
- Fixed SQLite web-worker errors caused by overlapping refresh operations.
- Fixed the development warning caused by attempting to go back when Settings had no previous route.
- Kept Settings refresh manual instead of triggering continuous full-database reloads.

### Testing

- Added SQLite integration coverage for application metadata storage.
- Updated database migration tests for the new metadata table.
- Confirmed existing backup, cycle, task, goal, recurring-task, template, and History tests continued to pass.

## Validation

- Settings opened correctly from the main WeekFlow tabs.
- Settings did not appear as an extra permanent bottom tab.
- Database counts displayed correctly.
- Manual Refresh completed without repeatedly triggering itself.
- Backup import completed without the previous worker or update-depth errors.
- Back navigation worked after opening or directly refreshing Settings.
- The Settings UI and stability fixes were confirmed in the running app.
- Run the complete TypeScript and Jest validation immediately before committing this batch.
