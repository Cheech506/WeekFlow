import type { WeekFlowBackup } from './backupValidation';

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
