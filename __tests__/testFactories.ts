import type { StoredBrainDump } from '../lib/brainDumpStorage';
import type { StoredGoal } from '../lib/goalStorage';
import type { RecurringRule } from '../lib/recurringStorage';
import type { Task } from '../lib/taskStorage';

let nextId = 1;

export function resetFactoryIds() {
  nextId = 1;
}

export function makeTask(
  overrides: Partial<Task> = {}
): Task {
  const id = overrides.id ?? nextId++;

  return {
    id,
    title: `Task ${id}`,
    day: 'Inbox',
    dueDate: null,
    notes: null,
    priority: 0,
    goalId: null,
    completed: false,
    createdAt: new Date(2026, 5, 1, 12).toISOString(),
    completedAt: null,
    recurringRuleId: null,
    recurrenceOccurrenceDate: null,
    ...overrides,
  };
}

export function makeGoal(
  overrides: Partial<StoredGoal> = {}
): StoredGoal {
  const id = overrides.id ?? nextId++;

  return {
    id,
    title: `Goal ${id}`,
    completed: false,
    createdAt: new Date(2026, 5, 1, 12).toISOString(),
    completedAt: null,
    startDate: new Date(2026, 5, 1, 12).toISOString(),
    endDate: new Date(2026, 7, 24, 12).toISOString(),
    ...overrides,
  };
}

export function makeBrainDump(
  overrides: Partial<StoredBrainDump> = {}
): StoredBrainDump {
  const id = overrides.id ?? nextId++;

  return {
    id,
    body: `Brain dump ${id}`,
    archived: false,
    createdAt: new Date(2026, 5, 1, 12).toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

export function makeRecurringRule(
  overrides: Partial<RecurringRule> = {}
): RecurringRule {
  const id = overrides.id ?? nextId++;

  return {
    id,
    title: `Recurring rule ${id}`,
    notes: null,
    priority: 0,
    goalId: null,
    frequency: 'daily',
    startDate: '2026-06-22',
    endDate: null,
    weekdays: [],
    active: true,
    createdAt: new Date(2026, 5, 22, 12).toISOString(),
    ...overrides,
  };
}

export function localIso(
  year: number,
  month: number,
  day: number,
  hour: number = 12
) {
  return new Date(
    year,
    month - 1,
    day,
    hour
  ).toISOString();
}
