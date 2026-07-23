import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('goal and brain dump storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('creates, edits, completes, reopens, and deletes a goal', async () => {
    const goalStorage = await import('../../lib/goalStorage');

    const goal = await goalStorage.insertGoal(
      '  Integration goal  ',
      '2026-07-01',
      '2026-09-23',
      '  Buy a new game  '
    );

    expect(goal.title).toBe('Integration goal');
    expect(goal.reward).toBe('Buy a new game');

    const editedGoal = await goalStorage.updateGoalDetails(
      goal.id,
      '  Updated integration goal  ',
      '2026-07-08',
      '2026-10-07',
      '  Take a full gaming night  '
    );

    let goals = await goalStorage.getGoals();

    expect(goals[0].title).toBe('Updated integration goal');
    expect(goals[0].startDate).toBe(editedGoal.startDate);
    expect(goals[0].endDate).toBe(editedGoal.endDate);
    expect(goals[0].reward).toBe('Take a full gaming night');

    const completedAt =
      await goalStorage.updateGoalCompletion(
        goal.id,
        true
      );

    goals = await goalStorage.getGoals();

    expect(goals[0].completed).toBe(true);
    expect(goals[0].completedAt).toBe(completedAt);

    await goalStorage.updateGoalCompletion(goal.id, false);
    goals = await goalStorage.getGoals();

    expect(goals[0].completed).toBe(false);
    expect(goals[0].completedAt).toBeNull();

    await goalStorage.deleteGoalById(goal.id);
    goals = await goalStorage.getGoals();

    expect(goals).toEqual([]);
  });

  test('rejects an empty edited goal title without changing saved details', async () => {
    const goalStorage = await import('../../lib/goalStorage');

    const goal = await goalStorage.insertGoal(
      'Original title',
      '2026-07-01',
      '2026-09-23'
    );

    await expect(
      goalStorage.updateGoalDetails(
        goal.id,
        '   ',
        '2026-07-08',
        '2026-10-07'
      )
    ).rejects.toThrow('Enter a goal title first.');

    const goals = await goalStorage.getGoals();

    expect(goals[0]).toMatchObject({
      title: 'Original title',
      startDate: goal.startDate,
      endDate: goal.endDate,
    });
  });

  test('normalizes blank rewards and rejects rewards that are too long', async () => {
    const goalStorage = await import('../../lib/goalStorage');

    const goal = await goalStorage.insertGoal(
      'Reward validation goal',
      '2026-07-01',
      '2026-09-23',
      '   '
    );

    expect(goal.reward).toBeNull();

    await expect(
      goalStorage.updateGoalDetails(
        goal.id,
        goal.title,
        '2026-07-01',
        '2026-09-23',
        'x'.repeat(201)
      )
    ).rejects.toThrow('under 200 characters');
  });

  test('deleting a goal preserves linked tasks and recurring rules', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');
    const goalStorage = await import('../../lib/goalStorage');

    await migrateDb();
    const db = await getDb();
    const goal = await goalStorage.insertGoal(
      'Linked goal',
      '2026-07-01',
      '2026-09-23'
    );

    await db.runAsync(
      `
      INSERT INTO tasks (
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
      VALUES (?, 'Inbox', NULL, '', 0, ?, 0, ?, NULL, NULL, NULL);
      `,
      ['Linked task', goal.id, new Date().toISOString()]
    );

    await db.runAsync(
      `
      INSERT INTO recurring_rules (
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
      VALUES (?, '', 0, ?, 'daily', '2026-07-01', NULL, '[]', 1, ?);
      `,
      ['Linked recurring rule', goal.id, new Date().toISOString()]
    );

    await goalStorage.deleteGoalById(goal.id);

    const storedGoal = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM goals WHERE id = ?;',
      [goal.id]
    );
    const storedTask = await db.getFirstAsync<{ goal_id: number | null }>(
      'SELECT goal_id FROM tasks WHERE title = ?;',
      ['Linked task']
    );
    const storedRule = await db.getFirstAsync<{ goal_id: number | null }>(
      'SELECT goal_id FROM recurring_rules WHERE title = ?;',
      ['Linked recurring rule']
    );

    expect(storedGoal).toBeNull();
    expect(storedTask).not.toBeNull();
    expect(storedTask?.goal_id).toBeNull();
    expect(storedRule).not.toBeNull();
    expect(storedRule?.goal_id).toBeNull();
  });

  test('rolls back relationship cleanup when goal deletion fails', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');
    const goalStorage = await import('../../lib/goalStorage');

    await migrateDb();
    const db = await getDb();
    const goal = await goalStorage.insertGoal(
      'Rollback goal',
      '2026-07-01',
      '2026-09-23'
    );

    await db.runAsync(
      `
      INSERT INTO tasks (
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
      VALUES (?, 'Inbox', NULL, '', 0, ?, 0, ?, NULL, NULL, NULL);
      `,
      ['Rollback task', goal.id, new Date().toISOString()]
    );

    await db.execAsync(`
      CREATE TRIGGER fail_goal_delete
      BEFORE DELETE ON goals
      BEGIN
        SELECT RAISE(ABORT, 'forced goal delete failure');
      END;
    `);

    await expect(
      goalStorage.deleteGoalById(goal.id)
    ).rejects.toThrow('forced goal delete failure');

    await db.execAsync('DROP TRIGGER fail_goal_delete;');

    const storedGoal = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM goals WHERE id = ?;',
      [goal.id]
    );
    const storedTask = await db.getFirstAsync<{ goal_id: number | null }>(
      'SELECT goal_id FROM tasks WHERE title = ?;',
      ['Rollback task']
    );

    expect(storedGoal?.id).toBe(goal.id);
    expect(storedTask?.goal_id).toBe(goal.id);
  });

  test('creates, archives, restores, and deletes a brain dump', async () => {
    const brainStorage = await import(
      '../../lib/brainDumpStorage'
    );

    const note = await brainStorage.insertBrainDump(
      '  Remember this  '
    );

    expect(note.body).toBe('Remember this');

    await brainStorage.archiveBrainDumpById(note.id);

    let notes = await brainStorage.getBrainDumps();

    expect(notes[0].archived).toBe(true);
    expect(notes[0].archivedAt).not.toBeNull();

    await brainStorage.restoreBrainDumpById(note.id);
    notes = await brainStorage.getBrainDumps();

    expect(notes[0].archived).toBe(false);
    expect(notes[0].archivedAt).toBeNull();

    await brainStorage.deleteBrainDumpById(note.id);
    notes = await brainStorage.getBrainDumps();

    expect(notes).toEqual([]);
  });

  test('turns an active brain dump into one Inbox task atomically', async () => {
    const brainStorage = await import(
      '../../lib/brainDumpStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');

    const note = await brainStorage.insertBrainDump(
      '  Convert this idea  '
    );

    await brainStorage.convertBrainDumpToTaskById(note.id);

    const notes = await brainStorage.getBrainDumps();
    const tasks = await taskStorage.getTasks();

    expect(notes).toEqual([]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Convert this idea',
      day: 'Inbox',
      dueDate: null,
      notes: null,
      priority: 0,
      goalId: null,
      completed: false,
      recurringRuleId: null,
      recurrenceOccurrenceDate: null,
    });
  });

  test('keeps the brain dump when task creation fails during conversion', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');
    const brainStorage = await import(
      '../../lib/brainDumpStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');

    const note = await brainStorage.insertBrainDump(
      'Force brain conversion rollback'
    );

    await migrateDb();
    const db = await getDb();

    await db.execAsync(`
      CREATE TRIGGER fail_brain_dump_conversion
      BEFORE INSERT ON tasks
      WHEN NEW.title = 'Force brain conversion rollback'
      BEGIN
        SELECT RAISE(ABORT, 'forced conversion rollback');
      END;
    `);

    await expect(
      brainStorage.convertBrainDumpToTaskById(note.id)
    ).rejects.toThrow('forced conversion rollback');

    const notes = await brainStorage.getBrainDumps();
    const tasks = await taskStorage.getTasks();

    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('Force brain conversion rollback');
    expect(tasks).toEqual([]);
  });

});
