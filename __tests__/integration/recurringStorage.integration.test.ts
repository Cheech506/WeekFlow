import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('recurring storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('generates recurring tasks without duplicates', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const today = getLocalDateKey(new Date());

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Daily integration task',
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();

    const before = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = ?;
      `,
      [rule.id]
    );

    await recurringStorage.ensureRecurringOccurrences();

    const after = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = ?;
      `,
      [rule.id]
    );

    expect(before?.count).toBeGreaterThan(0);
    expect(after?.count).toBe(before?.count);
  });

  test('paused rules do not generate occurrences', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb, migrateDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    await migrateDb();
    const db = await getDb();
    const today = getLocalDateKey(new Date());

    await db.runAsync(
      `
      INSERT INTO recurring_rules (
        id,
        title,
        notes,
        priority,
        goal_id,
        frequency,
        start_date,
        end_date,
        weekdays,
        active,
        created_at
      )
      VALUES (?, ?, NULL, 0, NULL, 'daily', ?, NULL, '[]', 0, ?);
      `,
      [22, 'Paused task', today, new Date().toISOString()]
    );

    await recurringStorage.ensureRecurringOccurrences();

    const count = await db.getFirstAsync<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = 22;
    `);

    expect(count?.count).toBe(0);
  });

  test('stopOnly keeps generated tasks and detaches them', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb, migrateDb } = await import('../../lib/db');

    await migrateDb();
    const db = await getDb();

    await db.execAsync(`
      INSERT INTO recurring_rules (
        id, title, notes, priority, goal_id, frequency,
        start_date, end_date, weekdays, active, created_at
      )
      VALUES (
        30, 'Rule', NULL, 0, NULL, 'daily',
        '2026-07-01', NULL, '[]', 1,
        '2026-07-01T12:00:00.000Z'
      );

      INSERT INTO tasks (
        id, title, day, due_date, notes, priority, goal_id,
        completed, created_at, completed_at,
        recurring_rule_id, recurrence_occurrence_date
      )
      VALUES (
        301, 'Keep me', 'Wednesday', '2026-07-01',
        NULL, 0, NULL, 0, '2026-07-01T12:00:00.000Z',
        NULL, 30, '2026-07-01'
      );
    `);

    await recurringStorage.deleteRecurringRuleById(
      30,
      'stopOnly'
    );

    const task = await db.getFirstAsync<{
      recurring_rule_id: number | null;
      recurrence_occurrence_date: string | null;
    }>(`
      SELECT recurring_rule_id, recurrence_occurrence_date
      FROM tasks
      WHERE id = 301;
    `);

    const rule = await db.getFirstAsync(
      'SELECT id FROM recurring_rules WHERE id = 30;'
    );

    expect(task).toEqual({
      recurring_rule_id: null,
      recurrence_occurrence_date: null,
    });
    expect(rule).toBeNull();
  });

  test('deleteUnfinished removes active tasks but keeps completed history', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb, migrateDb } = await import('../../lib/db');

    await migrateDb();
    const db = await getDb();

    await db.execAsync(`
      INSERT INTO recurring_rules (
        id, title, notes, priority, goal_id, frequency,
        start_date, end_date, weekdays, active, created_at
      )
      VALUES (
        40, 'Rule', NULL, 0, NULL, 'daily',
        '2026-07-01', NULL, '[]', 1,
        '2026-07-01T12:00:00.000Z'
      );

      INSERT INTO tasks (
        id, title, day, due_date, notes, priority, goal_id,
        completed, created_at, completed_at,
        recurring_rule_id, recurrence_occurrence_date
      )
      VALUES
      (
        401, 'Delete me', 'Wednesday', '2026-07-01',
        NULL, 0, NULL, 0, '2026-07-01T12:00:00.000Z',
        NULL, 40, '2026-07-01'
      ),
      (
        402, 'Keep history', 'Thursday', '2026-07-02',
        NULL, 0, NULL, 1, '2026-07-02T12:00:00.000Z',
        '2026-07-02T13:00:00.000Z', 40, '2026-07-02'
      );
    `);

    await recurringStorage.deleteRecurringRuleById(
      40,
      'deleteUnfinished'
    );

    const unfinished = await db.getFirstAsync(
      'SELECT id FROM tasks WHERE id = 401;'
    );
    const completed = await db.getFirstAsync<{
      completed: number;
      recurring_rule_id: number | null;
    }>(`
      SELECT completed, recurring_rule_id
      FROM tasks
      WHERE id = 402;
    `);

    expect(unfinished).toBeNull();
    expect(completed).toEqual({
      completed: 1,
      recurring_rule_id: null,
    });
  });
  test('converts a standalone task into the first recurring occurrence without a duplicate', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const today = getLocalDateKey(new Date());

    await taskStorage.insertTask(
      'Standalone task',
      'Inbox',
      'Original note',
      0,
      null
    );

    const [standaloneTask] = await taskStorage.getTasks();

    const rule =
      await recurringStorage.convertTaskToRecurringRule(
        standaloneTask.id,
        {
          title: 'Converted recurring task',
          notes: 'Updated note',
          priority: 2,
          frequency: 'daily',
          startDate: today,
        }
      );

    const db = await getDb();
    const convertedTask = await db.getFirstAsync<{
      title: string;
      due_date: string | null;
      notes: string | null;
      priority: number;
      recurring_rule_id: number | null;
      recurrence_occurrence_date: string | null;
    }>(
      `
      SELECT
        title,
        due_date,
        notes,
        priority,
        recurring_rule_id,
        recurrence_occurrence_date
      FROM tasks
      WHERE id = ?;
      `,
      [standaloneTask.id]
    );

    const firstOccurrenceCount =
      await db.getFirstAsync<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, today]
      );

    expect(convertedTask).toEqual({
      title: 'Converted recurring task',
      due_date: today,
      notes: 'Updated note',
      priority: 2,
      recurring_rule_id: rule.id,
      recurrence_occurrence_date: today,
    });
    expect(firstOccurrenceCount?.count).toBe(1);
  });

  test('rejects converting a completed task and leaves the database unchanged', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    await taskStorage.insertTask('Completed task', 'Inbox');
    const [task] = await taskStorage.getTasks();
    await taskStorage.completeTaskById(task.id);

    await expect(
      recurringStorage.convertTaskToRecurringRule(task.id, {
        title: 'Should not convert',
        frequency: 'daily',
        startDate: getLocalDateKey(new Date()),
      })
    ).rejects.toThrow(
      'A completed task cannot be converted into a recurring task.'
    );

    const db = await getDb();
    const ruleCount = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM recurring_rules;'
    );
    const unchangedTask = await db.getFirstAsync<{
      completed: number;
      recurring_rule_id: number | null;
    }>(
      `
      SELECT completed, recurring_rule_id
      FROM tasks
      WHERE id = ?;
      `,
      [task.id]
    );

    expect(ruleCount?.count).toBe(0);
    expect(unchangedTask).toEqual({
      completed: 1,
      recurring_rule_id: null,
    });
  });

});
