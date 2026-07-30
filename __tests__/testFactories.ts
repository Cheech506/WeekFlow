import type { StoredBrainDump } from '../lib/brainDumpStorage';
import type { PlanningCycle } from '../lib/cycleStorage';
import type { GoalMilestone } from '../lib/goalMilestoneStorage';
import type { StoredGoal } from '../lib/goalStorage';
import type { RecurringRule } from '../lib/recurringStorage';
import type { Task } from '../lib/taskStorage';
import type { TaskTemplate } from '../lib/taskTemplateStorage';

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
    reward: null,
    purpose: null,
    successDefinition: null,
    notes: null,
    completionWhatHelped: null,
    completionHardestPart: null,
    completionLearned: null,
    completionDoDifferently: null,
    completionTaskTotal: null,
    completionTaskCompleted: null,
    completionMilestoneTotal: null,
    completionMilestoneCompleted: null,
    completionHighPriorityCompleted: null,
    ...overrides,
  };
}


export function makeGoalMilestone(
  overrides: Partial<GoalMilestone> = {}
): GoalMilestone {
  const id = overrides.id ?? nextId++;

  return {
    id,
    goalId: 1,
    title: `Milestone ${id}`,
    notes: null,
    targetDate: null,
    completed: false,
    createdAt: new Date(2026, 5, 1, 12).toISOString(),
    completedAt: null,
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


export function makePlanningCycle(
  overrides: Partial<PlanningCycle> = {}
): PlanningCycle {
  const id = overrides.id ?? nextId++;

  return {
    id,
    startDate: '2026-07-01',
    endDate: '2026-09-22',
    active: true,
    createdAt: new Date(2026, 6, 1, 12).toISOString(),
    completedAt: null,
    ...overrides,
  };
}

export function makeTaskTemplate(
  overrides: Partial<TaskTemplate> = {}
): TaskTemplate {
  const id = overrides.id ?? nextId++;

  return {
    id,
    title: `Task template ${id}`,
    notes: null,
    priority: 0,
    goalId: null,
    createdAt: new Date(2026, 5, 1, 12).toISOString(),
    updatedAt: new Date(2026, 5, 1, 12).toISOString(),
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
