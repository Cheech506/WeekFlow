import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  getBackupCounts,
  parseWeekFlowBackup,
  parseWeekFlowBackupJson,
  type BackupCounts,
  type ExportedWeekFlowBackup,
  type PickedWeekFlowBackup,
  type WeekFlowBackup,
} from './backupValidation';
import { getBrainDumps } from './brainDumpStorage';
import { getDb, migrateDb } from './db';
import { getGoals } from './goalStorage';
import {
  getRecurringOccurrenceExceptions,
  getRecurringRules,
} from './recurringStorage';
import { getTasks } from './taskStorage';

export type {
  BackupCounts,
  ExportedWeekFlowBackup,
  PickedWeekFlowBackup,
  WeekFlowBackup,
} from './backupValidation';

function createBackupFileName(
  exportedAt: string
) {
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
  const [{ File, Paths }, Sharing] =
    await Promise.all([
      import('expo-file-system'),
      import('expo-sharing'),
    ]);

  const backupFile = new File(
    Paths.cache,
    fileName
  );

  backupFile.create({
    overwrite: true,
  });

  backupFile.write(json);

  const sharingAvailable =
    await Sharing.isAvailableAsync();

  if (!sharingAvailable) {
    throw new Error(
      'File sharing is not available on this device.'
    );
  }

  await Sharing.shareAsync(
    backupFile.uri,
    {
      dialogTitle:
        'Export WeekFlow Backup',
      mimeType: 'application/json',
      UTI: 'public.json',
    }
  );
}

export async function exportWeekFlowBackup(): Promise<ExportedWeekFlowBackup> {
  const backup =
    await buildWeekFlowBackup();

  const fileName =
    createBackupFileName(
      backup.exportedAt
    );

  const json = JSON.stringify(
    backup,
    null,
    2
  );

  if (Platform.OS === 'web') {
    downloadBackupOnWeb(
      json,
      fileName
    );
  } else {
    await shareBackupOnNative(
      json,
      fileName
    );
  }

  return {
    fileName,
    counts: getBackupCounts(backup),
  };
}

async function readPickedBackupText(
  asset: DocumentPicker.DocumentPickerAsset
) {
  if (
    Platform.OS === 'web' &&
    asset.file
  ) {
    return asset.file.text();
  }

  const { File } =
    await import('expo-file-system');

  const pickedFile =
    new File(asset.uri);

  return pickedFile.text();
}

export async function pickWeekFlowBackup(): Promise<PickedWeekFlowBackup | null> {
  const result =
    await DocumentPicker.getDocumentAsync({
      type: [
        'application/json',
        'text/json',
        'text/plain',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];

  const fileText =
    await readPickedBackupText(asset);

  const backup =
    parseWeekFlowBackupJson(fileText);

  return {
    fileName: asset.name,
    backup,
    counts:
      getBackupCounts(backup),
  };
}

/**
 * Replaces the current database using one transaction.
 *
 * If an insert fails, SQLite rolls back the transaction instead
 * of leaving the database partially imported.
 */
export async function replaceWeekFlowData(
  backup: WeekFlowBackup
): Promise<BackupCounts> {
  const validatedBackup =
    parseWeekFlowBackup(backup);

  await migrateDb();

  const db = await getDb();

  await db.withTransactionAsync(
    async () => {
      await db.execAsync(`
        DELETE FROM tasks;
        DELETE FROM recurring_occurrence_exceptions;
        DELETE FROM recurring_rules;
        DELETE FROM goals;
        DELETE FROM brain_dumps;
      `);

      for (
        const goal of
        validatedBackup.data.goals
      ) {
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

      for (
        const rule of
        validatedBackup.data.recurringRules
      ) {
        await db.runAsync(
          `
          INSERT INTO recurring_rules (
            id,
            title,
            notes,
            priority,
            goal_id,
            frequency,
            start_date,
            end_date,
            weekdays,
            active,
            created_at
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
            JSON.stringify(
              rule.weekdays
            ),
            rule.active ? 1 : 0,
            rule.createdAt,
          ]
        );
      }

      for (
        const task of
        validatedBackup.data.tasks
      ) {
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
            completed_at,
            recurring_rule_id,
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

      for (
        const exception of
        validatedBackup.data
          .recurringExceptions
      ) {
        await db.runAsync(
          `
          INSERT INTO recurring_occurrence_exceptions (
            recurring_rule_id,
            occurrence_date,
            created_at
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

      for (
        const brainDump of
        validatedBackup.data.brainDumps
      ) {
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
            brainDump.archived
              ? 1
              : 0,
            brainDump.createdAt,
            brainDump.archivedAt,
          ]
        );
      }
    }
  );

  return getBackupCounts(
    validatedBackup
  );
}
