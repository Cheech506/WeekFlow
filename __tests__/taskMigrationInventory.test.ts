import { getTaskMigrationInventory } from '../lib/taskMigrationInventory';
import { makeTask } from './testFactories';

test('returns zeroes for an empty task list', () => {
  expect(getTaskMigrationInventory([])).toEqual({
    total: 0,
    plain: 0,
    goalLinked: 0,
    recurring: 0,
    completed: 0,
  });
});

test('counts plain, goal-linked, recurring, and completed tasks', () => {
  const tasks = [
    makeTask(),
    makeTask({
      completed: true,
      goalId: 10,
    }),
    makeTask({
      recurringRuleId: 20,
      recurrenceOccurrenceDate: '2026-09-16',
    }),
    makeTask({
      completed: true,
      goalId: 10,
      recurringRuleId: 20,
      recurrenceOccurrenceDate: '2026-09-17',
    }),
  ];

  expect(getTaskMigrationInventory(tasks)).toEqual({
    total: 4,
    plain: 1,
    goalLinked: 2,
    recurring: 2,
    completed: 2,
  });
});