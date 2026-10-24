/** Mock HTTP checks for recurring schedules and occurrence generation. */
import {
    createApiRecurringRule, deleteApiRecurringRule, fetchApiRecurringRule,
    fetchApiRecurringRules, generateApiRecurringTasks, updateApiRecurringRule,
} from '../lib/api/recurringRuleApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/recurring-rules';
const CREATE = { title: 'Study', frequency: 'weekly' as const, startDate: '2026-10-22' };
function rule(changes: Record<string, unknown> = {}) {
  return {
    id: 41, source_recurring_rule_id: 1781204320001, goal_id: 21,
    title: 'Study', notes: null, priority: 1, frequency: 'weekly',
    start_date: '2026-10-22', end_date: null, weekdays: [], active: true,
    created_at: '2026-10-22T12:00:00Z', ...changes,
  };
}
function summary(changes: Record<string, unknown> = {}) {
  return {
    current_date: '2026-10-22', horizon_days: 30, window_end: '2026-11-21',
    rules_checked: 1, candidate_count: 4, created_count: 2, existing_count: 1,
    skipped_count: 1, created_task_ids: [501, 502], database_changed: true,
    ...changes,
  };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(value), { status }));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('maps native IDs, migration metadata, schedule details, and calendar dates', async () => {
  respond([rule()]);
  expect(await fetchApiRecurringRules({}, OPTIONS)).toEqual([{
    id: 41, sourceRecurringRuleId: 1781204320001, goalId: 21,
    title: 'Study', notes: null, priority: 1, frequency: 'weekly',
    startDate: '2026-10-22', endDate: null, weekdays: [], active: true,
    createdAt: '2026-10-22T12:00:00Z',
  }]);
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test('sends active=false as a real filter and captures filters before awaiting', async () => {
  respond([rule({ active: false })]);
  const filters = { goalId: 21, active: false };
  const pending = fetchApiRecurringRules(filters, OPTIONS);
  filters.active = true;
  filters.goalId = 99;
  expect((await pending)[0].active).toBe(false);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?goal_id=21&active=false`);
});

test('reads one schedule by native ID', async () => {
  respond(rule());
  expect((await fetchApiRecurringRule(41, OPTIONS)).id).toBe(41);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/41`);
});

test('creation sends one request and leaves occurrence generation explicit', async () => {
  respond(rule(), 201);
  await createApiRecurringRule({ ...CREATE, title: ' Study ', notes: ' ', goalId: 21, priority: 0, active: false }, OPTIONS);
  expect(body()).toEqual({ title: 'Study', notes: null, goal_id: 21, priority: 0, frequency: 'weekly', start_date: '2026-10-22', active: false });
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('sorts selected weekdays without mutating caller input', async () => {
  respond(rule({ frequency: 'certainDays', weekdays: [1, 3, 5] }), 201);
  const days = [5, 1, 3];
  await createApiRecurringRule({ ...CREATE, frequency: 'certainDays', weekdays: days }, OPTIONS);
  expect(body().weekdays).toEqual([1, 3, 5]);
  expect(days).toEqual([5, 1, 3]);
});

test('pause/resume and goal changes use PATCH without rewriting task history', async () => {
  respond(rule({ active: false, goal_id: null }));
  await updateApiRecurringRule(41, { active: false, goalId: null, notes: undefined }, OPTIONS);
  expect(body()).toEqual({ active: false, goal_id: null });
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a partial schedule patch leaves merged validation to the server', async () => {
  respond(rule({ frequency: 'certainDays', weekdays: [1] }));
  await updateApiRecurringRule(41, { frequency: 'certainDays' }, OPTIONS);
  expect(body()).toEqual({ frequency: 'certainDays' });
});

test.each(['stopOnly', 'deleteUnfinished'] as const)('sends explicit deletion mode %s', async (mode) => {
  respond(null, 204);
  await expect(deleteApiRecurringRule(41, mode, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41?mode=${mode}`, expect.objectContaining({ method: 'DELETE' }));
});

test.each([0, -1, 1.5, 1781204320001])('rejects invalid/source IDs %s', async (id) => {
  await expect(fetchApiRecurringRule(id, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiRecurringRule(id, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiRecurringRule(id, 'stopOnly', OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { title: '' }, { frequency: 'yearly' }, { startDate: '2026-02-30' },
  { endDate: '2026-10-21' }, { priority: true }, { priority: 3 },
  { goalId: 1781204320001 }, { active: 0 }, { weekdays: [1, 1] },
  { weekdays: [7] }, { weekdays: [true] }, { sourceRecurringRuleId: 1781204320001 },
  { frequency: 'certainDays', weekdays: [] }, { frequency: 'certainDays' },
])('rejects invalid create schedule %j', async (changes) => {
  await expect(createApiRecurringRule({ ...CREATE, ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ title: null }, { weekdays: null }, { active: null }, { frequency: null }, { startDate: null }])('rejects null required patch field %j', async (input) => {
  await expect(updateApiRecurringRule(41, input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 1781204320001 }, { goal_id: 1781204320001 }, { title: '' },
  { priority: -1 }, { frequency: 'yearly' }, { start_date: '2026-02-30' },
  { end_date: '2026-10-21' }, { weekdays: [1, 1] }, { weekdays: [7] },
  { frequency: 'certainDays', weekdays: [] }, { active: 1 },
  { created_at: '2026-10-22T12:00:00' },
])('rejects invalid server schedule %j', async (changes) => {
  respond([rule(changes)]);
  await expect(fetchApiRecurringRules({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects duplicate schedules, incorrect filters, and mismatched returned IDs', async () => {
  respond([rule(), rule()]);
  await expect(fetchApiRecurringRules({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  respond([rule({ active: true })]);
  await expect(fetchApiRecurringRules({ active: false }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  respond(rule({ id: 42 }));
  await expect(fetchApiRecurringRule(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  await expect(updateApiRecurringRule(41, { active: false }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('rejects invalid filters and deletion modes before sending', async () => {
  await expect(fetchApiRecurringRules({ goalId: 1781204320001 }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiRecurringRules({ active: 0 } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiRecurringRule(41, 'deleteAll' as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('generates one schedule from the device calendar date and maps the summary', async () => {
  respond(summary());
  expect(await generateApiRecurringTasks({ currentDate: '2026-10-22', recurringRuleId: 41 }, OPTIONS)).toEqual({
    currentDate: '2026-10-22', horizonDays: 30, windowEnd: '2026-11-21',
    rulesChecked: 1, candidateCount: 4, createdCount: 2, existingCount: 1,
    skippedCount: 1, createdTaskIds: [501, 502], databaseChanged: true,
  });
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/generate`);
  expect(body()).toEqual({ current_date: '2026-10-22', horizon_days: 30, recurring_rule_id: 41 });
});

test('zero-day generation and null schedule selection are retained', async () => {
  respond(summary({ horizon_days: 0, window_end: '2026-10-22', rules_checked: 0, candidate_count: 0, created_count: 0, existing_count: 0, skipped_count: 0, created_task_ids: [], database_changed: false }));
  const result = await generateApiRecurringTasks({ currentDate: '2026-10-22', horizonDays: 0, recurringRuleId: null }, OPTIONS);
  expect(body()).toEqual({ current_date: '2026-10-22', horizon_days: 0, recurring_rule_id: null });
  expect(result.databaseChanged).toBe(false);
});

test('generation uses calendar arithmetic across leap day and DST changes', async () => {
  respond(summary({ current_date: '2028-02-28', horizon_days: 2, window_end: '2028-03-01' }));
  await generateApiRecurringTasks({ currentDate: '2028-02-28', horizonDays: 2 }, OPTIONS);
  respond(summary({ current_date: '2026-10-31', horizon_days: 2, window_end: '2026-11-02' }));
  await generateApiRecurringTasks({ currentDate: '2026-10-31', horizonDays: 2 }, OPTIONS);
});

test.each([
  { currentDate: '2026-02-30' }, { horizonDays: -1 }, { horizonDays: 367 },
  { horizonDays: true }, { recurringRuleId: 1781204320001 },
  { currentDate: '9999-12-31', horizonDays: 1 }, { current_date: '2026-10-22' },
])('rejects invalid generation input %j without sending', async (changes) => {
  await expect(generateApiRecurringTasks({ currentDate: '2026-10-22', ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { current_date: '2026-10-23' }, { horizon_days: 31 }, { window_end: '2026-11-22' },
  { candidate_count: 5 }, { rules_checked: -1 }, { created_count: true },
  { created_task_ids: [501, 501] }, { created_task_ids: [501] },
  { created_task_ids: [501, 1781204320001] }, { database_changed: false },
])('rejects an inconsistent generation summary %j', async (changes) => {
  respond(summary(changes));
  await expect(generateApiRecurringTasks({ currentDate: '2026-10-22' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('single-schedule generation must report exactly one checked rule', async () => {
  respond(summary({ rules_checked: 2 }));
  await expect(generateApiRecurringTasks({ currentDate: '2026-10-22', recurringRuleId: 41 }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('reports a server-side schedule validation failure without fallback', async () => {
  respond({ detail: 'Schedule range is invalid.' }, 422);
  await expect(updateApiRecurringRule(41, { endDate: '2026-10-01' }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 422 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('network failures do not trigger automatic retries or local writes', async () => {
  fetchSpy.mockRejectedValue(new Error('Offline'));
  await expect(createApiRecurringRule(CREATE, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
