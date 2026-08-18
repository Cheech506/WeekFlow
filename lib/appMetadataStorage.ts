import { getDb, migrateDb } from './db';

const LAST_EXPORT_AT_KEY = 'last_backup_export_at';
const LAST_EXPORT_FILE_KEY = 'last_backup_export_file';
const LAST_IMPORT_AT_KEY = 'last_backup_import_at';
const LAST_IMPORT_FILE_KEY = 'last_backup_import_file';
const COMPLETION_CELEBRATIONS_ENABLED_KEY = 'completion_celebrations_enabled';

export type BackupActivity = {
  lastExportAt: string | null;
  lastExportFileName: string | null;
  lastImportAt: string | null;
  lastImportFileName: string | null;
};

type MetadataRow = {
  key: string;
  value: string;
};

type WeekFlowDatabase = Awaited<ReturnType<typeof getDb>>;

async function setMetadataValue(
  db: WeekFlowDatabase,
  key: string,
  value: string,
  updatedAt: string
) {
  await db.runAsync(
    `
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
    `,
    [key, value, updatedAt]
  );
}

/**
 * Device-level metadata is intentionally excluded from WeekFlow backups.
 * Importing another device's data should not overwrite this device's record of
 * when it last exported or restored a backup.
 */
export async function getBackupActivity(): Promise<BackupActivity> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<MetadataRow>(
    `
    SELECT key, value
    FROM app_metadata
    WHERE key IN (?, ?, ?, ?);
    `,
    [
      LAST_EXPORT_AT_KEY,
      LAST_EXPORT_FILE_KEY,
      LAST_IMPORT_AT_KEY,
      LAST_IMPORT_FILE_KEY,
    ]
  );

  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    lastExportAt: values.get(LAST_EXPORT_AT_KEY) ?? null,
    lastExportFileName: values.get(LAST_EXPORT_FILE_KEY) ?? null,
    lastImportAt: values.get(LAST_IMPORT_AT_KEY) ?? null,
    lastImportFileName: values.get(LAST_IMPORT_FILE_KEY) ?? null,
  };
}

export async function recordBackupExport(
  fileName: string,
  exportedAt: string = new Date().toISOString()
) {
  await migrateDb();
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    await setMetadataValue(
      db,
      LAST_EXPORT_AT_KEY,
      exportedAt,
      exportedAt
    );
    await setMetadataValue(
      db,
      LAST_EXPORT_FILE_KEY,
      fileName,
      exportedAt
    );
  });
}

export async function recordBackupImport(
  fileName: string,
  importedAt: string = new Date().toISOString()
) {
  await migrateDb();
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    await setMetadataValue(
      db,
      LAST_IMPORT_AT_KEY,
      importedAt,
      importedAt
    );
    await setMetadataValue(
      db,
      LAST_IMPORT_FILE_KEY,
      fileName,
      importedAt
    );
  });
}


/**
 * Completion feedback is a device preference, not productivity data. Keeping
 * it in app_metadata means backup restores do not unexpectedly change how a
 * specific device feels when tasks, goals, or cycles are completed.
 */
export async function getCompletionCelebrationsEnabled(): Promise<boolean> {
  await migrateDb();
  const db = await getDb();

  const row = await db.getFirstAsync<MetadataRow>(
    `
    SELECT key, value
    FROM app_metadata
    WHERE key = ?
    LIMIT 1;
    `,
    [COMPLETION_CELEBRATIONS_ENABLED_KEY]
  );

  if (!row) return true;
  if (row.value === '0') return false;
  if (row.value === '1') return true;

  // Unknown older values fall back to the safe default instead of disabling UI.
  return true;
}

export async function setCompletionCelebrationsEnabled(enabled: boolean) {
  await migrateDb();
  const db = await getDb();
  const updatedAt = new Date().toISOString();

  await setMetadataValue(
    db,
    COMPLETION_CELEBRATIONS_ENABLED_KEY,
    enabled ? '1' : '0',
    updatedAt
  );
}
