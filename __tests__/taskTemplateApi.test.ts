/** HTTP contract tests; every request uses a simulated server response. */
import {
    createApiTaskFromTemplate, createApiTaskTemplate, deleteApiTaskTemplate,
    fetchApiTaskTemplate, fetchApiTaskTemplates, updateApiTaskTemplate,
} from '../lib/api/taskTemplateApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/task-templates';
function template(changes: Record<string, unknown> = {}) {
  return { id: 41, source_task_template_id: 1781204320001, goal_id: 9,
    title: 'Study', notes: 'Keep notes', priority: 2,
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-22T14:00:00+00:00', ...changes };
}
function task(changes: Record<string, unknown> = {}) {
  return { id: 501, title: 'Study', day: 'Inbox', due_date: null, notes: 'Keep notes',
    priority: 2, completed: false, created_at: '2026-10-22T14:00:00Z', completed_at: null,
    goal_id: 9, source_goal_id: 1781204320002, source_task_id: null,
    recurring_rule_id: null, source_recurring_rule_id: null, recurrence_occurrence_date: null, ...changes };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(value), { status }));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('lists templates in server order and maps read-only migration metadata', async () => {
  respond([template(), template({ id: 42, goal_id: null, source_task_template_id: null })]);
  const saved = await fetchApiTaskTemplates({}, OPTIONS);
  expect(saved.map((row) => row.id)).toEqual([41, 42]);
  expect(saved[0]).toEqual({ id: 41, sourceTaskTemplateId: 1781204320001, goalId: 9,
    title: 'Study', notes: 'Keep notes', priority: 2,
    createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-22T14:00:00+00:00' });
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test('captures the native goal filter before awaiting the response', async () => {
  respond([template()]);
  const filters = { goalId: 9 };
  const pending = fetchApiTaskTemplates(filters, OPTIONS);
  filters.goalId = 10;
  expect((await pending)[0].goalId).toBe(9);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?goal_id=9`);
});

test('reads one template using its native ID', async () => {
  respond(template());
  expect((await fetchApiTaskTemplate(41, OPTIONS)).id).toBe(41);
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test('creating a template sends normalized details without creating a task', async () => {
  respond(template({ source_task_template_id: null }), 201);
  await createApiTaskTemplate({ title: ' Study ', notes: ' Keep notes ', priority: 2, goalId: 9 }, OPTIONS);
  expect(body()).toEqual({ title: 'Study', notes: 'Keep notes', priority: 2, goal_id: 9 });
  expect(fetchSpy).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('create defaults are explicit and accept zero, blank notes, and a null goal', async () => {
  respond(template({ notes: null, priority: 0, goal_id: null }), 201);
  await createApiTaskTemplate({ title: 'Study', notes: '   ' }, OPTIONS);
  expect(body()).toEqual({ title: 'Study', notes: null, priority: 0, goal_id: null });
});

test('PATCH sends only provided fields and leaves omitted fields out', async () => {
  respond(template({ title: 'New title' }));
  await updateApiTaskTemplate(41, { title: ' New title ', notes: undefined }, OPTIONS);
  expect(body()).toEqual({ title: 'New title' });
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
});

test('PATCH explicitly clears optional fields and retains priority zero', async () => {
  respond(template({ notes: null, goal_id: null, priority: 0 }));
  await updateApiTaskTemplate(41, { notes: null, goalId: null, priority: 0 }, OPTIONS);
  expect(body()).toEqual({ notes: null, goal_id: null, priority: 0 });
});

test('empty PATCH is allowed without inventing edits or timestamps', async () => {
  respond(template());
  await updateApiTaskTemplate(41, {}, OPTIONS);
  expect(body()).toEqual({});
});

test('captures submitted values before caller changes its form', async () => {
  respond(template(), 201);
  const input = { title: 'Study', notes: 'Keep notes', priority: 2, goalId: 9 };
  const pending = createApiTaskTemplate(input, OPTIONS);
  input.title = 'Changed'; input.goalId = 10;
  expect((await pending).title).toBe('Study');
  expect(body().goal_id).toBe(9);
});

test('deleting a template makes one DELETE and does not call any task endpoint', async () => {
  respond(null, 204);
  await expect(deleteApiTaskTemplate(41, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('create-task sends a bodyless POST and decodes a new independent Inbox task', async () => {
  respond(task(), 201);
  const saved = await createApiTaskFromTemplate(41, OPTIONS);
  expect(saved).toMatchObject({ id: 501, goalId: 9, sourceGoalId: 1781204320002,
    recurringRuleId: null, sourceTaskId: null, dueDate: null, day: 'Inbox', completed: false });
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41/create-task`, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('task and template can have the same number because their tables have separate IDs', async () => {
  respond(task({ id: 41 }), 201);
  expect((await createApiTaskFromTemplate(41, OPTIONS)).id).toBe(41);
});

test('each explicit create-task call can return a different task', async () => {
  fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(task()), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(task({ id: 502 })), { status: 201 }));
  expect((await createApiTaskFromTemplate(41, OPTIONS)).id).toBe(501);
  expect((await createApiTaskFromTemplate(41, OPTIONS)).id).toBe(502);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source ID %j without sending', async (id) => {
  await expect(fetchApiTaskTemplate(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiTaskTemplate(id as number, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiTaskTemplate(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiTaskFromTemplate(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiTaskTemplates({ goalId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { title: '' }, { title: '   ' }, { title: null }, { notes: 4 },
  { priority: true }, { priority: '1' }, { priority: 3 }, { priority: null },
  { goalId: 0 }, { goalId: true }, { goalId: 1781204320001 },
  { sourceTaskTemplateId: 1781204320001 }, { createdAt: '2026-10-01T12:00:00Z' },
  { completed: false }, { dueDate: null }, { recurringRuleId: 41 },
])('rejects invalid or protected create/update input %j', async (changes) => {
  await expect(createApiTaskTemplate({ title: 'Study', ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiTaskTemplate(41, changes as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('creating without a title fails before sending', async () => {
  await expect(createApiTaskTemplate({} as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('unexpected filters fail before sending', async () => {
  await expect(fetchApiTaskTemplates({ sourceGoalId: 1781204320001 } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 0 }, { source_task_template_id: -1 }, { goal_id: 1781204320001 },
  { title: '   ' }, { notes: false }, { priority: 3 },
  { created_at: '2026-02-29T12:00:00Z' }, { updated_at: '2026-10-22T24:00:00Z' },
  { updated_at: '2026-10-22T12:00:00' }, { updated_at: null },
])('rejects malformed template responses %j', async (changes) => {
  respond(template(changes));
  await expect(fetchApiTaskTemplate(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { rows: [template(), template()] },
  { rows: [template({ goal_id: 10 })] },
])('rejects duplicate IDs or list items outside the requested goal', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiTaskTemplates({ goalId: 9 }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each(['fetch', 'update'])('rejects a different template ID on %s', async (action) => {
  respond(template({ id: 42 }));
  const pending = action === 'fetch' ? fetchApiTaskTemplate(41, OPTIONS) : updateApiTaskTemplate(41, {}, OPTIONS);
  await expect(pending).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([{ title: 'Wrong' }, { notes: 'Wrong' }, { priority: 1 }, { goal_id: null }])('rejects a successful response that contradicts submitted values %j', async (changes) => {
  respond(template(changes), 201);
  await expect(createApiTaskTemplate({ title: 'Study', notes: 'Keep notes', priority: 2, goalId: 9 }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each([
  { day: 'Thursday', due_date: '2026-10-22' },
  { completed: true, completed_at: '2026-10-22T14:00:00Z' },
  { completed_at: '2026-10-22T14:00:00Z' },
  { recurring_rule_id: 41, recurrence_occurrence_date: '2026-10-22' },
  { source_recurring_rule_id: 1781204320001, recurrence_occurrence_date: '2026-10-22' },
  { source_task_id: 1781204320001 },
])('rejects a create-task result that is not new, unfinished, and standalone %j', async (changes) => {
  respond(task(changes), 201);
  await expect(createApiTaskFromTemplate(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('long title/notes remain intact and optional whitespace notes clear', async () => {
  const title = 'x'.repeat(20000), notes = 'Line one\n' + 'y'.repeat(20000);
  respond(template({ title, notes }), 201);
  const saved = await createApiTaskTemplate({ title, notes, priority: 2, goalId: 9 }, OPTIONS);
  expect(saved.title).toBe(title); expect(saved.notes).toBe(notes);
});

test.each([404, 409, 422, 500])('create-task preserves HTTP %s without retrying', async (status) => {
  respond({ detail: 'Cannot create this task.' }, status);
  await expect(createApiTaskFromTemplate(41, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('network failure never automatically repeats task creation', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(createApiTaskFromTemplate(41, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('delete rejects unexpected content in a successful response', async () => {
  respond({ removed: true });
  await expect(deleteApiTaskTemplate(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});
