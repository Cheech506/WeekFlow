import type { StoredBrainDump } from '../lib/brainDumpStorage';
import type { PlanningCycle } from '../lib/cycleStorage';
import type {
  StoredCycleGoalOutcome,
  StoredCycleReview,
} from '../lib/cycleReviewStorage';
import type { GoalMilestone } from '../lib/goalMilestoneStorage';
import type { StoredGoal } from '../lib/goalStorage';
import type { RecurringRule } from '../lib/recurringStorage';
import type { Task } from '../lib/taskStorage';
import type { TaskTemplate } from '../lib/taskTemplateStorage';
import type {
  StoredWeeklyReview,
  WeeklyCommitment,
  WeeklyTaskDecision,
} from '../lib/weeklyReviewStorage';

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
    cycleId: null,
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
    name: null,
    primaryFocus: null,
    theme: null,
    startDate: '2026-07-01',
    endDate: '2026-09-22',
    active: true,
    createdAt: new Date(2026, 6, 1, 12).toISOString(),
    completedAt: null,
    ...overrides,
  };
}

export function makeCycleReview(
  overrides: Partial<StoredCycleReview> = {}
): StoredCycleReview {
  const id = overrides.id ?? nextId++;

  return {
    id,
    cycleId: 1,
    biggestAccomplishment: null,
    biggestChallenge: null,
    whatWorkedWell: null,
    whatChangeNextCycle: null,
    whatStopDoing: null,
    whatContinueDoing: null,
    whatLearned: null,
    goalTotal: 3,
    goalCompleted: 2,
    taskCompleted: 24,
    milestoneTotal: 6,
    milestoneCompleted: 5,
    weeklyReviewsCompleted: 10,
    longestStreak: 8,
    bestWeekNumber: 7,
    bestWeekCount: 6,
    bestDay: 'Tuesday',
    bestDayCount: 7,
    highPriorityCompleted: 5,
    recurringCompleted: 4,
    rewardsUnlocked: 1,
    brainDumpsArchived: 3,
    nextCycleName: 'Next Cycle',
    nextCyclePrimaryFocus: 'Keep building the foundation',
    nextCycleTheme: 'Finish strong',
    nextCycleStartDate: '2026-10-01',
    nextCycleFirstWeekCommitments: ['Set up the first week'],
    nextCycleId: null,
    createdAt: localIso(2026, 9, 23),
    updatedAt: localIso(2026, 9, 23),
    finalizedAt: null,
    ...overrides,
  };
}

export function makeCycleGoalOutcome(
  overrides: Partial<StoredCycleGoalOutcome> = {}
): StoredCycleGoalOutcome {
  const id = overrides.id ?? nextId++;

  return {
    id,
    cycleReviewId: 1,
    goalId: 1,
    goalTitle: 'Unfinished goal',
    action: 'carryForward',
    replacementTitle: null,
    destinationGoalId: null,
    createdAt: localIso(2026, 9, 23),
    updatedAt: localIso(2026, 9, 23),
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



export function makeWeeklyReview(
  overrides: Partial<StoredWeeklyReview> = {}
): StoredWeeklyReview {
  const id = overrides.id ?? nextId++;

  return {
    id,
    weekStart: '2026-06-22',
    cycleId: null,
    whatWentWell: null,
    whatCausedProblems: null,
    whatLearned: null,
    whatChangeNextWeek: null,
    nextWeekFocus: null,
    completedCount: 4,
    unfinishedCount: 1,
    overdueCount: 1,
    completionRate: 80,
    goalsProgressedCount: 1,
    bestDay: 'Wednesday',
    bestDayCount: 2,
    archivedBrainDumpCount: 1,
    highPriorityCompletedCount: 1,
    recurringCompletedCount: 1,
    createdAt: localIso(2026, 6, 28),
    updatedAt: localIso(2026, 6, 28),
    reviewedAt: localIso(2026, 6, 28),
    ...overrides,
  };
}

export function makeWeeklyCommitment(
  overrides: Partial<WeeklyCommitment> = {}
): WeeklyCommitment {
  const id = overrides.id ?? nextId++;

  return {
    id,
    weekStart: '2026-06-22',
    cycleId: null,
    taskId: null,
    title: `Weekly commitment ${id}`,
    completed: false,
    createdAt: localIso(2026, 6, 22),
    completedAt: null,
    ...overrides,
  };
}

export function makeWeeklyTaskDecision(
  overrides: Partial<WeeklyTaskDecision> = {}
): WeeklyTaskDecision {
  const id = overrides.id ?? nextId++;

  return {
    id,
    weekStart: '2026-06-22',
    taskId: 1,
    taskTitle: 'Unfinished task',
    originalDueDate: '2026-06-24',
    action: 'nextWeek',
    resolvedDueDate: '2026-07-01',
    recurringRuleId: null,
    recurrenceOccurrenceDate: null,
    decidedAt: localIso(2026, 6, 28),
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
