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

  test('repairs duplicate recurring identities without deleting legacy tasks', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');

    const db = await getDb();

    await db.execAsync(`
      CREATE TABLE tasks (
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

      INSERT INTO tasks (
        id, title, day, due_date, notes, priority, goal_id,
        completed, created_at, completed_at,
        recurring_rule_id, recurrence_occurrence_date
      )
      VALUES
      (
        1, 'Legacy unfinished copy', 'Friday', '2026-07-17',
        NULL, 0, NULL, 0, '2026-07-17T10:00:00.000Z',
        NULL, 77, '2026-07-17'
      ),
      (
        2, 'Legacy completed copy', 'Friday', '2026-07-17',
        NULL, 0, NULL, 1, '2026-07-17T10:01:00.000Z',
        '2026-07-17T11:00:00.000Z', 77, '2026-07-17'
      ),
      (
        3, 'Legacy unfinished copy 2', 'Friday', '2026-07-17',
        NULL, 0, NULL, 0, '2026-07-17T10:02:00.000Z',
        NULL, 77, '2026-07-17'
      );
    `);

    await migrateDb();

    const rows = await db.getAllAsync<{
      id: number;
      completed: number;
      recurring_rule_id: number | null;
      recurrence_occurrence_date: string | null;
    }>(`
      SELECT
        id,
        completed,
        recurring_rule_id,
        recurrence_occurrence_date
      FROM tasks
      ORDER BY id;
    `);

    expect(rows).toEqual([
      {
        id: 1,
        completed: 0,
        recurring_rule_id: null,
        recurrence_occurrence_date: null,
      },
      {
        id: 2,
        completed: 1,
        recurring_rule_id: 77,
        recurrence_occurrence_date: '2026-07-17',
      },
      {
        id: 3,
        completed: 0,
        recurring_rule_id: null,
        recurrence_occurrence_date: null,
      },
    ]);

    await expect(
      db.runAsync(`
        INSERT INTO tasks (
          id, title, day, due_date, notes, priority, goal_id,
          completed, created_at, completed_at,
          recurring_rule_id, recurrence_occurrence_date
        )
        VALUES (
          4, 'Blocked duplicate', 'Friday', '2026-07-17',
          NULL, 0, NULL, 0, '2026-07-17T12:00:00.000Z',
          NULL, 77, '2026-07-17'
        );
      `)
    ).rejects.toThrow();
  });

});
