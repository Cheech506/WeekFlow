import {
  createDefaultGoalDateRange,
  getGoalDateKey,
  validateGoalDateRange,
} from '../lib/goalUtils';

describe('goal date utilities', () => {
  test('creates a default 12-week goal range', () => {
    const range = createDefaultGoalDateRange(
      new Date(2026, 6, 1, 9, 30)
    );

    expect(range).toEqual({
      startDateKey: '2026-07-01',
      endDateKey: '2026-09-23',
    });
  });

  test('accepts recommended 12 to 13 week ranges', () => {
    const twelveWeeks = validateGoalDateRange(
      '2026-07-01',
      '2026-09-23'
    );
    const thirteenWeeks = validateGoalDateRange(
      '2026-07-01',
      '2026-09-30'
    );

    expect(twelveWeeks.durationDays).toBe(84);
    expect(twelveWeeks.recommendation).toBeNull();
    expect(thirteenWeeks.durationDays).toBe(91);
    expect(thirteenWeeks.recommendation).toBeNull();
  });

  test('allows shorter and longer ranges with a recommendation', () => {
    const shortRange = validateGoalDateRange(
      '2026-07-01',
      '2026-07-31'
    );
    const longRange = validateGoalDateRange(
      '2026-07-01',
      '2026-12-31'
    );

    expect(shortRange.recommendation).toContain('12–13 weeks');
    expect(longRange.recommendation).toContain('still allowed');
  });

  test('rejects invalid dates and backwards ranges', () => {
    expect(() =>
      validateGoalDateRange('2026-02-30', '2026-05-01')
    ).toThrow('YYYY-MM-DD');

    expect(() =>
      validateGoalDateRange('2026-09-01', '2026-08-01')
    ).toThrow('cannot be before');
  });

  test('converts stored ISO timestamps back to local date keys', () => {
    expect(
      getGoalDateKey(new Date(2026, 6, 1, 12).toISOString())
    ).toBe('2026-07-01');
  });
});
