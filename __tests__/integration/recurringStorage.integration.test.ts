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

  test('stores and generates every-two-weeks schedules', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb } = await import('../../lib/db');
    const { addDays, getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const todayDate = new Date();
    const today = getLocalDateKey(todayDate);
    const secondOccurrence = getLocalDateKey(
      addDays(todayDate, 14)
    );
    const thirdOccurrence = getLocalDateKey(
      addDays(todayDate, 28)
    );

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Biweekly integration task',
      frequency: 'everyTwoWeeks',
      startDate: today,
    });

    const db = await getDb();
    const storedRule = await db.getFirstAsync<{
      frequency: string;
    }>(
      'SELECT frequency FROM recurring_rules WHERE id = ?;',
      [rule.id]
    );
    const occurrences = await db.getAllAsync<{
      due_date: string;
    }>(
      `
      SELECT due_date
      FROM tasks
      WHERE recurring_rule_id = ?
      ORDER BY due_date ASC;
      `,
      [rule.id]
    );

    expect(storedRule?.frequency).toBe('everyTwoWeeks');
    expect(occurrences.map((task) => task.due_date)).toEqual([
      today,
      secondOccurrence,
      thirdOccurrence,
    ]);
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


  test('updates a saved schedule while preserving completed history and rebuilding future tasks', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const {
      addDays,
      getLocalDateKey,
    } = await import('../../lib/dateUtils');

    const todayDate = new Date();
    const today = getLocalDateKey(todayDate);
    const tomorrow = getLocalDateKey(
      addDays(todayDate, 1)
    );
    const nextWeek = getLocalDateKey(
      addDays(todayDate, 7)
    );

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Original daily task',
      notes: 'Original note',
      priority: 0,
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();

    /*
     * Referential-integrity checks now require every stored goal ID to point
     * to a real goal, so this test creates the goal it assigns to the rule.
     */
    await db.runAsync(
      `
      INSERT INTO goals (
        id,
        title,
        completed,
        created_at,
        completed_at,
        start_date,
        end_date
      )
      VALUES (?, ?, 0, ?, NULL, ?, ?);
      `,
      [
        77,
        'Updated schedule goal',
        '2026-07-20T09:00:00.000Z',
        '2026-07-20T12:00:00.000Z',
        '2026-10-12T12:00:00.000Z',
      ]
    );

    const firstOccurrence = await db.getFirstAsync<{
      id: number;
    }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(firstOccurrence).not.toBeNull();

    await taskStorage.completeTaskById(
      firstOccurrence!.id
    );

    await recurringStorage.updateRecurringRuleById(
      rule.id,
      {
        title: 'Updated weekly task',
        notes: 'Updated note',
        priority: 2,
        goalId: 77,
        frequency: 'weekly',
        startDate: today,
        endDate: null,
        weekdays: [],
      },
      today
    );

    const updatedRule = await db.getFirstAsync<{
      title: string;
      notes: string | null;
      priority: number;
      goal_id: number | null;
      frequency: string;
      start_date: string;
      end_date: string | null;
      active: number;
    }>(
      `
      SELECT
        title,
        notes,
        priority,
        goal_id,
        frequency,
        start_date,
        end_date,
        active
      FROM recurring_rules
      WHERE id = ?;
      `,
      [rule.id]
    );

    const completedOccurrence =
      await db.getFirstAsync<{
        title: string;
        notes: string | null;
        priority: number;
        completed: number;
        recurring_rule_id: number | null;
      }>(
        `
        SELECT
          title,
          notes,
          priority,
          completed,
          recurring_rule_id
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, today]
      );

    const removedDailyOccurrence =
      await db.getFirstAsync(
        `
        SELECT id
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, tomorrow]
      );

    const rebuiltWeeklyOccurrence =
      await db.getFirstAsync<{
        title: string;
        notes: string | null;
        priority: number;
        goal_id: number | null;
        completed: number;
      }>(
        `
        SELECT
          title,
          notes,
          priority,
          goal_id,
          completed
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, nextWeek]
      );

    expect(updatedRule).toEqual({
      title: 'Updated weekly task',
      notes: 'Updated note',
      priority: 2,
      goal_id: 77,
      frequency: 'weekly',
      start_date: today,
      end_date: null,
      active: 1,
    });

    /*
     * Completed history keeps the exact details that were true when the
     * occurrence was completed.
     */
    expect(completedOccurrence).toEqual({
      title: 'Original daily task',
      notes: 'Original note',
      priority: 0,
      completed: 1,
      recurring_rule_id: rule.id,
    });

    expect(removedDailyOccurrence).toBeNull();
    expect(rebuiltWeeklyOccurrence).toEqual({
      title: 'Updated weekly task',
      notes: 'Updated note',
      priority: 2,
      goal_id: 77,
      completed: 0,
    });
  });


  test('keeps an edited paused schedule paused until it is resumed', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb } = await import('../../lib/db');
    const {
      addDays,
      getLocalDateKey,
    } = await import('../../lib/dateUtils');

    const todayDate = new Date();
    const today = getLocalDateKey(todayDate);
    const nextWeek = getLocalDateKey(
      addDays(todayDate, 7)
    );

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Paused daily task',
      frequency: 'daily',
      startDate: today,
    });

    await recurringStorage.setRecurringRuleActive(
      rule.id,
      false
    );

    await recurringStorage.updateRecurringRuleById(
      rule.id,
      {
        title: 'Paused weekly task',
        frequency: 'weekly',
        startDate: today,
      },
      today
    );

    const db = await getDb();
    const pausedRule = await db.getFirstAsync<{
      title: string;
      frequency: string;
      active: number;
    }>(
      `
      SELECT title, frequency, active
      FROM recurring_rules
      WHERE id = ?;
      `,
      [rule.id]
    );

    const whilePaused = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = ?
        AND completed = 0;
      `,
      [rule.id]
    );

    expect(pausedRule).toEqual({
      title: 'Paused weekly task',
      frequency: 'weekly',
      active: 0,
    });
    expect(whilePaused?.count).toBe(0);

    await recurringStorage.setRecurringRuleActive(
      rule.id,
      true
    );

    const resumedOccurrence = await db.getFirstAsync<{
      title: string;
      completed: number;
    }>(
      `
      SELECT title, completed
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, nextWeek]
    );

    expect(resumedOccurrence).toEqual({
      title: 'Paused weekly task',
      completed: 0,
    });
  });


  test('updates the selected recurring occurrence and future schedule without changing earlier tasks or completed history', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const {
      addDays,
      getLocalDateKey,
    } = await import('../../lib/dateUtils');

    const todayDate = new Date();
    const today = getLocalDateKey(todayDate);
    const selectedDate = getLocalDateKey(
      addDays(todayDate, 1)
    );
    const completedFutureDate = getLocalDateKey(
      addDays(todayDate, 2)
    );
    const removedDailyDate = getLocalDateKey(
      addDays(todayDate, 3)
    );
    const nextWeeklyDate = getLocalDateKey(
      addDays(todayDate, 8)
    );

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Original daily task',
      notes: 'Original note',
      priority: 0,
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();

    /*
     * Referential-integrity checks now require every stored goal ID to point
     * to a real goal, so this test creates the goal it assigns to the rule.
     */
    await db.runAsync(
      `
      INSERT INTO goals (
        id,
        title,
        completed,
        created_at,
        completed_at,
        start_date,
        end_date
      )
      VALUES (?, ?, 0, ?, NULL, ?, ?);
      `,
      [
        88,
        'Future schedule goal',
        '2026-07-20T09:00:00.000Z',
        '2026-07-20T12:00:00.000Z',
        '2026-10-12T12:00:00.000Z',
      ]
    );
    const earlierTask = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );
    const selectedTask = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, selectedDate]
    );
    const completedFutureTask =
      await db.getFirstAsync<{ id: number }>(
        `
        SELECT id
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, completedFutureDate]
      );

    expect(earlierTask).not.toBeNull();
    expect(selectedTask).not.toBeNull();
    expect(completedFutureTask).not.toBeNull();

    await taskStorage.updateTaskById(
      earlierTask!.id,
      'Earlier one-off edit',
      'Keep earlier details',
      1,
      null
    );
    await taskStorage.updateTaskById(
      completedFutureTask!.id,
      'Completed future history',
      'Keep completed details',
      2,
      null
    );
    await taskStorage.completeTaskById(
      completedFutureTask!.id
    );

    await recurringStorage.updateRecurringRuleFromOccurrence(
      selectedTask!.id,
      {
        title: 'Revised weekly task',
        notes: 'Revised note',
        priority: 2,
        goalId: 88,
        frequency: 'weekly',
        endDate: null,
        weekdays: [],
      }
    );

    const updatedRule = await db.getFirstAsync<{
      title: string;
      notes: string | null;
      priority: number;
      goal_id: number | null;
      frequency: string;
      start_date: string;
    }>(
      `
      SELECT
        title,
        notes,
        priority,
        goal_id,
        frequency,
        start_date
      FROM recurring_rules
      WHERE id = ?;
      `,
      [rule.id]
    );

    const unchangedEarlierTask =
      await db.getFirstAsync<{
        title: string;
        notes: string | null;
        priority: number;
        completed: number;
      }>(
        `
        SELECT title, notes, priority, completed
        FROM tasks
        WHERE id = ?;
        `,
        [earlierTask!.id]
      );

    const revisedSelectedTask =
      await db.getFirstAsync<{
        title: string;
        notes: string | null;
        priority: number;
        goal_id: number | null;
        completed: number;
        recurrence_occurrence_date: string | null;
      }>(
        `
        SELECT
          title,
          notes,
          priority,
          goal_id,
          completed,
          recurrence_occurrence_date
        FROM tasks
        WHERE id = ?;
        `,
        [selectedTask!.id]
      );

    const unchangedCompletedHistory =
      await db.getFirstAsync<{
        title: string;
        notes: string | null;
        priority: number;
        completed: number;
      }>(
        `
        SELECT title, notes, priority, completed
        FROM tasks
        WHERE id = ?;
        `,
        [completedFutureTask!.id]
      );

    const removedOldDailyTask = await db.getFirstAsync(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?
        AND completed = 0;
      `,
      [rule.id, removedDailyDate]
    );

    const rebuiltWeeklyTask =
      await db.getFirstAsync<{
        title: string;
        notes: string | null;
        priority: number;
        goal_id: number | null;
        completed: number;
      }>(
        `
        SELECT title, notes, priority, goal_id, completed
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, nextWeeklyDate]
      );

    const selectedDateCount =
      await db.getFirstAsync<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?;
        `,
        [rule.id, selectedDate]
      );

    expect(updatedRule).toEqual({
      title: 'Revised weekly task',
      notes: 'Revised note',
      priority: 2,
      goal_id: 88,
      frequency: 'weekly',
      start_date: selectedDate,
    });
    expect(unchangedEarlierTask).toEqual({
      title: 'Earlier one-off edit',
      notes: 'Keep earlier details',
      priority: 1,
      completed: 0,
    });
    expect(revisedSelectedTask).toEqual({
      title: 'Revised weekly task',
      notes: 'Revised note',
      priority: 2,
      goal_id: 88,
      completed: 0,
      recurrence_occurrence_date: selectedDate,
    });
    expect(unchangedCompletedHistory).toEqual({
      title: 'Completed future history',
      notes: 'Keep completed details',
      priority: 2,
      completed: 1,
    });
    expect(removedOldDailyTask).toBeNull();
    expect(rebuiltWeeklyTask).toEqual({
      title: 'Revised weekly task',
      notes: 'Revised note',
      priority: 2,
      goal_id: 88,
      completed: 0,
    });
    expect(selectedDateCount?.count).toBe(1);
  });

  test('keeps a recurring schedule paused when this and future occurrences are edited', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb } = await import('../../lib/db');
    const {
      addDays,
      getLocalDateKey,
    } = await import('../../lib/dateUtils');

    const todayDate = new Date();
    const today = getLocalDateKey(todayDate);
    const selectedDate = getLocalDateKey(
      addDays(todayDate, 1)
    );
    const nextWeeklyDate = getLocalDateKey(
      addDays(todayDate, 8)
    );

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Paused daily task',
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();
    const selectedTask = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, selectedDate]
    );

    expect(selectedTask).not.toBeNull();

    await recurringStorage.setRecurringRuleActive(
      rule.id,
      false
    );

    await recurringStorage.updateRecurringRuleFromOccurrence(
      selectedTask!.id,
      {
        title: 'Paused weekly task',
        frequency: 'weekly',
      }
    );

    const pausedRule = await db.getFirstAsync<{
      title: string;
      frequency: string;
      start_date: string;
      active: number;
    }>(
      `
      SELECT title, frequency, start_date, active
      FROM recurring_rules
      WHERE id = ?;
      `,
      [rule.id]
    );

    const selectedOccurrence =
      await db.getFirstAsync<{
        title: string;
        completed: number;
      }>(
        `
        SELECT title, completed
        FROM tasks
        WHERE id = ?;
        `,
        [selectedTask!.id]
      );

    const futureWhilePaused =
      await db.getFirstAsync<{ count: number }>(
        `
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date > ?
          AND completed = 0;
        `,
        [rule.id, selectedDate]
      );

    expect(pausedRule).toEqual({
      title: 'Paused weekly task',
      frequency: 'weekly',
      start_date: selectedDate,
      active: 0,
    });
    expect(selectedOccurrence).toEqual({
      title: 'Paused weekly task',
      completed: 0,
    });
    expect(futureWhilePaused?.count).toBe(0);

    await recurringStorage.setRecurringRuleActive(
      rule.id,
      true
    );

    const resumedOccurrence = await db.getFirstAsync<{
      title: string;
      completed: number;
    }>(
      `
      SELECT title, completed
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, nextWeeklyDate]
    );

    expect(resumedOccurrence).toEqual({
      title: 'Paused weekly task',
      completed: 0,
    });
  });

  test('rejects applying recurring changes from a standalone task', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');

    await taskStorage.insertTask(
      'Standalone task',
      'Inbox',
      'Keep me unchanged',
      1
    );
    const [task] = await taskStorage.getTasks();

    await expect(
      recurringStorage.updateRecurringRuleFromOccurrence(
        task.id,
        {
          title: 'Should fail',
          frequency: 'daily',
        }
      )
    ).rejects.toThrow(
      'This task does not belong to a recurring schedule.'
    );

    const db = await getDb();
    const unchangedTask = await db.getFirstAsync<{
      title: string;
      notes: string | null;
      priority: number;
      recurring_rule_id: number | null;
    }>(
      `
      SELECT title, notes, priority, recurring_rule_id
      FROM tasks
      WHERE id = ?;
      `,
      [task.id]
    );

    expect(unchangedTask).toEqual({
      title: 'Standalone task',
      notes: 'Keep me unchanged',
      priority: 1,
      recurring_rule_id: null,
    });
  });


  test('does not regenerate a recurring occurrence moved back to Inbox', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const today = getLocalDateKey(new Date());
    const rule = await recurringStorage.insertRecurringRule({
      title: 'Move-safe recurring task',
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();
    const occurrence = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(occurrence).not.toBeNull();

    await taskStorage.moveTaskToInboxById(occurrence!.id);
    await recurringStorage.ensureRecurringOccurrences();

    const rows = await db.getAllAsync<{
      id: number;
      day: string;
      due_date: string | null;
    }>(
      `
      SELECT id, day, due_date
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(rows).toEqual([
      {
        id: occurrence!.id,
        day: 'Inbox',
        due_date: null,
      },
    ]);
  });

  test('does not regenerate a deleted recurring occurrence', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const today = getLocalDateKey(new Date());
    const rule = await recurringStorage.insertRecurringRule({
      title: 'Delete-safe recurring task',
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();
    const occurrence = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(occurrence).not.toBeNull();

    await taskStorage.deleteTaskById(occurrence!.id);
    await recurringStorage.ensureRecurringOccurrences();
    await recurringStorage.ensureRecurringOccurrences();

    const remainingCount = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    const exceptionCount = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM recurring_occurrence_exceptions
      WHERE recurring_rule_id = ?
        AND occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(remainingCount?.count).toBe(0);
    expect(exceptionCount?.count).toBe(1);
  });

  test('does not duplicate a completed recurring occurrence', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const today = getLocalDateKey(new Date());
    const rule = await recurringStorage.insertRecurringRule({
      title: 'Completed recurring task',
      frequency: 'daily',
      startDate: today,
    });

    const db = await getDb();
    const occurrence = await db.getFirstAsync<{ id: number }>(
      `
      SELECT id
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(occurrence).not.toBeNull();

    await taskStorage.completeTaskById(occurrence!.id);
    await recurringStorage.ensureRecurringOccurrences();

    const rows = await db.getAllAsync<{
      id: number;
      completed: number;
    }>(
      `
      SELECT id, completed
      FROM tasks
      WHERE recurring_rule_id = ?
        AND recurrence_occurrence_date = ?;
      `,
      [rule.id, today]
    );

    expect(rows).toEqual([
      {
        id: occurrence!.id,
        completed: 1,
      },
    ]);
  });

  test('rejects an invalid recurring delete option without changing data', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );
    const { getDb } = await import('../../lib/db');
    const { getLocalDateKey } = await import(
      '../../lib/dateUtils'
    );

    const rule = await recurringStorage.insertRecurringRule({
      title: 'Keep this recurring schedule',
      frequency: 'daily',
      startDate: getLocalDateKey(new Date()),
    });

    const db = await getDb();
    const beforeTaskCount = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = ?;
      `,
      [rule.id]
    );

    await expect(
      recurringStorage.deleteRecurringRuleById(
        rule.id,
        'invalid-mode' as never
      )
    ).rejects.toThrow(
      'Recurring schedule delete option is invalid.'
    );

    const remainingRule = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM recurring_rules WHERE id = ?;',
      [rule.id]
    );
    const afterTaskCount = await db.getFirstAsync<{
      count: number;
    }>(
      `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE recurring_rule_id = ?;
      `,
      [rule.id]
    );

    expect(remainingRule).toEqual({ id: rule.id });
    expect(afterTaskCount?.count).toBe(beforeTaskCount?.count);
  });

  test('reports missing recurring schedules instead of silently succeeding', async () => {
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );

    await expect(
      recurringStorage.setRecurringRuleActive(999999, false)
    ).rejects.toThrow(
      'The recurring schedule could not be found.'
    );

    await expect(
      recurringStorage.deleteRecurringRuleById(
        999999,
        'stopOnly'
      )
    ).rejects.toThrow(
      'The recurring schedule could not be found.'
    );
  });

});
