# WF-015 — Goal Title Editing

## Summary

Expanded the existing goal editing workflow so users can update a goal's title along with its start and end dates from the same screen.

## Changes

- Renamed the goal action from **Edit Dates** to **Edit Goal**.
- Added goal title editing to the existing goal edit form.
- Updated the goal context so title and date changes can be saved together.
- Updated goal storage logic to persist edited titles.
- Added validation that prevents a goal from being saved with a blank title.
- Preserved linked tasks, goal completion state, and completed goal history when a goal is edited.
- Added integration-test coverage for editing a goal title and rejecting blank titles.

## Validation

- Goal title editing was tested successfully in the app.
- Goal start and end date editing continued to work.
- Saved goal changes remained after refreshing or reopening the app.
- Blank goal titles were rejected.
- TypeScript validation completed without errors.
- All 11 Jest test suites passed.
- All 81 automated tests passed.

## Notes

Most of the larger goal-management workflow was already present before this batch, including goal completion, reopening, date editing, completed-goal history, and the recommended 12–13 week goal duration. WF-015 completed the missing title-editing portion of that workflow.
