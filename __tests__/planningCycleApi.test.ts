/** Verify app-to-API planning-cycle requests without contacting a server. */
import { ApiError } from '../lib/api/apiClient';
import {
  createApiPlanningCycle, deleteApiPlanningCycle,
  fetchApiCurrentPlanningCycle, fetchApiPlanningCycle, fetchApiPlanningCycles,
  updateApiPlanningCycle,
} from '../lib/api/planningCycleApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/planning-cycles';
function cycle(changes: Record<string, unknown> = {}) {
  return {
    id: 12, source_planning_cycle_id: 1781204320001,
    name: 'Autumn', primary_focus: 'Ship WeekFlow', theme: null,
    start_date: '2026-10-22', end_date: '2027-01-13', active: true,
    created_at: '2026-10-22T12:00:00+00:00', completed_at: null, ...changes,
  };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => jest.restoreAllMocks());
function respond(body: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}
function sentBody() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('maps native PostgreSQL IDs and snake-case response fields to app fields', async () => {
  respond([cycle()]);
  expect(await fetchApiPlanningCycles(OPTIONS)).toEqual([{
    id: 12, sourcePlanningCycleId: 1781204320001,
    name: 'Autumn', primaryFocus: 'Ship WeekFlow', theme: null,
    startDate: '2026-10-22', endDate: '2027-01-13', active: true,
    createdAt: '2026-10-22T12:00:00+00:00', completedAt: null,
  }]);
  expect(fetchSpy).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'GET' }));
});

test('reads current cycle and handles no current cycle', async () => {
  respond(cycle());
  expect((await fetchApiCurrentPlanningCycle(OPTIONS))?.id).toBe(12);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/current`);
  respond(null);
  expect(await fetchApiCurrentPlanningCycle(OPTIONS)).toBeNull();
});

test('reads a cycle by its native ID', async () => {
  respond(cycle());
  expect((await fetchApiPlanningCycle(12, OPTIONS)).id).toBe(12);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/12`);
});

test('creates through the existing endpoint and lets the backend calculate end date', async () => {
  respond(cycle(), 201);
  await createApiPlanningCycle({ startDate: '2026-10-22', name: ' Autumn ', primaryFocus: ' Ship WeekFlow ', theme: ' ' }, OPTIONS);
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(sentBody()).toEqual({ start_date: '2026-10-22', name: 'Autumn', primary_focus: 'Ship WeekFlow', theme: null });
});

test('omitted create details remain omitted', async () => {
  respond(cycle(), 201);
  await createApiPlanningCycle({ startDate: '2026-10-22' }, OPTIONS);
  expect(sentBody()).toEqual({ start_date: '2026-10-22' });
});

test('patches only supplied fields and preserves explicit null', async () => {
  respond(cycle({ primary_focus: null }));
  await updateApiPlanningCycle(12, { primaryFocus: null, theme: undefined }, OPTIONS);
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
  expect(sentBody()).toEqual({ primary_focus: null });
});

test('updates start date without inventing an end date', async () => {
  respond(cycle());
  await updateApiPlanningCycle(12, { startDate: '2026-10-22' }, OPTIONS);
  expect(sentBody()).toEqual({ start_date: '2026-10-22' });
});

test('deletes using native ID and handles the empty response', async () => {
  respond(null, 204);
  await expect(deleteApiPlanningCycle(12, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/12`, expect.objectContaining({ method: 'DELETE' }));
});

test.each([0, -1, 1.5, 1781204320001, Number.NaN])('rejects invalid/native-source ID confusion %s without a request', async (id) => {
  await expect(fetchApiPlanningCycle(id, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiPlanningCycle(id, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiPlanningCycle(id, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  {}, { startDate: null }, { startDate: '2026-02-29' },
  { startDate: '2026-10-22', id: 12 },
  { startDate: '2026-10-22', endDate: '2027-01-13' },
  { startDate: '2026-10-22', name: 5 },
  { startDate: '2026-10-22', name: 'x'.repeat(81) },
  { startDate: '2026-10-22', primaryFocus: 'x'.repeat(301) },
  { startDate: '2026-10-22', theme: 'x'.repeat(121) },
])('rejects invalid create input %j before sending it', async (input) => {
  await expect(createApiPlanningCycle(input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('accepts leap dates', async () => {
  respond(cycle({ start_date: '2028-02-29', end_date: '2028-05-22' }), 201);
  await createApiPlanningCycle({ startDate: '2028-02-29' }, OPTIONS);
  expect(sentBody()).toEqual({ start_date: '2028-02-29' });
});

test('rejects null start-date patches', async () => {
  await expect(updateApiPlanningCycle(12, { startDate: null } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 1781204320001 }, { source_planning_cycle_id: Number.MAX_SAFE_INTEGER + 1 },
  { start_date: '2026-02-30' }, { end_date: '2026-10-01' },
  { active: 1 }, { created_at: '2026-10-22T12:00:00' },
  { name: 'x'.repeat(81) }, { completed_at: 'invalid' },
])('rejects malformed cycle data %j', async (changes) => {
  respond([cycle(changes)]);
  await expect(fetchApiPlanningCycles(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { body: [cycle(), cycle()] },
  { body: [cycle(), cycle({ id: 13 })] },
  { body: { rows: [cycle()] } },
])('rejects malformed/ambiguous cycle lists', async ({ body }) => {
  respond(body);
  await expect(fetchApiPlanningCycles(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects an inactive cycle returned by the current endpoint', async () => {
  respond(cycle({ active: false }));
  await expect(fetchApiCurrentPlanningCycle(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects mismatching read/update response IDs; a failed update response may already have committed', async () => {
  respond(cycle({ id: 13 }));
  await expect(fetchApiPlanningCycle(12, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: false });
  await expect(updateApiPlanningCycle(12, { name: 'Changed' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('preserves a protected-cycle deletion conflict', async () => {
  respond({ detail: 'This cycle is linked to goals or reviews.' }, 409);
  await expect(deleteApiPlanningCycle(12, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409, message: 'This cycle is linked to goals or reviews.' });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a network failure remains an error without retries or SQLite fallback', async () => {
  fetchSpy.mockRejectedValue(new Error('Offline'));
  await expect(createApiPlanningCycle({ startDate: '2026-10-22' }, OPTIONS)).rejects.toBeInstanceOf(ApiError);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
