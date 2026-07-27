import {
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';

import {
  BACKUP_VERSION,
  inspectWeekFlowBackup,
  parseWeekFlowBackup,
  parseWeekFlowBackupJson,
  type WeekFlowBackup,
} from '../lib/backupValidation';
import {
  localIso,
  makeBrainDump,
  makeGoal,
  makePlanningCycle,
  makeRecurringRule,
  makeTask,
  makeTaskTemplate,
  resetFactoryIds,
} from './testFactories';

function makeValidBackup(): WeekFlowBackup {
  const goal = makeGoal({ id: 1, reward: 'Buy a new game' });
  const rule = makeRecurringRule({
    id: 10,
    goalId: 1,
    frequency: 'certainDays',
    weekdays: [1, 3, 5],
  });

  return {
    format: 'weekflow-backup',
    version: BACKUP_VERSION,
    exportedAt: localIso(2026, 6, 23),
    metadata: {
      appVersion: '1.0.0',
      dataModelVersion: 1,
    },
    data: {
      tasks: [
        makeTask({
          id: 100,
          goalId: 1,
        }),
        makeTask({
          id: 101,
          day: 'Monday',
          dueDate: '2026-06-22',
          goalId: 1,
          recurringRuleId: 10,
          recurrenceOccurrenceDate: '2026-06-22',
        }),
      ],
      goals: [goal],
      brainDumps: [makeBrainDump({ id: 20 })],
      taskTemplates: [
        makeTaskTemplate({
          id: 30,
          goalId: 1,
          priority: 2,
        }),
      ],
      recurringRules: [rule],
      recurringExceptions: [
        {
          recurringRuleId: 10,
          occurrenceDate: '2026-06-24',
          createdAt: localIso(2026, 6, 23),
        },
      ],
      planningCycles: [makePlanningCycle({ id: 40 })],
    },
  };
}

describe('backup validation', () => {
  beforeEach(() => {
    resetFactoryIds();
  });

  test('accepts a valid current backup and builds a complete preview', () => {
    const result = inspectWeekFlowBackup(makeValidBackup());

    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.preview).toMatchObject({
      sourceVersion: BACKUP_VERSION,
      currentVersion: BACKUP_VERSION,
      appVersion: '1.0.0',
      dataModelVersion: 1,
      counts: {
        tasks: 2,
        goals: 1,
        brainDumps: 1,
        taskTemplates: 1,
        recurringRules: 1,
        recurringExceptions: 1,
        planningCycles: 1,
      },
    });
  });

  test('accepts every-two-weeks recurring rules in current backups', () => {
    const backup = makeValidBackup();
    backup.data.recurringRules[0] = makeRecurringRule({
      id: 10,
      goalId: 1,
      frequency: 'everyTwoWeeks',
      startDate: '2026-06-22',
    });

    const result = inspectWeekFlowBackup(backup);

    expect(result.backup.data.recurringRules[0].frequency).toBe(
      'everyTwoWeeks'
    );
  });

  test('upgrades a valid version 1 backup', () => {
    const versionOneBackup = {
      format: 'weekflow-backup',
      version: 1,
      exportedAt: localIso(2026, 6, 1),
      data: {
        tasks: [
          {
            id: 1,
            title: 'Old task',
            day: 'Inbox',
            dueDate: null,
            notes: null,
            priority: 0,
            goalId: null,
            completed: false,
            createdAt: localIso(2026, 6, 1),
            completedAt: null,
          },
        ],
        goals: [],
        brainDumps: [],
      },
    };

    const result =
      inspectWeekFlowBackup(versionOneBackup);

    expect(result.preview.sourceVersion).toBe(1);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.data.recurringRules).toEqual([]);
    expect(result.backup.data.taskTemplates).toEqual([]);
    expect(result.backup.data.planningCycles).toEqual([]);
    expect(
      result.backup.data.tasks[0].recurringRuleId
    ).toBeNull();
  });

  test('upgrades a valid version 2 backup', () => {
    const current = makeValidBackup();
    const versionTwoBackup = {
      format: current.format,
      version: 2,
      exportedAt: current.exportedAt,
      data: {
        tasks: current.data.tasks,
        goals: current.data.goals,
        brainDumps: current.data.brainDumps,
        recurringRules: current.data.recurringRules,
        recurringExceptions: current.data.recurringExceptions,
      },
    };

    const result =
      inspectWeekFlowBackup(versionTwoBackup);

    expect(result.preview.sourceVersion).toBe(2);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.metadata.appVersion).toBe('legacy-v2');
    expect(result.backup.data.planningCycles).toEqual([]);
  });

  test('upgrades a valid version 3 backup without templates', () => {
    const current = makeValidBackup();
    const versionThreeBackup = {
      format: current.format,
      version: 3,
      exportedAt: current.exportedAt,
      metadata: current.metadata,
      data: {
        tasks: current.data.tasks,
        goals: current.data.goals,
        brainDumps: current.data.brainDumps,
        recurringRules: current.data.recurringRules,
        recurringExceptions: current.data.recurringExceptions,
      },
    };

    const result = inspectWeekFlowBackup(versionThreeBackup);

    expect(result.preview.sourceVersion).toBe(3);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.data.taskTemplates).toEqual([]);
    expect(result.backup.data.planningCycles).toEqual([]);
  });

  test('upgrades a valid version 4 backup without planning cycles', () => {
    const current = makeValidBackup();
    const versionFourBackup = {
      format: current.format,
      version: 4,
      exportedAt: current.exportedAt,
      metadata: current.metadata,
      data: {
        tasks: current.data.tasks,
        goals: current.data.goals,
        brainDumps: current.data.brainDumps,
        taskTemplates: current.data.taskTemplates,
        recurringRules: current.data.recurringRules,
        recurringExceptions: current.data.recurringExceptions,
      },
    };

    const result = inspectWeekFlowBackup(versionFourBackup);

    expect(result.preview.sourceVersion).toBe(4);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.data.planningCycles).toEqual([]);
  });

  test('upgrades a valid version 5 backup and adds null rewards to old goals', () => {
    const current = makeValidBackup();
    const versionFiveBackup = {
      ...current,
      version: 5,
      data: {
        ...current.data,
        goals: current.data.goals.map(({ reward, ...goal }) => goal),
      },
    };

    const result = inspectWeekFlowBackup(versionFiveBackup);

    expect(result.preview.sourceVersion).toBe(5);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.data.goals[0].reward).toBeNull();
  });

  test('accepts JSON with a UTF-8 byte-order mark', () => {
    const backup = makeValidBackup();
    const result = parseWeekFlowBackupJson(
      `\uFEFF${JSON.stringify(backup)}`
    );

    expect(result.data.tasks).toHaveLength(2);
  });

  test('rejects multiple active planning cycles', () => {
    const backup = makeValidBackup();
    backup.data.planningCycles.push(
      makePlanningCycle({ id: 41 })
    );

    expect(() => parseWeekFlowBackup(backup)).toThrow(
      'more than one active planning cycle'
    );
  });

  test('rejects a planning cycle that is not exactly twelve weeks', () => {
    const backup = makeValidBackup();
    backup.data.planningCycles[0].endDate = '2026-09-23';

    expect(() => parseWeekFlowBackup(backup)).toThrow(
      'not exactly twelve weeks long'
    );
  });

  test('rejects a current backup with an invalid goal reward', () => {
    const backup = makeValidBackup();
    backup.data.goals[0].reward = 'x'.repeat(201);

    expect(() => parseWeekFlowBackup(backup)).toThrow(
      'reward longer than 200 characters'
    );
  });

  test('rejects malformed JSON text', () => {
    expect(() =>
      parseWeekFlowBackupJson('{not valid json')
    ).toThrow('does not contain valid JSON');
  });

  test('reports unsupported versions clearly', () => {
    const backup = {
      ...makeValidBackup(),
      version: 99,
    };

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('Backup version 99 is not supported');
  });

  test('reports the exact invalid task field', () => {
    const backup = makeValidBackup();
    backup.data.tasks[0].priority = 8;

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow(
      'Task 1 has an invalid priority. Expected 0, 1, or 2.'
    );
  });

  test('rejects inconsistent completion status', () => {
    const backup = makeValidBackup();
    backup.data.tasks[0].completed = true;
    backup.data.tasks[0].completedAt = null;

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('completion status');
  });

  test('rejects duplicate record IDs', () => {
    const backup = makeValidBackup();

    backup.data.tasks.push({
      ...backup.data.tasks[0],
    });

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('duplicate task IDs');
  });

  test('repairs orphaned optional goal links while preserving records', () => {
    const backup = makeValidBackup();
    backup.data.tasks[0].goalId = 999;
    backup.data.taskTemplates[0].goalId = 998;
    backup.data.recurringRules[0].goalId = 997;

    const result = inspectWeekFlowBackup(backup);

    expect(result.backup.data.tasks[0].goalId).toBeNull();
    expect(
      result.backup.data.taskTemplates[0].goalId
    ).toBeNull();
    expect(
      result.backup.data.recurringRules[0].goalId
    ).toBeNull();
    expect(result.preview.repairs).toEqual({
      orphanedGoalLinks: 3,
    });
    expect(result.backup.data.tasks).toHaveLength(2);
    expect(result.backup.data.taskTemplates).toHaveLength(1);
    expect(result.backup.data.recurringRules).toHaveLength(1);
  });

  test('rejects a task linked to a missing recurring rule', () => {
    const backup = makeValidBackup();
    backup.data.tasks[1].recurringRuleId = 999;

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('linked to a recurring schedule');
  });

  test('rejects duplicate recurring occurrences', () => {
    const backup = makeValidBackup();

    backup.data.tasks.push(
      makeTask({
        id: 102,
        day: 'Monday',
        dueDate: '2026-06-22',
        goalId: 1,
        recurringRuleId: 10,
        recurrenceOccurrenceDate: '2026-06-22',
      })
    );

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow(
      'duplicate recurring task occurrences'
    );
  });

  test('rejects duplicate recurring weekdays', () => {
    const backup = makeValidBackup();
    backup.data.recurringRules[0].weekdays = [1, 1, 3];

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('contains duplicate weekdays');
  });

  test('rejects invalid recurring-rule dates', () => {
    const backup = makeValidBackup();
    backup.data.recurringRules[0].endDate =
      '2026-06-01';

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('ends before its start date');
  });
});
