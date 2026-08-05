import type { StoredBrainDump } from './brainDumpStorage';
import type { PlanningCycle } from './cycleStorage';
import {
  CYCLE_GOAL_OUTCOME_ACTIONS,
  MAX_CYCLE_REVIEW_RESPONSE_LENGTH,
  MAX_FIRST_WEEK_COMMITMENT_LENGTH,
  MAX_FIRST_WEEK_COMMITMENTS,
  MAX_REPLACEMENT_GOAL_TITLE_LENGTH,
} from './cycleReviewUtils';
import type {
  StoredCycleGoalOutcome,
  StoredCycleReview,
} from './cycleReviewStorage';
import {
  MAX_CYCLE_NAME_LENGTH,
  MAX_CYCLE_PRIMARY_FOCUS_LENGTH,
  MAX_CYCLE_THEME_LENGTH,
} from './cycleIdentityUtils';
import { createPlanningCycleRange } from './cycleUtils';
import {
  addDays,
  DAY_NAMES,
  getLocalDateKey,
  parseLocalDateKey,
} from './dateUtils';
import type { GoalMilestone } from './goalMilestoneStorage';
import {
  MAX_GOAL_NOTES_LENGTH,
  MAX_GOAL_PURPOSE_LENGTH,
  MAX_GOAL_SUCCESS_DEFINITION_LENGTH,
  MAX_MILESTONE_NOTES_LENGTH,
  MAX_MILESTONE_TITLE_LENGTH,
} from './goalPlanningUtils';
import type { StoredGoal } from './goalStorage';
import { MAX_GOAL_REFLECTION_LENGTH } from './goalReviewUtils';
import { MAX_GOAL_REWARD_LENGTH } from './goalRewardUtils';
import { RECURRENCE_FREQUENCIES } from './recurrenceUtils';
import type {
  RecurringOccurrenceException,
  RecurringRule,
} from './recurringStorage';
import type { Task } from './taskStorage';
import type { TaskTemplate } from './taskTemplateStorage';
import {
  MAX_WEEKLY_COMMITMENT_TITLE_LENGTH,
  MAX_WEEKLY_REVIEW_RESPONSE_LENGTH,
  WEEKLY_TASK_DECISION_ACTIONS,
  type StoredWeeklyReview,
  type WeeklyCommitment,
  type WeeklyTaskDecision,
} from './weeklyReviewStorage';

export const BACKUP_FORMAT = 'weekflow-backup';
export const BACKUP_VERSION = 12;
export const BACKUP_DATA_MODEL_VERSION = 1;

export type BackupCounts = {
  tasks: number;
  goals: number;
  goalMilestones: number;
  brainDumps: number;
  taskTemplates: number;
  recurringRules: number;
  recurringExceptions: number;
  planningCycles: number;
  weeklyReviews: number;
  weeklyCommitments: number;
  weeklyTaskDecisions: number;
  cycleReviews: number;
  cycleGoalOutcomes: number;
};

export type BackupRepairs = {
  orphanedGoalLinks: number;
};

export type BackupMetadata = {
  appVersion: string;
  dataModelVersion: typeof BACKUP_DATA_MODEL_VERSION;
};

type LegacyTask = Omit<
  Task,
  'recurringRuleId' | 'recurrenceOccurrenceDate'
>;

type LegacyStoredGoal = Omit<
  StoredGoal,
  | 'reward'
  | 'purpose'
  | 'successDefinition'
  | 'notes'
  | 'completionWhatHelped'
  | 'completionHardestPart'
  | 'completionLearned'
  | 'completionDoDifferently'
  | 'completionTaskTotal'
  | 'completionTaskCompleted'
  | 'completionMilestoneTotal'
  | 'completionMilestoneCompleted'
  | 'completionHighPriorityCompleted'
  | 'cycleId'
> & {
  reward?: string | null;
  purpose?: string | null;
  successDefinition?: string | null;
  notes?: string | null;
  completionWhatHelped?: string | null;
  completionHardestPart?: string | null;
  completionLearned?: string | null;
  completionDoDifferently?: string | null;
  completionTaskTotal?: number | null;
  completionTaskCompleted?: number | null;
  completionMilestoneTotal?: number | null;
  completionMilestoneCompleted?: number | null;
  completionHighPriorityCompleted?: number | null;
  cycleId?: number | null;
};

type LegacyPlanningCycle = Omit<
  PlanningCycle,
  'name' | 'primaryFocus' | 'theme'
> & {
  name?: string | null;
  primaryFocus?: string | null;
  theme?: string | null;
};

type BackupDataWithLegacyGoals = Omit<
  WeekFlowBackup['data'],
  | 'goals'
  | 'goalMilestones'
  | 'planningCycles'
  | 'weeklyReviews'
  | 'weeklyCommitments'
  | 'weeklyTaskDecisions'
  | 'cycleReviews'
  | 'cycleGoalOutcomes'
> & {
  goals: LegacyStoredGoal[];
  goalMilestones?: GoalMilestone[];
  planningCycles: LegacyPlanningCycle[];
};

type LegacyWeekFlowBackupV1 = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  data: {
    tasks: LegacyTask[];
    goals: LegacyStoredGoal[];
    brainDumps: StoredBrainDump[];
  };
};

type LegacyBackupDataWithoutTemplates = Omit<
  BackupDataWithLegacyGoals,
  'taskTemplates' | 'planningCycles'
>;

type LegacyBackupDataWithoutCycles = Omit<
  BackupDataWithLegacyGoals,
  'planningCycles'
>;

type LegacyWeekFlowBackupV2 = {
  format: typeof BACKUP_FORMAT;
  version: 2;
  exportedAt: string;
  data: LegacyBackupDataWithoutTemplates;
};

type LegacyWeekFlowBackupV3 = {
  format: typeof BACKUP_FORMAT;
  version: 3;
  exportedAt: string;
  metadata: BackupMetadata;
  data: LegacyBackupDataWithoutTemplates;
};

type LegacyWeekFlowBackupV4 = {
  format: typeof BACKUP_FORMAT;
  version: 4;
  exportedAt: string;
  metadata: BackupMetadata;
  data: LegacyBackupDataWithoutCycles;
};

type LegacyWeekFlowBackupV5 = {
  format: typeof BACKUP_FORMAT;
  version: 5;
  exportedAt: string;
  metadata: BackupMetadata;
  data: BackupDataWithLegacyGoals;
};

type LegacyWeekFlowBackupV6 = {
  format: typeof BACKUP_FORMAT;
  version: 6;
  exportedAt: string;
  metadata: BackupMetadata;
  data: BackupDataWithLegacyGoals;
};

type LegacyWeekFlowBackupV7 = {
  format: typeof BACKUP_FORMAT;
  version: 7;
  exportedAt: string;
  metadata: BackupMetadata;
  data: BackupDataWithLegacyGoals;
};

type LegacyWeekFlowBackupV8 = {
  format: typeof BACKUP_FORMAT;
  version: 8;
  exportedAt: string;
  metadata: BackupMetadata;
  data: BackupDataWithLegacyGoals;
};

type LegacyWeeklyCommitmentV9 = Omit<WeeklyCommitment, 'taskId'> & {
  taskId?: number | null;
};

type LegacyWeekFlowBackupV9 = {
  format: typeof BACKUP_FORMAT;
  version: 9;
  exportedAt: string;
  metadata: BackupMetadata;
  data: Omit<
    WeekFlowBackup['data'],
    'weeklyCommitments' | 'cycleReviews' | 'cycleGoalOutcomes'
  > & {
    weeklyCommitments: LegacyWeeklyCommitmentV9[];
  };
};

type LegacyWeekFlowBackupV10 = {
  format: typeof BACKUP_FORMAT;
  version: 10;
  exportedAt: string;
  metadata: BackupMetadata;
  data: Omit<
    WeekFlowBackup['data'],
    'goals' | 'planningCycles' | 'cycleReviews' | 'cycleGoalOutcomes'
  > & {
    goals: LegacyStoredGoal[];
    planningCycles: LegacyPlanningCycle[];
    cycleReviews?: StoredCycleReview[];
    cycleGoalOutcomes?: StoredCycleGoalOutcome[];
  };
};

type LegacyWeekFlowBackupV11 = {
  format: typeof BACKUP_FORMAT;
  version: 11;
  exportedAt: string;
  metadata: BackupMetadata;
  data: Omit<WeekFlowBackup['data'], 'cycleReviews' | 'cycleGoalOutcomes'> & {
    cycleReviews?: StoredCycleReview[];
    cycleGoalOutcomes?: StoredCycleGoalOutcome[];
  };
};

export type WeekFlowBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  metadata: BackupMetadata;
  data: {
    tasks: Task[];
    goals: StoredGoal[];
    goalMilestones: GoalMilestone[];
    brainDumps: StoredBrainDump[];
    taskTemplates: TaskTemplate[];
    recurringRules: RecurringRule[];
    recurringExceptions: RecurringOccurrenceException[];
    planningCycles: PlanningCycle[];
    weeklyReviews: StoredWeeklyReview[];
    weeklyCommitments: WeeklyCommitment[];
    weeklyTaskDecisions: WeeklyTaskDecision[];
    cycleReviews: StoredCycleReview[];
    cycleGoalOutcomes: StoredCycleGoalOutcome[];
  };
};

export type BackupPreview = {
  sourceVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | typeof BACKUP_VERSION;
  currentVersion: typeof BACKUP_VERSION;
  exportedAt: string;
  appVersion: string;
  dataModelVersion: number;
  counts: BackupCounts;
  repairs: BackupRepairs;
};

export type ParsedWeekFlowBackup = {
  backup: WeekFlowBackup;
  preview: BackupPreview;
};

