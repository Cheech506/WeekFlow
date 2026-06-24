import {
  describe,
  expect,
  test,
} from '@jest/globals';

import {
  addDays,
  getLocalDateKey,
  getNextOccurrenceDateKey,
  getStartOfWeek,
  getUpcomingDays,
  getWeekDays,
  isDateKeyOverdue,
  parseLocalDateKey,
  startOfLocalDay,
} from '../lib/dateUtils';

function localDate(
  year: number,
  month: number,
  day: number,
  hour: number = 12
) {
  return new Date(year, month - 1, day, hour);
}

describe('dateUtils', () => {
  test('creates and parses local date keys', () => {
    const date = localDate(2026, 6, 23, 18);

    expect(getLocalDateKey(date)).toBe('2026-06-23');
    expect(
      getLocalDateKey(
        parseLocalDateKey('2026-06-23') as Date
      )
    ).toBe('2026-06-23');
  });

  test('rejects malformed and impossible dates', () => {
    expect(parseLocalDateKey('2026-6-23')).toBeNull();
    expect(parseLocalDateKey('2025-02-29')).toBeNull();
    expect(parseLocalDateKey('2026-02-30')).toBeNull();
    expect(parseLocalDateKey('not-a-date')).toBeNull();
  });

  test('accepts leap day and crosses month boundaries', () => {
    expect(parseLocalDateKey('2024-02-29')).not.toBeNull();

    expect(
      getLocalDateKey(
        addDays(localDate(2026, 1, 31), 1)
      )
    ).toBe('2026-02-01');
  });

  test('removes the local time portion', () => {
    const result = startOfLocalDay(
      localDate(2026, 6, 23, 21)
    );

    expect(result.getHours()).toBe(0);
    expect(getLocalDateKey(result)).toBe('2026-06-23');
  });

  test('uses Monday as the start of the week', () => {
    expect(
      getLocalDateKey(
        getStartOfWeek(localDate(2026, 6, 28))
      )
    ).toBe('2026-06-22');

    expect(
      getLocalDateKey(
        getStartOfWeek(localDate(2026, 6, 22))
      )
    ).toBe('2026-06-22');
  });

  test('finds the next weekday including today', () => {
    const tuesday = localDate(2026, 6, 23);

    expect(
      getNextOccurrenceDateKey('Tuesday', tuesday)
    ).toBe('2026-06-23');

    expect(
      getNextOccurrenceDateKey('Friday', tuesday)
    ).toBe('2026-06-26');

    expect(
      getNextOccurrenceDateKey('Notaday', tuesday)
    ).toBeNull();
  });

  test('builds upcoming dates and week offsets', () => {
    const currentDate = localDate(2026, 6, 23);
    const upcoming = getUpcomingDays(3, currentDate);

    expect(
      upcoming.map((day) => day.dateKey)
    ).toEqual([
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
    ]);

    const nextWeek = getWeekDays(currentDate, 1);

    expect(nextWeek[0].dateKey).toBe('2026-06-29');
    expect(nextWeek[6].dateKey).toBe('2026-07-05');
  });

  test('detects overdue dates using the local day', () => {
    const currentDate = localDate(2026, 6, 23, 20);

    expect(
      isDateKeyOverdue('2026-06-22', currentDate)
    ).toBe(true);

    expect(
      isDateKeyOverdue('2026-06-23', currentDate)
    ).toBe(false);

    expect(
      isDateKeyOverdue('2026-06-24', currentDate)
    ).toBe(false);

    expect(
      isDateKeyOverdue('invalid', currentDate)
    ).toBe(false);
  });
});
