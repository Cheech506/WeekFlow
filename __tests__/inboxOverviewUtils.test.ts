import {
  calculateInboxOverview,
  createInboxQuickFilterState,
  getSelectedInboxQuickFilter,
} from '@/lib/inboxOverviewUtils';
import {
  makeRecurringRule,
  makeTask,
  resetFactoryIds,
} from './testFactories';

describe('inbox overview utilities', () => {
  beforeEach(() => resetFactoryIds());

  test('summarizes active work without counting completed tasks or paused schedules', () => {
    const currentDate = new Date(2026, 7, 6, 12);
    const tasks = [
      makeTask({ id: 1, dueDate: null }),
      makeTask({ id: 2, dueDate: '2026-08-06', goalId: 7 }),
      makeTask({ id: 3, dueDate: '2026-08-05', recurringRuleId: 10 }),
      makeTask({ id: 4, dueDate: '2026-08-10', goalId: 8 }),
      makeTask({ id: 5, completed: true, dueDate: null, goalId: 9 }),
    ];
    const rules = [
      makeRecurringRule({ id: 10, active: true }),
      makeRecurringRule({ id: 11, active: false }),
    ];

    expect(calculateInboxOverview(tasks, rules, currentDate)).toEqual({
      totalActiveTasks: 4,
      unscheduledTasks: 1,
      scheduledToday: 1,
      overdueTasks: 1,
      activeRecurringSchedules: 1,
      goalLinkedTasks: 2,
    });
  });

  test.each([
    ['unscheduled', { schedule: 'unscheduled' }],
    ['today', { schedule: 'today' }],
    ['overdue', { schedule: 'overdue' }],
    ['recurring', { recurrence: 'recurring' }],
    ['goalLinked', { goal: 'linked' }],
    ['all', { schedule: 'all', recurrence: 'all', goal: 'all' }],
  ] as const)('creates the %s quick filter', (quickFilter, expected) => {
    expect(createInboxQuickFilterState(quickFilter)).toMatchObject(expected);
  });

  test('recognizes simple quick filters and leaves combined filters unselected', () => {
    const today = createInboxQuickFilterState('today');
    expect(getSelectedInboxQuickFilter(today)).toBe('today');

    expect(
      getSelectedInboxQuickFilter({
        ...today,
        priority: 2,
      })
    ).toBeNull();
  });
});
