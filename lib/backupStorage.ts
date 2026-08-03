import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import {
  BACKUP_DATA_MODEL_VERSION,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupValidationError,
  getBackupCounts,
  inspectWeekFlowBackupJson,
  parseWeekFlowBackup,
  type BackupCounts,
  type BackupPreview,
  type ExportedWeekFlowBackup,
  type PickedWeekFlowBackup,
  type WeekFlowBackup,
} from './backupValidation';
import { getBrainDumps } from './brainDumpStorage';
import { getPlanningCycles } from './cycleStorage';
import { getDb, migrateDb } from './db';
import { getGoalMilestones } from './goalMilestoneStorage';
import { getGoals } from './goalStorage';
import {
  getRecurringOccurrenceExceptions,
  getRecurringRules,
} from './recurringStorage';
import { getTasks } from './taskStorage';
import { getTaskTemplates } from './taskTemplateStorage';
import {
  getWeeklyCommitments,
  getWeeklyReviews,
  getWeeklyTaskDecisions,
} from './weeklyReviewStorage';

export type {
  BackupCounts,
  BackupPreview,
  ExportedWeekFlowBackup,
  PickedWeekFlowBackup,
  WeekFlowBackup,
} from './backupValidation';

const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;
const WEEKFLOW_APP_VERSION = '1.0.0';

export type BackupOperation =
  | 'export'
  | 'choose'
  | 'restore';

class BackupStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'BackupStorageError';
  }
}

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
    goalMilestones,
    brainDumps,
    taskTemplates,
    recurringRules,
    recurringExceptions,
    planningCycles,
    weeklyReviews,
    weeklyCommitments,
    weeklyTaskDecisions,
  ] = await Promise.all([
    getTasks(),
    getGoals(),
    getGoalMilestones(),
    getBrainDumps(),
    getTaskTemplates(),
    getRecurringRules(),
    getRecurringOccurrenceExceptions(),
    getPlanningCycles(),
    getWeeklyReviews(),
    getWeeklyCommitments(),
    getWeeklyTaskDecisions(),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    metadata: {
      appVersion: WEEKFLOW_APP_VERSION,
      dataModelVersion: BACKUP_DATA_MODEL_VERSION,
    },
    data: {
      tasks,
      goals,
      goalMilestones,
      brainDumps,
      taskTemplates,
      recurringRules,
      recurringExceptions,
      planningCycles,
      weeklyReviews,
      weeklyCommitments,
      weeklyTaskDecisions,
    },
  };
}

