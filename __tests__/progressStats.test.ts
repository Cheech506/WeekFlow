import {
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';

import { calculateProgressStats } from '../lib/progressStats';
import {
  localIso,
  makeTask,
  resetFactoryIds,
} from './testFactories';

describe('calculateProgressStats', () => {
  beforeEach(() => {
    resetFactoryIds();
  });

  test('calculates weekly totals, streaks, best day, and rate', () => {
    const tasks = [
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 22, 10),
      }),
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 23, 10),
      }),
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 24, 10),
      }),
      makeTask({
        completed: true,
        completedAt: localIso(2026, 6, 24, 15),
      }),
      makeTask({
        day: 'Thursday',
        dueDate: '2026-06-25',
      }),
      makeTask({
        day: 'Inbox',
        dueDate: null,
      }),
    ];

    const stats = calculateProgressStats(
      tasks,
      new Date(2026, 5, 24, 18)
    );

    expect(stats.completedToday).toBe(2);
    expect(stats.completedThisWeek).toBe(4);
    expect(stats.currentStreak).toBe(3);
    expect(stats.longestStreak).toBe(3);
    expect(stats.weeklyCompletionRate).toBe(80);
    expect(stats.bestDay).toBe('Wednesday');
    expect(stats.bestDayCount).toBe(2);
    expect(stats.weeklyDays).toHaveLength(7);
  });

  test('continues the current streak from yesterday', () => {
    const stats = calculateProgressStats(
      [
        makeTask({
          completed: true,
          completedAt: localIso(2026, 6, 22),
        }),
        makeTask({
          completed: true,
          completedAt: localIso(2026, 6, 23),
        }),
      ],
      new Date(2026, 5, 24, 12)
    );

    expect(stats.currentStreak).toBe(2);
  });

  test('keeps the longest historical streak after a later reset', () => {
    const stats = calculateProgressStats(
      [
        makeTask({
          completed: true,
          completedAt: localIso(2026, 1, 1),
        }),
        makeTask({
          completed: true,
          completedAt: localIso(2026, 1, 2),
        }),
        makeTask({
          completed: true,
          completedAt: localIso(2026, 1, 3),
        }),
        makeTask({
          completed: true,
          completedAt: localIso(2026, 1, 5),
        }),
        makeTask({
          completed: true,
          completedAt: localIso(2026, 1, 6),
        }),
      ],
      new Date(2026, 0, 6, 12)
    );

    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(3);
  });

  test('returns zero progress when there is no planned work', () => {
    const stats = calculateProgressStats(
      [],
      new Date(2026, 5, 24, 12)
    );

    expect(stats.completedToday).toBe(0);
    expect(stats.completedThisWeek).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestStreak).toBe(0);
    expect(stats.weeklyCompletionRate).toBe(0);
    expect(stats.bestDay).toBeNull();
  });
});
