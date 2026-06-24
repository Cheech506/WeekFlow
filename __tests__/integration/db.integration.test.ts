import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('SQLite migrations', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('uses an isolated in-memory database and runs migrations repeatedly', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');

    await migrateDb();
    await migrateDb();

    const db = await getDb();

    expect(
      (db as unknown as { __databaseLocation?: string })
        .__databaseLocation
    ).toBe(':memory:');

    const tables = await db.getAllAsync<{ name: string }>(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          'tasks',
          'goals',
          'brain_dumps',
          'recurring_rules',
          'recurring_occurrence_exceptions'
        )
      ORDER BY name;
    `);

    expect(tables.map((table) => table.name)).toEqual([
      'brain_dumps',
      'goals',
      'recurring_occurrence_exceptions',
      'recurring_rules',
      'tasks',
    ]);
  });

  test('backfills due dates for legacy scheduled tasks without deleting data', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');
    const { getNextOccurrenceDateKey } = await import(
      '../../lib/dateUtils'
    );

    const db = await getDb();

    await db.execAsync(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        day TEXT NOT NULL,
        notes TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        goal_id INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        recurring_rule_id INTEGER,
        recurrence_occurrence_date TEXT
      );

      INSERT INTO tasks (
        id,
        title,
        day,
        notes,
        priority,
        goal_id,
        completed,
        created_at,
        completed_at,
        recurring_rule_id,
        recurrence_occurrence_date
      )
      VALUES (
        1,
        'Legacy Monday task',
        'Monday',
        NULL,
        0,
        NULL,
        0,
        '2026-06-01T12:00:00.000Z',
        NULL,
        NULL,
        NULL
      );
    `);

    await migrateDb();

    const task = await db.getFirstAsync<{
      title: string;
      due_date: string | null;
    }>(`
      SELECT title, due_date
      FROM tasks
      WHERE id = 1;
    `);

    expect(task?.title).toBe('Legacy Monday task');
    expect(task?.due_date).toBe(
      getNextOccurrenceDateKey('Monday')
    );
  });
});
