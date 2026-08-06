import {
  countActiveTaskFilters,
  createDefaultActiveTaskFilters,
  filterActiveTasks,
} from '@/lib/activeTaskFilters';
import type { Task } from '@/lib/taskStorage';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Review database notes',
    day: 'Inbox',
    dueDate: null,
    notes: 'Prepare for class',
    priority: 1,
    goalId: null,
    completed: false,
    createdAt: '2026-07-21T12:00:00.000Z',
    completedAt: null,
    recurringRuleId: null,
    recurrenceOccurrenceDate: null,
    ...overrides,
  };
}

describe('active task filters', () => {
  const today = new Date(2026, 6, 21, 12, 0, 0);
  const tasks = [
    makeTask({ id: 1 }),
    makeTask({
      id: 2,
      title: 'High priority recurring backup',
      notes: 'Run server backup',
      priority: 2,
      goalId: 4,
      dueDate: '2026-07-20',
      recurringRuleId: 9,
    }),
    makeTask({
      id: 3,
      title: 'Today task',
      notes: null,
      priority: 0,
      goalId: 4,
      dueDate: '2026-07-21',
    }),
    makeTask({
      id: 4,
      title: 'Upcoming task',
      priority: 1,
      goalId: 8,
      dueDate: '2026-07-25',
    }),
    makeTask({ id: 5, title: 'Completed task', completed: true }),
  ];

  test('returns every incomplete task with default filters', () => {
    expect(
      filterActiveTasks(tasks, createDefaultActiveTaskFilters(), today).map(
        (task) => task.id
      )
    ).toEqual([1, 2, 3, 4]);
  });

  test('searches titles and notes without case sensitivity', () => {
    const filters = {
      ...createDefaultActiveTaskFilters(),
      searchText: 'SERVER BACKUP',
    };

    expect(filterActiveTasks(tasks, filters, today).map((task) => task.id)).toEqual([
      2,
    ]);
  });

  test('filters by priority and linked goal', () => {
    const filters = {
      ...createDefaultActiveTaskFilters(),
      priority: 2 as const,
      goal: 'goal:4' as const,
    };

    expect(filterActiveTasks(tasks, filters, today).map((task) => task.id)).toEqual([
      2,
    ]);
  });

  test('filters all goal-linked tasks', () => {
    const filters = {
      ...createDefaultActiveTaskFilters(),
      goal: 'linked' as const,
    };

    expect(filterActiveTasks(tasks, filters, today).map((task) => task.id)).toEqual([
      2,
      3,
      4,
    ]);
  });

  test('filters unlinked tasks', () => {
    const filters = {
      ...createDefaultActiveTaskFilters(),
      goal: 'unlinked' as const,
    };

    expect(filterActiveTasks(tasks, filters, today).map((task) => task.id)).toEqual([
      1,
    ]);
  });

  test.each([
    ['unscheduled', [1]],
    ['overdue', [2]],
    ['today', [3]],
    ['upcoming', [4]],
  ] as const)('filters %s tasks', (schedule, expectedIds) => {
    const filters = {
      ...createDefaultActiveTaskFilters(),
      schedule,
    };

    expect(filterActiveTasks(tasks, filters, today).map((task) => task.id)).toEqual(
      expectedIds
    );
  });

  test('filters recurring and standalone tasks', () => {
    const recurringFilters = {
      ...createDefaultActiveTaskFilters(),
      recurrence: 'recurring' as const,
    };
    const standaloneFilters = {
      ...createDefaultActiveTaskFilters(),
      recurrence: 'standalone' as const,
    };

    expect(
      filterActiveTasks(tasks, recurringFilters, today).map((task) => task.id)
    ).toEqual([2]);
    expect(
      filterActiveTasks(tasks, standaloneFilters, today).map((task) => task.id)
    ).toEqual([1, 3, 4]);
  });

  test('filters an exact due date', () => {
    const filters = {
      ...createDefaultActiveTaskFilters(),
      dueDate: '2026-07-25',
    };

    expect(filterActiveTasks(tasks, filters, today).map((task) => task.id)).toEqual([
      4,
    ]);
  });

  test('counts every non-default filter', () => {
    expect(
      countActiveTaskFilters({
        searchText: 'backup',
        priority: 2,
        goal: 'goal:4',
        schedule: 'overdue',
        recurrence: 'recurring',
        dueDate: '2026-07-20',
      })
    ).toBe(6);
  });
});
