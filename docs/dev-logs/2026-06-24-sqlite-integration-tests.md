# Dev Log — SQLite Integration Tests

## Date

June 24, 2026

## Project

WeekFlow

## Summary

Today I added SQLite integration tests to WeekFlow.

The previous automated test suite covered pure TypeScript logic such as dates, streaks, weekly reviews, recurring schedule calculations, and backup validation. This update adds tests that exercise the actual storage layer and database transactions.

The tests use Node's in-memory SQLite database instead of the real WeekFlow database. This keeps the test environment completely separate from the app's saved tasks, goals, brain dumps, recurring schedules, and history.

All 47 tests passed.

---

## What I Added

I added five SQLite integration test suites covering:

```txt
Database migrations
Task storage
Goal storage
Brain dump storage
Recurring task storage
Backup restoration
Transaction rollback
```

The full test suite now includes:

```txt
10 passing test suites
47 passing tests
No TypeScript errors
```

---

## Test Database Safety

The integration tests do not open or modify the real `weekflow.db` database.

Inside Jest, `expo-sqlite` is replaced by a test-only adapter that creates:

```txt
DatabaseSync(':memory:')
```

Each test suite receives a temporary in-memory SQLite database.

The test database:

```txt
Does not create a database file
Does not connect to the Expo Simulator database
Does not use the production WeekFlow data
Disappears when the test process finishes
```

This allowed me to test destructive database operations such as backup replacement and recurring-rule deletion without risking the real app data.

---

## Migration Tests

I added tests for the database initialization and migration logic in `lib/db.ts`.

The tests confirm that:

```txt
All required tables are created
Migrations can run more than once safely
The task table receives newer columns
Indexes are created
Legacy scheduled tasks receive due dates
Existing legacy task records are preserved
```

The migration test creates an older version of the task table, inserts a legacy task, and then runs the current migrations.

After the migration, the task still exists and has a valid due date.

---

## Task Storage Tests

I added integration tests for `lib/taskStorage.ts`.

The tests confirm that:

```txt
Tasks can be inserted
Tasks can be read from SQLite
Titles and notes are trimmed
Task edits persist
Priorities persist
Tasks can be completed
Completion timestamps are saved
Tasks can be scheduled using a real date
The weekday updates from the due date
Moving a task to Inbox clears its due date
Invalid due dates are rejected
Deleting a recurring occurrence creates an exception
Deleted recurring occurrences are removed from the task table
```

These tests call the real storage functions rather than testing isolated helper calculations.

---

## Goal Storage Tests

I added database tests for `lib/goalStorage.ts`.

The tests confirm that:

```txt
Goals can be inserted
Goal titles are trimmed
Goals can be marked complete
Completion timestamps are stored
Goals can be deleted
Deleted goals no longer appear in the database
```

---

## Brain Dump Storage Tests

I added database tests for `lib/brainDumpStorage.ts`.

The tests confirm that:

```txt
Brain Dump notes can be inserted
Note text is trimmed
Notes can be archived
Archive timestamps are stored
Notes can be restored
Archive timestamps are cleared on restore
Notes can be deleted
```

---

## Recurring Task Storage Tests

I added database tests for `lib/recurringStorage.ts`.

The tests confirm that:

```txt
Recurring rules generate task occurrences
Running generation again does not create duplicates
Paused rules do not generate tasks
Stop Schedule Only keeps generated tasks
Stopped tasks are detached from the recurring rule
Delete Schedule and Unfinished Tasks removes incomplete occurrences
Completed recurring tasks remain in History
Remaining completed tasks are detached from the deleted rule
```

The duplicate-generation test checks the number of tasks before and after running the generator a second time.

The count remains unchanged because the unique recurring occurrence index prevents duplicate tasks.

---

## Backup Restore Tests

I added integration tests for `replaceWeekFlowData` in `lib/backupStorage.ts`.

The tests confirm that:

```txt
Existing test data is removed during a valid restore
Tasks are restored
Goals are restored
Brain Dump notes are restored
Backup counts are returned correctly
The restore runs inside a database transaction
A failed insert rolls back the full restore
Original data remains after a failed restore
```

The rollback test creates a temporary SQLite trigger that intentionally rejects one restored task.

The restore fails, but the original task remains in the database. This confirms that WeekFlow does not leave the database partially replaced when an import fails.

---

## Jest Test Adapter

I added a Jest-only SQLite adapter:

```txt
__tests__/helpers/expoSqliteNodeAdapter.js
```

The adapter implements the Expo SQLite methods used by WeekFlow:

```txt
execAsync
runAsync
getAllAsync
getFirstAsync
withTransactionAsync
closeAsync
```

It uses Node's built-in SQLite support and opens only an in-memory database.

I also added small mocks for:

```txt
react-native
expo-document-picker
```

These mocks prevent native modules from loading during database tests while still allowing the storage code to be imported.

---

## Files I Added

```txt
__tests__/helpers/expoSqliteNodeAdapter.js
__tests__/helpers/reactNativeMock.js
__tests__/helpers/documentPickerMock.js
__tests__/integration/db.integration.test.ts
__tests__/integration/taskStorage.integration.test.ts
__tests__/integration/goalBrainDump.integration.test.ts
__tests__/integration/recurringStorage.integration.test.ts
__tests__/integration/backupStorage.integration.test.ts
```

---

## Files I Updated

### `jest.config.js`

I added Jest module mappings for the SQLite adapter and native-module mocks.

I also added the database and storage files to the coverage list.

---

## Testing Results

I ran:

```txt
npx tsc --noEmit
npm test
```

TypeScript completed without errors.

The final Jest result was:

```txt
Test Suites: 10 passed, 10 total
Tests:       47 passed, 47 total
Snapshots:   0 total
```

---

## Current Testing Coverage

WeekFlow now has automated coverage for:

```txt
Date utilities
Progress statistics
Current and longest streaks
Weekly review calculations
Recurring schedule calculations
Backup validation
Database migrations
Task storage
Goal storage
Brain Dump storage
Recurring database operations
Backup restoration
Transaction rollback
```

---

## Current Status

WeekFlow now has both unit tests and SQLite integration tests.

The application logic and storage layer can be checked automatically before new changes are committed.

The tests remain isolated from the real WeekFlow database, so running them does not remove or modify saved app data.

---

## Git Commit

```txt
test: add SQLite integration coverage
```

---

## Next Step

The next testing improvement could add React Context and screen interaction tests for task creation, completion, scheduling, recurring-task controls, and backup actions.
