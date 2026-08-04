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
          cycleId: 40,
          title: 'Restored goal',
          completed: true,
          createdAt: '2026-07-01T12:00:00.000Z',
          completedAt: '2026-07-20T12:00:00.000Z',
          startDate: '2026-07-01T12:00:00.000Z',
          endDate: '2026-09-23T12:00:00.000Z',
          reward: 'Buy a new game',
          purpose: 'Build a portfolio that proves practical DBA skills.',
          successDefinition: 'Publish the completed database portfolio.',
          notes: 'Keep screenshots and recovery test results.',
          completionWhatHelped: 'Weekly planning kept the work moving.',
          completionHardestPart: 'Recovery testing took the most time.',
          completionLearned: 'Document restores while running them.',
          completionDoDifferently: 'Start screenshots earlier.',
          completionTaskTotal: 1,
          completionTaskCompleted: 0,
          completionMilestoneTotal: 1,
          completionMilestoneCompleted: 1,
          completionHighPriorityCompleted: 0,
        },
      ],
      goalMilestones: [
        {
          id: 5,
          goalId: 1,
          title: 'Finish backup and recovery lab',
          notes: 'Document the restore test.',
          targetDate: '2026-08-01',
          completed: true,
          createdAt: '2026-07-01T12:00:00.000Z',
          completedAt: '2026-07-15T12:00:00.000Z',
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
          name: 'Summer 2026',
          primaryFocus: 'Finish WeekFlow local v1.0',
          theme: 'Build the foundation',
          startDate: '2026-07-01',
          endDate: '2026-09-22',
          active: true,
          createdAt: '2026-07-01T12:00:00.000Z',
          completedAt: null,
        },
      ],
      weeklyReviews: [
        {
          id: 60,
          weekStart: '2026-07-06',
          cycleId: 40,
          whatWentWell: 'The plan was realistic.',
          whatCausedProblems: null,
          whatLearned: 'Keep commitments focused.',
          whatChangeNextWeek: null,
          nextWeekFocus: 'Finish the restore test.',
          completedCount: 4,
          unfinishedCount: 1,
          overdueCount: 1,
          completionRate: 80,
          goalsProgressedCount: 1,
          bestDay: 'Wednesday',
          bestDayCount: 2,
          archivedBrainDumpCount: 1,
          highPriorityCompletedCount: 1,
          recurringCompletedCount: 1,
          createdAt: '2026-07-12T12:00:00.000Z',
          updatedAt: '2026-07-12T12:00:00.000Z',
          reviewedAt: '2026-07-12T12:00:00.000Z',
        },
      ],
      weeklyCommitments: [
        {
          id: 70,
          weekStart: '2026-07-06',
          cycleId: 40,
          taskId: 10,
          title: taskTitle,
          completed: false,
          createdAt: '2026-07-06T12:00:00.000Z',
          completedAt: null,
        },
      ],
      weeklyTaskDecisions: [
        {
          id: 80,
          weekStart: '2026-07-06',
          taskId: 10,
          taskTitle: taskTitle,
          originalDueDate: '2026-07-06',
          action: 'nextWeek',
          resolvedDueDate: '2026-07-13',
          recurringRuleId: null,
          recurrenceOccurrenceDate: null,
          decidedAt: '2026-07-12T12:00:00.000Z',
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
    const milestoneStorage = await import(
      '../../lib/goalMilestoneStorage'
    );
    const templateStorage = await import(
      '../../lib/taskTemplateStorage'
    );
    const cycleStorage = await import(
      '../../lib/cycleStorage'
    );
    const weeklyReviewStorage = await import(
      '../../lib/weeklyReviewStorage'
    );

    await taskStorage.insertTask('Old task', 'Inbox');
    await goalStorage.insertGoal('Old goal');
    await brainStorage.insertBrainDump('Old note');

    const counts = await replaceWeekFlowData(makeBackup());

    expect(counts).toEqual({
      tasks: 1,
      goals: 1,
      goalMilestones: 1,
      brainDumps: 1,
      taskTemplates: 1,
      recurringRules: 0,
      recurringExceptions: 0,
      planningCycles: 1,
      weeklyReviews: 1,
      weeklyCommitments: 1,
      weeklyTaskDecisions: 1,
    });

    expect((await taskStorage.getTasks())[0].title).toBe(
      'Restored task'
    );
    expect((await goalStorage.getGoals())[0]).toMatchObject({
      cycleId: 40,
      title: 'Restored goal',
      reward: 'Buy a new game',
      purpose: 'Build a portfolio that proves practical DBA skills.',
      successDefinition: 'Publish the completed database portfolio.',
      notes: 'Keep screenshots and recovery test results.',
      completionWhatHelped: 'Weekly planning kept the work moving.',
      completionHardestPart: 'Recovery testing took the most time.',
      completionLearned: 'Document restores while running them.',
      completionDoDifferently: 'Start screenshots earlier.',
      completionTaskTotal: 1,
      completionTaskCompleted: 0,
      completionMilestoneTotal: 1,
      completionMilestoneCompleted: 1,
      completionHighPriorityCompleted: 0,
    });
    expect((await milestoneStorage.getGoalMilestones())[0]).toMatchObject({
      goalId: 1,
      title: 'Finish backup and recovery lab',
      completed: true,
      targetDate: '2026-08-01',
    });
    expect(
      (await brainStorage.getBrainDumps())[0].body
    ).toBe('Restored note');
    expect(
      (await templateStorage.getTaskTemplates())[0].title
    ).toBe('Restored template');
    expect(
      (await cycleStorage.getPlanningCycles())[0]
    ).toMatchObject({
      name: 'Summer 2026',
      primaryFocus: 'Finish WeekFlow local v1.0',
      theme: 'Build the foundation',
      startDate: '2026-07-01',
      endDate: '2026-09-22',
      active: true,
    });
    expect((await weeklyReviewStorage.getWeeklyReviews())[0]).toMatchObject({
      weekStart: '2026-07-06',
      whatWentWell: 'The plan was realistic.',
      completionRate: 80,
    });
    expect((await weeklyReviewStorage.getWeeklyCommitments())[0]).toMatchObject({
      taskId: 10,
      title: 'Restored task',
      completed: false,
    });
    expect((await weeklyReviewStorage.getWeeklyTaskDecisions())[0]).toMatchObject({
      action: 'nextWeek',
      resolvedDueDate: '2026-07-13',
    });
  });

  test('restores every-two-weeks recurring schedules', async () => {
    const { replaceWeekFlowData } = await import(
      '../../lib/backupStorage'
    );
    const recurringStorage = await import(
      '../../lib/recurringStorage'
    );

    const backup = makeBackup();
    backup.data.recurringRules = [
      {
        id: 50,
        title: 'Restored biweekly schedule',
        notes: null,
        priority: 1,
        goalId: 1,
        frequency: 'everyTwoWeeks',
        startDate: '2026-07-06',
        endDate: null,
        weekdays: [],
        active: true,
        createdAt: '2026-07-01T12:00:00.000Z',
      },
    ];

    const counts = await replaceWeekFlowData(backup);
    const rules = await recurringStorage.getRecurringRules();

    expect(counts.recurringRules).toBe(1);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      title: 'Restored biweekly schedule',
      frequency: 'everyTwoWeeks',
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
    orphanedBackup.data.goalMilestones = [];

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
