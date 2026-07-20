# WeekFlow Dev Log — WF-012 / WF-013

**Date:** July 20, 2026  
**Branch:** `dev`

## What I worked on

I worked on making WeekFlow backups safer and making storage errors easier to understand.

The main focus was making sure a bad backup file cannot damage the current database and making the restore process clearer before anything gets replaced.

## Backup format update

I updated the WeekFlow backup format from version 2 to version 3.

New backups now include:

- the backup format version
- the WeekFlow app version
- the data model version
- the export date and time

Older version 1 and version 2 backups are still supported. They are upgraded in memory during import instead of being changed on disk.

This gives WeekFlow a better way to handle backup compatibility as the app keeps changing.

## Restore preview

I improved the restore preview shown before data is replaced.

The preview now shows:

- backup filename
- export date
- WeekFlow version
- number of tasks
- number of goals
- number of Brain Dump notes
- number of recurring schedules
- number of skipped recurring occurrences

Older backups also show that they will be upgraded during restore.

This makes it easier to confirm that the correct backup file was selected before replacing current data.

## Stronger backup validation

I added more detailed validation for the backup contents.

WeekFlow now checks:

- record IDs
- task titles
- Brain Dump text
- task days
- due dates
- priorities
- completion values
- goal date ranges
- recurring start and end dates
- recurring frequency
- weekday values
- duplicate weekdays
- goal links
- recurring schedule links
- duplicate recurring occurrences
- duplicate skipped occurrences

The error messages now point to the specific record and field that failed instead of only saying the backup is invalid.

## Restore safety

Backup validation now happens before the restore transaction begins.

The restore process now follows this order:

```text
Read file
Validate backup
Show preview
Ask for confirmation
Start transaction
Replace data
Verify restored counts
Commit
```

After the records are inserted, WeekFlow counts each restored table before committing.

It checks:

- tasks
- goals
- Brain Dumps
- recurring schedules
- recurring exceptions

If a count does not match the backup, the transaction is rolled back and the previous data stays unchanged.

I added comments around the transaction and verification logic so it is clear why the checks happen before the commit.

## File-size protection

WeekFlow now rejects backup files larger than 25 MB.

This prevents the app from trying to load a large unrelated file into memory as a backup.

## Better storage errors

I added clearer messages for common storage and restore failures.

This includes:

- database busy errors
- storage full errors
- file permission errors
- restore conflicts
- invalid JSON
- unsupported backup versions
- unknown restore failures

Restore errors now also say that the existing data was left unchanged.

## Message colors

Backup and restore messages now use different colors.

Successful operations show in green.

Validation and storage errors show in red.

This makes it easier to tell whether an operation actually succeeded.

## Files changed

```text
app/(tabs)/history.tsx
lib/backupStorage.ts
lib/backupValidation.ts
__tests__/backupValidation.test.ts
__tests__/integration/backupStorage.integration.test.ts
```

## Testing

The TypeScript check passed:

```bash
npx tsc --noEmit
```

The full Jest test suite passed:

```text
Test Suites: 11 passed, 11 total
Tests:       80 passed, 80 total
Snapshots:   0 total
```

The manual backup and restore tests also worked.

I checked:

- exporting a version 3 backup
- viewing the restore preview
- cancelling without changing current data
- restoring a valid backup
- rejecting invalid JSON
- rejecting an unsupported backup version
- keeping existing data unchanged after a failed restore

## Data safety

This update does not add any new database tables or columns.

Invalid backups are rejected before current data is replaced.

Valid restores run inside a transaction.

Restored record counts are verified before the transaction commits.

A failed restore rolls back and leaves the previous WeekFlow data in place.

## Result

WeekFlow backups are now easier to inspect, safer to restore, and more useful when something goes wrong.

The app now gives clearer errors and has stronger protection against corrupt, incomplete, or unsupported backup files.
