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
  makeRecurringRule,
  makeTask,
  resetFactoryIds,
} from './testFactories';

function makeValidBackup(): WeekFlowBackup {
  const goal = makeGoal({ id: 1 });
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
      recurringRules: [rule],
      recurringExceptions: [
        {
          recurringRuleId: 10,
          occurrenceDate: '2026-06-24',
          createdAt: localIso(2026, 6, 23),
        },
      ],
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
        recurringRules: 1,
        recurringExceptions: 1,
      },
    });
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
      data: current.data,
    };

    const result =
      inspectWeekFlowBackup(versionTwoBackup);

    expect(result.preview.sourceVersion).toBe(2);
    expect(result.backup.version).toBe(BACKUP_VERSION);
    expect(result.backup.metadata.appVersion).toBe('legacy-v2');
  });

  test('accepts JSON with a UTF-8 byte-order mark', () => {
    const backup = makeValidBackup();
    const result = parseWeekFlowBackupJson(
      `\uFEFF${JSON.stringify(backup)}`
    );

    expect(result.data.tasks).toHaveLength(2);
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

  test('names a task linked to a missing goal', () => {
    const backup = makeValidBackup();
    backup.data.tasks[0].goalId = 999;

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow(
      `Task "${backup.data.tasks[0].title}" is linked to a goal`
    );
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
