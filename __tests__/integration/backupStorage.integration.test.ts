import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import {
  BACKUP_VERSION,
  type WeekFlowBackup,
} from '../../lib/backupValidation';

function makeBackup(
  taskTitle: string = 'Restored task'
): WeekFlowBackup {
  return {
    format: 'weekflow-backup',
    version: BACKUP_VERSION,
    exportedAt: '2026-07-01T12:00:00.000Z',
    metadata: {
      appVersion: '1.0.0',
      dataModelVersion: 1,
    },
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
      taskTemplates: [
        {
          id: 30,
          title: 'Restored template',
          notes: 'Template note',
          priority: 2,
          goalId: 1,
          createdAt: '2026-07-01T12:00:00.000Z',
          updatedAt: '2026-07-01T12:00:00.000Z',
        },
      ],
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
      planningCycles: [
        {
          id: 40,
          startDate: '2026-07-01',
          endDate: '2026-09-22',
          active: true,
          createdAt: '2026-07-01T12:00:00.000Z',
          completedAt: null,
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
    const templateStorage = await import(
      '../../lib/taskTemplateStorage'
    );
    const cycleStorage = await import(
      '../../lib/cycleStorage'
    );

    await taskStorage.insertTask('Old task', 'Inbox');
    await goalStorage.insertGoal('Old goal');
    await brainStorage.insertBrainDump('Old note');

    const counts = await replaceWeekFlowData(makeBackup());

    expect(counts).toEqual({
      tasks: 1,
      goals: 1,
      brainDumps: 1,
      taskTemplates: 1,
      recurringRules: 0,
      recurringExceptions: 0,
      planningCycles: 1,
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
    expect(
      (await templateStorage.getTaskTemplates())[0].title
    ).toBe('Restored template');
    expect(
      (await cycleStorage.getPlanningCycles())[0]
    ).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-09-22',
      active: true,
    });
  });

  test('rejects invalid data before deleting the current database contents', async () => {
    const { replaceWeekFlowData } = await import(
      '../../lib/backupStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');

    await taskStorage.insertTask('Original task', 'Inbox');

    const invalidBackup = makeBackup();
    invalidBackup.data.tasks[0].priority = 9;

    await expect(
      replaceWeekFlowData(invalidBackup)
    ).rejects.toThrow('invalid priority');

    const tasks = await taskStorage.getTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Original task');
  });

  test('preserves records and clears goal links from older orphaned backups', async () => {
    const { replaceWeekFlowData } = await import(
      '../../lib/backupStorage'
    );
    const taskStorage = await import('../../lib/taskStorage');
    const templateStorage = await import(
      '../../lib/taskTemplateStorage'
    );

    const orphanedBackup = makeBackup();
    orphanedBackup.data.goals = [];

    await replaceWeekFlowData(orphanedBackup);

    const tasks = await taskStorage.getTasks();
    const templates = await templateStorage.getTaskTemplates();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].goalId).toBeNull();
    expect(templates).toHaveLength(1);
    expect(templates[0].goalId).toBeNull();
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
