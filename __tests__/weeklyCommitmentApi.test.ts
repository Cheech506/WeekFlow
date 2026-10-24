/** Mock HTTP checks for standalone promises and task-linked commitments. */
import {
    createApiWeeklyCommitment, deleteApiWeeklyCommitment, fetchApiWeeklyCommitment,
    fetchApiWeeklyCommitments, updateApiWeeklyCommitment,
} from '../lib/api/weeklyCommitmentApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/weekly-commitments';
const WEEK = '2026-10-19';
const STAMP = '2026-10-22T12:00:00Z';
function commitment(changes: Record<string, unknown> = {}) {
  return { id: 41, source_weekly_commitment_id: 1781204320001, week_start: WEEK,
    cycle_id: 9, task_id: null, title: 'Study this week', completed: false,
    created_at: '2026-10-19T12:00:00Z', completed_at: null, ...changes };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockImplementation(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(value), { status })));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('maps identity, source metadata, parent links, and server timestamps', async () => {
  respond([commitment()]);
  const [saved] = await fetchApiWeeklyCommitments({}, OPTIONS);
  expect(saved).toEqual({ id: 41, sourceWeeklyCommitmentId: 1781204320001, weekStart: WEEK,
    cycleId: 9, taskId: null, title: 'Study this week', completed: false,
    createdAt: '2026-10-19T12:00:00Z', completedAt: null });
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test('captures all filters including false before caller mutation', async () => {
  respond([commitment({ task_id: 12 })]);
  const filters = { weekStart: WEEK, cycleId: 9, taskId: 12, completed: false };
  const pending = fetchApiWeeklyCommitments(filters, OPTIONS);
  filters.weekStart = '2026-10-26'; filters.cycleId = 10; filters.taskId = 13; filters.completed = true;
  expect((await pending)[0].taskId).toBe(12);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?week_start=${WEEK}&cycle_id=9&task_id=12&completed=false`);
});

test('reads a linked commitment using the live task title and completion state', async () => {
  respond(commitment({ task_id: 12, title: 'Renamed task', completed: true, completed_at: STAMP }));
  const saved = await fetchApiWeeklyCommitment(41, OPTIONS);
  expect(saved).toMatchObject({ taskId: 12, title: 'Renamed task', completed: true, completedAt: STAMP });
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test('creates a normalized standalone promise without creating a task', async () => {
  respond(commitment({ source_weekly_commitment_id: null }), 201);
  await createApiWeeklyCommitment({ weekStart: WEEK, cycleId: 9, title: ' Study this week ' }, OPTIONS);
  expect(body()).toEqual({ week_start: WEEK, cycle_id: 9, task_id: null, title: 'Study this week' });
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('standalone creation defaults to no cycle and no task', async () => {
  respond(commitment({ source_weekly_commitment_id: null, cycle_id: null }), 201);
  await createApiWeeklyCommitment({ weekStart: WEEK, title: 'Study this week' }, OPTIONS);
  expect(body()).toEqual({ week_start: WEEK, cycle_id: null, task_id: null, title: 'Study this week' });
});

test.each([false, true])('selects an existing task and accepts its current completion %j', async (completed) => {
  respond(commitment({ source_weekly_commitment_id: null, task_id: 12, completed,
    completed_at: completed ? STAMP : null }), 201);
  const saved = await createApiWeeklyCommitment({ weekStart: WEEK, cycleId: 9, taskId: 12 }, OPTIONS);
  expect(saved.completed).toBe(completed);
  expect(body()).toEqual({ week_start: WEEK, cycle_id: 9, task_id: 12 });
  expect(body()).not.toHaveProperty('title');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('linked creation permits explicit null title without sending a forged title', async () => {
  respond(commitment({ source_weekly_commitment_id: null, cycle_id: null, task_id: 12 }), 201);
  await createApiWeeklyCommitment({ weekStart: WEEK, taskId: 12, title: null }, OPTIONS);
  expect(body()).not.toHaveProperty('title');
});

test('captures creation values before the caller changes its form', async () => {
  respond(commitment({ source_weekly_commitment_id: null }), 201);
  const input = { weekStart: WEEK, cycleId: 9, title: 'Study this week' };
  const pending = createApiWeeklyCommitment(input, OPTIONS);
  input.weekStart = '2026-10-26'; input.title = 'Changed';
  expect((await pending).weekStart).toBe(WEEK);
  expect(body().title).toBe('Study this week');
});

test('PATCH sends only supplied standalone title and leaves parent identity out', async () => {
  respond(commitment({ title: 'New promise' }));
  await updateApiWeeklyCommitment(41, { title: ' New promise ', completed: undefined }, OPTIONS);
  expect(body()).toEqual({ title: 'New promise' });
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
});

test.each([false, true])('sets linked completion explicitly to %j with one PATCH', async (completed) => {
  respond(commitment({ task_id: 12, completed, completed_at: completed ? STAMP : null }));
  const saved = await updateApiWeeklyCommitment(41, { completed }, OPTIONS);
  expect(saved.completed).toBe(completed);
  expect(body()).toEqual({ completed });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('repeated explicit completion keeps the server-provided timestamp', async () => {
  respond(commitment({ completed: true, completed_at: STAMP }));
  expect((await updateApiWeeklyCommitment(41, { completed: true }, OPTIONS)).completedAt).toBe(STAMP);
  expect((await updateApiWeeklyCommitment(41, { completed: true }, OPTIONS)).completedAt).toBe(STAMP);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test('empty PATCH does not invent changes', async () => {
  respond(commitment());
  await updateApiWeeklyCommitment(41, {}, OPTIONS);
  expect(body()).toEqual({});
});

test('linked reads allow long live task titles and legacy missing completion timestamps', async () => {
  respond(commitment({ task_id: 12, title: 'x'.repeat(200), completed: true, completed_at: null }));
  const saved = await fetchApiWeeklyCommitment(41, OPTIONS);
  expect(saved.title).toHaveLength(200);
  expect(saved.completed).toBe(true);
  expect(saved.completedAt).toBeNull();
});

test('multiple standalone promises in one week may share the same title', async () => {
  respond([commitment(), commitment({ id: 42 })]);
  expect(await fetchApiWeeklyCommitments({}, OPTIONS)).toHaveLength(2);
});

test('the same task may be selected for different weeks', async () => {
  respond([commitment({ task_id: 12 }), commitment({ id: 42, task_id: 12, week_start: '2026-10-26' })]);
  expect(await fetchApiWeeklyCommitments({}, OPTIONS)).toHaveLength(2);
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source commitment or parent ID %j', async (id) => {
  await expect(fetchApiWeeklyCommitment(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiWeeklyCommitment(id as number, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiWeeklyCommitment(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyCommitments({ cycleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyCommitments({ taskId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiWeeklyCommitment({ weekStart: WEEK, taskId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['2026-10-20', '2026-02-30', '', '2026-10-19T00:00:00Z'])('rejects invalid/non-Monday week %j', async (weekStart) => {
  await expect(createApiWeeklyCommitment({ weekStart, title: 'Promise' }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyCommitments({ weekStart }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([null, true, '', ' ', 'x'.repeat(181)])('rejects invalid standalone title %j', async (title) => {
  await expect(createApiWeeklyCommitment({ weekStart: WEEK, title } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiWeeklyCommitment(41, { title } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('cannot omit a standalone title or supply one alongside a task ID', async () => {
  await expect(createApiWeeklyCommitment({ weekStart: WEEK } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiWeeklyCommitment({ weekStart: WEEK, taskId: 12, title: 'Forged title' } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('title length counts Unicode code points rather than UTF-16 units', async () => {
  const title = '😀'.repeat(180);
  respond(commitment({ title, cycle_id: null, source_weekly_commitment_id: null }), 201);
  expect((await createApiWeeklyCommitment({ weekStart: WEEK, title }, OPTIONS)).title).toBe(title);
  await expect(updateApiWeeklyCommitment(41, { title: title + '😀' }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([null, 0, 1, 'false'])('rejects nonboolean completion %j', async (completed) => {
  await expect(updateApiWeeklyCommitment(41, { completed } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyCommitments({ completed } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ sourceWeeklyCommitmentId: 1781204320001 }, { createdAt: STAMP }, { completedAt: STAMP }, { completed: true }])('creation rejects server-owned fields %j', async (changes) => {
  await expect(createApiWeeklyCommitment({ weekStart: WEEK, title: 'Promise', ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ weekStart: WEEK }, { cycleId: null }, { taskId: null }, { completedAt: STAMP }])('PATCH cannot rewrite parent identity or timestamps %j', async (changes) => {
  await expect(updateApiWeeklyCommitment(41, changes as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 0 }, { source_weekly_commitment_id: -1 }, { task_id: 1781204320001 },
  { cycle_id: true }, { week_start: '2026-10-20' }, { title: ' ' },
  { title: 'x'.repeat(181) }, { completed: 'false' }, { completed: true, completed_at: null },
  { completed: false, completed_at: STAMP }, { created_at: '2026-02-29T12:00:00Z' },
])('rejects invalid standalone commitment response %j', async (changes) => {
  respond(commitment(changes));
  await expect(fetchApiWeeklyCommitment(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { rows: [commitment(), commitment()] },
  { rows: [commitment({ task_id: 12 }), commitment({ id: 42, task_id: 12 })] },
  { rows: [commitment({ task_id: 13 })] },
  { rows: [commitment({ task_id: 12, cycle_id: 10 })] },
  { rows: [commitment({ task_id: 12, completed: true, completed_at: STAMP })] },
  { rows: [commitment({ task_id: 12, week_start: '2026-10-26' })] },
])('rejects duplicate identities or commitments outside requested filters', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiWeeklyCommitments({ weekStart: WEEK, cycleId: 9, taskId: 12, completed: false }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each(['fetch', 'update'])('rejects a different commitment ID on %s', async (action) => {
  respond(commitment({ id: 42 }));
  await expect(action === 'fetch' ? fetchApiWeeklyCommitment(41, OPTIONS) : updateApiWeeklyCommitment(41, {}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([{ week_start: '2026-10-26' }, { cycle_id: 10 }, { task_id: 12 },
  { title: 'Other promise' }, { completed: true, completed_at: STAMP }, { source_weekly_commitment_id: 1781204320001 }])('rejects create results that contradict the submitted promise %j', async (changes) => {
  respond(commitment({ source_weekly_commitment_id: null, ...changes }), 201);
  await expect(createApiWeeklyCommitment({ weekStart: WEEK, cycleId: 9, title: 'Study this week' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each([
  { task_id: 12, completed: false, completed_at: null },
  { task_id: 12, completed: true, completed_at: null },
])('a completion write cannot report unchanged or timestamp-less completion %j', async (changes) => {
  respond(commitment(changes));
  await expect(updateApiWeeklyCommitment(41, { completed: true }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('linked title-edit conflict is preserved without silently editing the task', async () => {
  respond({ detail: 'Edit a task-linked title through the Task API.' }, 409);
  await expect(updateApiWeeklyCommitment(41, { title: 'New title' }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('duplicate selection conflict does not retry or create another commitment', async () => {
  respond({ detail: 'That task is already a commitment for this week.' }, 409);
  await expect(createApiWeeklyCommitment({ weekStart: WEEK, taskId: 12 }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409, mutationMayHaveSucceeded: false });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([404, 422, 500])('preserves HTTP %s without retrying', async (status) => {
  respond({ detail: 'Operation could not be completed.' }, status);
  await expect(updateApiWeeklyCommitment(41, { completed: false }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('network failure leaves completion uncertain and does not repeat it', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(updateApiWeeklyCommitment(41, { completed: true }, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('deletion sends one bodyless DELETE and leaves task operations to the server', async () => {
  respond(null, 204);
  await expect(deleteApiWeeklyCommitment(41, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
