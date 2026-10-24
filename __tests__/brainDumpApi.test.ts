/** Mock HTTP tests for Brain Dump notes; no real server or database writes. */
import {
    archiveApiBrainDump, convertApiBrainDumpToTask, createApiBrainDump,
    deleteApiBrainDump, fetchApiBrainDump, fetchApiBrainDumps,
    restoreApiBrainDump, updateApiBrainDump,
} from '../lib/api/brainDumpApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/brain-dumps';
const CREATED = '2026-10-01T12:00:00Z';
const ARCHIVED = '2026-10-22T14:00:00+00:00';
function note(changes: Record<string, unknown> = {}) {
  return { id: 41, source_brain_dump_id: 1781204320001, body: 'An idea\nWith details',
    archived: false, created_at: CREATED, archived_at: null, ...changes };
}
function task(changes: Record<string, unknown> = {}) {
  return { id: 501, title: 'An idea\nWith details', day: 'Inbox', due_date: null,
    notes: null, priority: 0, completed: false, created_at: '2026-10-22T14:00:00Z',
    completed_at: null, goal_id: null, source_task_id: null, source_goal_id: null,
    recurring_rule_id: null, source_recurring_rule_id: null, recurrence_occurrence_date: null, ...changes };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockImplementation(() => Promise.resolve(
    new Response(status === 204 ? null : JSON.stringify(value), { status })
  ));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('lists notes in server order and maps source identity and archive timestamps', async () => {
  respond([note(), note({ id: 42, archived: true, archived_at: ARCHIVED })]);
  const saved = await fetchApiBrainDumps({}, OPTIONS);
  expect(saved.map((row) => row.id)).toEqual([41, 42]);
  expect(saved[0]).toEqual({ id: 41, sourceBrainDumpId: 1781204320001,
    body: 'An idea\nWith details', archived: false, createdAt: CREATED, archivedAt: null });
  expect(saved[1].archivedAt).toBe(ARCHIVED);
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test.each([false, true])('sends the explicit archive filter %j and captures it before awaiting', async (archived) => {
  respond([note({ archived, archived_at: archived ? ARCHIVED : null })]);
  const filters = { archived };
  const pending = fetchApiBrainDumps(filters, OPTIONS);
  filters.archived = !archived;
  expect((await pending)[0].archived).toBe(archived);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?archived=${archived}`);
});

test('reads one note with its native PostgreSQL ID', async () => {
  respond(note());
  expect((await fetchApiBrainDump(41, OPTIONS)).id).toBe(41);
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test('creates an active note and sends only normalized text', async () => {
  respond(note({ source_brain_dump_id: null }), 201);
  const saved = await createApiBrainDump({ body: '  An idea\nWith details  ' }, OPTIONS);
  expect(body()).toEqual({ body: 'An idea\nWith details' });
  expect(saved.archived).toBe(false);
  expect(saved.createdAt).toBe(CREATED);
  expect(fetchSpy).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('edits note text without sending archive state or timestamps', async () => {
  respond(note({ body: 'Updated note', archived: true, archived_at: ARCHIVED }));
  const saved = await updateApiBrainDump(41, { body: ' Updated note ' }, OPTIONS);
  expect(body()).toEqual({ body: 'Updated note' });
  expect(saved.archivedAt).toBe(ARCHIVED);
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
});

test('archive and repeated archive preserve the server-provided first archive timestamp', async () => {
  respond(note({ archived: true, archived_at: ARCHIVED }));
  expect((await archiveApiBrainDump(41, OPTIONS)).archivedAt).toBe(ARCHIVED);
  expect((await archiveApiBrainDump(41, OPTIONS)).archivedAt).toBe(ARCHIVED);
  expect(body()).toEqual({ archived: true });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test('restore sends false explicitly and accepts the cleared archive timestamp', async () => {
  respond(note());
  const saved = await restoreApiBrainDump(41, OPTIONS);
  expect(body()).toEqual({ archived: false });
  expect(saved.archived).toBe(false);
  expect(saved.archivedAt).toBeNull();
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}/41`);
});

test('combined text/archive PATCH sends both supplied changes', async () => {
  respond(note({ body: 'New text', archived: true, archived_at: ARCHIVED }));
  await updateApiBrainDump(41, { body: 'New text', archived: true }, OPTIONS);
  expect(body()).toEqual({ body: 'New text', archived: true });
});

test('empty PATCH and undefined fields do not invent changes', async () => {
  respond(note());
  await updateApiBrainDump(41, { body: undefined, archived: undefined }, OPTIONS);
  expect(body()).toEqual({});
});

test('captures the input before the caller changes its form', async () => {
  respond(note({ source_brain_dump_id: null }), 201);
  const input = { body: 'An idea\nWith details' };
  const pending = createApiBrainDump(input, OPTIONS);
  input.body = 'Changed';
  expect((await pending).body).toBe('An idea\nWith details');
});

test('delete sends one DELETE and never calls a task endpoint', async () => {
  respond(null, 204);
  await expect(deleteApiBrainDump(41, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('conversion sends one bodyless POST and maps the independent Inbox task', async () => {
  respond(task(), 201);
  const saved = await convertApiBrainDumpToTask(41, OPTIONS);
  expect(saved).toMatchObject({ id: 501, title: 'An idea\nWith details', day: 'Inbox',
    dueDate: null, notes: null, priority: 0, goalId: null, recurringRuleId: null, completed: false });
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41/convert-to-task`, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('note and task IDs may coincide because they belong to separate tables', async () => {
  respond(task({ id: 41 }), 201);
  expect((await convertApiBrainDumpToTask(41, OPTIONS)).id).toBe(41);
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source note ID %j before sending', async (id) => {
  const identity = id as number;
  await expect(fetchApiBrainDump(identity, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiBrainDump(identity, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(archiveApiBrainDump(identity, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(restoreApiBrainDump(identity, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiBrainDump(identity, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(convertApiBrainDumpToTask(identity, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ body: '' }, { body: '  \n ' }, { body: null }, { body: 42 },
  { sourceBrainDumpId: 1781204320001 }, { createdAt: CREATED }, { archivedAt: ARCHIVED }, { id: 41 },
])('rejects invalid or protected note input %j', async (changes) => {
  await expect(createApiBrainDump({ body: 'Idea', ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiBrainDump(41, changes as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([null, 0, 1, 'false'])('rejects nonboolean archive state %j', async (archived) => {
  await expect(updateApiBrainDump(41, { archived } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiBrainDumps({ archived } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('creation cannot set archive state or omit note text', async () => {
  await expect(createApiBrainDump({ body: 'Idea', archived: true } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiBrainDump({} as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('unsupported list filters are rejected', async () => {
  await expect(fetchApiBrainDumps({ sourceBrainDumpId: 1781204320001 } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 0 }, { source_brain_dump_id: -1 }, { body: ' ' }, { archived: 0 },
  { archived: true, archived_at: null }, { archived: false, archived_at: ARCHIVED },
  { archived: true, archived_at: '2026-02-29T12:00:00Z' },
  { created_at: '2026-10-22T24:00:00Z' }, { created_at: '2026-10-22T12:00:00' },
])('rejects malformed note response or broken archive pair %j', async (changes) => {
  respond(note(changes));
  await expect(fetchApiBrainDump(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { rows: [note(), note()] },
  { rows: [note({ archived: true, archived_at: ARCHIVED })] },
])('rejects duplicate IDs or wrong active-note filter results', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiBrainDumps({ archived: false }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each(['fetch', 'update'])('rejects wrong returned note ID for %s', async (action) => {
  respond(note({ id: 42 }));
  const pending = action === 'fetch' ? fetchApiBrainDump(41, OPTIONS) : updateApiBrainDump(41, {}, OPTIONS);
  await expect(pending).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([{ body: 'Other text' }, { archived: true, archived_at: ARCHIVED },
  { source_brain_dump_id: 1781204320001 }])('rejects a create result that contradicts the request %j', async (changes) => {
  respond(note({ source_brain_dump_id: null, ...changes }), 201);
  await expect(createApiBrainDump({ body: 'An idea\nWith details' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('archive rejects a successful response that still shows an active note', async () => {
  respond(note());
  await expect(archiveApiBrainDump(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('restore rejects a successful response that still shows an archived note', async () => {
  respond(note({ archived: true, archived_at: ARCHIVED }));
  await expect(restoreApiBrainDump(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each([
  { day: 'Thursday', due_date: '2026-10-22' }, { notes: 'Unexpected notes' }, { priority: 1 },
  { completed: true, completed_at: CREATED }, { goal_id: 9 }, { source_goal_id: 1781204320001 },
  { source_task_id: 1781204320001 }, { recurring_rule_id: 41, recurrence_occurrence_date: '2026-10-22' },
])('rejects a converted task that breaks the conversion contract %j', async (changes) => {
  respond(task(changes), 201);
  await expect(convertApiBrainDumpToTask(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('long multiline note text stays intact without an invented length limit', async () => {
  const text = 'First line\n' + 'x'.repeat(20000);
  respond(note({ source_brain_dump_id: null, body: text }), 201);
  expect((await createApiBrainDump({ body: text }, OPTIONS)).body).toBe(text);
  expect(body().body).toBe(text);
});

test.each([404, 409, 422, 500])('conversion preserves HTTP %s without retrying or extra writes', async (status) => {
  respond({ detail: 'Conversion cannot be completed.' }, status);
  await expect(convertApiBrainDumpToTask(41, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('lost conversion response marks the write uncertain and does not repeat it', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(convertApiBrainDumpToTask(41, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('delete rejects a nonempty successful response', async () => {
  respond({ removed: true });
  await expect(deleteApiBrainDump(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});
