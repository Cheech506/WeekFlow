# WF-016 — Task Templates

## Summary

Added reusable task templates to the WeekFlow Inbox so commonly created tasks can be saved and reused without re-entering the same details each time.

## Changes

- Added a new `task_templates` SQLite table.
- Added task-template storage functions for creating, reading, editing, and deleting templates.
- Added a **Task Templates** section to the Inbox.
- Added controls to:
  - Save the current Quick Task details as a template
  - Load a template into the Quick Task form
  - Add a task directly to Inbox from a template
  - Edit an existing template
  - Delete a template
- Templates store:
  - Title
  - Notes
  - Priority
  - Optional linked goal
- Templates intentionally do not store recurring-task settings.
- Added a collapsible Task Templates dropdown.
- The dropdown:
  - Starts collapsed
  - Shows the number of saved templates
  - Expands or collapses with an arrow control
  - Automatically opens after a new template is saved
- Updated goal cleanup behavior so deleting a goal safely unlinks any templates that referenced it.
- Updated WeekFlow backup support to include task templates.
- Updated the backup format to version 4 while keeping older backup versions import-compatible.
- Added task-template counts to backup previews.
- Added automated tests for template storage, relationships, backup validation, and backup restoration.

## Validation

- Task templates were successfully created, loaded, edited, used to create Inbox tasks, deleted, and persisted after refresh.
- The Task Templates dropdown opened and collapsed correctly.
- The template count displayed correctly.
- TypeScript validation completed without errors.
- All 12 Jest test suites passed.
- All 86 automated tests passed.

## Notes

Task templates are kept separate from recurring schedules. Templates are intended for quickly reusing common task details, while recurring schedules continue to be managed through the existing recurring-task workflow.
