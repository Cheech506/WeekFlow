import {
  describe,
  expect,
  test,
} from '@jest/globals';

import {
  getPlanningCycleDisplayName,
  normalizePlanningCycleDetails,
} from '../lib/cycleIdentityUtils';

describe('cycle identity utilities', () => {
  test('trims optional cycle details', () => {
    expect(
      normalizePlanningCycleDetails({
        name: '  Fall 2026  ',
        primaryFocus: '  Finish WeekFlow  ',
        theme: '  Build the foundation  ',
      })
    ).toEqual({
      name: 'Fall 2026',
      primaryFocus: 'Finish WeekFlow',
      theme: 'Build the foundation',
    });
  });

  test('stores blank optional details as null', () => {
    expect(
      normalizePlanningCycleDetails({
        name: '   ',
        primaryFocus: '',
        theme: null,
      })
    ).toEqual({
      name: null,
      primaryFocus: null,
      theme: null,
    });
  });

  test('rejects cycle details that exceed their limits', () => {
    expect(() =>
      normalizePlanningCycleDetails({ name: 'x'.repeat(81) })
    ).toThrow('80 characters or fewer');
  });

  test('uses the saved name or a numbered fallback', () => {
    expect(getPlanningCycleDisplayName('Summer 2026', 2)).toBe(
      'Summer 2026'
    );
    expect(getPlanningCycleDisplayName(null, 2)).toBe('Cycle 2');
  });
});
