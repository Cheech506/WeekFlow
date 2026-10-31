import { makeTask } from '@/__tests__/testFactories';
import { ApiError } from '@/lib/api/apiClient';
import { exportApiBackup } from '@/lib/api/backupExportApi';
import type { WeekFlowBackup } from '@/lib/backupValidation';

const OPTIONS = { baseUrl: 'https://weekflow.test' };

function backup(): WeekFlowBackup {
  return { format: 'weekflow-backup', version: 12, exportedAt: '2026-10-28T12:00:00.000Z',
    metadata: { appVersion: '0.1.0', dataModelVersion: 1 }, data: {
      tasks: [makeTask({ id: 101, title: 'Current PostgreSQL task' })], goals: [], goalMilestones: [],
      brainDumps: [], taskTemplates: [], recurringRules: [], recurringExceptions: [],
      planningCycles: [], weeklyReviews: [], weeklyCommitments: [], weeklyTaskDecisions: [],
      cycleReviews: [], cycleGoalOutcomes: [],
    } };
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

function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify(value), { status }));
}

test('uses the configured URL and requests one complete export without a request body', async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = OPTIONS.baseUrl;
  const document = backup(); respond(document);
  await expect(exportApiBackup()).resolves.toEqual(document);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe('https://weekflow.test/api/v1/backups/export');
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(fetchSpy.mock.calls[0][1].body).toBeUndefined();
});

test('allows an explicit instance URL and forwards transport headers', async () => {
  respond(backup());
  await exportApiBackup({ ...OPTIONS, headers: { 'X-Request-Id': 'export-test' } });
  expect(fetchSpy.mock.calls[0][1].headers['X-Request-Id']).toBe('export-test');
});

test('accepts a backup with thirteen empty collections', async () => {
  const document = backup(); document.data.tasks = []; respond(document);
  await expect(exportApiBackup(OPTIONS)).resolves.toEqual(document);
});

test('preserves the server task completion state', async () => {
  const document = backup();
  document.data.tasks[0].completed = true;
  document.data.tasks[0].completedAt = '2026-10-28T11:00:00.000Z';
  respond(document);
  const result = await exportApiBackup(OPTIONS);
  expect(result.data.tasks[0]).toMatchObject({ completed: true, completedAt: '2026-10-28T11:00:00.000Z' });
});

test('preserves JavaScript-safe portable IDs larger than PostgreSQL IDs', async () => {
  const document = backup(); document.data.tasks[0].id = Number.MAX_SAFE_INTEGER; respond(document);
  expect((await exportApiBackup(OPTIONS)).data.tasks[0].id).toBe(Number.MAX_SAFE_INTEGER);
});

test.each([null, [], {}, { format: 'other-backup', version: 12 }, { ...backup(), version: 11 }])(
  'rejects a response that is not the current server backup format: %p', async value => {
    respond(value);
    await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  }
);

test('rejects a partial backup missing a collection', async () => {
  const document = backup();
  const { cycleGoalOutcomes: _, ...incomplete } = document.data;
  respond({ ...document, data: incomplete });
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects missing metadata', async () => {
  const { metadata: _, ...document } = backup(); respond(document);
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects inconsistent completion fields', async () => {
  const document = backup(); document.data.tasks[0].completed = true; respond(document);
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects orphaned goal links instead of silently repairing a new server export', async () => {
  const document = backup(); document.data.tasks[0].goalId = 999; respond(document);
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects duplicate task identities', async () => {
  const document = backup(); document.data.tasks.push({ ...document.data.tasks[0] }); respond(document);
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('preserves a server validation explanation', async () => {
  respond({ detail: 'The JSON backup could not be created.' }, 409);
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({
    kind: 'http', status: 409, message: 'The JSON backup could not be created.',
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('reports server unavailability without automatically retrying', async () => {
  respond({ detail: 'The database could not complete the JSON export.' }, 503);
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 503 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('reports a lost connection without automatically retrying', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection closed'));
  await expect(exportApiBackup(OPTIONS)).rejects.toBeInstanceOf(ApiError);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('reports invalid JSON instead of returning a corrupt export', async () => {
  fetchSpy.mockResolvedValue(new Response('<html>Not a backup</html>'));
  await expect(exportApiBackup(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('honors a caller timeout without retrying the export', async () => {
  jest.useFakeTimers();
  fetchSpy.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  const request = expect(exportApiBackup({ ...OPTIONS, timeoutMs: 50 })).rejects.toMatchObject({ kind: 'timeout' });
  await jest.advanceTimersByTimeAsync(50); await request;
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('does not send a request when the caller already canceled it', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(exportApiBackup({ ...OPTIONS, signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('requires an API address when no override is supplied', async () => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  await expect(exportApiBackup()).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
