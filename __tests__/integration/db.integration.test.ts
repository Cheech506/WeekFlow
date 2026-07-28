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
          'goal_milestones',
          'planning_cycles',
          'recurring_rules',
          'recurring_occurrence_exceptions',
          'app_metadata'
        )
      ORDER BY name;
    `);

    expect(tables.map((table) => table.name)).toEqual([
      'app_metadata',
      'brain_dumps',
      'goal_milestones',
      'goals',
      'planning_cycles',
      'recurring_occurrence_exceptions',
      'recurring_rules',
      'tasks',
    ]);

    const goalColumns = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(goals);'
    );

    expect(goalColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'reward',
        'purpose',
        'success_definition',
        'notes',
      ])
    );

    const milestoneColumns = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(goal_milestones);'
    );

    expect(milestoneColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'goal_id',
        'title',
        'notes',
        'target_date',
        'completed',
        'created_at',
        'completed_at',
      ])
    );
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

      CREATE TABLE recurring_rules (
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

      INSERT INTO recurring_rules (
        id, title, notes, priority, goal_id, frequency,
        start_date, end_date, weekdays, active, created_at
      )
      VALUES (
        77, 'Legacy rule', NULL, 0, NULL, 'daily',
        '2026-07-17', NULL, '[]', 1,
        '2026-07-17T09:00:00.000Z'
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


  test('repairs orphaned goals, recurring links, and exceptions without deleting tasks', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');

    const db = await getDb();

    await db.execAsync(`
      CREATE TABLE goals (
        id INTEGER PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL
      );

      CREATE TABLE recurring_rules (
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

      CREATE TABLE recurring_occurrence_exceptions (
        recurring_rule_id INTEGER NOT NULL,
        occurrence_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (recurring_rule_id, occurrence_date)
      );

      INSERT INTO goals (
        id, title, completed, created_at, completed_at,
        start_date, end_date
      )
      VALUES (
        1, 'Valid goal', 0, '2026-07-20T10:00:00.000Z', NULL,
        '2026-07-20T12:00:00.000Z',
        '2026-10-12T12:00:00.000Z'
      );

      INSERT INTO recurring_rules (
        id, title, notes, priority, goal_id, frequency,
        start_date, end_date, weekdays, active, created_at
      )
      VALUES
      (
        10, 'Valid rule', NULL, 0, 1, 'daily',
        '2026-07-20', NULL, '[]', 1,
        '2026-07-20T10:00:00.000Z'
      ),
      (
        11, 'Rule with missing goal', NULL, 0, 999, 'daily',
        '2026-07-20', NULL, '[]', 1,
        '2026-07-20T10:01:00.000Z'
      );

      INSERT INTO tasks (
        id, title, day, due_date, notes, priority, goal_id,
        completed, created_at, completed_at,
        recurring_rule_id, recurrence_occurrence_date
      )
      VALUES
      (
        1, 'Task with missing goal', 'Inbox', NULL, NULL, 0, 999,
        0, '2026-07-20T11:00:00.000Z', NULL, NULL, NULL
      ),
      (
        2, 'Incomplete recurring identity', 'Inbox', NULL, NULL, 0, NULL,
        0, '2026-07-20T11:01:00.000Z', NULL, 10, NULL
      ),
      (
        3, 'Task with missing rule', 'Monday', '2026-07-20', NULL, 0, NULL,
        0, '2026-07-20T11:02:00.000Z', NULL, 999, '2026-07-20'
      ),
      (
        4, 'Valid recurring task', 'Monday', '2026-07-20', NULL, 0, 1,
        0, '2026-07-20T11:03:00.000Z', NULL, 10, '2026-07-20'
      );

      INSERT INTO recurring_occurrence_exceptions (
        recurring_rule_id, occurrence_date, created_at
      )
      VALUES
      (10, '2026-07-21', '2026-07-20T12:00:00.000Z'),
      (999, '2026-07-22', '2026-07-20T12:01:00.000Z');
    `);

    await migrateDb();

    const tasks = await db.getAllAsync<{
      id: number;
      goal_id: number | null;
      recurring_rule_id: number | null;
      recurrence_occurrence_date: string | null;
    }>(`
      SELECT
        id,
        goal_id,
        recurring_rule_id,
        recurrence_occurrence_date
      FROM tasks
      ORDER BY id;
    `);

    expect(tasks).toEqual([
      {
        id: 1,
        goal_id: null,
        recurring_rule_id: null,
        recurrence_occurrence_date: null,
      },
      {
        id: 2,
        goal_id: null,
        recurring_rule_id: null,
        recurrence_occurrence_date: null,
      },
      {
        id: 3,
        goal_id: null,
        recurring_rule_id: null,
        recurrence_occurrence_date: null,
      },
      {
        id: 4,
        goal_id: 1,
        recurring_rule_id: 10,
        recurrence_occurrence_date: '2026-07-20',
      },
    ]);

    const repairedRule = await db.getFirstAsync<{
      goal_id: number | null;
    }>('SELECT goal_id FROM recurring_rules WHERE id = 11;');

    const exceptions = await db.getAllAsync<{
      recurring_rule_id: number;
    }>(`
      SELECT recurring_rule_id
      FROM recurring_occurrence_exceptions
      ORDER BY recurring_rule_id;
    `);

    expect(repairedRule?.goal_id).toBeNull();
    expect(exceptions).toEqual([{ recurring_rule_id: 10 }]);
  });

  test('blocks new orphaned goal and recurring references', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');

    await migrateDb();
    const db = await getDb();

    await expect(
      db.runAsync(`
        INSERT INTO tasks (
          title, day, due_date, notes, priority, goal_id,
          completed, created_at, completed_at,
          recurring_rule_id, recurrence_occurrence_date
        )
        VALUES (
          'Orphan goal task', 'Inbox', NULL, NULL, 0, 999,
          0, '2026-07-20T13:00:00.000Z', NULL, NULL, NULL
        );
      `)
    ).rejects.toThrow('Task goal does not exist.');

    await expect(
      db.runAsync(`
        INSERT INTO tasks (
          title, day, due_date, notes, priority, goal_id,
          completed, created_at, completed_at,
          recurring_rule_id, recurrence_occurrence_date
        )
        VALUES (
          'Orphan recurring task', 'Monday', '2026-07-20', NULL, 0, NULL,
          0, '2026-07-20T13:01:00.000Z', NULL, 999, '2026-07-20'
        );
      `)
    ).rejects.toThrow('Recurring task identity is invalid.');

    await expect(
      db.runAsync(`
        INSERT INTO recurring_occurrence_exceptions (
          recurring_rule_id, occurrence_date, created_at
        )
        VALUES (999, '2026-07-20', '2026-07-20T13:02:00.000Z');
      `)
    ).rejects.toThrow('Recurring exception rule does not exist.');
  });

  test('database cleanup triggers protect links during direct deletes', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');

    await migrateDb();
    const db = await getDb();

    await db.execAsync(`
      INSERT INTO goals (
        id, title, completed, created_at, completed_at,
        start_date, end_date
      )
      VALUES (
        50, 'Trigger goal', 0, '2026-07-20T14:00:00.000Z', NULL,
        '2026-07-20T12:00:00.000Z',
        '2026-10-12T12:00:00.000Z'
      );

      INSERT INTO recurring_rules (
        id, title, notes, priority, goal_id, frequency,
        start_date, end_date, weekdays, active, created_at
      )
      VALUES (
        60, 'Trigger rule', NULL, 0, 50, 'daily',
        '2026-07-20', NULL, '[]', 1,
        '2026-07-20T14:01:00.000Z'
      );

      INSERT INTO tasks (
        id, title, day, due_date, notes, priority, goal_id,
        completed, created_at, completed_at,
        recurring_rule_id, recurrence_occurrence_date
      )
      VALUES (
        70, 'Trigger task', 'Monday', '2026-07-20', NULL, 0, 50,
        0, '2026-07-20T14:02:00.000Z', NULL, 60, '2026-07-20'
      );

      INSERT INTO recurring_occurrence_exceptions (
        recurring_rule_id, occurrence_date, created_at
      )
      VALUES (60, '2026-07-21', '2026-07-20T14:03:00.000Z');

      DELETE FROM goals WHERE id = 50;
    `);

    const afterGoalDelete = await db.getFirstAsync<{
      task_goal_id: number | null;
      rule_goal_id: number | null;
    }>(`
      SELECT
        tasks.goal_id AS task_goal_id,
        recurring_rules.goal_id AS rule_goal_id
      FROM tasks
      JOIN recurring_rules ON recurring_rules.id = 60
      WHERE tasks.id = 70;
    `);

    expect(afterGoalDelete).toEqual({
      task_goal_id: null,
      rule_goal_id: null,
    });

    await db.runAsync('DELETE FROM recurring_rules WHERE id = 60;');

    const afterRuleDelete = await db.getFirstAsync<{
      recurring_rule_id: number | null;
      recurrence_occurrence_date: string | null;
    }>(`
      SELECT recurring_rule_id, recurrence_occurrence_date
      FROM tasks
      WHERE id = 70;
    `);

    const exceptionCount = await db.getFirstAsync<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM recurring_occurrence_exceptions
      WHERE recurring_rule_id = 60;
    `);

    expect(afterRuleDelete).toEqual({
      recurring_rule_id: null,
      recurrence_occurrence_date: null,
    });
    expect(exceptionCount?.count).toBe(0);
  });

});
