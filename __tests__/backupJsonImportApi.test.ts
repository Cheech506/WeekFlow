import { makeTask } from '@/__tests__/testFactories';
import { ApiError } from '@/lib/api/apiClient';
import { refreshApiBackup, type BackupImportCounts, type BackupRefreshResult } from '@/lib/api/backupMigrationApi';
import type { WeekFlowBackup } from '@/lib/backupValidation';

const OPTIONS = { baseUrl: 'https://weekflow.test' };
function counts(tasks = 0): BackupImportCounts {
  return { tasks, goals: 0, goal_milestones: 0, brain_dumps: 0, task_templates: 0,
    recurring_rules: 0, recurring_exceptions: 0, planning_cycles: 0,
    weekly_reviews: 0, weekly_commitments: 0, weekly_task_decisions: 0,
    cycle_reviews: 0, cycle_goal_outcomes: 0 };
}
function backup(): WeekFlowBackup {
  return { format: 'weekflow-backup', version: 12, exportedAt: '2026-10-27T12:00:00.000Z',
    metadata: { appVersion: '1.0.0', dataModelVersion: 1 }, data: {
      tasks: [makeTask({ id: 101, title: 'Imported task' })], goals: [], goalMilestones: [],
      brainDumps: [], taskTemplates: [], recurringRules: [], recurringExceptions: [],
      planningCycles: [], weeklyReviews: [], weeklyCommitments: [], weeklyTaskDecisions: [],
      cycleReviews: [], cycleGoalOutcomes: [],
    } };
}
function result(): BackupRefreshResult {
  return { format: 'weekflow-backup', version: 12, exported_at: '2026-10-27T12:00:00Z',
    app_version: '1.0.0', data_model_version: 1, total_records: 1, created_count: 1,
    updated_count: 0, already_imported_count: 0, created_counts: counts(1),
    updated_counts: counts(), already_imported_counts: counts(),
    validation_passed: true, import_completed: true, refresh_completed: true,
    database_changed: true };
}
let fetchSpy: jest.SpyInstance;
let previousUrl: string | undefined;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch');
  previousUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
});
afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers();
  if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = previousUrl;
});
function respond(body: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

test('uses the configured API URL and sends the selected JSON in one refresh request', async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = OPTIONS.baseUrl;
  respond(result());
  await expect(refreshApiBackup(backup())).resolves.toEqual(result());
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe('https://weekflow.test/api/v1/backups/import/refresh');
  const request = fetchSpy.mock.calls[0][1];
  expect(request.method).toBe('POST');
  expect(JSON.parse(request.body).data.tasks[0]).toMatchObject({ id: 101, title: 'Imported task' });
});

test('forwards caller-supplied transport headers', async () => {
  respond(result());
  await refreshApiBackup(backup(), { ...OPTIONS, headers: { 'X-Request-Id': 'import-test' } });
  expect(fetchSpy.mock.calls[0][1].headers).toMatchObject({ 'X-Request-Id': 'import-test', 'Content-Type': 'application/json' });
});

test('accepts a matching update acknowledgement', async () => {
  const updated = { ...result(), created_count: 0, created_counts: counts(), updated_count: 1, updated_counts: counts(1) };
  respond(updated);
  await expect(refreshApiBackup(backup(), OPTIONS)).resolves.toEqual(updated);
});

test('accepts an unchanged-file acknowledgement', async () => {
  const unchanged = { ...result(), created_count: 0, created_counts: counts(),
    already_imported_count: 1, already_imported_counts: counts(1), database_changed: false };
  respond(unchanged);
  await expect(refreshApiBackup(backup(), OPTIONS)).resolves.toEqual(unchanged);
});

test.each([
  ['wrong file timestamp', { exported_at: '2026-10-26T12:00:00Z' }],
  ['wrong app version', { app_version: 'different-version' }],
  ['wrong total', { total_records: 2 }],
  ['inconsistent collection totals', { created_counts: counts() }],
  ['wrong collection', { created_counts: { ...counts(), goals: 1 } }],
  ['invalid changed flag', { database_changed: false }],
  ['missing refresh confirmation', { refresh_completed: false }],
  ['negative count', { updated_count: -1 }],
])('rejects %s as an uncertain write response without retrying', async (_label, changes) => {
  respond({ ...result(), ...changes });
  await expect(refreshApiBackup(backup(), OPTIONS)).rejects.toMatchObject({
    kind: 'invalid-response', mutationMayHaveSucceeded: true,
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('invalid backup contents fail before any HTTP request', async () => {
  const invalid = backup(); invalid.data.tasks[0].title = '';
  await expect(refreshApiBackup(invalid, OPTIONS)).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('the request and expected counts are captured before the caller changes its draft', async () => {
  const selected = backup();
  let resolve!: (value: Response) => void;
  fetchSpy.mockReturnValue(new Promise<Response>(yes => { resolve = yes; }));
  const pending = refreshApiBackup(selected, OPTIONS);
  selected.data.tasks.push(makeTask({ id: 102 }));
  expect(JSON.parse(fetchSpy.mock.calls[0][1].body).data.tasks).toHaveLength(1);
  resolve(new Response(JSON.stringify(result()), { status: 200 }));
  await expect(pending).resolves.toEqual(result());
});

test('409 conflict details reach the screen without suggesting that the write might have succeeded', async () => {
  respond({ detail: { message: 'Duplicate occurrence; no changes were saved.' } }, 409);
  await expect(refreshApiBackup(backup(), OPTIONS)).rejects.toMatchObject({
    message: 'Duplicate occurrence; no changes were saved.', status: 409,
    mutationMayHaveSucceeded: false,
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a failed server response remains uncertain and is not retried', async () => {
  respond({ detail: 'Server error' }, 500);
  await expect(refreshApiBackup(backup(), OPTIONS)).rejects.toMatchObject({
    status: 500, mutationMayHaveSucceeded: true,
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('network failure preserves the shared ApiError uncertainty flag', async () => {
  fetchSpy.mockRejectedValue(new Error('Connection lost'));
  const failure = await refreshApiBackup(backup(), OPTIONS).catch(error => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect(failure).toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('unreadable successful JSON is uncertain and never triggers another import', async () => {
  fetchSpy.mockResolvedValue(new Response('Not JSON', { status: 200 }));
  await expect(refreshApiBackup(backup(), OPTIONS)).rejects.toMatchObject({
    kind: 'invalid-response', mutationMayHaveSucceeded: true,
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a timed-out import aborts locally without replaying the write', async () => {
  jest.useFakeTimers();
  fetchSpy.mockImplementation((_url: unknown, request: RequestInit) => new Promise((_resolve, reject) => {
    request.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  const pending = refreshApiBackup(backup(), { ...OPTIONS, timeoutMs: 20 });
  const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout', mutationMayHaveSucceeded: true });
  await jest.advanceTimersByTimeAsync(21); await assertion;
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a previously cancelled request never sends the file', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(refreshApiBackup(backup(), { ...OPTIONS, signal: controller.signal })).rejects.toMatchObject({
    kind: 'cancelled', mutationMayHaveSucceeded: false,
  });
  expect(fetchSpy).not.toHaveBeenCalled();
});
