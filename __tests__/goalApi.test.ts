/** Mock the HTTP boundary; no SQLite or live PostgreSQL is used. */
import {
    completeApiGoal, createApiGoal, deleteApiGoal, fetchApiGoal, fetchApiGoals,
    reopenApiGoal, updateApiGoal,
} from '../lib/api/goalApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/goals';
const CREATE = { title: 'Ship WeekFlow', startDate: '2026-10-22', endDate: '2027-01-14' };
const HISTORY = {
  completion_what_helped: 'Small steps', completion_hardest_part: 'Time',
  completion_learned: 'Testing helps', completion_do_differently: 'Start earlier',
  completion_task_total: 10, completion_task_completed: 7,
  completion_milestone_total: 3, completion_milestone_completed: 2,
  completion_high_priority_completed: 4,
};
function goal(changes: Record<string, unknown> = {}) {
  return {
    id: 21, source_goal_id: 1781204320001, cycle_id: 12,
    title: 'Ship WeekFlow', start_date: '2026-10-22', end_date: '2027-01-14',
    reward: 'Dinner', purpose: 'Finish project', success_definition: 'App deployed', notes: null,
    completed: false, created_at: '2026-10-22T12:00:00Z', completed_at: null,
    completion_what_helped: null, completion_hardest_part: null,
    completion_learned: null, completion_do_differently: null,
    completion_task_total: null, completion_task_completed: null,
    completion_milestone_total: null, completion_milestone_completed: null,
    completion_high_priority_completed: null, ...changes,
  };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(body: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }
function localDateParts(value: string) {
  const date = new Date(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()];
}

test('maps native goal/cycle IDs and preserves source ID only as metadata', async () => {
  respond([goal()]);
  const [result] = await fetchApiGoals({}, OPTIONS);
  expect(result).toMatchObject({ id: 21, sourceGoalId: 1781204320001, cycleId: 12, title: 'Ship WeekFlow', purpose: 'Finish project', successDefinition: 'App deployed', reward: 'Dinner', notes: null });
  expect(localDateParts(result.startDate)).toEqual([2026, 10, 22, 12]);
  expect(localDateParts(result.endDate)).toEqual([2027, 1, 14, 12]);
  expect(fetchSpy).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'GET' }));
});

test('filters by the native planning cycle ID', async () => {
  respond([goal()]);
  await fetchApiGoals({ cycleId: 12 }, OPTIONS);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?cycle_id=12`);
});

test('captures filters before a request so caller mutation does not change validation', async () => {
  respond([goal()]);
  const filters = { cycleId: 12 };
  const pending = fetchApiGoals(filters, OPTIONS);
  filters.cycleId = 99;
  expect((await pending)[0].cycleId).toBe(12);
});

test('fetches one goal by native ID', async () => {
  respond(goal());
  expect((await fetchApiGoal(21, OPTIONS)).id).toBe(21);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/21`);
});

test('maps create fields, trims optional text, and sends only supplied values', async () => {
  respond(goal(), 201);
  await createApiGoal({ ...CREATE, title: ' Ship WeekFlow ', cycleId: 12, reward: ' Dinner ', purpose: ' Finish ', successDefinition: ' Deployed ', notes: ' ' }, OPTIONS);
  expect(body()).toEqual({ title: 'Ship WeekFlow', start_date: '2026-10-22', end_date: '2027-01-14', cycle_id: 12, reward: 'Dinner', purpose: 'Finish', success_definition: 'Deployed', notes: null });
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
});

test('omits unspecified create details and preserves an explicitly null cycle', async () => {
  respond(goal(), 201);
  await createApiGoal({ ...CREATE, cycleId: null }, OPTIONS);
  expect(body()).toEqual({ title: CREATE.title, start_date: CREATE.startDate, end_date: CREATE.endDate, cycle_id: null });
});

test('updates only supplied fields; null clears optional fields', async () => {
  respond(goal());
  await updateApiGoal(21, { notes: null, reward: ' ', purpose: undefined }, OPTIONS);
  expect(body()).toEqual({ notes: null, reward: null });
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
});

test('allows a single changed date and lets the server compare it to the saved date', async () => {
  respond(goal());
  await updateApiGoal(21, { endDate: '2027-01-14' }, OPTIONS);
  expect(body()).toEqual({ end_date: '2027-01-14' });
});

