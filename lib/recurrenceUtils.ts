import {
  addDays,
  getLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from './dateUtils';
import type {
  CreateRecurringRuleInput,
  RecurringRule,
} from './recurringStorage';

export const RECURRENCE_FREQUENCIES = [
  'daily',
  'weekly',
  'certainDays',
  'monthly',
] as const;

export type RecurrenceFrequency =
  (typeof RECURRENCE_FREQUENCIES)[number];

export type NormalizedRecurringRuleInput = {
  title: string;
  notes: string | null;
  priority: number;
  goalId: number | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
};

export function normalizeWeekdays(
  weekdays: number[] = []
): number[] {
  return Array.from(
    new Set(
      weekdays.filter(
        (weekday) =>
          Number.isInteger(weekday) &&
          weekday >= 0 &&
          weekday <= 6
      )
    )
  ).sort((first, second) => first - second);
}

export function validateAndNormalizeRecurringRuleInput(
  input: CreateRecurringRuleInput
): NormalizedRecurringRuleInput {
  const title = input.title.trim();
  const notes = input.notes?.trim() || null;
  const priority = input.priority ?? 0;
  const goalId = input.goalId ?? null;
  const startDate = parseLocalDateKey(input.startDate);
  const endDate = input.endDate
    ? parseLocalDateKey(input.endDate)
    : null;
  const weekdays = normalizeWeekdays(input.weekdays);

  if (!title) {
    throw new Error('A recurring task needs a title.');
  }

  if (
    !RECURRENCE_FREQUENCIES.includes(input.frequency)
  ) {
    throw new Error('Recurring task frequency is invalid.');
  }

  if (
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 2
  ) {
    throw new Error('Recurring task priority is invalid.');
  }

  if (!startDate) {
    throw new Error('Recurring task start date is invalid.');
  }

  if (input.endDate && !endDate) {
    throw new Error('Recurring task end date is invalid.');
  }

  if (endDate && endDate < startDate) {
    throw new Error(
      'The repeat end date cannot be before the start date.'
    );
  }

  if (
    input.frequency === 'certainDays' &&
    weekdays.length === 0
  ) {
    throw new Error(
      'Choose at least one weekday for Certain Days.'
    );
  }

  return {
    title,
    notes,
    priority,
    goalId,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    weekdays,
  };
}

function getDaysInMonth(
  year: number,
  monthIndex: number
) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function matchesRecurringDate(
  rule: Pick<
    RecurringRule,
    'frequency' | 'weekdays'
  >,
  date: Date,
  startDate: Date
) {
  if (date < startDate) {
    return false;
  }

  if (rule.frequency === 'daily') {
    return true;
  }

  if (rule.frequency === 'weekly') {
    return date.getDay() === startDate.getDay();
  }

  if (rule.frequency === 'certainDays') {
    return rule.weekdays.includes(date.getDay());
  }

  /*
   * Monthly rules anchored on the 29th, 30th, or 31st use the
   * final valid day of shorter months.
   */
  const targetDay = Math.min(
    startDate.getDate(),
    getDaysInMonth(
      date.getFullYear(),
      date.getMonth()
    )
  );

  return date.getDate() === targetDay;
}

/**
 * Returns every recurrence date that belongs in the rolling generation
 * window. The ending date and the horizon date are both inclusive.
 */
export function getRecurringOccurrenceDateKeys(
  rule: Pick<
    RecurringRule,
    | 'frequency'
    | 'startDate'
    | 'endDate'
    | 'weekdays'
    | 'active'
  >,
  currentDate: Date = new Date(),
  horizonDays: number = 30
): string[] {
  if (!rule.active) {
    return [];
  }

  const startDate = parseLocalDateKey(rule.startDate);
  const endDate = rule.endDate
    ? parseLocalDateKey(rule.endDate)
    : null;

  if (!startDate || (rule.endDate && !endDate)) {
    return [];
  }

  const today = startOfLocalDay(currentDate);
  const horizonEnd = addDays(
    today,
    Math.max(0, horizonDays)
  );

  const generationStart =
    startDate > today ? startDate : today;

  const generationEnd =
    endDate && endDate < horizonEnd
      ? endDate
      : horizonEnd;

  if (generationEnd < generationStart) {
    return [];
  }

  const occurrenceDates: string[] = [];

  for (
    let cursor = generationStart;
    cursor <= generationEnd;
    cursor = addDays(cursor, 1)
  ) {
    if (
      matchesRecurringDate(
        rule,
        cursor,
        startDate
      )
    ) {
      occurrenceDates.push(
        getLocalDateKey(cursor)
      );
    }
  }

  return occurrenceDates;
}
