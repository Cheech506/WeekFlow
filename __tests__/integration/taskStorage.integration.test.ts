import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('task storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('inserts, reads, and edits a task', async () => {
    const taskStorage = await import('../../lib/taskStorage');

    await taskStorage.insertTask(
      '  Integration task  ',
      'Inbox',
      '  Stored note  ',
      2,
      null,
      null
    );

    let tasks = await taskStorage.getTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Integration task',
      day: 'Inbox',
      dueDate: null,
      notes: 'Stored note',
      priority: 2,
      completed: false,
    });

    await taskStorage.updateTaskById(
      tasks[0].id,
      'Edited task',
      'Edited note',
      1,
      null
    );

    tasks = await taskStorage.getTasks();

    expect(tasks[0]).toMatchObject({
      title: 'Edited task',
      notes: 'Edited note',
      priority: 1,
    });
  });

  test('completes a task and stores a completion timestamp', async () => {
    const taskStorage = await import('../../lib/taskStorage');

    await taskStorage.insertTask('Finish me', 'Inbox');
    const [task] = await taskStorage.getTasks();

    await taskStorage.completeTaskById(task.id);

    const [completedTask] = await taskStorage.getTasks();

    expect(completedTask.completed).toBe(true);
    expect(completedTask.completedAt).not.toBeNull();
  });

  test('reschedules a task and moving it to Inbox clears its due date', async () => {
    const taskStorage = await import('../../lib/taskStorage');

    await taskStorage.insertTask('Schedule me', 'Inbox');
    const [task] = await taskStorage.getTasks();

    await taskStorage.scheduleTaskByDate(
      task.id,
      '2026-07-06'
    );

    let [scheduledTask] = await taskStorage.getTasks();

    expect(scheduledTask.day).toBe('Monday');
    expect(scheduledTask.dueDate).toBe('2026-07-06');

    await taskStorage.moveTaskToInboxById(task.id);

    [scheduledTask] = await taskStorage.getTasks();

    expect(scheduledTask.day).toBe('Inbox');
    expect(scheduledTask.dueDate).toBeNull();
  });

  test('deleting a recurring occurrence records an exception', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');
    const { deleteTaskById } = await import(
      '../../lib/taskStorage'
    );

    await migrateDb();
    const db = await getDb();

    await db.execAsync(`
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
      VALUES (
        7,
        'Recurring rule',
        NULL,
        0,
        NULL,
        'daily',
        '2026-07-01',
        NULL,
        '[]',
        1,
        '2026-07-01T12:00:00.000Z'
      );

      INSERT INTO tasks (
        id,
        title,
        day,
        due_date,
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
        99,
        'Generated task',
        'Wednesday',
        '2026-07-01',
        NULL,
        0,
        NULL,
        0,
        '2026-07-01T12:00:00.000Z',
        NULL,
        7,
        '2026-07-01'
      );
    `);

    await deleteTaskById(99);

    const deletedTask = await db.getFirstAsync(
      'SELECT id FROM tasks WHERE id = 99;'
    );
    const exception = await db.getFirstAsync<{
      recurring_rule_id: number;
      occurrence_date: string;
    }>(`
      SELECT recurring_rule_id, occurrence_date
      FROM recurring_occurrence_exceptions
      WHERE recurring_rule_id = 7;
    `);

    expect(deletedTask).toBeNull();
    expect(exception).toEqual({
      recurring_rule_id: 7,
      occurrence_date: '2026-07-01',
    });
  });

  test('rejects an invalid due date without changing the task', async () => {
    const taskStorage = await import('../../lib/taskStorage');

    await taskStorage.insertTask('Keep me safe', 'Inbox');
    const [task] = await taskStorage.getTasks();

    await expect(
      taskStorage.scheduleTaskByDate(
        task.id,
        'not-a-date'
      )
    ).rejects.toThrow('Invalid due date');

    const [unchangedTask] = await taskStorage.getTasks();

    expect(unchangedTask.day).toBe('Inbox');
    expect(unchangedTask.dueDate).toBeNull();
  });
});
