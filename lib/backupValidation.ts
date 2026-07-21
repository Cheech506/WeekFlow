import type { StoredBrainDump } from './brainDumpStorage';
import {
  DAY_NAMES,
  parseLocalDateKey,
} from './dateUtils';
import type { StoredGoal } from './goalStorage';
import { RECURRENCE_FREQUENCIES } from './recurrenceUtils';
import type {
  RecurringOccurrenceException,
  RecurringRule,
} from './recurringStorage';
import type { Task } from './taskStorage';
import type { TaskTemplate } from './taskTemplateStorage';

export const BACKUP_FORMAT = 'weekflow-backup';
export const BACKUP_VERSION = 4;
export const BACKUP_DATA_MODEL_VERSION = 1;

export type BackupCounts = {
  tasks: number;
  goals: number;
  brainDumps: number;
  taskTemplates: number;
  recurringRules: number;
  recurringExceptions: number;
};

export type BackupMetadata = {
  appVersion: string;
  dataModelVersion: typeof BACKUP_DATA_MODEL_VERSION;
};

type LegacyTask = Omit<
  Task,
  'recurringRuleId' | 'recurrenceOccurrenceDate'
>;

type LegacyWeekFlowBackupV1 = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  data: {
    tasks: LegacyTask[];
    goals: StoredGoal[];
    brainDumps: StoredBrainDump[];
  };
};

type LegacyBackupDataWithoutTemplates = Omit<
  WeekFlowBackup['data'],
  'taskTemplates'
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

export type WeekFlowBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  metadata: BackupMetadata;
  data: {
    tasks: Task[];
    goals: StoredGoal[];
    brainDumps: StoredBrainDump[];
    taskTemplates: TaskTemplate[];
    recurringRules: RecurringRule[];
    recurringExceptions: RecurringOccurrenceException[];
  };
};

export type BackupPreview = {
  sourceVersion: 1 | 2 | 3 | typeof BACKUP_VERSION;
  currentVersion: typeof BACKUP_VERSION;
  exportedAt: string;
  appVersion: string;
  dataModelVersion: number;
  counts: BackupCounts;
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
  label: string
): asserts value is StoredGoal {
  if (!isRecord(value)) {
    fail('INVALID_GOAL', `${label} is not an object.`);
  }

  if (!isPositiveInteger(value.id)) {
    fail('INVALID_GOAL', `${label} has an invalid ID.`);
  }

  if (
    typeof value.title !== 'string' ||
    value.title.trim().length === 0
  ) {
    fail('INVALID_GOAL', `${label} has an empty title.`);
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
}

function validateData(
  value: Record<string, unknown>,
  requireTaskTemplates: boolean = true
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

  const tasks = value.tasks as unknown[];
  const goals = value.goals as unknown[];
  const brainDumps = value.brainDumps as unknown[];
  const taskTemplates = Array.isArray(value.taskTemplates)
    ? (value.taskTemplates as unknown[])
    : [];
  const recurringRules = value.recurringRules as unknown[];
  const recurringExceptions =
    value.recurringExceptions as unknown[];

  tasks.forEach((task, index) =>
    validateTask(task, `Task ${index + 1}`)
  );

  goals.forEach((goal, index) =>
    validateGoal(goal, `Goal ${index + 1}`)
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

  return {
    tasks: tasks as Task[],
    goals: goals as StoredGoal[],
    brainDumps: brainDumps as StoredBrainDump[],
    taskTemplates: taskTemplates as TaskTemplate[],
    recurringRules: recurringRules as RecurringRule[],
    recurringExceptions:
      recurringExceptions as RecurringOccurrenceException[],
  };
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
      goals: backup.data.goals,
      brainDumps: backup.data.brainDumps,
      taskTemplates: [],
      recurringRules: [],
      recurringExceptions: [],
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
      taskTemplates: [],
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
      taskTemplates: [],
    },
  };
}

function validateNormalizedBackup(
  backup: WeekFlowBackup
) {
  assertUniqueIds(backup.data.tasks, 'task');
  assertUniqueIds(backup.data.goals, 'goal');
  assertUniqueIds(backup.data.brainDumps, 'Brain Dump');
  assertUniqueIds(
    backup.data.taskTemplates,
    'task template'
  );
  assertUniqueIds(
    backup.data.recurringRules,
    'recurring schedule'
  );

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
    brainDumps: backup.data.brainDumps.length,
    taskTemplates: backup.data.taskTemplates.length,
    recurringRules:
      backup.data.recurringRules.length,
    recurringExceptions:
      backup.data.recurringExceptions.length,
  };
}

function buildPreview(
  backup: WeekFlowBackup,
  sourceVersion: BackupPreview['sourceVersion']
): BackupPreview {
  return {
    sourceVersion,
    currentVersion: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    appVersion: backup.metadata.appVersion,
    dataModelVersion:
      backup.metadata.dataModelVersion,
    counts: getBackupCounts(backup),
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
      validateGoal(goal, `Goal ${index + 1}`)
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
    const data = validateData(value.data, false);

    backup = normalizeLegacyBackupV2({
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt: value.exportedAt,
      data,
    });
  } else if (sourceVersion === 3) {
    validateMetadata(value.metadata);
    const data = validateData(value.data, false);

    backup = normalizeLegacyBackupV3({
      format: BACKUP_FORMAT,
      version: 3,
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
      data: validateData(value.data),
    };
  } else {
    fail(
      'UNSUPPORTED_VERSION',
      `Backup version ${String(
        sourceVersion
      )} is not supported. This copy of WeekFlow supports backup versions 1 through ${BACKUP_VERSION}.`
    );
  }

  validateNormalizedBackup(backup);

  return {
    backup,
    preview: buildPreview(
      backup,
      sourceVersion as BackupPreview['sourceVersion']
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