export type PickedWeekFlowBackup = {
  fileName: string;
  backup: WeekFlowBackup;
  preview: BackupPreview;
};

export type ExportedWeekFlowBackup = {
  fileName: string;
  preview: BackupPreview;
};

export class BackupValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function fail(code: string, message: string): never {
  throw new BackupValidationError(code, message);
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNullableString(
  value: unknown
): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNullableInteger(value: unknown) {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value))
  );
}

function isPositiveInteger(value: unknown) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNullableNonNegativeInteger(value: unknown) {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0)
  );
}

function isIsoTimestamp(
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    value.includes('T') &&
    Number.isFinite(Date.parse(value))
  );
}

function isNullableIsoTimestamp(
  value: unknown
): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isValidDateKey(
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    parseLocalDateKey(value) !== null
  );
}

function isValidNullableDateKey(
  value: unknown
): value is string | null {
  return value === null || isValidDateKey(value);
}


function isMondayDateKey(value: unknown): value is string {
  const date = typeof value === 'string' ? parseLocalDateKey(value) : null;
  return date?.getDay() === 1;
}

function isDateKeyInsideWeek(dateKey: string, weekStart: string) {
  const date = parseLocalDateKey(dateKey);
  const start = parseLocalDateKey(weekStart);

  if (!date || !start) return false;

  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 7
  );

  return date >= start && date < end;
}

function isValidTaskDay(value: unknown) {
  return (
    value === 'Inbox' ||
    DAY_NAMES.includes(
      value as (typeof DAY_NAMES)[number]
    )
  );
}

function hasMatchingStatusTimestamp(
  activeState: boolean,
  timestamp: string | null
) {
  return activeState
    ? timestamp !== null
    : timestamp === null;
}

