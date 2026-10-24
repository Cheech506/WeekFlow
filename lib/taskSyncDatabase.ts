/** Local database foundation for server task caching and pending uploads. */

import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'weekflow-task-sync.db';
const SCHEMA_VERSION = 1;

export type TaskSyncDatabase = SQLite.SQLiteDatabase;

let databasePromise: Promise<TaskSyncDatabase> | null = null;
let initializationPromise: Promise<void> | null = null;
let operationQueue: Promise<void> = Promise.resolve();

async function openDatabase(): Promise<TaskSyncDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function initializeDatabase(): Promise<void> {
  const db = await openDatabase();

  // Enable these before BEGIN. Foreign-key changes inside a transaction
  // would be ignored. Busy timeout lets a competing connection finish.
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
  `);

  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    if (!row || row.user_version > SCHEMA_VERSION) {
      throw new Error('This task-sync database requires a newer WeekFlow version.');
    }
    if (row.user_version === SCHEMA_VERSION) return;
    if (row.user_version !== 0) {
      throw new Error('Unsupported task-sync database version.');
    }

    await db.execAsync(`
      CREATE TABLE task_sync_scopes (
        scope_key TEXT PRIMARY KEY NOT NULL
          CHECK (length(trim(scope_key)) > 0),
        base_url TEXT NOT NULL
          CHECK (length(trim(base_url)) > 0),
        server_instance_key TEXT NOT NULL
          CHECK (length(trim(server_instance_key)) > 0),
        owner_key TEXT NOT NULL DEFAULT 'single-owner'
          CHECK (length(trim(owner_key)) > 0),
        created_at TEXT NOT NULL,
        last_download_at TEXT,
        last_upload_at TEXT,
        UNIQUE (base_url, server_instance_key, owner_key)
      );

      CREATE TABLE task_sync_cache (
        local_id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_key TEXT NOT NULL
          REFERENCES task_sync_scopes(scope_key) ON DELETE RESTRICT,
        server_id INTEGER
          CHECK (server_id IS NULL OR server_id BETWEEN 1 AND 2147483647),
        client_task_key TEXT NOT NULL
          DEFAULT (lower(hex(randomblob(16))))
          CHECK (length(client_task_key) = 32
            AND client_task_key NOT GLOB '*[^0-9a-f]*'),
        working_json TEXT NOT NULL
          CHECK (json_valid(working_json) AND json_type(working_json) = 'object'),
        server_snapshot_json TEXT
          CHECK (server_snapshot_json IS NULL OR
            (json_valid(server_snapshot_json) AND json_type(server_snapshot_json) = 'object')),
        local_revision INTEGER NOT NULL DEFAULT 0
          CHECK (local_revision >= 0),
        is_deleted INTEGER NOT NULL DEFAULT 0
          CHECK (is_deleted IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT,
        UNIQUE (client_task_key),
        UNIQUE (scope_key, server_id),
        CHECK (
          (server_id IS NULL AND server_snapshot_json IS NULL)
          OR
          (server_id IS NOT NULL AND server_snapshot_json IS NOT NULL)
        )
      );

      CREATE TABLE task_sync_outbox (
        operation_key TEXT PRIMARY KEY NOT NULL
          DEFAULT (lower(hex(randomblob(16))))
          CHECK (length(operation_key) = 32
            AND operation_key NOT GLOB '*[^0-9a-f]*'),
        local_task_id INTEGER NOT NULL
          REFERENCES task_sync_cache(local_id) ON DELETE RESTRICT,
        action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK (state IN ('pending', 'sending', 'uncertain', 'conflict', 'rejected')),
        payload_json TEXT NOT NULL
          CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
        base_snapshot_json TEXT
          CHECK (base_snapshot_json IS NULL OR
            (json_valid(base_snapshot_json) AND json_type(base_snapshot_json) = 'object')),
        local_revision INTEGER NOT NULL CHECK (local_revision > 0),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        conflict_json TEXT
          CHECK (conflict_json IS NULL OR
            (json_valid(conflict_json) AND json_type(conflict_json) = 'object')),
        UNIQUE (local_task_id),
        CHECK (
          (action = 'create' AND base_snapshot_json IS NULL)
          OR
          (action IN ('update', 'delete') AND base_snapshot_json IS NOT NULL)
        )
      );

      CREATE INDEX idx_task_sync_cache_scope_visible
        ON task_sync_cache (scope_key, is_deleted, local_id);
      CREATE INDEX idx_task_sync_outbox_state_created
        ON task_sync_outbox (state, created_at, operation_key);

      PRAGMA user_version = 1;
    `);
  });
}

async function ensureInitialized(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = initializeDatabase().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

/**
 * Run one cache/outbox operation in a serialized SQLite transaction.
 *
 * All sync database reads and writes must go through this function. Expo's
 * web SQLite worker is shared, and withTransactionAsync alone does not
 * prevent unrelated async calls from entering the same transaction.
 *
 * The callback must use the supplied db directly. Do not call this function
 * recursively or make API requests while holding its transaction open.
 *
 * Cache changes and their queue entry can be committed together. A failure
 * rolls both back. One failed operation does not block later operations.
 */
export function withTaskSyncTransaction<T>(
  operation: (db: TaskSyncDatabase) => Promise<T>
): Promise<T> {
  const pending = operationQueue.catch(() => undefined).then(async () => {
    await ensureInitialized();
    const db = await openDatabase();
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await operation(db);
    });
    return result;
  });
  operationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

/** Initialize the database without fetching or changing any server data. */
export async function initializeTaskSyncDatabase(): Promise<void> {
  await withTaskSyncTransaction(async () => undefined);
}
