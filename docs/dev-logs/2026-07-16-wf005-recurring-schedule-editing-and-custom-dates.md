# Dev Log — WF-005 Recurring Schedule Editing and Custom Date Controls

## Date

July 16, 2026

## Project

WeekFlow

## Branch

`dev`

## Ticket

`WF-005`

## Summary

I completed the next recurring-task update for WeekFlow.

This update adds editing for saved recurring schedules and improves the recurring-date controls used when:

- Creating a new recurring task
- Converting an existing normal task into a recurring task
- Editing an existing saved recurring schedule

The goal was to keep the fast preset options while also allowing fully custom start and end dates.

---

## Edit Saved Recurring Schedules

The Manage Recurring Tasks section now includes an **Edit Schedule** action for each saved schedule.

A saved recurring schedule can now be changed without deleting the schedule and recreating it manually.

The editor supports changing:

- Title
- Notes
- Priority
- Linked goal
- Repeat frequency
- Selected weekdays
- Start date
- Optional end date

Supported repeat types remain:

```text
Daily
Weekly
Certain Days
Monthly
```

---

## Recurring Schedule Update Rules

When an active saved schedule is edited:

- The recurring-rule record is updated.
- Completed occurrences remain unchanged.
- Completed History is preserved.
- Unfinished occurrences from the current date forward are rebuilt from the updated schedule.
- Earlier unfinished occurrences remain available.
- Earlier unfinished occurrences receive the updated title, notes, priority, and linked goal.
- Duplicate-occurrence protection remains active.

This keeps historical records stable while allowing future planning to change.

---

## Paused Schedule Behavior

Editing a paused schedule does not automatically resume it.

A paused schedule:

- Remains paused after saving changes
- Stores the updated schedule settings
- Begins generating from the updated rule only after it is resumed

This prevents an edit from unexpectedly creating new tasks.

---

## New Recurring Task Controls

The recurring-task creation form continues to support quick repeat presets.

Users can create a new recurring task with:

```text
Daily
Weekly
Certain Days
Monthly
```

For Certain Days schedules, users can select the weekdays on which the task repeats.

The form displays upcoming dates for quick selection and now also supports a fully custom first scheduled date.

---

## Custom Start Date

Recurring forms now include a **Custom Date** option for the first scheduled date.

This allows a schedule to begin on any valid calendar date instead of being limited to the upcoming date buttons.

The custom date uses:

```text
YYYY-MM-DD
```

WeekFlow validates the date before saving.

For Certain Days schedules, the custom first date must match one of the selected weekdays.

---

## Repeat-Until Options

The recurring forms now provide both quick presets and a custom end date.

Available options are:

```text
No End
2 Weeks
4 Weeks
12 Weeks
Custom Date
```

The preset buttons make common schedules fast to create.

The Custom Date option allows any valid end date.

The same repeat-until controls are available when:

- Creating a recurring task
- Converting a normal task into a recurring task
- Editing a saved recurring schedule

---

## Date Validation

The updated forms validate recurring schedule dates before saving.

WeekFlow rejects:

- Invalid start dates
- Invalid end dates
- End dates before the start date
- Certain Days schedules whose first date is not one of the selected weekdays
- Missing weekday selections for Certain Days schedules

Invalid date settings do not create or partially update a recurring schedule.

---

## Existing Task Conversion

The recurring controls remain compatible with WF-008.

A normal task can still be edited and converted into a recurring schedule.

During conversion:

- The existing task becomes the first occurrence.
- The task is not duplicated on the first date.
- Future occurrences are generated.
- Title, notes, priority, and linked goal carry into the recurring rule.
- The custom start-date and repeat-until controls are available.

---

## Schedule Management

The existing recurring-schedule controls remain available:

- Edit Schedule
- Pause
- Resume
- Stop Schedule Only
- Delete Schedule and Unfinished Tasks
- Cancel deletion

Deleting a schedule continues to preserve completed History.

---

## Web SQLite Development Fix

During testing, the Expo web app initially failed to load SQLite-backed data in the browser.

The Expo Router web configuration was updated to provide the browser headers required by `expo-sqlite`:

```text
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

This allows WeekFlow to load its web SQLite database correctly through:

```text
http://localhost:8081
```

This configuration change does not alter or reset saved data.

---

## Files Updated

The recurring-schedule feature work includes:

```text
app/(tabs)/inbox.tsx
context/TaskContext.tsx
lib/recurringStorage.ts
__tests__/integration/recurringStorage.integration.test.ts
app.json
```

---

## Database and Data Safety

This update does not add a new database table or require a schema migration.

It does not reset the SQLite database.

The update preserves:

- Completed task History
- Existing goals
- Brain Dump notes
- Weekly reviews
- Unrelated tasks
- Backup data

Only the selected recurring schedule and its applicable unfinished occurrences are changed.

---

## Automated Testing

The recurring-storage integration coverage was expanded to verify saved-schedule editing.

The tests cover:

- Updating an active recurring schedule
- Preserving completed occurrences
- Rebuilding future unfinished occurrences
- Keeping paused schedules paused
- Preventing duplicate occurrences
- Maintaining task-to-rule relationships

Before committing, I ran:

```text
npx tsc --noEmit
npm test
```

Both checks must complete successfully before the update is pushed.

---

## Manual Testing

I manually confirmed:

1. A recurring task can be created.
2. Quick start-date buttons still work.
3. A custom first scheduled date can be entered.
4. No End, 2 Weeks, 4 Weeks, and 12 Weeks presets work.
5. A custom repeat-until date can be entered.
6. A saved recurring schedule can be opened for editing.
7. Title, notes, priority, goal, frequency, dates, and weekdays can be changed.
8. The schedule card displays the updated settings.
9. Completed occurrences remain unchanged.
10. Future unfinished occurrences use the updated schedule.
11. A paused schedule remains paused after editing.
12. A normal task can still be converted into a recurring schedule.
13. The first occurrence is not duplicated.
14. Existing deletion and pause controls continue to work.
15. WeekFlow loads correctly through localhost with web SQLite enabled.

---

## Current Status

WF-005 and the recurring-date control refinement are complete and ready for final TypeScript and automated test verification on the `dev` branch.

---

## Suggested Git Commit

```text
feat: add recurring schedule editing and custom dates
```

---

## Next Step

The next recurring-task phase should add editing scope choices for generated occurrences:

- This occurrence only
- This and future occurrences

Completed and historical occurrences must remain protected.