function validateBaseTask(
  value: unknown,
  label: string
): asserts value is LegacyTask {
  if (!isRecord(value)) {
    fail('INVALID_TASK', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_TASK', `${label} has an invalid ID.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0
  ) {
    fail('INVALID_TASK', `${label} has an empty title.`);
  }

  if (!isValidTaskDay(value.day)) {
    fail('INVALID_TASK', `${label} has an invalid day value.`);
  }

  if (!isValidNullableDateKey(value.dueDate)) {
    fail('INVALID_TASK', `${label} has an invalid due date.`);
  }

  if (!isNullableString(value.notes)) {
    fail('INVALID_TASK', `${label} has invalid notes.`);
  }

  if (
    typeof value.priority !== 'number' ||
    !Number.isInteger(value.priority) ||
    value.priority < 0 ||
    value.priority > 2
  ) {
    fail(
      'INVALID_TASK',
      `${label} has an invalid priority. Expected 0, 1, or 2.`
    );
  }

  if (!isNullableInteger(value.goalId)) {
    fail('INVALID_TASK', `${label} has an invalid goal link.`);
  }

  if (typeof value.completed !== 'boolean') {
    fail('INVALID_TASK', `${label} has an invalid completed value.`);
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail('INVALID_TASK', `${label} has an invalid created timestamp.`);
  }

  if (!isNullableIsoTimestamp(value.completedAt)) {
    fail('INVALID_TASK', `${label} has an invalid completed timestamp.`);
  }

  if (
    !hasMatchingStatusTimestamp(
      value.completed,
      value.completedAt
    )
  ) {
    fail(
      'INVALID_TASK',
      `${label} has a completion status that does not match its completed timestamp.`
    );
  }
}

function validateTask(
  value: unknown,
  label: string
): asserts value is Task {
  validateBaseTask(value, label);

  const record = value as unknown as Record<string, unknown>;
  const recurringRuleId = record.recurringRuleId;
  const occurrenceDate = record.recurrenceOccurrenceDate;

  const isNormalTask =
    recurringRuleId === null &&
    occurrenceDate === null;

  const isRecurringTask =
    isPositiveInteger(recurringRuleId) &&
    isValidDateKey(occurrenceDate);

  if (!isNormalTask && !isRecurringTask) {
    fail(
      'INVALID_TASK',
      `${label} has an incomplete or invalid recurring occurrence link.`
    );
  }
}

function validateGoal(
  value: unknown,
  label: string,
  requireReward: boolean = true,
  requirePlanningDetails: boolean = true,
  requireReviewDetails: boolean = true,
  requireCycleLink: boolean = true
): asserts value is StoredGoal {
  if (!isRecord(value)) {
    fail('INVALID_GOAL', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_GOAL', `${label} has an invalid ID.`);
  }

  if (
    requireCycleLink &&
    !Object.prototype.hasOwnProperty.call(value, 'cycleId')
  ) {
    fail('INVALID_GOAL', `${label} is missing its cycle link.`);
  }

  if (
    value.cycleId !== undefined &&
    value.cycleId !== null &&
    !isPositiveInteger(value.cycleId)
  ) {
    fail('INVALID_GOAL', `${label} has an invalid cycle link.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0
  ) {
    fail('INVALID_GOAL', `${label} has an empty title.`);
  }

  if (
    requireReward &&
    !Object.prototype.hasOwnProperty.call(value, 'reward')
  ) {
    fail('INVALID_GOAL', `${label} is missing its reward value.`);
  }

  if (
    value.reward !== undefined &&
    !isNullableString(value.reward)
  ) {
    fail('INVALID_GOAL', `${label} has an invalid reward.`);
  }

  if (
    typeof value.reward === 'string' &&
    value.reward.length > MAX_GOAL_REWARD_LENGTH
  ) {
    fail(
      'INVALID_GOAL',
      `${label} has a reward longer than ${MAX_GOAL_REWARD_LENGTH} characters.`
    );
  }

  const planningFields = [
    ['purpose', MAX_GOAL_PURPOSE_LENGTH],
    ['successDefinition', MAX_GOAL_SUCCESS_DEFINITION_LENGTH],
    ['notes', MAX_GOAL_NOTES_LENGTH],
  ] as const;

  for (const [field, maxLength] of planningFields) {
    if (
      requirePlanningDetails &&
      !Object.prototype.hasOwnProperty.call(value, field)
    ) {
      fail('INVALID_GOAL', `${label} is missing its ${field} value.`);
    }

    const fieldValue = value[field];

    if (fieldValue !== undefined && !isNullableString(fieldValue)) {
      fail('INVALID_GOAL', `${label} has an invalid ${field} value.`);
    }

    if (typeof fieldValue === 'string' && fieldValue.length > maxLength) {
      fail(
        'INVALID_GOAL',
        `${label} has a ${field} value longer than ${maxLength} characters.`
      );
    }
  }

  const reflectionFields = [
    'completionWhatHelped',
    'completionHardestPart',
    'completionLearned',
    'completionDoDifferently',
  ] as const;

  for (const field of reflectionFields) {
    if (
      requireReviewDetails &&
      !Object.prototype.hasOwnProperty.call(value, field)
    ) {
      fail('INVALID_GOAL', `${label} is missing its ${field} value.`);
    }

    const fieldValue = value[field];

    if (fieldValue !== undefined && !isNullableString(fieldValue)) {
      fail('INVALID_GOAL', `${label} has an invalid ${field} value.`);
    }

    if (
      typeof fieldValue === 'string' &&
      fieldValue.length > MAX_GOAL_REFLECTION_LENGTH
    ) {
      fail(
        'INVALID_GOAL',
        `${label} has a ${field} value longer than ${MAX_GOAL_REFLECTION_LENGTH} characters.`
      );
    }
  }

  const snapshotFields = [
    'completionTaskTotal',
    'completionTaskCompleted',
    'completionMilestoneTotal',
    'completionMilestoneCompleted',
    'completionHighPriorityCompleted',
  ] as const;

  for (const field of snapshotFields) {
    if (
      requireReviewDetails &&
      !Object.prototype.hasOwnProperty.call(value, field)
    ) {
      fail('INVALID_GOAL', `${label} is missing its ${field} value.`);
    }

    const fieldValue = value[field];

    if (
      fieldValue !== undefined &&
      !isNullableNonNegativeInteger(fieldValue)
    ) {
      fail('INVALID_GOAL', `${label} has an invalid ${field} value.`);
    }
  }

  const taskTotal = value.completionTaskTotal;
  const taskCompleted = value.completionTaskCompleted;
  const milestoneTotal = value.completionMilestoneTotal;
  const milestoneCompleted = value.completionMilestoneCompleted;
  const highPriorityCompleted = value.completionHighPriorityCompleted;

  if (
    typeof taskTotal === 'number' &&
    typeof taskCompleted === 'number' &&
    taskCompleted > taskTotal
  ) {
    fail(
      'INVALID_GOAL',
      `${label} has more completed tasks than total tasks.`
    );
  }

  if (
    typeof milestoneTotal === 'number' &&
    typeof milestoneCompleted === 'number' &&
    milestoneCompleted > milestoneTotal
  ) {
    fail(
      'INVALID_GOAL',
      `${label} has more completed milestones than total milestones.`
    );
  }

  if (
    typeof taskCompleted === 'number' &&
    typeof highPriorityCompleted === 'number' &&
    highPriorityCompleted > taskCompleted
  ) {
    fail(
      'INVALID_GOAL',
      `${label} has more high-priority completions than completed tasks.`
    );
  }

  if (typeof value.completed !== 'boolean') {
    fail('INVALID_GOAL', `${label} has an invalid completed value.`);
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail('INVALID_GOAL', `${label} has an invalid created timestamp.`);
  }

  if (!isNullableIsoTimestamp(value.completedAt)) {
    fail('INVALID_GOAL', `${label} has an invalid completed timestamp.`);
  }

  if (
    !hasMatchingStatusTimestamp(
      value.completed,
      value.completedAt
    )
  ) {
    fail(
      'INVALID_GOAL',
      `${label} has a completion status that does not match its completed timestamp.`
    );
  }

  if (
    !isIsoTimestamp(value.startDate) ||
    !isIsoTimestamp(value.endDate)
  ) {
    fail('INVALID_GOAL', `${label} has invalid goal dates.`);
  }

  if (Date.parse(value.endDate) < Date.parse(value.startDate)) {
    fail(
      'INVALID_GOAL',
      `${label} ends before its start date.`
    );
  }
}

function validateGoalMilestone(
  value: unknown,
  label: string
): asserts value is GoalMilestone {
  if (!isRecord(value)) {
    fail('INVALID_MILESTONE', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id) || !isPositiveInteger(value.goalId)) {
    fail('INVALID_MILESTONE', `${label} has an invalid ID or goal link.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > MAX_MILESTONE_TITLE_LENGTH
  ) {
    fail('INVALID_MILESTONE', `${label} has an invalid title.`);
  }

  if (!isNullableString(value.notes)) {
    fail('INVALID_MILESTONE', `${label} has invalid notes.`);
  }

  if (
    typeof value.notes === 'string' &&
    value.notes.length > MAX_MILESTONE_NOTES_LENGTH
  ) {
    fail('INVALID_MILESTONE', `${label} has notes that are too long.`);
  }

  if (!isValidNullableDateKey(value.targetDate)) {
    fail('INVALID_MILESTONE', `${label} has an invalid target date.`);
  }

  if (typeof value.completed !== 'boolean') {
    fail('INVALID_MILESTONE', `${label} has an invalid completed value.`);
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail('INVALID_MILESTONE', `${label} has an invalid created timestamp.`);
  }

  if (!isNullableIsoTimestamp(value.completedAt)) {
    fail('INVALID_MILESTONE', `${label} has an invalid completed timestamp.`);
  }

  if (!hasMatchingStatusTimestamp(value.completed, value.completedAt)) {
    fail(
      'INVALID_MILESTONE',
      `${label} has a completion status that does not match its completed timestamp.`
    );
  }
}

function validatePlanningCycle(
  value: unknown,
  label: string,
  requireIdentity: boolean = true
): asserts value is PlanningCycle {
  if (!isRecord(value)) {
    fail('INVALID_CYCLE', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_CYCLE', `${label} has an invalid ID.`);
  }

  const identityFields = [
    ['name', MAX_CYCLE_NAME_LENGTH],
    ['primaryFocus', MAX_CYCLE_PRIMARY_FOCUS_LENGTH],
    ['theme', MAX_CYCLE_THEME_LENGTH],
  ] as const;

  for (const [field, maxLength] of identityFields) {
    if (
      requireIdentity &&
      !Object.prototype.hasOwnProperty.call(value, field)
    ) {
      fail('INVALID_CYCLE', `${label} is missing its ${field} value.`);
    }

    const fieldValue = value[field];

    if (fieldValue !== undefined && !isNullableString(fieldValue)) {
      fail('INVALID_CYCLE', `${label} has an invalid ${field} value.`);
    }

    if (typeof fieldValue === 'string' && fieldValue.length > maxLength) {
      fail(
        'INVALID_CYCLE',
        `${label} has a ${field} value longer than ${maxLength} characters.`
      );
    }
  }

  if (
    !isValidDateKey(value.startDate) ||
    !isValidDateKey(value.endDate)
  ) {
    fail('INVALID_CYCLE', `${label} has invalid cycle dates.`);
  }

  const expectedRange = createPlanningCycleRange(
    value.startDate
  );

  if (value.endDate !== expectedRange.endDate) {
    fail(
      'INVALID_CYCLE',
      `${label} is not exactly twelve weeks long.`
    );
  }

  if (typeof value.active !== 'boolean') {
    fail('INVALID_CYCLE', `${label} has an invalid active value.`);
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail(
      'INVALID_CYCLE',
      `${label} has an invalid created timestamp.`
    );
  }

  if (!isNullableIsoTimestamp(value.completedAt)) {
    fail(
      'INVALID_CYCLE',
      `${label} has an invalid completed timestamp.`
    );
  }

  if (
    (value.active && value.completedAt !== null) ||
    (!value.active && value.completedAt === null)
  ) {
    fail(
      'INVALID_CYCLE',
      `${label} has an active status that does not match its completed timestamp.`
    );
  }
}

function validateWeeklyReview(
  value: unknown,
  label: string
): asserts value is StoredWeeklyReview {
  if (!isRecord(value)) {
    fail('INVALID_WEEKLY_REVIEW', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id) || !isMondayDateKey(value.weekStart)) {
    fail('INVALID_WEEKLY_REVIEW', `${label} must use a valid Monday week start.`);
  }

  if (
    value.cycleId !== null &&
    !isPositiveInteger(value.cycleId)
  ) {
    fail('INVALID_WEEKLY_REVIEW', `${label} has an invalid cycle link.`);
  }

  const responses = [
    value.whatWentWell,
    value.whatCausedProblems,
    value.whatLearned,
    value.whatChangeNextWeek,
    value.nextWeekFocus,
  ];

  if (
    responses.some(
      (response) =>
        !isNullableString(response) ||
        (typeof response === 'string' &&
          response.length > MAX_WEEKLY_REVIEW_RESPONSE_LENGTH)
    )
  ) {
    fail('INVALID_WEEKLY_REVIEW', `${label} has an invalid reflection response.`);
  }

  const countFields = [
    value.completedCount,
    value.unfinishedCount,
    value.overdueCount,
    value.goalsProgressedCount,
    value.bestDayCount,
    value.archivedBrainDumpCount,
    value.highPriorityCompletedCount,
    value.recurringCompletedCount,
  ];

  if (
    countFields.some(
      (count) =>
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0
    )
  ) {
    fail('INVALID_WEEKLY_REVIEW', `${label} has an invalid saved count.`);
  }

  if (
    typeof value.completionRate !== 'number' ||
    !Number.isSafeInteger(value.completionRate) ||
    value.completionRate < 0 ||
    value.completionRate > 100
  ) {
    fail('INVALID_WEEKLY_REVIEW', `${label} has an invalid completion rate.`);
  }

  /*
   * The array validation above proves these unknown record properties are
   * non-negative integers. Capture typed locals so the consistency checks stay
   * strict without weakening validation for the rest of the backup object.
   */
  const completedCount = value.completedCount as number;
  const unfinishedCount = value.unfinishedCount as number;
  const overdueCount = value.overdueCount as number;
  const goalsProgressedCount = value.goalsProgressedCount as number;
  const bestDayCount = value.bestDayCount as number;
  const highPriorityCompletedCount =
    value.highPriorityCompletedCount as number;
  const recurringCompletedCount =
    value.recurringCompletedCount as number;
  const completionRate = value.completionRate as number;

  const reviewTotal = completedCount + unfinishedCount;
  const expectedCompletionRate =
    reviewTotal === 0
      ? 0
      : Math.round((completedCount / reviewTotal) * 100);

  const hasConsistentBestDay =
    value.bestDay === null
      ? bestDayCount === 0
      : bestDayCount > 0;

  if (
    completionRate !== expectedCompletionRate ||
    overdueCount > unfinishedCount ||
    goalsProgressedCount > completedCount ||
    bestDayCount > completedCount ||
    highPriorityCompletedCount > completedCount ||
    recurringCompletedCount > completedCount ||
    !hasConsistentBestDay
  ) {
    fail(
      'INVALID_WEEKLY_REVIEW',
      `${label} contains inconsistent saved analytics.`
    );
  }

  if (
    value.bestDay !== null &&
    (typeof value.bestDay !== 'string' ||
      ![
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ].includes(value.bestDay))
  ) {
    fail('INVALID_WEEKLY_REVIEW', `${label} has an invalid strongest day.`);
  }

  if (
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isIsoTimestamp(value.reviewedAt)
  ) {
    fail('INVALID_WEEKLY_REVIEW', `${label} has an invalid timestamp.`);
  }
}

function validateWeeklyCommitment(
  value: unknown,
  label: string,
  requireTaskLink: boolean = true
): asserts value is WeeklyCommitment {
  if (!isRecord(value)) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id) || !isMondayDateKey(value.weekStart)) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} must use a valid Monday week start.`);
  }

  if (
    value.cycleId !== null &&
    !isPositiveInteger(value.cycleId)
  ) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} has an invalid cycle link.`);
  }

  if (
    requireTaskLink &&
    !Object.prototype.hasOwnProperty.call(value, 'taskId')
  ) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} is missing its task link.`);
  }

  if (
    value.taskId !== undefined &&
    value.taskId !== null &&
    !isPositiveInteger(value.taskId)
  ) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} has an invalid task link.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0 ||
    value.title.length > MAX_WEEKLY_COMMITMENT_TITLE_LENGTH
  ) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} has an invalid title.`);
  }

  if (typeof value.completed !== 'boolean') {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} has an invalid completed value.`);
  }

  if (
    !isIsoTimestamp(value.createdAt) ||
    !isNullableIsoTimestamp(value.completedAt) ||
    !hasMatchingStatusTimestamp(value.completed, value.completedAt)
  ) {
    fail('INVALID_WEEKLY_COMMITMENT', `${label} has invalid completion timestamps.`);
  }
}

function validateWeeklyTaskDecision(
  value: unknown,
  label: string
): asserts value is WeeklyTaskDecision {
  if (!isRecord(value)) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} is not an object.`);
  }

  if (
    !isPositiveInteger(value.id) ||
    !isMondayDateKey(value.weekStart) ||
    !isValidDateKey(value.originalDueDate) ||
    !isDateKeyInsideWeek(value.originalDueDate, value.weekStart)
  ) {
    fail(
      'INVALID_WEEKLY_TASK_DECISION',
      `${label} has an invalid review week or original task date.`
    );
  }

  if (
    value.taskId !== null &&
    !isPositiveInteger(value.taskId)
  ) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid task link.`);
  }

  if (
    typeof value.taskTitle !== 'string' ||
    value.taskTitle.trim().length === 0
  ) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid task title.`);
  }

  if (
    typeof value.action !== 'string' ||
    !WEEKLY_TASK_DECISION_ACTIONS.includes(
      value.action as (typeof WEEKLY_TASK_DECISION_ACTIONS)[number]
    )
  ) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid action.`);
  }

  if (!isValidNullableDateKey(value.resolvedDueDate)) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid resolved date.`);
  }

  const actionMovesTask =
    value.action === 'nextWeek' || value.action === 'reschedule';

  if (actionMovesTask !== (value.resolvedDueDate !== null)) {
    fail(
      'INVALID_WEEKLY_TASK_DECISION',
      `${label} has a resolved date that does not match its action.`
    );
  }

  if (value.action === 'nextWeek' && value.resolvedDueDate !== null) {
    const originalDueDate = parseLocalDateKey(value.originalDueDate);
    const expectedNextWeekDate = originalDueDate
      ? getLocalDateKey(addDays(originalDueDate, 7))
      : null;

    if (value.resolvedDueDate !== expectedNextWeekDate) {
      fail(
        'INVALID_WEEKLY_TASK_DECISION',
        `${label} does not preserve the task weekday when moving it to next week.`
      );
    }
  }

  if (value.action === 'delete' && value.taskId !== null) {
    fail(
      'INVALID_WEEKLY_TASK_DECISION',
      `${label} keeps a live task link after recording deletion.`
    );
  }

  if (
    value.recurringRuleId !== null &&
    !isPositiveInteger(value.recurringRuleId)
  ) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid recurring rule link.`);
  }

  if (!isValidNullableDateKey(value.recurrenceOccurrenceDate)) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid occurrence date.`);
  }

  if (
    (value.recurringRuleId === null) !==
    (value.recurrenceOccurrenceDate === null)
  ) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an incomplete recurring identity.`);
  }

  if (!isIsoTimestamp(value.decidedAt)) {
    fail('INVALID_WEEKLY_TASK_DECISION', `${label} has an invalid decision timestamp.`);
  }
}

function validateCycleReview(
  value: unknown,
  label: string
): asserts value is StoredCycleReview {
  if (!isRecord(value)) {
    fail('INVALID_CYCLE_REVIEW', `${label} is not an object.`);
  }

  if (
    !isPositiveInteger(value.id) ||
    !isPositiveInteger(value.cycleId)
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} has an invalid ID or cycle link.`);
  }

  const responses = [
    value.biggestAccomplishment,
    value.biggestChallenge,
    value.whatWorkedWell,
    value.whatChangeNextCycle,
    value.whatStopDoing,
    value.whatContinueDoing,
    value.whatLearned,
  ];

  if (
    responses.some(
      (response) =>
        !isNullableString(response) ||
        (typeof response === 'string' &&
          response.length > MAX_CYCLE_REVIEW_RESPONSE_LENGTH)
    )
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} has an invalid reflection response.`);
  }

  const counts = [
    value.goalTotal,
    value.goalCompleted,
    value.taskCompleted,
    value.milestoneTotal,
    value.milestoneCompleted,
    value.weeklyReviewsCompleted,
    value.longestStreak,
    value.bestWeekCount,
    value.bestDayCount,
    value.highPriorityCompleted,
    value.recurringCompleted,
    value.rewardsUnlocked,
    value.brainDumpsArchived,
  ];

  if (
    counts.some(
      (count) =>
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0
    )
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} has an invalid saved count.`);
  }

  const bestWeekNumber = value.bestWeekNumber;
  if (
    bestWeekNumber !== null &&
    (typeof bestWeekNumber !== 'number' ||
      !Number.isSafeInteger(bestWeekNumber) ||
      bestWeekNumber < 1 ||
      bestWeekNumber > 12)
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} has an invalid best week.`);
  }

  const goalTotal = value.goalTotal as number;
  const goalCompleted = value.goalCompleted as number;
  const taskCompleted = value.taskCompleted as number;
  const milestoneTotal = value.milestoneTotal as number;
  const milestoneCompleted = value.milestoneCompleted as number;
  const highPriorityCompleted = value.highPriorityCompleted as number;
  const recurringCompleted = value.recurringCompleted as number;
  const rewardsUnlocked = value.rewardsUnlocked as number;
  const bestWeekCount = value.bestWeekCount as number;
  const bestDayCount = value.bestDayCount as number;

  if (
    !isNullableString(value.bestDay) ||
    goalCompleted > goalTotal ||
    milestoneCompleted > milestoneTotal ||
    highPriorityCompleted > taskCompleted ||
    recurringCompleted > taskCompleted ||
    rewardsUnlocked > goalCompleted ||
    bestWeekCount > taskCompleted ||
    bestDayCount > taskCompleted
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} contains inconsistent saved analytics.`);
  }

  const nextCycleTexts = [
    [value.nextCycleName, MAX_CYCLE_NAME_LENGTH],
    [value.nextCyclePrimaryFocus, MAX_CYCLE_PRIMARY_FOCUS_LENGTH],
    [value.nextCycleTheme, MAX_CYCLE_THEME_LENGTH],
  ] as const;
  if (
    nextCycleTexts.some(
      ([item, maxLength]) =>
        !isNullableString(item) ||
        (typeof item === 'string' && item.length > maxLength)
    )
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} has invalid next-cycle details.`);
  }

  if (
    !Array.isArray(value.nextCycleFirstWeekCommitments) ||
    value.nextCycleFirstWeekCommitments.length > MAX_FIRST_WEEK_COMMITMENTS ||
    value.nextCycleFirstWeekCommitments.some(
      (commitment) =>
        typeof commitment !== 'string' ||
        commitment.trim().length === 0 ||
        commitment.length > MAX_FIRST_WEEK_COMMITMENT_LENGTH
    )
  ) {
    fail(
      'INVALID_CYCLE_REVIEW',
      `${label} has invalid first-week commitments.`
    );
  }

  if (
    new Set(
      value.nextCycleFirstWeekCommitments.map((commitment) =>
        commitment.trim().toLowerCase()
      )
    ).size !== value.nextCycleFirstWeekCommitments.length
  ) {
    fail(
      'INVALID_CYCLE_REVIEW',
      `${label} has duplicate first-week commitments.`
    );
  }

  if (!isValidNullableDateKey(value.nextCycleStartDate)) {
    fail('INVALID_CYCLE_REVIEW', `${label} has an invalid next-cycle start date.`);
  }

  if (value.nextCycleId !== null && !isPositiveInteger(value.nextCycleId)) {
    fail('INVALID_CYCLE_REVIEW', `${label} has an invalid next-cycle link.`);
  }

  if (
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isNullableIsoTimestamp(value.finalizedAt)
  ) {
    fail('INVALID_CYCLE_REVIEW', `${label} has invalid timestamps.`);
  }

  if (
    value.finalizedAt !== null &&
    value.nextCycleStartDate === null
  ) {
    fail(
      'INVALID_CYCLE_REVIEW',
      `${label} is finalized without a saved next-cycle plan.`
    );
  }
}

function validateCycleGoalOutcome(
  value: unknown,
  label: string
): asserts value is StoredCycleGoalOutcome {
  if (!isRecord(value)) {
    fail('INVALID_CYCLE_GOAL_OUTCOME', `${label} is not an object.`);
  }

  if (
    !isPositiveInteger(value.id) ||
    !isPositiveInteger(value.cycleReviewId) ||
    (value.goalId !== null && !isPositiveInteger(value.goalId)) ||
    (value.destinationGoalId !== null &&
      !isPositiveInteger(value.destinationGoalId))
  ) {
    fail('INVALID_CYCLE_GOAL_OUTCOME', `${label} has an invalid relationship.`);
  }

  if (
    typeof value.goalTitle !== 'string' ||
    value.goalTitle.trim().length === 0
  ) {
    fail('INVALID_CYCLE_GOAL_OUTCOME', `${label} has an invalid goal title.`);
  }

  if (
    typeof value.action !== 'string' ||
    !CYCLE_GOAL_OUTCOME_ACTIONS.includes(
      value.action as (typeof CYCLE_GOAL_OUTCOME_ACTIONS)[number]
    )
  ) {
    fail('INVALID_CYCLE_GOAL_OUTCOME', `${label} has an invalid action.`);
  }

  if (
    !isNullableString(value.replacementTitle) ||
    (typeof value.replacementTitle === 'string' &&
      value.replacementTitle.length > MAX_REPLACEMENT_GOAL_TITLE_LENGTH)
  ) {
    fail('INVALID_CYCLE_GOAL_OUTCOME', `${label} has an invalid replacement title.`);
  }

  if (
    (value.action === 'replace') !== (value.replacementTitle !== null)
  ) {
    fail(
      'INVALID_CYCLE_GOAL_OUTCOME',
      `${label} has replacement text that does not match its action.`
    );
  }

  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) {
    fail('INVALID_CYCLE_GOAL_OUTCOME', `${label} has invalid timestamps.`);
  }
}

function validateBrainDump(
  value: unknown,
  label: string
): asserts value is StoredBrainDump {
  if (!isRecord(value)) {
    fail('INVALID_BRAIN_DUMP', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_BRAIN_DUMP', `${label} has an invalid ID.`);
  }

  if (
    typeof value.body !== 'string' ||
    value.body.trim().length === 0
  ) {
    fail('INVALID_BRAIN_DUMP', `${label} is empty.`);
  }

  if (typeof value.archived !== 'boolean') {
    fail('INVALID_BRAIN_DUMP', `${label} has an invalid archived value.`);
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail(
      'INVALID_BRAIN_DUMP',
      `${label} has an invalid created timestamp.`
    );
  }

  if (!isNullableIsoTimestamp(value.archivedAt)) {
    fail(
      'INVALID_BRAIN_DUMP',
      `${label} has an invalid archived timestamp.`
    );
  }

  if (
    !hasMatchingStatusTimestamp(
      value.archived,
      value.archivedAt
    )
  ) {
    fail(
      'INVALID_BRAIN_DUMP',
      `${label} has an archived status that does not match its archived timestamp.`
    );
  }
}

function validateTaskTemplate(
  value: unknown,
  label: string
): asserts value is TaskTemplate {
  if (!isRecord(value)) {
    fail('INVALID_TASK_TEMPLATE', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_TASK_TEMPLATE', `${label} has an invalid ID.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0
  ) {
    fail('INVALID_TASK_TEMPLATE', `${label} has an empty title.`);
  }

  if (!isNullableString(value.notes)) {
    fail('INVALID_TASK_TEMPLATE', `${label} has invalid notes.`);
  }

  if (
    typeof value.priority !== 'number' ||
    !Number.isInteger(value.priority) ||
    value.priority < 0 ||
    value.priority > 2
  ) {
    fail(
      'INVALID_TASK_TEMPLATE',
      `${label} has an invalid priority. Expected 0, 1, or 2.`
    );
  }

  if (!isNullableInteger(value.goalId)) {
    fail(
      'INVALID_TASK_TEMPLATE',
      `${label} has an invalid goal link.`
    );
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail(
      'INVALID_TASK_TEMPLATE',
      `${label} has an invalid created timestamp.`
    );
  }

  if (!isIsoTimestamp(value.updatedAt)) {
    fail(
      'INVALID_TASK_TEMPLATE',
      `${label} has an invalid updated timestamp.`
    );
  }
}

