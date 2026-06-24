import type { StoredBrainDump } from './brainDumpStorage';
import { parseLocalDateKey } from './dateUtils';
import type { StoredGoal } from './goalStorage';
import { RECURRENCE_FREQUENCIES } from './recurrenceUtils';
import type {
  RecurringOccurrenceException,
  RecurringRule,
} from './recurringStorage';
import type { Task } from './taskStorage';

export const BACKUP_FORMAT = 'weekflow-backup';
export const BACKUP_VERSION = 2;

type LegacyTask = Omit<
  Task,
  'recurringRuleId' | 'recurrenceOccurrenceDate'
>;

type LegacyWeekFlowBackup = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  data: {
    tasks: LegacyTask[];
    goals: StoredGoal[];
    brainDumps: StoredBrainDump[];
  };
};

export type WeekFlowBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: {
    tasks: Task[];
    goals: StoredGoal[];
    brainDumps: StoredBrainDump[];
    recurringRules: RecurringRule[];
    recurringExceptions: RecurringOccurrenceException[];
  };
};

export type BackupCounts = {
  tasks: number;
  goals: number;
  brainDumps: number;
  recurringRules: number;
};

export type PickedWeekFlowBackup = {
  fileName: string;
  backup: WeekFlowBackup;
  counts: BackupCounts;
};

export type ExportedWeekFlowBackup = {
  fileName: string;
  counts: BackupCounts;
};

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
      Number.isInteger(value))
  );
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

function isBaseTask(value: unknown): value is LegacyTask {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
    typeof value.day === 'string' &&
    isValidNullableDateKey(value.dueDate) &&
    isNullableString(value.notes) &&
    typeof value.priority === 'number' &&
    Number.isInteger(value.priority) &&
    value.priority >= 0 &&
    value.priority <= 2 &&
    isNullableInteger(value.goalId) &&
    typeof value.completed === 'boolean' &&
    typeof value.createdAt === 'string' &&
    isNullableString(value.completedAt)
  );
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value) || !isBaseTask(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  const recurringRuleId = record.recurringRuleId;
  const occurrenceDate =
    record.recurrenceOccurrenceDate;

  const isNormalTask =
    recurringRuleId === null &&
    occurrenceDate === null;

  const isRecurringTask =
    typeof recurringRuleId === 'number' &&
    Number.isInteger(recurringRuleId) &&
    isValidDateKey(occurrenceDate);

  return isNormalTask || isRecurringTask;
}

function isGoal(value: unknown): value is StoredGoal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
    typeof value.completed === 'boolean' &&
    typeof value.createdAt === 'string' &&
    isNullableString(value.completedAt) &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string'
  );
}

function isBrainDump(
  value: unknown
): value is StoredBrainDump {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.body === 'string' &&
    typeof value.archived === 'boolean' &&
    typeof value.createdAt === 'string' &&
    isNullableString(value.archivedAt)
  );
}

function isRecurringRule(
  value: unknown
): value is RecurringRule {
  if (!isRecord(value)) {
    return false;
  }

  const startDate = isValidDateKey(value.startDate)
    ? parseLocalDateKey(value.startDate)
    : null;

  const endDate = isValidNullableDateKey(value.endDate)
    ? value.endDate
      ? parseLocalDateKey(value.endDate)
      : null
    : null;

  const hasValidDateRange =
    startDate !== null &&
    (value.endDate === null ||
      (endDate !== null && endDate >= startDate));

  const hasValidWeekdays =
    Array.isArray(value.weekdays) &&
    value.weekdays.every(
      (weekday) =>
        typeof weekday === 'number' &&
        Number.isInteger(weekday) &&
        weekday >= 0 &&
        weekday <= 6
    );

  const hasRequiredCertainDays =
    value.frequency !== 'certainDays' ||
    (Array.isArray(value.weekdays) &&
      value.weekdays.length > 0);

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    isNullableString(value.notes) &&
    typeof value.priority === 'number' &&
    Number.isInteger(value.priority) &&
    value.priority >= 0 &&
    value.priority <= 2 &&
    isNullableInteger(value.goalId) &&
    typeof value.frequency === 'string' &&
    RECURRENCE_FREQUENCIES.includes(
      value.frequency as RecurringRule['frequency']
    ) &&
    hasValidDateRange &&
    hasValidWeekdays &&
    hasRequiredCertainDays &&
    typeof value.active === 'boolean' &&
    typeof value.createdAt === 'string'
  );
}

function isRecurringException(
  value: unknown
): value is RecurringOccurrenceException {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.recurringRuleId === 'number' &&
    Number.isInteger(value.recurringRuleId) &&
    isValidDateKey(value.occurrenceDate) &&
    typeof value.createdAt === 'string'
  );
}

function hasUniqueIds(items: { id: number }[]) {
  return (
    new Set(items.map((item) => item.id)).size ===
    items.length
  );
}

function hasUniqueRecurringOccurrences(
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

  return new Set(keys).size === keys.length;
}

