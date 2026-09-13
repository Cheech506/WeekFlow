# Week 2 Friday wrap-up (completed Sunday, September 13)

## What changed

- Made task create and update requests reject unknown fields, so typos return `422` instead of being silently ignored.
- Added schema and API tests for those cases, including proof that a rejected update leaves the saved task unchanged.
- Updated the backend README to describe the working CRUD API, migrations, and current tests.

## Verification

- Backend suite: 28 passed, 1 known dependency warning.
- Alembic: database at head; no new upgrade operations detected.

## Next

The mobile app still uses SQLite. Connecting it to the backend is future work and should preserve existing local data.