function validateRecurringRule(
  value: unknown,
  label: string
): asserts value is RecurringRule {
  if (!isRecord(value)) {
    fail('INVALID_RECURRING_RULE', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_RECURRING_RULE', `${label} has an invalid ID.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0
  ) {
    fail('INVALID_RECURRING_RULE', `${label} has an empty title.`);
  }

  if (!isNullableString(value.notes)) {
    fail('INVALID_RECURRING_RULE', `${label} has invalid notes.`);
  }

  if (
    typeof value.priority !== 'number' ||
    !Number.isInteger(value.priority) ||
    value.priority < 0 ||
    value.priority > 2
  ) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an invalid priority. Expected 0, 1, or 2.`
    );
  }

  if (!isNullableInteger(value.goalId)) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an invalid goal link.`
    );
  }

  if (
    typeof value.frequency !== 'string' ||
    !RECURRENCE_FREQUENCIES.includes(
      value.frequency as RecurringRule['frequency']
    )
  ) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an unsupported recurrence frequency.`
    );
  }

  if (!isValidDateKey(value.startDate)) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an invalid start date.`
    );
  }

  if (!isValidNullableDateKey(value.endDate)) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an invalid end date.`
    );
  }

  if (
    value.endDate !== null &&
    value.endDate < value.startDate
  ) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} ends before its start date.`
    );
  }

  if (
    !Array.isArray(value.weekdays) ||
    value.weekdays.some(
      (weekday) =>
        typeof weekday !== 'number' ||
        !Number.isInteger(weekday) ||
        weekday < 0 ||
        weekday > 6
    )
  ) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} contains an invalid weekday.`
    );
  }

  if (
    new Set(value.weekdays).size !==
    value.weekdays.length
  ) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} contains duplicate weekdays.`
    );
  }

  if (
    value.frequency === 'certainDays' &&
    value.weekdays.length === 0
  ) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} must select at least one weekday.`
    );
  }

  if (typeof value.active !== 'boolean') {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an invalid active value.`
    );
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail(
      'INVALID_RECURRING_RULE',
      `${label} has an invalid created timestamp.`
    );
  }
}

