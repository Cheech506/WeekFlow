# WF-020 — Optional Goal Rewards

## Summary

Added optional rewards to WeekFlow goals so users can attach a simple motivational reward to a goal without introducing XP, coins, leaderboards, or other game systems.

## Changes

### Goal Rewards

- Added an optional reward field when creating a goal.
- Added reward editing and removal through **Edit Goal**.
- Limited reward text to 200 characters.
- Stored blank reward entries as no reward.
- Preserved rewards when goals are reopened.
- Displayed rewards on active goal cards only when a reward exists.
- Displayed completed rewards as **Reward Unlocked** in completed-goal History.
- Included reward text when searching completed goals.

### Database and Storage

- Added reward storage to the goals table.
- Added migration support for existing databases.
- Updated goal storage functions to create, edit, read, complete, reopen, and delete goals without losing reward data.
- Added reward validation and normalization helpers.

### Backup and Restore

- Updated the WeekFlow backup format to version 6.
- Added goal rewards to backup export and restore.
- Kept backup versions 1 through 5 import-compatible.
- Older backups import goals with no reward attached.
- Preserved rewards during backup validation, upgrade, preview, and restoration.

### Testing

- Added unit tests for reward validation and normalization.
- Updated goal integration tests for creating, editing, removing, completing, and reopening rewards.
- Updated database migration tests.
- Updated backup validation and restore tests.
- Added coverage for upgrading older backups that do not contain reward data.

## Validation

- Creating a goal without a reward worked normally.
- Creating a goal with a reward displayed the reward correctly.
- Editing and removing a reward worked correctly.
- Completing a rewarded goal displayed **Reward Unlocked** in History.
- Reopening a goal preserved its reward.
- Backup export and restore preserved reward data.
- Older backups continued to import normally.
- Run the complete TypeScript and Jest validation immediately before committing this batch.