function hasUniqueExceptions(
  exceptions: RecurringOccurrenceException[]
) {
  const keys = exceptions.map(
    (exception) =>
      `${exception.recurringRuleId}:${exception.occurrenceDate}`
  );

  return new Set(keys).size === keys.length;
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

  if (
    backup.data.tasks.some(
      (task) =>
        task.goalId !== null &&
        !goalIds.has(task.goalId)
    )
  ) {
    throw new Error(
      'The backup contains a task linked to a missing goal.'
    );
  }

  if (
    backup.data.recurringRules.some(
      (rule) =>
        rule.goalId !== null &&
        !goalIds.has(rule.goalId)
    )
  ) {
    throw new Error(
      'The backup contains a recurring rule linked to a missing goal.'
    );
  }

  if (
    backup.data.tasks.some(
      (task) =>
        task.recurringRuleId !== null &&
        !recurringRuleIds.has(
          task.recurringRuleId
        )
    )
  ) {
    throw new Error(
      'The backup contains a task linked to a missing recurring rule.'
    );
  }

  if (
    backup.data.recurringExceptions.some(
      (exception) =>
        !recurringRuleIds.has(
          exception.recurringRuleId
        )
    )
  ) {
    throw new Error(
      'The backup contains an exception linked to a missing recurring rule.'
    );
  }
}

function normalizeLegacyBackup(
  backup: LegacyWeekFlowBackup
): WeekFlowBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    data: {
      tasks: backup.data.tasks.map((task) => ({
        ...task,
        recurringRuleId: null,
        recurrenceOccurrenceDate: null,
      })),
      goals: backup.data.goals,
      brainDumps: backup.data.brainDumps,
      recurringRules: [],
      recurringExceptions: [],
    },
  };
}

export function parseWeekFlowBackup(
  value: unknown
): WeekFlowBackup {
  if (
    !isRecord(value) ||
    value.format !== BACKUP_FORMAT ||
    typeof value.exportedAt !== 'string' ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.tasks) ||
    !Array.isArray(value.data.goals) ||
    !Array.isArray(value.data.brainDumps)
  ) {
    throw new Error(
      'This is not a supported WeekFlow backup file.'
    );
  }

  if (value.version === 1) {
    if (
      !value.data.tasks.every(isBaseTask) ||
      !value.data.goals.every(isGoal) ||
      !value.data.brainDumps.every(isBrainDump)
    ) {
      throw new Error(
        'The older backup contains an invalid record.'
      );
    }

    const normalizedBackup =
      normalizeLegacyBackup(
        value as unknown as LegacyWeekFlowBackup
      );

    validateRelationships(normalizedBackup);

    return normalizedBackup;
  }

  if (
    value.version !== BACKUP_VERSION ||
    !Array.isArray(value.data.recurringRules) ||
    !Array.isArray(
      value.data.recurringExceptions
    )
  ) {
    throw new Error(
      'This WeekFlow backup version is not supported.'
    );
  }

  const tasks = value.data.tasks;
  const goals = value.data.goals;
  const brainDumps = value.data.brainDumps;
  const recurringRules =
    value.data.recurringRules;
  const recurringExceptions =
    value.data.recurringExceptions;

  if (!tasks.every(isTask)) {
    throw new Error(
      'The backup contains an invalid task.'
    );
  }

  if (!goals.every(isGoal)) {
    throw new Error(
      'The backup contains an invalid goal.'
    );
  }

  if (!brainDumps.every(isBrainDump)) {
    throw new Error(
      'The backup contains an invalid brain dump.'
    );
  }

  if (!recurringRules.every(isRecurringRule)) {
    throw new Error(
      'The backup contains an invalid recurring rule.'
    );
  }

  if (
    !recurringExceptions.every(
      isRecurringException
    )
  ) {
    throw new Error(
      'The backup contains an invalid recurring exception.'
    );
  }

  if (
    !hasUniqueIds(tasks) ||
    !hasUniqueIds(goals) ||
    !hasUniqueIds(brainDumps) ||
    !hasUniqueIds(recurringRules)
  ) {
    throw new Error(
      'The backup contains duplicate record IDs.'
    );
  }

  if (
    !hasUniqueRecurringOccurrences(tasks)
  ) {
    throw new Error(
      'The backup contains duplicate recurring task occurrences.'
    );
  }

  if (
    !hasUniqueExceptions(recurringExceptions)
  ) {
    throw new Error(
      'The backup contains duplicate recurring exceptions.'
    );
  }

  const backup =
    value as unknown as WeekFlowBackup;

  validateRelationships(backup);

  return backup;
}

export function parseWeekFlowBackupJson(
  json: string
): WeekFlowBackup {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(json);
  } catch {
    throw new Error(
      'The selected file does not contain valid JSON.'
    );
  }

  return parseWeekFlowBackup(parsedValue);
}

export function getBackupCounts(
  backup: WeekFlowBackup
): BackupCounts {
  return {
    tasks: backup.data.tasks.length,
    goals: backup.data.goals.length,
    brainDumps:
      backup.data.brainDumps.length,
    recurringRules:
      backup.data.recurringRules.length,
  };
}
