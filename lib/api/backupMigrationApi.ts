import { parseWeekFlowBackup, type WeekFlowBackup } from '../backupValidation';
import { apiRequest, type ApiRequestOptions } from './apiClient';

const BACKUP_COLLECTION_NAMES = [
  'tasks',
  'goals',
  'goal_milestones',
  'brain_dumps',
  'task_templates',
  'recurring_rules',
  'recurring_exceptions',
  'planning_cycles',
  'weekly_reviews',
  'weekly_commitments',
  'weekly_task_decisions',
  'cycle_reviews',
  'cycle_goal_outcomes',
] as const;

type BackupCollectionName =
  (typeof BACKUP_COLLECTION_NAMES)[number];

export type BackupImportCounts = Record<
  BackupCollectionName,
  number
>;

export type BackupImportResult = {
  format: 'weekflow-backup';
  version: 12;
  exported_at: string;
  app_version: string;
  data_model_version: 1;
  total_records: number;
  created_count: number;
  already_imported_count: number;
  created_counts: BackupImportCounts;
  already_imported_counts: BackupImportCounts;
  validation_passed: true;
  import_completed: true;
  database_changed: boolean;
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

function isNonNegativeInteger(
  value: unknown
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isBackupImportCounts(
  value: unknown
): value is BackupImportCounts {
  if (!isRecord(value)) {
    return false;
  }

  return BACKUP_COLLECTION_NAMES.every((name) =>
    isNonNegativeInteger(value[name])
  );
}

function isBackupImportResult(
  value: unknown
): value is BackupImportResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.format === 'weekflow-backup' &&
    value.version === 12 &&
    typeof value.exported_at === 'string' &&
    typeof value.app_version === 'string' &&
    value.data_model_version === 1 &&
    isNonNegativeInteger(value.total_records) &&
    isNonNegativeInteger(value.created_count) &&
    isNonNegativeInteger(
      value.already_imported_count
    ) &&
    isBackupImportCounts(value.created_counts) &&
    isBackupImportCounts(
      value.already_imported_counts
    ) &&
    value.validation_passed === true &&
    value.import_completed === true &&
    typeof value.database_changed === 'boolean'
  );
}

export async function importBackupMigration(
  baseUrl: string,
  backup: WeekFlowBackup
): Promise<BackupImportResult> {
  const normalizedBaseUrl =
    baseUrl.replace(/\/+$/, '');

  const response = await fetch(
    `${normalizedBaseUrl}/api/v1/backups/import`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backup),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Backup migration import returned ${response.status}`
    );
  }

  const data: unknown = await response.json();

  if (!isBackupImportResult(data)) {
    throw new Error(
      'Backup migration import returned an invalid response'
    );
  }

  return data;
}

/** Summary returned after adding and updating a complete SQLite backup. */
export type BackupRefreshResult = BackupImportResult & {
  updated_count: number;
  updated_counts: BackupImportCounts;
  refresh_completed: true;
};

function isBackupRefreshResult(
  value: unknown
): value is BackupRefreshResult {
  if (!isRecord(value)) {
    return false;
  }

  const { updated_count, updated_counts, refresh_completed } = value;

  return (
    isBackupImportResult(value) &&
    isNonNegativeInteger(updated_count) &&
    isBackupImportCounts(updated_counts) &&
    refresh_completed === true &&
    value.total_records ===
      value.created_count +
        updated_count +
        value.already_imported_count
  );
}

/**
 * Add new records and update matching records to their SQLite values.
 * PostgreSQL primary keys stay unchanged. The screen must confirm this
 * action before calling it. Records absent from the backup are retained.
 */
export async function refreshBackupMigration(
  baseUrl: string,
  backup: WeekFlowBackup
): Promise<BackupRefreshResult> {
  const normalizedBaseUrl =
    baseUrl.trim().replace(/\/+$/, '');

  const response = await fetch(
    `${normalizedBaseUrl}/api/v1/backups/import/refresh`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backup),
    }
  );

  if (!response.ok) {
    const fallback =
      `Backup migration refresh returned ${response.status}`;
    let message = fallback;

    try {
      const errorBody: unknown = await response.json();
      if (
        isRecord(errorBody) &&
        isRecord(errorBody.detail) &&
        typeof errorBody.detail.message === 'string'
      ) {
        message = `${fallback}: ${errorBody.detail.message}`;
      }
    } catch {
      // Keep the HTTP status when the server returns a non-JSON error.
    }

    throw new Error(message);
  }

  const data: unknown = await response.json();

  if (!isBackupRefreshResult(data)) {
    throw new Error(
      'Backup migration refresh returned an invalid response'
    );
  }

  return data;
}


/** Transport options for the confirmed JSON-to-PostgreSQL import flow. */
export type BackupMigrationApiOptions = Pick<
  ApiRequestOptions,
  'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;

const BACKUP_DATA_NAMES = {
  tasks: 'tasks',
  goals: 'goals',
  goal_milestones: 'goalMilestones',
  brain_dumps: 'brainDumps',
  task_templates: 'taskTemplates',
  recurring_rules: 'recurringRules',
  recurring_exceptions: 'recurringExceptions',
  planning_cycles: 'planningCycles',
  weekly_reviews: 'weeklyReviews',
  weekly_commitments: 'weeklyCommitments',
  weekly_task_decisions: 'weeklyTaskDecisions',
  cycle_reviews: 'cycleReviews',
  cycle_goal_outcomes: 'cycleGoalOutcomes',
} as const;

/**
 * Import a selected JSON backup through the configured API. The caller must
 * obtain confirmation first: matching source records are updated from the file.
 * Records absent from the file remain, and PostgreSQL primary keys are retained.
 * This never restores SQLite or automatically retries a failed/uncertain write.
 */
export async function refreshApiBackup(
  backup: WeekFlowBackup,
  options: BackupMigrationApiOptions = {}
): Promise<BackupRefreshResult> {
  // Validate before sending anything. This also normalizes supported old files.
  const validated = parseWeekFlowBackup(backup);
  const expectedCounts = Object.fromEntries(BACKUP_COLLECTION_NAMES.map(name =>
    [name, validated.data[BACKUP_DATA_NAMES[name]].length]
  )) as BackupImportCounts;
  const total = BACKUP_COLLECTION_NAMES.reduce((sum, name) => sum + expectedCounts[name], 0);
  const exportedAt = Date.parse(validated.exportedAt);
  const appVersion = validated.metadata.appVersion;

  return apiRequest('/api/v1/backups/import/refresh', value => {
    if (!isBackupRefreshResult(value)) {
      throw new Error('The backup refresh returned an invalid response.');
    }
    // An acknowledgement must account for every collection in the selected file.
    const sumCounts = (counts: BackupImportCounts) =>
      BACKUP_COLLECTION_NAMES.reduce((sum, name) => sum + counts[name], 0);
    const matches = value.total_records === total &&
      Date.parse(value.exported_at) === exportedAt &&
      value.app_version === appVersion &&
      value.created_count === sumCounts(value.created_counts) &&
      value.updated_count === sumCounts(value.updated_counts) &&
      value.already_imported_count === sumCounts(value.already_imported_counts) &&
      value.database_changed === (value.created_count + value.updated_count > 0) &&
      BACKUP_COLLECTION_NAMES.every(name =>
        value.created_counts[name] + value.updated_counts[name] +
          value.already_imported_counts[name] === expectedCounts[name]
      );
    if (!matches) {
      throw new Error('The backup refresh response does not match the selected file.');
    }
    return value;
  }, {
    timeoutMs: 120_000,
    ...options,
    method: 'POST',
    body: validated,
  });
}
