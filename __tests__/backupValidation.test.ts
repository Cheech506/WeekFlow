import {
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';

import {
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
    version: 2,
    exportedAt: localIso(2026, 6, 23),
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

  test('accepts a valid version 2 backup', () => {
    const backup = makeValidBackup();
    const result = parseWeekFlowBackup(backup);

    expect(result.version).toBe(2);
    expect(result.data.recurringRules).toHaveLength(1);
    expect(result.data.tasks).toHaveLength(2);
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
      parseWeekFlowBackup(versionOneBackup);

    expect(result.version).toBe(2);
    expect(result.data.recurringRules).toEqual([]);
    expect(
      result.data.tasks[0].recurringRuleId
    ).toBeNull();
  });

  test('rejects malformed JSON text', () => {
    expect(() =>
      parseWeekFlowBackupJson('{not valid json')
    ).toThrow('does not contain valid JSON');
  });

  test('rejects duplicate record IDs', () => {
    const backup = makeValidBackup();

    backup.data.tasks.push({
      ...backup.data.tasks[0],
    });

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('duplicate record IDs');
  });

  test('rejects a task linked to a missing goal', () => {
    const backup = makeValidBackup();
    backup.data.tasks[0].goalId = 999;

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('task linked to a missing goal');
  });

  test('rejects a task linked to a missing recurring rule', () => {
    const backup = makeValidBackup();
    backup.data.tasks[1].recurringRuleId = 999;

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow(
      'task linked to a missing recurring rule'
    );
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

  test('rejects invalid recurring-rule dates', () => {
    const backup = makeValidBackup();
    backup.data.recurringRules[0].endDate =
      '2026-06-01';

    expect(() =>
      parseWeekFlowBackup(backup)
    ).toThrow('invalid recurring rule');
  });
});
