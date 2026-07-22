import {
  describe,
  expect,
  test,
} from '@jest/globals';

import {
  createPlanningCycleRange,
  getNextPlanningCycleStartDate,
  getPlanningCycleProgress,
  getTimestampDateKey,
  isDateKeyWithinCycle,
} from '../lib/cycleUtils';

describe('planning cycle utilities', () => {
  test('creates an inclusive twelve-week date range', () => {
    expect(
      createPlanningCycleRange('2026-07-01')
    ).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-09-22',
    });
  });

  test('rejects an invalid cycle start date', () => {
    expect(() =>
      createPlanningCycleRange('2026-02-30')
    ).toThrow('YYYY-MM-DD');
  });

  test('reports upcoming, active, and completed cycle progress', () => {
    expect(
      getPlanningCycleProgress(
        '2026-07-01',
        '2026-09-22',
        new Date(2026, 5, 28, 12)
      )
    ).toMatchObject({
      state: 'upcoming',
      weekNumber: null,
      progressPercentage: 0,
      daysUntilStart: 3,
    });

    expect(
      getPlanningCycleProgress(
        '2026-07-01',
        '2026-09-22',
        new Date(2026, 6, 15, 12)
      )
    ).toMatchObject({
      state: 'active',
      weekNumber: 3,
      daysElapsed: 15,
    });

    expect(
      getPlanningCycleProgress(
        '2026-07-01',
        '2026-09-22',
        new Date(2026, 8, 23, 12)
      )
    ).toMatchObject({
      state: 'complete',
      weekNumber: 12,
      progressPercentage: 100,
      daysRemaining: 0,
    });
  });

  test('builds the next cycle start and compares date keys', () => {
    expect(
      getNextPlanningCycleStartDate('2026-09-22')
    ).toBe('2026-09-23');

    expect(
      isDateKeyWithinCycle(
        '2026-08-01',
        '2026-07-01',
        '2026-09-22'
      )
    ).toBe(true);

    expect(
      isDateKeyWithinCycle(
        '2026-09-23',
        '2026-07-01',
        '2026-09-22'
      )
    ).toBe(false);
  });

  test('converts valid timestamps to local date keys', () => {
    expect(
      getTimestampDateKey(
        new Date(2026, 6, 4, 18).toISOString()
      )
    ).toBe('2026-07-04');

    expect(getTimestampDateKey(null)).toBeNull();
    expect(getTimestampDateKey('bad timestamp')).toBeNull();
  });
});