function buildCurrentPreview(
  backup: WeekFlowBackup
): BackupPreview {
  return {
    sourceVersion: BACKUP_VERSION,
    currentVersion: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    appVersion: backup.metadata.appVersion,
    dataModelVersion:
      backup.metadata.dataModelVersion,
    counts: getBackupCounts(backup),
    repairs: {
      orphanedGoalLinks: 0,
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
    throw new BackupStorageError(
      'SHARING_UNAVAILABLE',
      'File sharing is not available on this device. Try exporting from the web version of WeekFlow.'
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
    preview: buildCurrentPreview(backup),
  };
}

async function readPickedBackupText(
  asset: DocumentPicker.DocumentPickerAsset
) {
  if (
    typeof asset.size === 'number' &&
    asset.size > MAX_BACKUP_FILE_BYTES
  ) {
    throw new BackupStorageError(
      'FILE_TOO_LARGE',
      'The selected backup is larger than 25 MB. Choose a normal WeekFlow JSON backup file.'
    );
  }

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

  /*
   * The size check is repeated after reading because some platforms do not
   * include asset.size. Limiting text size prevents an accidental huge file
   * from being parsed into memory as though it were a WeekFlow backup.
   */
  if (fileText.length > MAX_BACKUP_FILE_BYTES) {
    throw new BackupStorageError(
      'FILE_TOO_LARGE',
      'The selected backup is larger than 25 MB. Choose a normal WeekFlow JSON backup file.'
    );
  }

  const inspected =
    inspectWeekFlowBackupJson(fileText);

  return {
    fileName: asset.name,
    backup: inspected.backup,
    preview: inspected.preview,
  };
}

type CountRow = {
  count: number;
};

async function readDatabaseCounts(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<BackupCounts> {
  const [
    tasks,
    goals,
    goalMilestones,
    brainDumps,
    taskTemplates,
    recurringRules,
    recurringExceptions,
    planningCycles,
    weeklyReviews,
    weeklyCommitments,
    weeklyTaskDecisions,
  ] = await Promise.all([
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM tasks;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM goals;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM goal_milestones;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM brain_dumps;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM task_templates;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM recurring_rules;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM recurring_occurrence_exceptions;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM planning_cycles;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM weekly_reviews;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM weekly_commitments;'
    ),
    db.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM weekly_task_decisions;'
    ),
  ]);

  return {
    tasks: tasks?.count ?? -1,
    goals: goals?.count ?? -1,
    goalMilestones: goalMilestones?.count ?? -1,
    brainDumps: brainDumps?.count ?? -1,
    taskTemplates: taskTemplates?.count ?? -1,
    recurringRules:
      recurringRules?.count ?? -1,
    recurringExceptions:
      recurringExceptions?.count ?? -1,
    planningCycles: planningCycles?.count ?? -1,
    weeklyReviews: weeklyReviews?.count ?? -1,
    weeklyCommitments: weeklyCommitments?.count ?? -1,
    weeklyTaskDecisions: weeklyTaskDecisions?.count ?? -1,
  };
}

function countsMatch(
  expected: BackupCounts,
  actual: BackupCounts
) {
  return (
    expected.tasks === actual.tasks &&
    expected.goals === actual.goals &&
    expected.goalMilestones === actual.goalMilestones &&
    expected.brainDumps === actual.brainDumps &&
    expected.taskTemplates === actual.taskTemplates &&
    expected.recurringRules === actual.recurringRules &&
    expected.recurringExceptions ===
      actual.recurringExceptions &&
    expected.planningCycles === actual.planningCycles &&
    expected.weeklyReviews === actual.weeklyReviews &&
    expected.weeklyCommitments === actual.weeklyCommitments &&
    expected.weeklyTaskDecisions === actual.weeklyTaskDecisions
  );
}

/**
 * Replaces the current database using one transaction.
 *
 * Validation happens before the transaction starts. Inside the transaction,
 * WeekFlow deletes the old rows, inserts the backup rows, and verifies every
 * table count. Any failure throws before commit, so SQLite restores the exact
 * data that was present before the restore attempt.
 */
export async function replaceWeekFlowData(
  backup: WeekFlowBackup
): Promise<BackupCounts> {
  const validatedBackup =
    parseWeekFlowBackup(backup);

  const expectedCounts =
    getBackupCounts(validatedBackup);

  await migrateDb();

  const db = await getDb();

  await db.withTransactionAsync(
    async () => {
      await db.execAsync(`
        DELETE FROM tasks;
        DELETE FROM recurring_occurrence_exceptions;
        DELETE FROM recurring_rules;
        DELETE FROM task_templates;
        DELETE FROM goal_milestones;
        DELETE FROM goals;
        DELETE FROM brain_dumps;
        DELETE FROM weekly_task_decisions;
        DELETE FROM weekly_commitments;
        DELETE FROM weekly_reviews;
        DELETE FROM planning_cycles;
      `);

      for (
        const cycle of
        validatedBackup.data.planningCycles
      ) {
        await db.runAsync(
          `
          INSERT INTO planning_cycles (
            id,
            start_date,
            end_date,
            active,
            created_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?);
          `,
          [
            cycle.id,
            cycle.startDate,
            cycle.endDate,
            cycle.active ? 1 : 0,
            cycle.createdAt,
            cycle.completedAt,
          ]
        );
      }

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
            end_date,
            reward,
            purpose,
            success_definition,
            notes,
            completion_what_helped,
            completion_hardest_part,
            completion_learned,
            completion_do_differently,
            completion_task_total,
            completion_task_completed,
            completion_milestone_total,
            completion_milestone_completed,
            completion_high_priority_completed
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          );
          `,
          [
            goal.id,
            goal.title,
            goal.completed ? 1 : 0,
            goal.createdAt,
            goal.completedAt,
            goal.startDate,
            goal.endDate,
            goal.reward,
            goal.purpose,
            goal.successDefinition,
            goal.notes,
            goal.completionWhatHelped,
            goal.completionHardestPart,
            goal.completionLearned,
            goal.completionDoDifferently,
            goal.completionTaskTotal,
            goal.completionTaskCompleted,
            goal.completionMilestoneTotal,
            goal.completionMilestoneCompleted,
            goal.completionHighPriorityCompleted,
          ]
        );
      }

      for (
        const milestone of
        validatedBackup.data.goalMilestones
      ) {
        await db.runAsync(
          `
          INSERT INTO goal_milestones (
            id,
            goal_id,
            title,
            notes,
            target_date,
            completed,
            created_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?);
          `,
          [
            milestone.id,
            milestone.goalId,
            milestone.title,
            milestone.notes,
            milestone.targetDate,
            milestone.completed ? 1 : 0,
            milestone.createdAt,
            milestone.completedAt,
          ]
        );
      }

      for (
        const template of
        validatedBackup.data.taskTemplates
      ) {
        await db.runAsync(
          `
          INSERT INTO task_templates (
            id,
            title,
            notes,
            priority,
            goal_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?);
          `,
          [
            template.id,
            template.title,
            template.notes,
            template.priority,
            template.goalId,
            template.createdAt,
            template.updatedAt,
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

      for (const review of validatedBackup.data.weeklyReviews) {
        await db.runAsync(
          `
          INSERT INTO weekly_reviews (
            id,
            week_start,
            cycle_id,
            what_went_well,
            what_caused_problems,
            what_learned,
            what_change_next_week,
            next_week_focus,
            snapshot_completed_count,
            snapshot_unfinished_count,
            snapshot_overdue_count,
            snapshot_completion_rate,
            snapshot_goals_progressed_count,
            snapshot_best_day,
            snapshot_best_day_count,
            snapshot_archived_brain_dump_count,
            snapshot_high_priority_completed_count,
            snapshot_recurring_completed_count,
            created_at,
            updated_at,
            reviewed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `,
          [
            review.id,
            review.weekStart,
            review.cycleId,
            review.whatWentWell,
            review.whatCausedProblems,
            review.whatLearned,
            review.whatChangeNextWeek,
            review.nextWeekFocus,
            review.completedCount,
            review.unfinishedCount,
            review.overdueCount,
            review.completionRate,
            review.goalsProgressedCount,
            review.bestDay,
            review.bestDayCount,
            review.archivedBrainDumpCount,
            review.highPriorityCompletedCount,
            review.recurringCompletedCount,
            review.createdAt,
            review.updatedAt,
            review.reviewedAt,
          ]
        );
      }

      for (const commitment of validatedBackup.data.weeklyCommitments) {
        await db.runAsync(
          `
          INSERT INTO weekly_commitments (
            id,
            week_start,
            cycle_id,
            task_id,
            title,
            completed,
            created_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?);
          `,
          [
            commitment.id,
            commitment.weekStart,
            commitment.cycleId,
            commitment.taskId,
            commitment.title,
            commitment.completed ? 1 : 0,
            commitment.createdAt,
            commitment.completedAt,
          ]
        );
      }

      for (const decision of validatedBackup.data.weeklyTaskDecisions) {
        await db.runAsync(
          `
          INSERT INTO weekly_task_decisions (
            id,
            week_start,
            task_id,
            task_title,
            original_due_date,
            action,
            resolved_due_date,
            recurring_rule_id,
            recurrence_occurrence_date,
            decided_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `,
          [
            decision.id,
            decision.weekStart,
            decision.taskId,
            decision.taskTitle,
            decision.originalDueDate,
            decision.action,
            decision.resolvedDueDate,
            decision.recurringRuleId,
            decision.recurrenceOccurrenceDate,
            decision.decidedAt,
          ]
        );
      }

      const restoredCounts =
        await readDatabaseCounts(db);

      if (!countsMatch(expectedCounts, restoredCounts)) {
        throw new BackupStorageError(
          'RESTORE_VERIFICATION_FAILED',
          'WeekFlow could not verify every restored record. Your existing data was left unchanged.'
        );
      }
    }
  );

  return expectedCounts;
}

/**
 * Converts low-level picker, filesystem, and SQLite errors into messages that
 * explain what the user can do next. Validation errors are already written for
 * the selected record, so their specific message is preserved.
 */
export function getBackupErrorMessage(
  error: unknown,
  operation: BackupOperation
) {
  if (
    error instanceof BackupValidationError ||
    error instanceof BackupStorageError
  ) {
    return error.message;
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : String(error);
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('database is locked') ||
    normalized.includes('database busy')
  ) {
    return (
      'WeekFlow’s database is busy. Close any other WeekFlow tabs, wait a moment, and try again.'
    );
  }

  if (
    normalized.includes('disk full') ||
    normalized.includes('no space') ||
    normalized.includes('quota')
  ) {
    return (
      'There is not enough free storage to finish this backup operation.'
    );
  }

  if (
    normalized.includes('permission') ||
    normalized.includes('denied')
  ) {
    return (
      'WeekFlow does not have permission to access that file. Choose another location or file and try again.'
    );
  }

  if (
    normalized.includes('constraint') ||
    normalized.includes('trigger')
  ) {
    return (
      'The backup contains records that conflict with WeekFlow’s data rules. Your existing data was left unchanged.'
    );
  }

  if (operation === 'export') {
    return 'WeekFlow could not create the backup file. Your data was not changed.';
  }

  if (operation === 'choose') {
    return 'WeekFlow could not read that backup file. Choose a WeekFlow JSON backup and try again.';
  }

  return 'WeekFlow could not restore that backup. Your existing data was left unchanged.';
}
