# WF-018 — 12-Week Cycle Dashboard and Legacy Backup Repair

## Summary

Added a dedicated 12-week planning cycle to WeekFlow and combined the cycle timeline and goal-progress information into one dashboard on the Goals screen. Also improved backup compatibility so older SDK54 backups can be imported safely when they contain tasks linked to goals that were previously deleted.

## Changes

### 12-Week Planning Cycle

- Added persistent 12-week planning cycles stored in SQLite.
- A cycle lasts 84 calendar days, including the selected start date.
- Added the current cycle date range and **Week X of 12** display.
- Added calendar progress and days remaining.
- Added cycle-level totals for:
  - Active goals
  - Goals finished during the cycle
  - All tasks finished during the cycle
- Added controls to start a cycle and edit its start date.
- Added support for starting the next cycle without deleting unfinished goals or tasks.
- Added cycle-completion summary support.

### Combined Cycle and Goal Dashboard

- Combined the previous cycle card and separate 12 Week Overview into one **Current 12-Week Cycle** dashboard.
- Added a **Goal progress in this cycle** section.
- Restored the useful SDK54-style goal statistics inside the new combined dashboard:
  - Goals Completed
  - Linked Tasks Done
  - Tasks Remaining
  - Task Progress
- Added linked-task progress totals and a progress bar.
- Clarified the difference between:
  - Total task completions during the cycle
  - Tasks linked to goals that overlap the cycle

### Backup and Restore

- Added planning-cycle data to WeekFlow backups.
- Updated the backup format to version 5.
- Kept older backup versions import-compatible.
- Added repair support for older backups containing tasks, templates, or recurring schedules linked to a goal that no longer exists.
- During import, affected records are preserved and only the invalid goal relationship is cleared.
- Added backup-preview messaging showing how many legacy goal links will be repaired.
- Kept missing recurring-schedule relationships as strict validation errors.
- Prevented expected backup validation failures from producing an unnecessary Expo error overlay.

### Testing

- Added unit tests for 12-week cycle calculations.
- Added SQLite integration tests for planning-cycle storage.
- Updated database migration tests.
- Updated backup validation and restore tests.
- Added coverage for repairing legacy orphaned goal links during backup import.

## Validation

- The combined cycle dashboard was verified in the running app.
- Cycle dates, week number, calendar progress, days remaining, and goal-progress statistics displayed correctly.
- An SDK54 backup containing a task linked to a deleted goal imported successfully.
- The affected task data was preserved while the missing goal relationship was repaired.
- Existing goals and tasks remained available after import.

Run the complete TypeScript and Jest validation immediately before committing this batch.
