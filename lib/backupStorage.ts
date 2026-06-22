import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { getBrainDumps, type StoredBrainDump } from './brainDumpStorage';
import { getDb, migrateDb } from './db';
import { getGoals, type StoredGoal } from './goalStorage';
import { getTasks, type Task } from './taskStorage';

const BACKUP_FORMAT = 'weekflow-backup';
const BACKUP_VERSION = 1;

export type WeekFlowBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: {
    tasks: Task[];
    goals: StoredGoal[];
    brainDumps: StoredBrainDump[];
  };
};

export type BackupCounts = {
  tasks: number;
  goals: number;
  brainDumps: number;
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isTask(value: unknown): value is Task {
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
    (value.goalId === null ||
      (typeof value.goalId === 'number' && Number.isInteger(value.goalId))) &&
    typeof value.completed === 'boolean' &&
    typeof value.createdAt === 'string' &&
    isNullableString(value.completedAt)
  );
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

function hasUniqueIds(items: { id: number }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/**
 * Validates the whole backup before any rows are deleted.
 *
 * Import is intentionally strict because this first version replaces
 * the current database. A malformed or partially valid file is rejected.
 */
function parseWeekFlowBackup(value: unknown): WeekFlowBackup {
  if (
    !isRecord(value) ||
    value.format !== BACKUP_FORMAT ||
    value.version !== BACKUP_VERSION ||
    typeof value.exportedAt !== 'string' ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.tasks) ||
    !Array.isArray(value.data.goals) ||
    !Array.isArray(value.data.brainDumps)
  ) {
    throw new Error('This is not a supported WeekFlow backup file.');
  }

  const tasks = value.data.tasks;
  const goals = value.data.goals;
  const brainDumps = value.data.brainDumps;

  if (!tasks.every(isTask)) {
    throw new Error('The backup contains an invalid task record.');
  }

  if (!goals.every(isGoal)) {
    throw new Error('The backup contains an invalid goal record.');
  }

  if (!brainDumps.every(isBrainDump)) {
    throw new Error('The backup contains an invalid brain dump record.');
  }

  if (
    !hasUniqueIds(tasks) ||
    !hasUniqueIds(goals) ||
    !hasUniqueIds(brainDumps)
  ) {
    throw new Error('The backup contains duplicate record IDs.');
  }

  const goalIds = new Set(goals.map((goal) => goal.id));
  const hasBrokenGoalLink = tasks.some(
    (task) => task.goalId !== null && !goalIds.has(task.goalId)
  );

  if (hasBrokenGoalLink) {
    throw new Error('The backup contains a task linked to a missing goal.');
  }

  return value as WeekFlowBackup;
}

function getBackupCounts(backup: WeekFlowBackup): BackupCounts {
  return {
    tasks: backup.data.tasks.length,
    goals: backup.data.goals.length,
    brainDumps: backup.data.brainDumps.length,
  };
}

function createBackupFileName(exportedAt: string) {
  const safeTimestamp = exportedAt
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z');

  return `weekflow-backup-${safeTimestamp}.json`;
}

async function buildWeekFlowBackup(): Promise<WeekFlowBackup> {
  const [tasks, goals, brainDumps] = await Promise.all([
    getTasks(),
    getGoals(),
    getBrainDumps(),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      tasks,
      goals,
      brainDumps,
    },
  };
}

function downloadBackupOnWeb(json: string, fileName: string) {
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

async function shareBackupOnNative(json: string, fileName: string) {
  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);

  const backupFile = new File(Paths.cache, fileName);

  /*
   * The cache may already contain a backup with this exact name
   * during repeated testing, so overwrite is enabled.
   */
  backupFile.create({ overwrite: true });
  backupFile.write(json);

  const sharingAvailable = await Sharing.isAvailableAsync();

  if (!sharingAvailable) {
    throw new Error('File sharing is not available on this device.');
  }

  await Sharing.shareAsync(backupFile.uri, {
    dialogTitle: 'Export WeekFlow Backup',
    mimeType: 'application/json',
    UTI: 'public.json',
  });
}

/**
 * Exports all current WeekFlow data.
 *
 * Web downloads a JSON file directly. Native platforms create a
 * temporary JSON file and open the system share sheet.
 */
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
  /*
   * On web, DocumentPicker provides the browser File object.
   * Native uses expo-file-system to read the cached picked file.
   */
  if (Platform.OS === 'web' && asset.file) {
    return asset.file.text();
  }

  const { File } = await import('expo-file-system');
  const pickedFile = new File(asset.uri);

  return pickedFile.text();
}

/**
 * Opens the system file picker and validates the chosen backup.
 *
 * No database changes happen here. The UI can display the record
 * counts and ask for confirmation before calling replaceWeekFlowData.
 */
export async function pickWeekFlowBackup(): Promise<PickedWeekFlowBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];
  const fileText = await readPickedBackupText(asset);

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(fileText);
  } catch {
    throw new Error('The selected file does not contain valid JSON.');
  }

  const backup = parseWeekFlowBackup(parsedValue);

  return {
    fileName: asset.name,
    backup,
    counts: getBackupCounts(backup),
  };
}

/**
 * Replaces the current SQLite data with a previously validated backup.
 *
 * The delete and insert statements run in one transaction. If any insert
 * fails, SQLite rolls the transaction back instead of leaving a partial
 * import behind.
 */
export async function replaceWeekFlowData(
  backup: WeekFlowBackup
): Promise<BackupCounts> {
  const validatedBackup = parseWeekFlowBackup(backup);

  await migrateDb();

  const db = await getDb();

  await db.withTransactionAsync(async () => {
    /*
     * Tasks are removed first because they can reference goals.
     * The current schema does not enforce a foreign key, but this
     * order also works if one is added later.
     */
    await db.execAsync(`
      DELETE FROM tasks;
      DELETE FROM goals;
      DELETE FROM brain_dumps;
    `);

    for (const goal of validatedBackup.data.goals) {
      await db.runAsync(
        `
        INSERT INTO goals (
          id,
          title,
          completed,
          created_at,
          completed_at,
          start_date,
          end_date
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

    for (const task of validatedBackup.data.tasks) {
      await db.runAsync(
        `
        INSERT INTO tasks (
          id,
          title,
          day,
          due_date,
          notes,
          priority,
          goal_id,
          completed,
          created_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
        ]
      );
    }

    for (const brainDump of validatedBackup.data.brainDumps) {
      await db.runAsync(
        `
        INSERT INTO brain_dumps (
          id,
          body,
          archived,
          created_at,
          archived_at
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

  return getBackupCounts(validatedBackup);
}
