import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import {
  getBrainDumps,
  type StoredBrainDump,
} from './brainDumpStorage';
import { getDb, migrateDb } from './db';
import { getGoals, type StoredGoal } from './goalStorage';
import {
  getRecurringOccurrenceExceptions,
  getRecurringRules,
  RECURRENCE_FREQUENCIES,
  type RecurringOccurrenceException,
  type RecurringRule,
} from './recurringStorage';
import { getTasks, type Task } from './taskStorage';

const BACKUP_FORMAT = 'weekflow-backup';
const BACKUP_VERSION = 2;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isNullableInteger(value: unknown) {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value))
  );
}

function isBaseTask(value: unknown): value is LegacyTask {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
    typeof value.day === 'string' &&
    isNullableString(value.dueDate) &&
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

  /*
   * isBaseTask validates every field shared by version 1 and
   * version 2 tasks. Read through a generic record here because
   * version 1 tasks did not contain the recurring-task fields.
   */
  const record = value as Record<string, unknown>;

  const recurringRuleId = record.recurringRuleId;
  const occurrenceDate = record.recurrenceOccurrenceDate;

  const isNormalTask =
    recurringRuleId === null &&
    occurrenceDate === null;

  const isRecurringTask =
    typeof recurringRuleId === 'number' &&
    Number.isInteger(recurringRuleId) &&
    typeof occurrenceDate === 'string';

  return isNormalTask || isRecurringTask;
}

function isGoal(value: unknown): value is StoredGoal {
  if (!isRecord(value)) return false;

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

function isBrainDump(value: unknown): value is StoredBrainDump {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.body === 'string' &&
    typeof value.archived === 'boolean' &&
    typeof value.createdAt === 'string' &&
    isNullableString(value.archivedAt)
  );
}

function isRecurringRule(value: unknown): value is RecurringRule {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    typeof value.title === 'string' &&
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
    typeof value.startDate === 'string' &&
    isNullableString(value.endDate) &&
    Array.isArray(value.weekdays) &&
    value.weekdays.every(
      (weekday) =>
        typeof weekday === 'number' &&
        Number.isInteger(weekday) &&
        weekday >= 0 &&
        weekday <= 6
    ) &&
    typeof value.active === 'boolean' &&
    typeof value.createdAt === 'string'
  );
}

function isRecurringException(
  value: unknown
): value is RecurringOccurrenceException {
  if (!isRecord(value)) return false;

  return (
    typeof value.recurringRuleId === 'number' &&
    Number.isInteger(value.recurringRuleId) &&
    typeof value.occurrenceDate === 'string' &&
    typeof value.createdAt === 'string'
  );
}

function hasUniqueIds(items: { id: number }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function validateRelationships(backup: WeekFlowBackup) {
  const goalIds = new Set(
    backup.data.goals.map((goal) => goal.id)
  );
  const ruleIds = new Set(
    backup.data.recurringRules.map((rule) => rule.id)
  );

  const brokenTaskGoal = backup.data.tasks.some(
    (task) =>
      task.goalId !== null && !goalIds.has(task.goalId)
  );

  const brokenRuleGoal = backup.data.recurringRules.some(
    (rule) =>
      rule.goalId !== null && !goalIds.has(rule.goalId)
  );

  const brokenTaskRule = backup.data.tasks.some(
    (task) =>
      task.recurringRuleId !== null &&
      !ruleIds.has(task.recurringRuleId)
  );

  const brokenException = backup.data.recurringExceptions.some(
    (exception) => !ruleIds.has(exception.recurringRuleId)
  );

  if (
    brokenTaskGoal ||
    brokenRuleGoal ||
    brokenTaskRule ||
    brokenException
  ) {
    throw new Error(
      'The backup contains a broken task, goal, or recurring-rule link.'
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

function parseWeekFlowBackup(value: unknown): WeekFlowBackup {
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

    const normalized = normalizeLegacyBackup(
      value as unknown as LegacyWeekFlowBackup
    );

    validateRelationships(normalized);
    return normalized;
  }

  if (
    value.version !== BACKUP_VERSION ||
    !Array.isArray(value.data.recurringRules) ||
    !Array.isArray(value.data.recurringExceptions)
  ) {
    throw new Error(
      'This WeekFlow backup version is not supported.'
    );
  }

  const tasks = value.data.tasks;
  const goals = value.data.goals;
  const brainDumps = value.data.brainDumps;
  const rules = value.data.recurringRules;
  const exceptions = value.data.recurringExceptions;

  if (!tasks.every(isTask)) {
    throw new Error('The backup contains an invalid task.');
  }

  if (!goals.every(isGoal)) {
    throw new Error('The backup contains an invalid goal.');
  }

  if (!brainDumps.every(isBrainDump)) {
    throw new Error(
      'The backup contains an invalid brain dump.'
    );
  }

  if (!rules.every(isRecurringRule)) {
    throw new Error(
      'The backup contains an invalid recurring rule.'
    );
  }

  if (!exceptions.every(isRecurringException)) {
    throw new Error(
      'The backup contains an invalid recurring exception.'
    );
  }

  if (
    !hasUniqueIds(tasks) ||
    !hasUniqueIds(goals) ||
    !hasUniqueIds(brainDumps) ||
    !hasUniqueIds(rules)
  ) {
    throw new Error(
      'The backup contains duplicate record IDs.'
    );
  }

  const backup = value as unknown as WeekFlowBackup;
  validateRelationships(backup);
  return backup;
}

function getBackupCounts(
  backup: WeekFlowBackup
): BackupCounts {
  return {
    tasks: backup.data.tasks.length,
    goals: backup.data.goals.length,
    brainDumps: backup.data.brainDumps.length,
    recurringRules: backup.data.recurringRules.length,
  };
}

function createBackupFileName(exportedAt: string) {
  const safeTimestamp = exportedAt
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z');

  return `weekflow-backup-${safeTimestamp}.json`;
}

async function buildWeekFlowBackup(): Promise<WeekFlowBackup> {
  const [
    tasks,
    goals,
    brainDumps,
    recurringRules,
    recurringExceptions,
  ] = await Promise.all([
    getTasks(),
    getGoals(),
    getBrainDumps(),
    getRecurringRules(),
    getRecurringOccurrenceExceptions(),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      tasks,
      goals,
      brainDumps,
      recurringRules,
      recurringExceptions,
    },
  };
}

function downloadBackupOnWeb(
  json: string,
  fileName: string
) {
  const blob = new Blob([json], {
    type: 'application/json',
  });

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

async function shareBackupOnNative(
  json: string,
  fileName: string
) {
  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);

  const backupFile = new File(Paths.cache, fileName);
  backupFile.create({ overwrite: true });
  backupFile.write(json);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(
      'File sharing is not available on this device.'
    );
  }

  await Sharing.shareAsync(backupFile.uri, {
    dialogTitle: 'Export WeekFlow Backup',
    mimeType: 'application/json',
    UTI: 'public.json',
  });
}

export async function exportWeekFlowBackup(): Promise<ExportedWeekFlowBackup> {
  const backup = await buildWeekFlowBackup();
  const fileName = createBackupFileName(backup.exportedAt);
  const json = JSON.stringify(backup, null, 2);

  if (Platform.OS === 'web') {
    downloadBackupOnWeb(json, fileName);
  } else {
    await shareBackupOnNative(json, fileName);
  }

  return {
    fileName,
    counts: getBackupCounts(backup),
  };
}

async function readPickedBackupText(
  asset: DocumentPicker.DocumentPickerAsset
) {
  if (Platform.OS === 'web' && asset.file) {
    return asset.file.text();
  }

  const { File } = await import('expo-file-system');
  return new File(asset.uri).text();
}

export async function pickWeekFlowBackup(): Promise<PickedWeekFlowBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  const fileText = await readPickedBackupText(asset);

  let parsed: unknown;

  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new Error(
      'The selected file does not contain valid JSON.'
    );
  }

  const backup = parseWeekFlowBackup(parsed);

  return {
    fileName: asset.name,
    backup,
    counts: getBackupCounts(backup),
  };
}