test('completion sends reflections without client-computed totals or completion timestamps', async () => {
  respond(goal({ completed: true, completed_at: '2026-10-23T14:00:00Z', ...HISTORY }));
  const result = await completeApiGoal(21, { whatHelped: ' Small steps ', hardestPart: null, learned: undefined, doDifferently: ' ' }, OPTIONS);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/21/complete`);
  expect(body()).toEqual({ what_helped: 'Small steps', hardest_part: null, do_differently: null });
  expect(result).toMatchObject({ completed: true, completionWhatHelped: 'Small steps', completionHardestPart: 'Time', completionLearned: 'Testing helps', completionDoDifferently: 'Start earlier', completionTaskTotal: 10, completionTaskCompleted: 7, completionMilestoneTotal: 3, completionMilestoneCompleted: 2, completionHighPriorityCompleted: 4 });
});

test('omitted reflection answers stay omitted for server-side recompletion behavior', async () => {
  respond(goal({ completed: true, completed_at: '2026-10-23T14:00:00Z', ...HISTORY }));
  await completeApiGoal(21, {}, OPTIONS);
  expect(body()).toEqual({});
});

test('reopening retains the returned historical reflections and counts', async () => {
  respond(goal(HISTORY));
  const result = await reopenApiGoal(21, OPTIONS);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/21/reopen`);
  expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(result).toMatchObject({ completed: false, completedAt: null, completionWhatHelped: 'Small steps', completionTaskTotal: 10, completionTaskCompleted: 7 });
});

test('deletes a goal with an empty response', async () => {
  respond(null, 204);
  await expect(deleteApiGoal(21, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
});

test.each([0, -1, 1.5, 1781204320001, true])('rejects source/invalid goal IDs %j before sending', async (id) => {
  await expect(fetchApiGoal(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiGoal(id as number, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(completeApiGoal(id as number, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(reopenApiGoal(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiGoal(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { title: '' }, { startDate: null }, { endDate: '2026-10-21' },
  { startDate: '2026-02-30' }, { startDate: '2026-10-22T00:00:00Z' },
  { cycleId: 1781204320001 }, { cycleId: false }, { completed: true },
  { id: 2 }, { sourceGoalId: 1781204320001 },
  { reward: 'x'.repeat(201) }, { purpose: 'x'.repeat(501) },
  { successDefinition: 'x'.repeat(501) }, { notes: 'x'.repeat(2001) },
])('rejects invalid or protected create fields %j', async (changes) => {
  await expect(createApiGoal({ ...CREATE, ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ cycleId: 2 }, { completed: true }, { completedAt: null }, { completionTaskTotal: 10 }, { title: null }, { startDate: null }])('rejects protected/null required update fields %j', async (input) => {
  await expect(updateApiGoal(21, input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ whatHelped: 'x'.repeat(1001) }, { learned: 5 }, { completed: true }, { taskTotal: 5 }])('rejects invalid or forged completion fields %j', async (input) => {
  await expect(completeApiGoal(21, input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 1781204320001 }, { cycle_id: 1781204320001 },
  { source_goal_id: Number.MAX_SAFE_INTEGER + 1 }, { title: '' },
  { start_date: '2026-02-30' }, { end_date: '2026-10-21' },
  { created_at: '2026-10-22T12:00:00' }, { completed: true, completed_at: null },
  { completed: false, completed_at: '2026-10-22T12:00:00Z' },
  { completion_task_total: -1 }, { completion_task_total: true },
  { completion_task_total: 1, completion_task_completed: 2 },
  { completion_milestone_total: 1, completion_milestone_completed: 2 },
  { completion_task_completed: 1, completion_high_priority_completed: 2 },
  { completion_what_helped: 'x'.repeat(1001) }, { reward: 'x'.repeat(201) },
])('rejects malformed server goal/history data %j', async (changes) => {
  respond([goal(changes)]);
  await expect(fetchApiGoals({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects duplicate goal IDs and incorrect cycle filtering', async () => {
  respond([goal(), goal()]);
  await expect(fetchApiGoals({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  respond([goal({ cycle_id: 99 })]);
  await expect(fetchApiGoals({ cycleId: 12 }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('validates filter IDs and rejects unsupported filters', async () => {
  await expect(fetchApiGoals({ cycleId: 1781204320001 }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiGoals({ completed: true } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('handles leap-day and year-below-100 goal dates without changing the selected day', async () => {
  for (const date of ['2028-02-29', '0001-01-01']) {
    respond(goal({ start_date: date, end_date: date }));
    const result = await fetchApiGoal(21, OPTIONS);
    expect(localDateParts(result.startDate)).toEqual([Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)), 12]);
  }
});

test('rejects a returned ID that differs from the requested goal', async () => {
  respond(goal({ id: 22 }));
  await expect(fetchApiGoal(21, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  await expect(updateApiGoal(21, { title: 'Changed' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('rejects unsuccessful complete/reopen response states', async () => {
  respond(goal());
  await expect(completeApiGoal(21, {}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  respond(goal({ completed: true, completed_at: '2026-10-23T14:00:00Z' }));
  await expect(reopenApiGoal(21, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('passes through protected-history deletion errors without retrying', async () => {
  respond({ detail: 'This goal has saved completion history and cannot be deleted.' }, 409);
  await expect(deleteApiGoal(21, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('does not retry or silently save to SQLite when the server cannot be reached', async () => {
  fetchSpy.mockRejectedValue(new Error('Offline'));
  await expect(createApiGoal(CREATE, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
