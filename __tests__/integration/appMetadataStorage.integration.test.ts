import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

describe('app metadata storage integration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('stores completion celebration preferences separately from backup activity', async () => {
    const {
      getCompletionCelebrationsEnabled,
      setCompletionCelebrationsEnabled,
    } = await import('../../lib/appMetadataStorage');

    await expect(getCompletionCelebrationsEnabled()).resolves.toBe(true);

    await setCompletionCelebrationsEnabled(false);
    await expect(getCompletionCelebrationsEnabled()).resolves.toBe(false);

    await setCompletionCelebrationsEnabled(true);
    await expect(getCompletionCelebrationsEnabled()).resolves.toBe(true);
  });

  test('records and updates successful backup activity for this device', async () => {
    const {
      getBackupActivity,
      recordBackupExport,
      recordBackupImport,
    } = await import('../../lib/appMetadataStorage');

    await expect(getBackupActivity()).resolves.toEqual({
      lastExportAt: null,
      lastExportFileName: null,
      lastImportAt: null,
      lastImportFileName: null,
    });

    await recordBackupExport(
      'weekflow-backup-first.json',
      '2026-07-22T20:00:00.000Z'
    );
    await recordBackupImport(
      'phone-backup.json',
      '2026-07-23T15:00:00.000Z'
    );

    await expect(getBackupActivity()).resolves.toEqual({
      lastExportAt: '2026-07-22T20:00:00.000Z',
      lastExportFileName: 'weekflow-backup-first.json',
      lastImportAt: '2026-07-23T15:00:00.000Z',
      lastImportFileName: 'phone-backup.json',
    });

    await recordBackupExport(
      'weekflow-backup-latest.json',
      '2026-07-23T16:00:00.000Z'
    );

    await expect(getBackupActivity()).resolves.toEqual({
      lastExportAt: '2026-07-23T16:00:00.000Z',
      lastExportFileName: 'weekflow-backup-latest.json',
      lastImportAt: '2026-07-23T15:00:00.000Z',
      lastImportFileName: 'phone-backup.json',
    });
  });
});
