/** Mock HTTP requests for the app's goal-milestone connector. */
import {
    createApiGoalMilestone, deleteApiGoalMilestone, fetchApiGoalMilestone,
    fetchApiGoalMilestones, updateApiGoalMilestone,
} from '../lib/api/goalMilestoneApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/goal-milestones';
function milestone(changes: Record<string, unknown> = {}) {
  return {
    id: 31, goal_id: 21, source_goal_milestone_id: 1781204320001,
    title: 'Finish integration', notes: null, target_date: '2026-10-30',
    completed: false, created_at: '2026-10-22T12:00:00Z', completed_at: null,
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

test('maps native IDs and all milestone fields without changing calendar target dates', async () => {
  respond([milestone()]);
  expect(await fetchApiGoalMilestones({}, OPTIONS)).toEqual([{
    id: 31, goalId: 21, sourceGoalMilestoneId: 1781204320001,
    title: 'Finish integration', notes: null, targetDate: '2026-10-30',
    completed: false, createdAt: '2026-10-22T12:00:00Z', completedAt: null,
  }]);
  expect(fetchSpy).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'GET' }));
});

test('retains server ordering and supports empty milestone lists', async () => {
  respond([milestone({ id: 99 }), milestone({ id: 31 })]);
  expect((await fetchApiGoalMilestones({}, OPTIONS)).map((row) => row.id)).toEqual([99, 31]);
  respond([]);
  expect(await fetchApiGoalMilestones({}, OPTIONS)).toEqual([]);
});

test('filters by native goal ID and captures it before the caller can change it', async () => {
  respond([milestone()]);
  const filters = { goalId: 21 };
  const request = fetchApiGoalMilestones(filters, OPTIONS);
  filters.goalId = 99;
  expect((await request)[0].goalId).toBe(21);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?goal_id=21`);
});

test('reads one milestone by native ID', async () => {
  respond(milestone());
  expect((await fetchApiGoalMilestone(31, OPTIONS)).id).toBe(31);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/31`);
});

test('creates a milestone using native goal ID and normalizes form text', async () => {
  respond(milestone(), 201);
  await createApiGoalMilestone({ goalId: 21, title: ' Finish integration ', notes: ' A note ', targetDate: ' 2026-10-30 ' }, OPTIONS);
  expect(body()).toEqual({ goal_id: 21, title: 'Finish integration', notes: 'A note', target_date: '2026-10-30' });
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
});

test('optional create fields remain omitted', async () => {
  respond(milestone({ target_date: null }), 201);
  await createApiGoalMilestone({ goalId: 21, title: 'Finish integration' }, OPTIONS);
  expect(body()).toEqual({ goal_id: 21, title: 'Finish integration' });
});

test('an empty form target date and notes clear those values to null', async () => {
  respond(milestone({ target_date: null }));
  await updateApiGoalMilestone(31, { targetDate: ' ', notes: '' }, OPTIONS);
  expect(body()).toEqual({ target_date: null, notes: null });
});

test('a details patch preserves fields omitted by the caller', async () => {
  respond(milestone());
  await updateApiGoalMilestone(31, { title: ' Updated ', targetDate: undefined }, OPTIONS);
  expect(body()).toEqual({ title: 'Updated' });
});

test.each([true, false])('changes completion to %s and uses the server timestamp', async (completed) => {
  const completedAt = completed ? '2026-10-23T14:00:00Z' : null;
  respond(milestone({ completed, completed_at: completedAt }));
  const result = await updateApiGoalMilestone(31, { completed }, OPTIONS);
  expect(body()).toEqual({ completed });
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
  expect(result.completedAt).toBe(completedAt);
  expect(result.completed).toBe(completed);
});

test('deletes via the endpoint and accepts the empty 204 response', async () => {
  respond(null, 204);
  await expect(deleteApiGoalMilestone(31, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/31`, expect.objectContaining({ method: 'DELETE' }));
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source milestone IDs %j without a request', async (id) => {
  await expect(fetchApiGoalMilestone(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiGoalMilestone(id as number, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiGoalMilestone(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { goalId: 1781204320001 }, { goalId: null }, { goalId: false },
  { title: '' }, { title: 'x'.repeat(161) },
  { notes: 'x'.repeat(501) }, { notes: 5 },
  { targetDate: '2026-02-30' }, { targetDate: '2026-10-30T00:00:00Z' },
  { completed: true }, { sourceGoalMilestoneId: 1781204320001 },
])('rejects invalid/protected create input %j', async (changes) => {
  await expect(createApiGoalMilestone({ goalId: 21, title: 'Valid', ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { goalId: 22 }, { title: null }, { completed: null }, { completed: 1 },
  { completedAt: '2026-10-23T14:00:00Z' }, { sourceGoalMilestoneId: 1781204320001 },
])('rejects immutable or invalid patch fields %j', async (input) => {
  await expect(updateApiGoalMilestone(31, input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 1781204320001 }, { goal_id: null }, { goal_id: 1781204320001 },
  { source_goal_milestone_id: Number.MAX_SAFE_INTEGER + 1 },
  { title: '' }, { title: 'x'.repeat(161) }, { notes: 'x'.repeat(501) },
  { target_date: '2026-02-30' }, { completed: 1 },
  { completed: true, completed_at: null },
  { completed: false, completed_at: '2026-10-23T14:00:00Z' },
  { created_at: '2026-10-22T12:00:00' },
])('rejects malformed server data %j', async (changes) => {
  respond([milestone(changes)]);
  await expect(fetchApiGoalMilestones({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('accepts a leap-day calendar target date', async () => {
  respond(milestone({ target_date: '2028-02-29' }), 201);
  const result = await createApiGoalMilestone({ goalId: 21, title: 'Leap day', targetDate: '2028-02-29' }, OPTIONS);
  expect(body().target_date).toBe('2028-02-29');
  expect(result.targetDate).toBe('2028-02-29');
});

test('rejects duplicate rows and filtered responses from another goal', async () => {
  respond([milestone(), milestone()]);
  await expect(fetchApiGoalMilestones({}, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
  respond([milestone({ goal_id: 22 })]);
  await expect(fetchApiGoalMilestones({ goalId: 21 }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects source or unsupported filters before sending', async () => {
  await expect(fetchApiGoalMilestones({ goalId: 1781204320001 }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiGoalMilestones({ completed: true } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('validates returned IDs on read and update', async () => {
  respond(milestone({ id: 32 }));
  await expect(fetchApiGoalMilestone(31, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: false });
  await expect(updateApiGoalMilestone(31, { title: 'Changed' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('rejects a create response linked to the wrong goal', async () => {
  respond(milestone({ goal_id: 22 }), 201);
  await expect(createApiGoalMilestone({ goalId: 21, title: 'Valid' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('rejects a completion response that did not apply the requested status', async () => {
  respond(milestone());
  await expect(updateApiGoalMilestone(31, { completed: true }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('retains useful missing-parent and deletion-conflict responses', async () => {
  respond({ detail: 'Goal not found.' }, 404);
  await expect(createApiGoalMilestone({ goalId: 21, title: 'Valid' }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 404, message: 'Goal not found.' });
  respond({ detail: 'The milestone could not be deleted.' }, 409);
  await expect(deleteApiGoalMilestone(31, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409 });
});

test('network failures remain errors without automatic retries or SQLite fallback', async () => {
  fetchSpy.mockRejectedValue(new Error('No connection'));
  await expect(createApiGoalMilestone({ goalId: 21, title: 'Valid' }, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
