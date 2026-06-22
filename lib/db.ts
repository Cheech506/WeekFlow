import * as SQLite from 'expo-sqlite';

import { getNextOccurrenceDateKey } from './dateUtils';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/*
 * TaskContext and GoalContext can request the database at nearly
 * the same time when the app starts. This shared promise makes
 * every caller wait for one migration instead of running several
 * migrations at the same time.
 */
let migrationPromise: Promise<void> | null = null;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('weekflow.db');
  }

  return dbPromise;
}

/**
 * Checks whether an error came from attempting to add a column
 * that another migration already added.
 */
function isDuplicateColumnError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('duplicate column name')
  );
}

/**
 * Adds a column only when it is missing.
 *
 * The duplicate-column catch protects against development reloads
 * or two migration calls reaching this point at nearly the same time.
 */
async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${tableName});`
  );

  const columnExists = columns.some(
    (column) => column.name === columnName
  );

  if (columnExists) {
    return;
  }

  try {
    await db.execAsync(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
    );
  } catch (error) {
    /*
     * Another migration may have added the same column after
     * the PRAGMA check but before this ALTER TABLE completed.
     */
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

/**
 * Converts older active tasks that only stored a weekday into
 * tasks with a real calendar due date.
 *
 * The next occurrence of the saved weekday is used so existing
 * scheduled tasks do not disappear after the migration.
 */
async function backfillLegacyTaskDueDates(
  db: SQLite.SQLiteDatabase
) {
  const legacyTasks = await db.getAllAsync<{
    id: number;
    day: string;
  }>(`
    SELECT id, day
    FROM tasks
    WHERE due_date IS NULL
      AND completed = 0
      AND day != 'Inbox';
  `);

  for (const task of legacyTasks) {
    const dueDate = getNextOccurrenceDateKey(task.day);

    if (!dueDate) {
      continue;
    }

    await db.runAsync(
      `
      UPDATE tasks
      SET due_date = ?
      WHERE id = ?;
      `,
      [dueDate, task.id]
    );
  }
}

/**
 * Performs the actual database setup and schema updates.
 * This function is called through the shared migration promise below.
 */
async function runMigrations() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      day TEXT NOT NULL,
      due_date TEXT,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      goal_id INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brain_dumps (
      id INTEGER PRIMARY KEY NOT NULL,
      body TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
  `);

  await ensureColumn(db, 'tasks', 'notes', 'TEXT');
  await ensureColumn(
    db,
    'tasks',
    'priority',
    'INTEGER NOT NULL DEFAULT 0'
  );
  await ensureColumn(db, 'tasks', 'goal_id', 'INTEGER');
  await ensureColumn(db, 'tasks', 'due_date', 'TEXT');

  await ensureColumn(
    db,
    'brain_dumps',
    'archived',
    'INTEGER NOT NULL DEFAULT 0'
  );
  await ensureColumn(
    db,
    'brain_dumps',
    'archived_at',
    'TEXT'
  );

  await backfillLegacyTaskDueDates(db);
}

/**
 * Ensures only one migration runs during app startup.
 *
 * If migration fails for a real reason, the promise is cleared so
 * the app can try again after the problem is corrected.
 */
export async function migrateDb() {
  if (!migrationPromise) {
    migrationPromise = runMigrations().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }

  return migrationPromise;
}