function validateRecurringException(
  value: unknown,
  label: string
): asserts value is RecurringOccurrenceException {
  if (!isRecord(value)) {
    fail('INVALID_EXCEPTION', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.recurringRuleId)) {
    fail(
      'INVALID_EXCEPTION',
      `${label} has an invalid recurring schedule link.`
    );
  }

  if (!isValidDateKey(value.occurrenceDate)) {
    fail(
      'INVALID_EXCEPTION',
      `${label} has an invalid occurrence date.`
    );
  }

  if (!isIsoTimestamp(value.createdAt)) {
    fail(
      'INVALID_EXCEPTION',
      `${label} has an invalid created timestamp.`
    );
  }
}

function validateMetadata(
  value: unknown
): asserts value is BackupMetadata {
  if (!isRecord(value)) {
    fail(
      'INVALID_METADATA',
      'The backup is missing its metadata section.'
    );
  }

  if (
    typeof value.appVersion !== 'string' ||
    value.appVersion.trim().length === 0
  ) {
    fail(
      'INVALID_METADATA',
      'The backup metadata has an invalid app version.'
    );
  }

  if (
    value.dataModelVersion !==
    BACKUP_DATA_MODEL_VERSION
  ) {
    fail(
      'UNSUPPORTED_DATA_MODEL',
      `This backup uses data model version ${String(
        value.dataModelVersion
      )}, but this copy of WeekFlow supports version ${BACKUP_DATA_MODEL_VERSION}.`
    );
  }
}

function assertUniqueIds(
  items: { id: number }[],
  label: string
) {
  if (
    new Set(items.map((item) => item.id)).size !==
    items.length
  ) {
    fail(
      'DUPLICATE_IDS',
      `The backup contains duplicate ${label} IDs.`
    );
  }
}

function validateUniqueRecurringOccurrences(
  tasks: Task[]
) {
  const keys = tasks
    .filter(
      (task) =>
        task.recurringRuleId !== null &&
        task.recurrenceOccurrenceDate !== null
    )
    .map(
      (task) =>
        `${task.recurringRuleId}:${task.recurrenceOccurrenceDate}`
    );

  if (new Set(keys).size !== keys.length) {
    fail(
      'DUPLICATE_OCCURRENCES',
      'The backup contains duplicate recurring task occurrences.'
    );
  }
}

function validateUniqueExceptions(
  exceptions: RecurringOccurrenceException[]
) {
  const keys = exceptions.map(
    (exception) =>
      `${exception.recurringRuleId}:${exception.occurrenceDate}`
  );

  if (new Set(keys).size !== keys.length) {
    fail(
      'DUPLICATE_EXCEPTIONS',
      'The backup contains duplicate recurring exceptions.'
    );
  }
}

/**
 * Older WeekFlow builds could leave tasks, templates, or recurring schedules
 * pointing at a goal after that goal was deleted. A goal link is optional, so
 * the safest migration is to preserve the record and clear only the missing
 * relationship. This lets older phone backups import without deleting work.
 */
function repairOrphanedGoalLinks(
  backup: WeekFlowBackup
): { backup: WeekFlowBackup; repairs: BackupRepairs } {
  const goalIds = new Set(
    backup.data.goals.map((goal) => goal.id)
  );

  let orphanedGoalLinks = 0;

  const repairGoalId = (goalId: number | null) => {
    if (
      goalId === null ||
      goalIds.has(goalId)
    ) {
      return goalId;
    }

    orphanedGoalLinks += 1;
    return null;
  };

  return {
    backup: {
      ...backup,
      data: {
        ...backup.data,
        tasks: backup.data.tasks.map((task) => ({
          ...task,
          goalId: repairGoalId(task.goalId),
        })),
        taskTemplates:
          backup.data.taskTemplates.map((template) => ({
            ...template,
            goalId: repairGoalId(template.goalId),
          })),
        recurringRules:
          backup.data.recurringRules.map((rule) => ({
            ...rule,
            goalId: repairGoalId(rule.goalId),
          })),
        cycleGoalOutcomes:
          backup.data.cycleGoalOutcomes.map((outcome) => ({
            ...outcome,
            goalId: repairGoalId(outcome.goalId),
            destinationGoalId: repairGoalId(outcome.destinationGoalId),
          })),
      },
    },
    repairs: {
      orphanedGoalLinks,
    },
  };
}

