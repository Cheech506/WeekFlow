import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('weekflow.db');
  }

  return dbPromise;
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

  const columnExists = columns.some((column) => column.name === columnName);

  if (!columnExists) {
    await db.execAsync(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
    );
  }
}

export async function migrateDb() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      day TEXT NOT NULL,
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
  await ensureColumn(db, 'tasks', 'priority', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'tasks', 'goal_id', 'INTEGER');

  await ensureColumn(db, 'brain_dumps', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'brain_dumps', 'archived_at', 'TEXT');
}