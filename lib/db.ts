import * as SQLite from 'expo-sqlite';

import { getNextOccurrenceDateKey } from './dateUtils';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let migrationPromise: Promise<void> | null = null;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('weekflow.db');
  }

  return dbPromise;
}

function isDuplicateColumnError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('duplicate column name')
  );
}

async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${tableName});`
  );

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  try {
    await db.execAsync(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
    );
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

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

    if (!dueDate) continue;

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
      completed_at TEXT,
      recurring_rule_id INTEGER,
      recurrence_occurrence_date TEXT
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

    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      goal_id INTEGER,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      weekdays TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_occurrence_exceptions (
      recurring_rule_id INTEGER NOT NULL,
      occurrence_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (recurring_rule_id, occurrence_date)
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
  await ensureColumn(db, 'tasks', 'recurring_rule_id', 'INTEGER');
  await ensureColumn(
    db,
    'tasks',
    'recurrence_occurrence_date',
    'TEXT'
  );

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

  /*
   * occurrence_date is the generated occurrence's permanent identity.
   * due_date can change when the user reschedules the task.
   */
  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_tasks_recurring_occurrence
    ON tasks (recurring_rule_id, recurrence_occurrence_date)
    WHERE recurring_rule_id IS NOT NULL
      AND recurrence_occurrence_date IS NOT NULL;

    CREATE INDEX IF NOT EXISTS
      idx_tasks_due_date
    ON tasks (due_date);

    CREATE INDEX IF NOT EXISTS
      idx_recurring_rules_active
    ON recurring_rules (active);
  `);

  await backfillLegacyTaskDueDates(db);
}

export async function migrateDb() {
  if (!migrationPromise) {
    migrationPromise = runMigrations().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }

  return migrationPromise;
}
