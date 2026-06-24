import {
  describe,
  expect,
  test,
} from '@jest/globals';

import {
  getRecurringOccurrenceDateKeys,
  normalizeWeekdays,
  validateAndNormalizeRecurringRuleInput,
} from '../lib/recurrenceUtils';
import { makeRecurringRule } from './testFactories';

describe('recurrenceUtils', () => {
  test('normalizes selected weekdays', () => {
    expect(
      normalizeWeekdays([5, 1, 5, -1, 7, 3])
    ).toEqual([1, 3, 5]);
  });

  test('validates and trims a recurring rule input', () => {
    const result =
      validateAndNormalizeRecurringRuleInput({
        title: '  Gym  ',
        notes: '  Bench and rows  ',
        priority: 2,
        goalId: 4,
        frequency: 'certainDays',
        startDate: '2026-06-22',
        endDate: '2026-07-06',
        weekdays: [5, 1, 3, 1],
      });

    expect(result.title).toBe('Gym');
    expect(result.notes).toBe('Bench and rows');
    expect(result.weekdays).toEqual([1, 3, 5]);
  });

  test('rejects invalid recurring inputs', () => {
    expect(() =>
      validateAndNormalizeRecurringRuleInput({
        title: ' ',
        frequency: 'daily',
        startDate: '2026-06-22',
      })
    ).toThrow('needs a title');

    expect(() =>
      validateAndNormalizeRecurringRuleInput({
        title: 'Gym',
        frequency: 'certainDays',
        startDate: '2026-06-22',
        weekdays: [],
      })
    ).toThrow('Choose at least one weekday');

    expect(() =>
      validateAndNormalizeRecurringRuleInput({
        title: 'Gym',
        frequency: 'daily',
        startDate: '2026-06-22',
        endDate: '2026-06-21',
      })
    ).toThrow('cannot be before');
  });

  test('generates daily dates inside an inclusive window', () => {
    const dates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        frequency: 'daily',
        startDate: '2026-06-23',
      }),
      new Date(2026, 5, 23, 12),
      3
    );

    expect(dates).toEqual([
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
      '2026-06-26',
    ]);
  });

  test('generates weekly occurrences on the start weekday', () => {
    const dates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        frequency: 'weekly',
        startDate: '2026-06-23',
      }),
      new Date(2026, 5, 23, 12),
      14
    );

    expect(dates).toEqual([
      '2026-06-23',
      '2026-06-30',
      '2026-07-07',
    ]);
  });

  test('generates only selected weekdays', () => {
    const dates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        frequency: 'certainDays',
        startDate: '2026-06-22',
        weekdays: [1, 3, 5],
      }),
      new Date(2026, 5, 22, 12),
      7
    );

    expect(dates).toEqual([
      '2026-06-22',
      '2026-06-24',
      '2026-06-26',
      '2026-06-29',
    ]);
  });

  test('uses the last valid day for shorter months', () => {
    const dates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        frequency: 'monthly',
        startDate: '2026-01-31',
      }),
      new Date(2026, 0, 31, 12),
      60
    );

    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  test('uses February 29 during a leap year', () => {
    const dates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        frequency: 'monthly',
        startDate: '2028-01-31',
      }),
      new Date(2028, 0, 31, 12),
      35
    );

    expect(dates).toContain('2028-02-29');
  });

  test('respects the ending date and paused status', () => {
    const activeDates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        frequency: 'daily',
        startDate: '2026-06-22',
        endDate: '2026-06-24',
      }),
      new Date(2026, 5, 22, 12),
      30
    );

    expect(activeDates).toEqual([
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
    ]);

    const pausedDates = getRecurringOccurrenceDateKeys(
      makeRecurringRule({
        active: false,
      }),
      new Date(2026, 5, 22, 12),
      30
    );

    expect(pausedDates).toEqual([]);
  });
});
