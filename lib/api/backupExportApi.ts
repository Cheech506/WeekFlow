/** Request a complete JSON backup of the current PostgreSQL data. */

import {
    BACKUP_FORMAT,
    BACKUP_VERSION,
    inspectWeekFlowBackup,
    type WeekFlowBackup,
} from '../backupValidation';
import { apiRequest, type ApiRequestOptions } from './apiClient';

export type BackupExportApiOptions = Pick<
  ApiRequestOptions,
  'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;

function decodeExport(value: unknown): WeekFlowBackup {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    !('format' in value) || value.format !== BACKUP_FORMAT ||
    !('version' in value) || value.version !== BACKUP_VERSION
  ) {
    throw new Error('The server did not return a current WeekFlow JSON backup.');
  }

  const inspected = inspectWeekFlowBackup(value);
  // Legacy file imports may repair orphaned goal links. A new server export
  // must already be complete, so reject repairs instead of saving a changed file.
  if (inspected.preview.repairs.orphanedGoalLinks !== 0) {
    throw new Error('The server backup contains missing goal links. No backup file was saved.');
  }
  return inspected.backup;
}

/**
 * Make one export request using EXPO_PUBLIC_API_BASE_URL by default.
 *
 * PostgreSQL supplies all thirteen collections in one snapshot. This does not
 * export cached context arrays or SQLite. The server may assign missing backup
 * identity metadata while preserving PostgreSQL IDs, content, and timestamps.
 *
 * This function returns validated data. The Settings export handler downloads
 * it on web or opens the native share sheet. Nothing is retried automatically.
 */
export async function exportApiBackup(
  options: BackupExportApiOptions = {}
): Promise<WeekFlowBackup> {
  return apiRequest('/api/v1/backups/export', decodeExport, {
    timeoutMs: 120_000,
    ...options,
    method: 'POST',
  });
}
