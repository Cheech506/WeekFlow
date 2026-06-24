import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import type { WeekFlowBackup } from '../../lib/backupValidation';

function makeBackup(
  taskTitle: string = 'Restored task'
): WeekFlowBackup {
  return {
    format: 'weekflow-backup',
    version: 2,
    exportedAt: '2026-07-01T12:00:00.000Z',
    data: {
      goals: [
        {
          id: 1,
          title: 'Restored goal',
          completed: false,
          createdAt: '2026-07-01T12:00:00.000Z',
          completedAt: null,
          startDate: '2026-07-01T12:00:00.000Z',
          endDate: '2026-09-23T12:00:00.000Z',
        },
      ],
      recurringRules: [],
      tasks: [
        {
          id: 10,
          title: taskTitle,
          day: 'Monday',
          dueDate: '2026-07-06',
          notes: null,
          priority: 1,
          goalId: 1,
          completed: false,
          createdAt: '2026-07-01T12:00:00.000Z',
          completedAt: null,
          recurringRuleId: null,
          recurrenceOccurrenceDate: null,
        },
      ],
      recurringExceptions: [],
      brainDumps: [
        {
          id: 20,
          body: 'Restored note',
          archived: false,
          createdAt: '2026-07-01T12:00:00.000Z',
          archivedAt: null,
        },
      ],
    },
  };
}

describe('backup restore integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('replaces isolated database contents with validated backup data', async () => {
    const { replaceWeekFlowData } = await import(
      '../../lib/backupStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const goalStorage = await import('../../lib/goalStorage');
    const brainStorage = await import(
      '../../lib/brainDumpStorage'
    );

    await taskStorage.insertTask('Old task', 'Inbox');
    await goalStorage.insertGoal('Old goal');
    await brainStorage.insertBrainDump('Old note');

    const counts = await replaceWeekFlowData(makeBackup());

    expect(counts).toEqual({
      tasks: 1,
      goals: 1,
      brainDumps: 1,
      recurringRules: 0,
    });

    expect((await taskStorage.getTasks())[0].title).toBe(
      'Restored task'
    );
    expect((await goalStorage.getGoals())[0].title).toBe(
      'Restored goal'
    );
    expect(
      (await brainStorage.getBrainDumps())[0].body
    ).toBe('Restored note');
  });

  test('rolls back the entire replacement when an insert fails', async () => {
    const { getDb, migrateDb } = await import('../../lib/db');
    const { replaceWeekFlowData } = await import(
      '../../lib/backupStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');

    await taskStorage.insertTask('Original task', 'Inbox');

    await migrateDb();
    const db = await getDb();

    await db.execAsync(`
      CREATE TRIGGER fail_forced_restore
      BEFORE INSERT ON tasks
      WHEN NEW.title = 'Force rollback'
      BEGIN
        SELECT RAISE(ABORT, 'forced rollback');
      END;
    `);

    await expect(
      replaceWeekFlowData(makeBackup('Force rollback'))
    ).rejects.toThrow();

    const tasks = await taskStorage.getTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Original task');
  });
});