function validateRelationships(
  backup: WeekFlowBackup
) {
  const goalIds = new Set(
    backup.data.goals.map((goal) => goal.id)
  );

  const recurringRuleIds = new Set(
    backup.data.recurringRules.map(
      (rule) => rule.id
    )
  );
  const taskIds = new Set(
    backup.data.tasks.map((task) => task.id)
  );

  const taskWithMissingGoal =
    backup.data.tasks.find(
      (task) =>
        task.goalId !== null &&
        !goalIds.has(task.goalId)
    );

  if (taskWithMissingGoal) {
    fail(
      'MISSING_GOAL',
      `Task "${taskWithMissingGoal.title}" is linked to a goal that is not included in the backup.`
    );
  }

  const templateWithMissingGoal =
    backup.data.taskTemplates.find(
      (template) =>
        template.goalId !== null &&
        !goalIds.has(template.goalId)
    );

  if (templateWithMissingGoal) {
    fail(
      'MISSING_GOAL',
      `Task template "${templateWithMissingGoal.title}" is linked to a goal that is not included in the backup.`
    );
  }

  const ruleWithMissingGoal =
    backup.data.recurringRules.find(
      (rule) =>
        rule.goalId !== null &&
        !goalIds.has(rule.goalId)
    );

  if (ruleWithMissingGoal) {
    fail(
      'MISSING_GOAL',
      `Recurring schedule "${ruleWithMissingGoal.title}" is linked to a goal that is not included in the backup.`
    );
  }

  const milestoneWithMissingGoal =
    backup.data.goalMilestones.find(
      (milestone) => !goalIds.has(milestone.goalId)
    );

  if (milestoneWithMissingGoal) {
    fail(
      'MISSING_GOAL',
      `Milestone "${milestoneWithMissingGoal.title}" is linked to a goal that is not included in the backup.`
    );
  }

  const taskWithMissingRule =
    backup.data.tasks.find(
      (task) =>
        task.recurringRuleId !== null &&
        !recurringRuleIds.has(task.recurringRuleId)
    );

  if (taskWithMissingRule) {
    fail(
      'MISSING_RECURRING_RULE',
      `Task "${taskWithMissingRule.title}" is linked to a recurring schedule that is not included in the backup.`
    );
  }

  const exceptionWithMissingRule =
    backup.data.recurringExceptions.find(
      (exception) =>
        !recurringRuleIds.has(
          exception.recurringRuleId
        )
    );

  if (exceptionWithMissingRule) {
    fail(
      'MISSING_RECURRING_RULE',
      `The skipped occurrence on ${exceptionWithMissingRule.occurrenceDate} is linked to a recurring schedule that is not included in the backup.`
    );
  }

  const commitmentWithMissingTask =
    backup.data.weeklyCommitments.find(
      (commitment) =>
        commitment.taskId !== null && !taskIds.has(commitment.taskId)
    );

  if (commitmentWithMissingTask) {
    fail(
      'MISSING_TASK',
      `The weekly commitment "${commitmentWithMissingTask.title}" is linked to a task that is not included in the backup.`
    );
  }

  const decisionWithMissingTask =
    backup.data.weeklyTaskDecisions.find(
      (decision) =>
        decision.taskId !== null && !taskIds.has(decision.taskId)
    );

  if (decisionWithMissingTask) {
    fail(
      'MISSING_TASK',
      `The weekly decision for "${decisionWithMissingTask.taskTitle}" is linked to a task that is not included in the backup.`
    );
  }

  const cycleIds = new Set(
    backup.data.planningCycles.map((cycle) => cycle.id)
  );

  const goalWithMissingCycle = backup.data.goals.find(
    (goal) =>
      goal.cycleId !== null && !cycleIds.has(goal.cycleId)
  );

  if (goalWithMissingCycle) {
    fail(
      'MISSING_CYCLE',
      `Goal "${goalWithMissingCycle.title}" is linked to a planning cycle that is not included in the backup.`
    );
  }

  const reviewWithMissingCycle = backup.data.weeklyReviews.find(
    (review) =>
      review.cycleId !== null && !cycleIds.has(review.cycleId)
  );

  if (reviewWithMissingCycle) {
    fail(
      'MISSING_CYCLE',
      `The weekly review for ${reviewWithMissingCycle.weekStart} is linked to a planning cycle that is not included in the backup.`
    );
  }

  const commitmentWithMissingCycle =
    backup.data.weeklyCommitments.find(
      (commitment) =>
        commitment.cycleId !== null &&
        !cycleIds.has(commitment.cycleId)
    );

  if (commitmentWithMissingCycle) {
    fail(
      'MISSING_CYCLE',
      `The weekly commitment "${commitmentWithMissingCycle.title}" is linked to a planning cycle that is not included in the backup.`
    );
  }

  const cycleReviewIds = new Set(
    backup.data.cycleReviews.map((review) => review.id)
  );

  const cycleReviewWithMissingCycle = backup.data.cycleReviews.find(
    (review) =>
      !cycleIds.has(review.cycleId) ||
      (review.nextCycleId !== null && !cycleIds.has(review.nextCycleId))
  );

  if (cycleReviewWithMissingCycle) {
    fail(
      'MISSING_CYCLE',
      'A Week 13 review is linked to a planning cycle that is not included in the backup.'
    );
  }

  const outcomeWithMissingReview = backup.data.cycleGoalOutcomes.find(
    (outcome) => !cycleReviewIds.has(outcome.cycleReviewId)
  );

  if (outcomeWithMissingReview) {
    fail(
      'MISSING_CYCLE_REVIEW',
      `The saved outcome for "${outcomeWithMissingReview.goalTitle}" is missing its cycle review.`
    );
  }

  const outcomeWithMissingGoal = backup.data.cycleGoalOutcomes.find(
    (outcome) =>
      (outcome.goalId !== null && !goalIds.has(outcome.goalId)) ||
      (outcome.destinationGoalId !== null &&
        !goalIds.has(outcome.destinationGoalId))
  );

  if (outcomeWithMissingGoal) {
    fail(
      'MISSING_GOAL',
      `The saved cycle outcome for "${outcomeWithMissingGoal.goalTitle}" is linked to a goal that is not included in the backup.`
    );
  }
}

function validateData(
  value: Record<string, unknown>,
  requireTaskTemplates: boolean = true,
  requirePlanningCycles: boolean = true,
  requireGoalReward: boolean = true,
  requireGoalPlanningDetails: boolean = true,
  requireGoalReviewDetails: boolean = true,
  requireGoalMilestones: boolean = true,
  requireWeeklyReviewData: boolean = true,
  requireWeeklyCommitmentTaskLinks: boolean = true,
  requireCycleIdentity: boolean = true,
  requireGoalCycleLinks: boolean = true,
  requireCycleReviewData: boolean = false
): WeekFlowBackup['data'] {
  const requiredArrays = [
    'tasks',
    'goals',
    'brainDumps',
    'recurringRules',
    'recurringExceptions',
  ] as const;

  for (const field of requiredArrays) {
    if (!Array.isArray(value[field])) {
      fail(
        'MISSING_SECTION',
        `The backup is missing the ${field} list.`
      );
    }
  }

  if (
    requireTaskTemplates &&
    !Array.isArray(value.taskTemplates)
  ) {
    fail(
      'MISSING_SECTION',
      'The backup is missing the taskTemplates list.'
    );
  }

  if (
    requirePlanningCycles &&
    !Array.isArray(value.planningCycles)
  ) {
    fail(
      'MISSING_SECTION',
      'The backup is missing the planningCycles list.'
    );
  }

  if (
    requireGoalMilestones &&
    !Array.isArray(value.goalMilestones)
  ) {
    fail(
      'MISSING_SECTION',
      'The backup is missing the goalMilestones list.'
    );
  }

  if (
    requireWeeklyReviewData &&
    (
      !Array.isArray(value.weeklyReviews) ||
      !Array.isArray(value.weeklyCommitments) ||
      !Array.isArray(value.weeklyTaskDecisions)
    )
  ) {
    fail(
      'MISSING_SECTION',
      'The backup is missing weekly review planning data.'
    );
  }

  if (
    requireCycleReviewData &&
    (
      !Array.isArray(value.cycleReviews) ||
      !Array.isArray(value.cycleGoalOutcomes)
    )
  ) {
    fail(
      'MISSING_SECTION',
      'The backup is missing Week 13 cycle review data.'
    );
  }

  const tasks = value.tasks as unknown[];
  const goals = value.goals as unknown[];
  const goalMilestones = Array.isArray(value.goalMilestones)
    ? (value.goalMilestones as unknown[])
    : [];
  const brainDumps = value.brainDumps as unknown[];
  const taskTemplates = Array.isArray(value.taskTemplates)
    ? (value.taskTemplates as unknown[])
    : [];
  const recurringRules = value.recurringRules as unknown[];
  const recurringExceptions =
    value.recurringExceptions as unknown[];
  const planningCycles = Array.isArray(value.planningCycles)
    ? (value.planningCycles as unknown[])
    : [];
  const weeklyReviews = Array.isArray(value.weeklyReviews)
    ? (value.weeklyReviews as unknown[])
    : [];
  const weeklyCommitments = Array.isArray(value.weeklyCommitments)
    ? (value.weeklyCommitments as unknown[])
    : [];
  const weeklyTaskDecisions = Array.isArray(value.weeklyTaskDecisions)
    ? (value.weeklyTaskDecisions as unknown[])
    : [];
  const cycleReviews = Array.isArray(value.cycleReviews)
    ? (value.cycleReviews as unknown[])
    : [];
  const cycleGoalOutcomes = Array.isArray(value.cycleGoalOutcomes)
    ? (value.cycleGoalOutcomes as unknown[])
    : [];

  tasks.forEach((task, index) =>
    validateTask(task, `Task ${index + 1}`)
  );

  goals.forEach((goal, index) =>
    validateGoal(
      goal,
      `Goal ${index + 1}`,
      requireGoalReward,
      requireGoalPlanningDetails,
      requireGoalReviewDetails,
      requireGoalCycleLinks
    )
  );

  goalMilestones.forEach((milestone, index) =>
    validateGoalMilestone(
      milestone,
      `Goal milestone ${index + 1}`
    )
  );

  brainDumps.forEach((brainDump, index) =>
    validateBrainDump(
      brainDump,
      `Brain Dump ${index + 1}`
    )
  );

  taskTemplates.forEach((template, index) =>
    validateTaskTemplate(
      template,
      `Task template ${index + 1}`
    )
  );

  recurringRules.forEach((rule, index) =>
    validateRecurringRule(
      rule,
      `Recurring schedule ${index + 1}`
    )
  );

  recurringExceptions.forEach((exception, index) =>
    validateRecurringException(
      exception,
      `Recurring exception ${index + 1}`
    )
  );

  planningCycles.forEach((cycle, index) =>
    validatePlanningCycle(
      cycle,
      `Planning cycle ${index + 1}`,
      requireCycleIdentity
    )
  );

  weeklyReviews.forEach((review, index) =>
    validateWeeklyReview(
      review,
      `Weekly review ${index + 1}`
    )
  );

  weeklyCommitments.forEach((commitment, index) =>
    validateWeeklyCommitment(
      commitment,
      `Weekly commitment ${index + 1}`,
      requireWeeklyCommitmentTaskLinks
    )
  );

  weeklyTaskDecisions.forEach((decision, index) =>
    validateWeeklyTaskDecision(
      decision,
      `Weekly task decision ${index + 1}`
    )
  );

  cycleReviews.forEach((review, index) =>
    validateCycleReview(review, `Cycle review ${index + 1}`)
  );

  cycleGoalOutcomes.forEach((outcome, index) =>
    validateCycleGoalOutcome(outcome, `Cycle goal outcome ${index + 1}`)
  );

  return {
    tasks: tasks as Task[],
    goals: goals as StoredGoal[],
    goalMilestones: goalMilestones as GoalMilestone[],
    brainDumps: brainDumps as StoredBrainDump[],
    taskTemplates: taskTemplates as TaskTemplate[],
    recurringRules: recurringRules as RecurringRule[],
    recurringExceptions:
      recurringExceptions as RecurringOccurrenceException[],
    planningCycles: planningCycles as PlanningCycle[],
    weeklyReviews: weeklyReviews as StoredWeeklyReview[],
    weeklyCommitments: weeklyCommitments as WeeklyCommitment[],
    weeklyTaskDecisions:
      weeklyTaskDecisions as WeeklyTaskDecision[],
    cycleReviews: cycleReviews as StoredCycleReview[],
    cycleGoalOutcomes:
      cycleGoalOutcomes as StoredCycleGoalOutcome[],
  };
}

