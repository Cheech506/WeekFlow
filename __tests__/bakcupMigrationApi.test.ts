import {
    importBackupMigration,
    type BackupImportCounts,
    type BackupImportResult,
} from '../lib/backupMigrationApi';
import type { WeekFlowBackup } from '../lib/backupValidation';
import { makeTask } from './testFactories';

function makeEmptyCounts(): BackupImportCounts {
  return {
    tasks: 0,
    goals: 0,
    goal_milestones: 0,
    brain_dumps: 0,
    task_templates: 0,
    recurring_rules: 0,
    recurring_exceptions: 0,
    planning_cycles: 0,
    weekly_reviews: 0,
    weekly_commitments: 0,
    weekly_task_decisions: 0,
    cycle_reviews: 0,
    cycle_goal_outcomes: 0,
  };
}

function makeBackup(): WeekFlowBackup {
  return {
    format: 'weekflow-backup',
    version: 12,
    exportedAt: '2026-09-26T12:00:00.000Z',
    metadata: {
      appVersion: '1.0.0',
      dataModelVersion: 1,
    },
    data: {
      tasks: [
        makeTask({
          id: 101,
          title: 'Already imported task',
        }),
      ],
      goals: [],
      goalMilestones: [],
      brainDumps: [],
      taskTemplates: [],
      recurringRules: [],
      recurringExceptions: [],
      planningCycles: [],
      weeklyReviews: [],
      weeklyCommitments: [],
      weeklyTaskDecisions: [],
      cycleReviews: [],
      cycleGoalOutcomes: [],
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('sends the complete backup to the import endpoint', async () => {
  const backup = makeBackup();

  const alreadyImportedCounts = {
    ...makeEmptyCounts(),
    tasks: 1,
  };

  const result: BackupImportResult = {
    format: 'weekflow-backup',
    version: 12,
    exported_at: '2026-09-26T12:00:00.000Z',
    app_version: '1.0.0',
    data_model_version: 1,
    total_records: 1,
    created_count: 0,
    already_imported_count: 1,
    created_counts: makeEmptyCounts(),
    already_imported_counts: alreadyImportedCounts,
    validation_passed: true,
    import_completed: true,
    database_changed: false,
  };

  const fetchMock = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => result,
    } as Response);

  await expect(
    importBackupMigration(
      'http://127.0.0.1:8000/',
      backup
    )
  ).resolves.toEqual(result);

  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/api/v1/backups/import',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backup),
    }
  );
});

test('reports an unsuccessful import response', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        detail: 'Backup import conflict',
      }),
    } as Response);

  await expect(
    importBackupMigration(
      'http://127.0.0.1:8000',
      makeBackup()
    )
  ).rejects.toThrow(
    'Backup migration import returned 409'
  );
});

test('rejects an invalid successful response', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        import_completed: false,
      }),
    } as Response);

  await expect(
    importBackupMigration(
      'http://127.0.0.1:8000',
      makeBackup()
    )
  ).rejects.toThrow(
    'Backup migration import returned an invalid response'
  );
});