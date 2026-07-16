# Dev Log — Web SQLite Headers and Expo Dependency Cleanup

## Date

July 16, 2026

## Project

WeekFlow

## Branch

`dev`

## Summary

I completed a small reliability cleanup after finishing WF-005.

This update adds the browser security headers required by `expo-sqlite` on web and removes the unnecessary direct `expo-modules-core` dependency from WeekFlow.

## Web SQLite Headers

I updated `app.json` so Expo Router sends:

```text
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

These headers allow the web SQLite worker to run correctly through:

```text
http://localhost:8081
```

This prevents the browser storage error that appeared while loading Brain Dump entries and other SQLite-backed data.

## Dependency Cleanup

`expo-modules-core` was listed directly in `package.json`, even though it is already provided through the installed Expo package.

I removed the direct dependency and rebuilt `node_modules` from the committed lockfile with:

```text
npm ci
```

The dependency tree now shows `expo-modules-core` under Expo instead of as a direct WeekFlow dependency.

## Verification

I confirmed:

- `npm ci` completed successfully.
- TypeScript completed without errors.
- All automated tests passed.
- `expo-modules-core` is installed through Expo.
- Only `app.json` and `package.json` remain modified.

Automated test results:

```text
Test Suites: 11 passed, 11 total
Tests:       58 passed, 58 total
Snapshots:   0 total
```

## Expo Doctor Result

Expo Doctor completed with:

```text
18/19 checks passed
```

The remaining check reports that several Expo SDK 55 packages are behind Expo's currently recommended patch versions, including a version mismatch for `react-native-get-random-values`.

I did not force those upgrades during this cleanup because an earlier automatic update attempt encountered a dependency-resolution conflict.

The package-version alignment will be handled later as a separate controlled maintenance task before the next stable release is merged into `main`.

## Files Updated

```text
app.json
package.json
```

## Data Safety

This update does not change:

- SQLite tables
- Migrations
- Tasks
- Goals
- Recurring schedules
- Brain Dump entries
- History
- Backups

No saved WeekFlow data is reset or removed.

## Security Audit Note

`npm` still reports dependency vulnerabilities from the installed dependency tree.

I did not run:

```text
npm audit fix --force
```

because forcing dependency upgrades could introduce breaking Expo or React Native changes.

## Current Status

The web SQLite fix and direct dependency cleanup are complete and tested.

Expo package patch-version alignment remains a separate maintenance item for a controlled update.

## Suggested Git Commit

```text
fix: configure web SQLite and clean Expo dependency
```