function normalizeLegacyPlanningCycles(
  cycles: LegacyPlanningCycle[] = []
): PlanningCycle[] {
  return cycles.map((cycle) => ({
    ...cycle,
    name:
      typeof cycle.name === 'string' && cycle.name.trim()
        ? cycle.name.trim()
        : null,
    primaryFocus:
      typeof cycle.primaryFocus === 'string' &&
      cycle.primaryFocus.trim()
        ? cycle.primaryFocus.trim()
        : null,
    theme:
      typeof cycle.theme === 'string' && cycle.theme.trim()
        ? cycle.theme.trim()
        : null,
  }));
}

function findLegacyGoalCycleId(
  goal: LegacyStoredGoal,
  cycles: PlanningCycle[]
) {
  if (
    typeof goal.cycleId === 'number' &&
    cycles.some((cycle) => cycle.id === goal.cycleId)
  ) {
    return goal.cycleId;
  }

  const goalStart = goal.startDate.slice(0, 10);
  const goalEnd = goal.endDate.slice(0, 10);

  const matchingCycle = [...cycles]
    .filter(
      (cycle) =>
        goalStart <= cycle.endDate && goalEnd >= cycle.startDate
    )
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.startDate.localeCompare(a.startDate);
    })[0];

  return matchingCycle?.id ?? null;
}

function normalizeLegacyGoals(
  goals: LegacyStoredGoal[],
  cycles: PlanningCycle[] = []
): StoredGoal[] {
  return goals.map((goal) => ({
    ...goal,
    cycleId: findLegacyGoalCycleId(goal, cycles),
    reward:
      typeof goal.reward === 'string' && goal.reward.trim()
        ? goal.reward.trim()
        : null,
    purpose:
      typeof goal.purpose === 'string' && goal.purpose.trim()
        ? goal.purpose.trim()
        : null,
    successDefinition:
      typeof goal.successDefinition === 'string' &&
      goal.successDefinition.trim()
        ? goal.successDefinition.trim()
        : null,
    notes:
      typeof goal.notes === 'string' && goal.notes.trim()
        ? goal.notes.trim()
        : null,
    completionWhatHelped:
      typeof goal.completionWhatHelped === 'string' &&
      goal.completionWhatHelped.trim()
        ? goal.completionWhatHelped.trim()
        : null,
    completionHardestPart:
      typeof goal.completionHardestPart === 'string' &&
      goal.completionHardestPart.trim()
        ? goal.completionHardestPart.trim()
        : null,
    completionLearned:
      typeof goal.completionLearned === 'string' &&
      goal.completionLearned.trim()
        ? goal.completionLearned.trim()
        : null,
    completionDoDifferently:
      typeof goal.completionDoDifferently === 'string' &&
      goal.completionDoDifferently.trim()
        ? goal.completionDoDifferently.trim()
        : null,
    completionTaskTotal:
      typeof goal.completionTaskTotal === 'number'
        ? goal.completionTaskTotal
        : null,
    completionTaskCompleted:
      typeof goal.completionTaskCompleted === 'number'
        ? goal.completionTaskCompleted
        : null,
    completionMilestoneTotal:
      typeof goal.completionMilestoneTotal === 'number'
        ? goal.completionMilestoneTotal
        : null,
    completionMilestoneCompleted:
      typeof goal.completionMilestoneCompleted === 'number'
        ? goal.completionMilestoneCompleted
        : null,
    completionHighPriorityCompleted:
      typeof goal.completionHighPriorityCompleted === 'number'
        ? goal.completionHighPriorityCompleted
        : null,
  }));
}

function normalizeLegacyWeeklyCommitments(
  commitments: LegacyWeeklyCommitmentV9[]
): WeeklyCommitment[] {
  return commitments.map((commitment) => ({
    ...commitment,
    taskId:
      typeof commitment.taskId === 'number' ? commitment.taskId : null,
  }));
}

