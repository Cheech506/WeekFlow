/** Mock HTTP checks for reading, skipping, and restoring recurring occurrences. */
import {
    createApiRecurringException, deleteApiRecurringException,
    fetchApiRecurringException, fetchApiRecurringExceptions,
} from '../lib/api/recurringExceptionApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/recurring-exceptions';
const INPUT = { recurringRuleId: 41, occurrenceDate: '2026-10-22' };
function skip(changes: Record<string, unknown> = {}) {
  return { recurring_rule_id: 41, occurrence_date: '2026-10-22', created_at: '2026-10-21T12:00:00Z', ...changes };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(value), { status }));
}

test('maps the composite identity and server timestamp without inventing another ID', async () => {
  respond([skip()]);
  expect(await fetchApiRecurringExceptions({}, OPTIONS)).toEqual([{
    recurringRuleId: 41, occurrenceDate: '2026-10-22', createdAt: '2026-10-21T12:00:00Z',
  }]);
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test('captures both filters before the caller can change them', async () => {
  respond([skip()]);
  const filters = { ...INPUT };
  const request = fetchApiRecurringExceptions(filters, OPTIONS);
  filters.recurringRuleId = 99;
  filters.occurrenceDate = '2026-10-23';
  expect((await request)[0].recurringRuleId).toBe(41);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?recurring_rule_id=41&occurrence_date=2026-10-22`);
});

test('date-only filtering can include different schedules on the same date', async () => {
  respond([skip(), skip({ recurring_rule_id: 42 })]);
  expect(await fetchApiRecurringExceptions({ occurrenceDate: '2026-10-22' }, OPTIONS)).toHaveLength(2);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?occurrence_date=2026-10-22`);
});

test('reads a single skip by schedule ID and original occurrence date', async () => {
  respond(skip());
  const result = await fetchApiRecurringException(41, '2026-10-22', OPTIONS);
  expect(result.occurrenceDate).toBe('2026-10-22');
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41/2026-10-22`, expect.objectContaining({ method: 'GET' }));
});

test.each([200, 201])('accepts a saved skip at status %s and preserves the server timestamp', async (status) => {
  respond(skip(), status);
  const result = await createApiRecurringException(INPUT, OPTIONS);
  expect(result.createdAt).toBe('2026-10-21T12:00:00Z');
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
  expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ recurring_rule_id: 41, occurrence_date: '2026-10-22' }) });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('removing a skip does not call task deletion or generation', async () => {
  respond(null, 204);
  await expect(deleteApiRecurringException(41, '2026-10-22', OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41/2026-10-22`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([0, -1, 1.5, 1781204320001, true])('rejects invalid/source schedule IDs %j before sending', async (id) => {
  await expect(fetchApiRecurringException(id as number, INPUT.occurrenceDate, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiRecurringException({ ...INPUT, recurringRuleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiRecurringException(id as number, INPUT.occurrenceDate, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiRecurringExceptions({ recurringRuleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['2026-02-29', '2026-04-31', '2026-10-22T00:00:00Z', '', '2026-10-22/other'])('rejects invalid occurrence date %j without sending', async (date) => {
  await expect(fetchApiRecurringException(41, date, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiRecurringException({ ...INPUT, occurrenceDate: date }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiRecurringException(41, date, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiRecurringExceptions({ occurrenceDate: date }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { ...INPUT, createdAt: '2026-10-21T12:00:00Z' },
  { ...INPUT, sourceRecurringRuleId: 1781204320001 },
  { recurringRuleId: 41 }, { occurrenceDate: '2026-10-22' },
])('rejects incomplete or protected skip creation %j', async (input) => {
  await expect(createApiRecurringException(input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('rejects unsupported filters and null filter values', async () => {
  await expect(fetchApiRecurringExceptions({ sourceRecurringRuleId: 1781204320001 } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiRecurringExceptions({ recurringRuleId: null } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiRecurringExceptions({ occurrenceDate: null } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { recurring_rule_id: 1781204320001 }, { recurring_rule_id: null },
  { occurrence_date: '2026-02-30' }, { created_at: '2026-10-21T12:00:00' },
  { created_at: null },
])('rejects invalid server skip data %j', async (changes) => {
  respond([skip(changes)]);
  await expect(fetchApiRecurringExceptions({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects duplicate composite identities', async () => {
  respond([skip(), skip()]);
  await expect(fetchApiRecurringExceptions({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([{ recurring_rule_id: 42 }, { occurrence_date: '2026-10-23' }])('rejects a single response with the wrong identity %j', async (changes) => {
  respond(skip(changes));
  await expect(fetchApiRecurringException(41, '2026-10-22', OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  await expect(createApiRecurringException(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each([{ recurring_rule_id: 42 }, { occurrence_date: '2026-10-23' }])('rejects filtered records from another occurrence %j', async (changes) => {
  respond([skip(changes)]);
  await expect(fetchApiRecurringExceptions(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each(['2028-02-29', '0001-01-01'])('keeps valid calendar date %s unchanged in the URL', async (date) => {
  respond(skip({ occurrence_date: date }));
  expect((await fetchApiRecurringException(41, date, OPTIONS)).occurrenceDate).toBe(date);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/41/${date}`);
});

test('preserves an existing-task conflict instead of attempting task deletion', async () => {
  respond({ detail: 'This occurrence already has a task. Handle that task through the Task API.' }, 409);
  await expect(createApiRecurringException(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
});

test('reports a missing skip without treating deletion as a success', async () => {
  respond({ detail: 'Recurring exception not found.' }, 404);
  await expect(deleteApiRecurringException(41, '2026-10-22', OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 404 });
});

test('network failures do not trigger automatic retries or local writes', async () => {
  fetchSpy.mockRejectedValue(new Error('Offline'));
  await expect(createApiRecurringException(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