export async function replaceWeekFlowData(
  backup: WeekFlowBackup
): Promise<BackupCounts> {
  const validated = parseWeekFlowBackup(backup);

  await migrateDb();
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM tasks;
      DELETE FROM recurring_occurrence_exceptions;
      DELETE FROM recurring_rules;
      DELETE FROM goals;
      DELETE FROM brain_dumps;
    `);

    for (const goal of validated.data.goals) {
      await db.runAsync(
        `
        INSERT INTO goals (
          id, title, completed, created_at, completed_at,
          start_date, end_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?);
        `,
        [
          goal.id,
          goal.title,
          goal.completed ? 1 : 0,
          goal.createdAt,
          goal.completedAt,
          goal.startDate,
          goal.endDate,
        ]
      );
    }

    for (const rule of validated.data.recurringRules) {
      await db.runAsync(
        `
        INSERT INTO recurring_rules (
          id, title, notes, priority, goal_id, frequency,
          start_date, end_date, weekdays, active, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        [
          rule.id,
          rule.title,
          rule.notes,
          rule.priority,
          rule.goalId,
          rule.frequency,
          rule.startDate,
          rule.endDate,
          JSON.stringify(rule.weekdays),
          rule.active ? 1 : 0,
          rule.createdAt,
        ]
      );
    }

    for (const task of validated.data.tasks) {
      await db.runAsync(
        `
        INSERT INTO tasks (
          id, title, day, due_date, notes, priority, goal_id,
          completed, created_at, completed_at, recurring_rule_id,
          recurrence_occurrence_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        [
          task.id,
          task.title,
          task.day,
          task.dueDate,
          task.notes,
          task.priority,
          task.goalId,
          task.completed ? 1 : 0,
          task.createdAt,
          task.completedAt,
          task.recurringRuleId,
          task.recurrenceOccurrenceDate,
        ]
      );
    }

    for (const exception of validated.data.recurringExceptions) {
      await db.runAsync(
        `
        INSERT INTO recurring_occurrence_exceptions (
          recurring_rule_id, occurrence_date, created_at
        )
        VALUES (?, ?, ?);
        `,
        [
          exception.recurringRuleId,
          exception.occurrenceDate,
          exception.createdAt,
        ]
      );
    }

    for (const brainDump of validated.data.brainDumps) {
      await db.runAsync(
        `
        INSERT INTO brain_dumps (
          id, body, archived, created_at, archived_at
        )
        VALUES (?, ?, ?, ?, ?);
        `,
        [
          brainDump.id,
          brainDump.body,
          brainDump.archived ? 1 : 0,
          brainDump.createdAt,
          brainDump.archivedAt,
        ]
      );
    }
  });

  return getBackupCounts(validated);
}