function normalizeLegacyBackupV1(
  backup: LegacyWeekFlowBackupV1
): WeekFlowBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    metadata: {
      appVersion: 'legacy-v1',
      dataModelVersion: BACKUP_DATA_MODEL_VERSION,
    },
    data: {
      tasks: backup.data.tasks.map((task) => ({
        ...task,
        recurringRuleId: null,
        recurrenceOccurrenceDate: null,
      })),
      goals: normalizeLegacyGoals(backup.data.goals),
      goalMilestones: [],
      brainDumps: backup.data.brainDumps,
      taskTemplates: [],
      recurringRules: [],
      recurringExceptions: [],
      planningCycles: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV2(
  backup: LegacyWeekFlowBackupV2
): WeekFlowBackup {
  return {
    ...backup,
    version: BACKUP_VERSION,
    metadata: {
      appVersion: 'legacy-v2',
      dataModelVersion: BACKUP_DATA_MODEL_VERSION,
    },
    data: {
      ...backup.data,
      goals: normalizeLegacyGoals(backup.data.goals),
      goalMilestones: [],
      taskTemplates: [],
      planningCycles: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV3(
  backup: LegacyWeekFlowBackupV3
): WeekFlowBackup {
  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      goals: normalizeLegacyGoals(backup.data.goals),
      goalMilestones: [],
      taskTemplates: [],
      planningCycles: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV4(
  backup: LegacyWeekFlowBackupV4
): WeekFlowBackup {
  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      goals: normalizeLegacyGoals(backup.data.goals),
      goalMilestones: [],
      planningCycles: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV5(
  backup: LegacyWeekFlowBackupV5
): WeekFlowBackup {
  const planningCycles = normalizeLegacyPlanningCycles(
    backup.data.planningCycles
  );

  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      planningCycles,
      goals: normalizeLegacyGoals(backup.data.goals, planningCycles),
      goalMilestones: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV6(
  backup: LegacyWeekFlowBackupV6
): WeekFlowBackup {
  const planningCycles = normalizeLegacyPlanningCycles(
    backup.data.planningCycles
  );

  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      planningCycles,
      goals: normalizeLegacyGoals(backup.data.goals, planningCycles),
      goalMilestones: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV7(
  backup: LegacyWeekFlowBackupV7
): WeekFlowBackup {
  const planningCycles = normalizeLegacyPlanningCycles(
    backup.data.planningCycles
  );

  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      planningCycles,
      goals: normalizeLegacyGoals(backup.data.goals, planningCycles),
      goalMilestones: backup.data.goalMilestones ?? [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV8(
  backup: LegacyWeekFlowBackupV8
): WeekFlowBackup {
  const planningCycles = normalizeLegacyPlanningCycles(
    backup.data.planningCycles
  );

  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      planningCycles,
      goals: normalizeLegacyGoals(backup.data.goals, planningCycles),
      goalMilestones: backup.data.goalMilestones ?? [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV9(
  backup: LegacyWeekFlowBackupV9
): WeekFlowBackup {
  const planningCycles = normalizeLegacyPlanningCycles(
    backup.data.planningCycles as LegacyPlanningCycle[]
  );

  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      planningCycles,
      goals: normalizeLegacyGoals(
        backup.data.goals as LegacyStoredGoal[],
        planningCycles
      ),
      weeklyCommitments: normalizeLegacyWeeklyCommitments(
        backup.data.weeklyCommitments
      ),
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV10(
  backup: LegacyWeekFlowBackupV10
): WeekFlowBackup {
  const planningCycles = normalizeLegacyPlanningCycles(
    backup.data.planningCycles
  );

  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      planningCycles,
      goals: normalizeLegacyGoals(backup.data.goals, planningCycles),
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function normalizeLegacyBackupV11(
  backup: LegacyWeekFlowBackupV11
): WeekFlowBackup {
  return {
    ...backup,
    version: BACKUP_VERSION,
    data: {
      ...backup.data,
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

function validateNormalizedBackup(
  backup: WeekFlowBackup
) {
  assertUniqueIds(backup.data.tasks, 'task');
  assertUniqueIds(backup.data.goals, 'goal');
  assertUniqueIds(backup.data.goalMilestones, 'goal milestone');
  assertUniqueIds(backup.data.brainDumps, 'Brain Dump');
  assertUniqueIds(
    backup.data.taskTemplates,
    'task template'
  );
  assertUniqueIds(
    backup.data.recurringRules,
    'recurring schedule'
  );
  assertUniqueIds(
    backup.data.planningCycles,
    'planning cycle'
  );
  assertUniqueIds(backup.data.weeklyReviews, 'weekly review');
  assertUniqueIds(
    backup.data.weeklyCommitments,
    'weekly commitment'
  );
  assertUniqueIds(
    backup.data.weeklyTaskDecisions,
    'weekly task decision'
  );
  assertUniqueIds(backup.data.cycleReviews, 'cycle review');
  assertUniqueIds(
    backup.data.cycleGoalOutcomes,
    'cycle goal outcome'
  );

  const cycleReviewCycleIds = backup.data.cycleReviews.map(
    (review) => review.cycleId
  );
  if (new Set(cycleReviewCycleIds).size !== cycleReviewCycleIds.length) {
    fail(
      'DUPLICATE_CYCLE_REVIEWS',
      'The backup contains more than one Week 13 review for the same cycle.'
    );
  }

  const cycleOutcomeKeys = backup.data.cycleGoalOutcomes
    .filter((outcome) => outcome.goalId !== null)
    .map((outcome) => `${outcome.cycleReviewId}:${outcome.goalId}`);
  if (new Set(cycleOutcomeKeys).size !== cycleOutcomeKeys.length) {
    fail(
      'DUPLICATE_CYCLE_OUTCOMES',
      'The backup contains more than one outcome for the same cycle goal.'
    );
  }

  const weeklyReviewWeeks = new Set<string>();
  for (const review of backup.data.weeklyReviews) {
    if (weeklyReviewWeeks.has(review.weekStart)) {
      fail(
        'DUPLICATE_WEEKLY_REVIEW',
        `The backup contains more than one weekly review for ${review.weekStart}.`
      );
    }
    weeklyReviewWeeks.add(review.weekStart);
  }

  const linkedCommitmentKeys = backup.data.weeklyCommitments
    .filter((commitment) => commitment.taskId !== null)
    .map((commitment) => `${commitment.weekStart}:${commitment.taskId}`);

  if (new Set(linkedCommitmentKeys).size !== linkedCommitmentKeys.length) {
    fail(
      'DUPLICATE_WEEKLY_COMMITMENTS',
      'The backup links the same task to the same week more than once.'
    );
  }

  const weeklyDecisionKeys = backup.data.weeklyTaskDecisions
    .filter((decision) => decision.taskId !== null)
    .map(
      (decision) =>
        `${decision.weekStart}:${decision.taskId}:${decision.originalDueDate}`
    );

  if (new Set(weeklyDecisionKeys).size !== weeklyDecisionKeys.length) {
    fail(
      'DUPLICATE_WEEKLY_TASK_DECISIONS',
      'The backup contains duplicate unfinished-task decisions.'
    );
  }

  if (
    backup.data.planningCycles.filter(
      (cycle) => cycle.active
    ).length > 1
  ) {
    fail(
      'MULTIPLE_ACTIVE_CYCLES',
      'The backup contains more than one active planning cycle.'
    );
  }

  validateUniqueRecurringOccurrences(
    backup.data.tasks
  );
  validateUniqueExceptions(
    backup.data.recurringExceptions
  );
  validateRelationships(backup);
}

export function getBackupCounts(
  backup: WeekFlowBackup
): BackupCounts {
  return {
    tasks: backup.data.tasks.length,
    goals: backup.data.goals.length,
    goalMilestones: backup.data.goalMilestones.length,
    brainDumps: backup.data.brainDumps.length,
    taskTemplates: backup.data.taskTemplates.length,
    recurringRules:
      backup.data.recurringRules.length,
    recurringExceptions:
      backup.data.recurringExceptions.length,
    planningCycles: backup.data.planningCycles.length,
    weeklyReviews: backup.data.weeklyReviews.length,
    weeklyCommitments: backup.data.weeklyCommitments.length,
    weeklyTaskDecisions: backup.data.weeklyTaskDecisions.length,
    cycleReviews: backup.data.cycleReviews.length,
    cycleGoalOutcomes: backup.data.cycleGoalOutcomes.length,
  };
}

function buildPreview(
  backup: WeekFlowBackup,
  sourceVersion: BackupPreview['sourceVersion'],
  repairs: BackupRepairs
): BackupPreview {
  return {
    sourceVersion,
    currentVersion: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    appVersion: backup.metadata.appVersion,
    dataModelVersion:
      backup.metadata.dataModelVersion,
    counts: getBackupCounts(backup),
    repairs,
  };
}

/**
 * Validates a backup and normalizes older supported versions into the current
 * in-memory format. The original source version is kept in the preview so the
 * restore screen can tell the user when an older backup will be upgraded.
 */
export function inspectWeekFlowBackup(
  value: unknown
): ParsedWeekFlowBackup {
  if (!isRecord(value)) {
    fail(
      'INVALID_FILE',
      'This file does not contain a WeekFlow backup object.'
    );
  }

  if (value.format !== BACKUP_FORMAT) {
    fail(
      'INVALID_FORMAT',
      'This is not a WeekFlow backup file.'
    );
  }

  if (!isIsoTimestamp(value.exportedAt)) {
    fail(
      'INVALID_EXPORTED_AT',
      'The backup has an invalid export timestamp.'
    );
  }

  if (!isRecord(value.data)) {
    fail(
      'MISSING_SECTION',
      'The backup is missing its data section.'
    );
  }

  const sourceVersion = value.version;
  let backup: WeekFlowBackup;

  if (sourceVersion === 1) {
    if (
      !Array.isArray(value.data.tasks) ||
      !Array.isArray(value.data.goals) ||
      !Array.isArray(value.data.brainDumps)
    ) {
      fail(
        'MISSING_SECTION',
        'The version 1 backup is missing a required list.'
      );
    }

    value.data.tasks.forEach((task, index) =>
      validateBaseTask(task, `Task ${index + 1}`)
    );
    value.data.goals.forEach((goal, index) =>
      validateGoal(goal, `Goal ${index + 1}`, false, false, false, false)
    );
    value.data.brainDumps.forEach((brainDump, index) =>
      validateBrainDump(
        brainDump,
        `Brain Dump ${index + 1}`
      )
    );

    backup = normalizeLegacyBackupV1(
      value as unknown as LegacyWeekFlowBackupV1
    );
  } else if (sourceVersion === 2) {
    const data = validateData(value.data, false, false, false, false, false, false, false, false, false, false);

    backup = normalizeLegacyBackupV2({
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt: value.exportedAt,
      data,
    });
  } else if (sourceVersion === 3) {
    validateMetadata(value.metadata);
    const data = validateData(value.data, false, false, false, false, false, false, false, false, false, false);

    backup = normalizeLegacyBackupV3({
      format: BACKUP_FORMAT,
      version: 3,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 4) {
    validateMetadata(value.metadata);
    const data = validateData(value.data, true, false, false, false, false, false, false, false, false, false);

    backup = normalizeLegacyBackupV4({
      format: BACKUP_FORMAT,
      version: 4,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 5) {
    validateMetadata(value.metadata);
    const data = validateData(value.data, true, true, false, false, false, false, false, false, false, false);

    backup = normalizeLegacyBackupV5({
      format: BACKUP_FORMAT,
      version: 5,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 6) {
    validateMetadata(value.metadata);
    const data = validateData(value.data, true, true, true, false, false, false, false, false, false, false);

    backup = normalizeLegacyBackupV6({
      format: BACKUP_FORMAT,
      version: 6,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 7) {
    validateMetadata(value.metadata);
    const data = validateData(value.data, true, true, true, true, false, true, false, false, false, false);

    backup = normalizeLegacyBackupV7({
      format: BACKUP_FORMAT,
      version: 7,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 8) {
    validateMetadata(value.metadata);
    const data = validateData(
      value.data,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false
    );

    backup = normalizeLegacyBackupV8({
      format: BACKUP_FORMAT,
      version: 8,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 9) {
    validateMetadata(value.metadata);
    const data = validateData(
      value.data,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false
    );

    backup = normalizeLegacyBackupV9({
      format: BACKUP_FORMAT,
      version: 9,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 10) {
    validateMetadata(value.metadata);
    const data = validateData(
      value.data,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false
    );

    backup = normalizeLegacyBackupV10({
      format: BACKUP_FORMAT,
      version: 10,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === 11) {
    validateMetadata(value.metadata);
    const data = validateData(
      value.data,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false
    );

    backup = normalizeLegacyBackupV11({
      format: BACKUP_FORMAT,
      version: 11,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data,
    });
  } else if (sourceVersion === BACKUP_VERSION) {
    validateMetadata(value.metadata);

    backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: value.exportedAt,
      metadata: value.metadata,
      data: validateData(
        value.data,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true
      ),
    };
  } else {
    fail(
      'UNSUPPORTED_VERSION',
      `Backup version ${String(
        sourceVersion
      )} is not supported. This copy of WeekFlow supports backup versions 1 through ${BACKUP_VERSION}.`
    );
  }

  const repairedBackup = repairOrphanedGoalLinks(backup);
  backup = repairedBackup.backup;

  validateNormalizedBackup(backup);

  return {
    backup,
    preview: buildPreview(
      backup,
      sourceVersion as BackupPreview['sourceVersion'],
      repairedBackup.repairs
    ),
  };
}

export function parseWeekFlowBackup(
  value: unknown
): WeekFlowBackup {
  return inspectWeekFlowBackup(value).backup;
}

export function inspectWeekFlowBackupJson(
  json: string
): ParsedWeekFlowBackup {
  let parsedValue: unknown;

  try {
    /* A UTF-8 byte-order mark is harmless but causes JSON.parse to fail. */
    parsedValue = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    fail(
      'INVALID_JSON',
      'The selected file does not contain valid JSON.'
    );
  }

  return inspectWeekFlowBackup(parsedValue);
}

export function parseWeekFlowBackupJson(
  json: string
): WeekFlowBackup {
  return inspectWeekFlowBackupJson(json).backup;
}
