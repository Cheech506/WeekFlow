/** Task client contracts; every HTTP request is mocked. */

import { ApiError } from '../lib/api/apiClient';
import {
    createApiTask,
    deleteApiTask,
    fetchApiTask,
    fetchApiTasks,
    fetchServerTasks,
    updateApiTask,
    type ApiTask,
    type CreateApiTaskInput,
    type ServerTask,
    type TaskApiFilters,
    type UpdateApiTaskInput,
} from '../lib/api/taskApi';

const BASE = 'http://127.0.0.1:8000';
const PATH = '/api/v1/tasks';
const SOURCE_TASK = 1_781_204_340_001;
const SOURCE_GOAL = 1_781_204_340_002;
const SOURCE_RULE = 1_781_204_340_003;
const previousBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

function serverTask(changes: Partial<ServerTask> = {}): ServerTask {
  return {
    id: 12, title: 'Study', day: 'Tuesday', due_date: '2026-10-20',
    notes: 'Saved notes', priority: 2, completed: false,
    created_at: '2026-10-20T12:00:00+00:00', completed_at: null,
    goal_id: 4, recurring_rule_id: null,
    source_task_id: SOURCE_TASK, source_goal_id: SOURCE_GOAL,
    source_recurring_rule_id: null, recurrence_occurrence_date: null,
    ...changes,
  };
}

function appTask(changes: Partial<ApiTask> = {}): ApiTask {
  return {
    id: 12, title: 'Study', day: 'Tuesday', dueDate: '2026-10-20',
    notes: 'Saved notes', priority: 2, completed: false,
    createdAt: '2026-10-20T12:00:00+00:00', completedAt: null,
    goalId: 4, recurringRuleId: null,
    sourceTaskId: SOURCE_TASK, sourceGoalId: SOURCE_GOAL,
    sourceRecurringRuleId: null, recurrenceOccurrenceDate: null,
    ...changes,
  };
}

function reply(payload: unknown, status = 200): Response {
  return {
    status, ok: status >= 200 && status < 300,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function mockResponse(payload: unknown = serverTask(), status = 200) {
  return jest.spyOn(global, 'fetch').mockResolvedValue(reply(payload, status));
}

async function getError(operation: Promise<unknown>): Promise<ApiError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected request to reject');
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = BASE;
});

afterEach(() => {
  jest.restoreAllMocks();
  if (previousBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = previousBaseUrl;
});


test('the migration screen still receives snake-case server tasks', async () => {
  const rows = [serverTask(), serverTask({ id: 13 })];
  const fetchMock = mockResponse(rows);
  await expect(fetchServerTasks(`${BASE}/`)).resolves.toEqual(rows);
  expect(fetchMock).toHaveBeenCalledWith(`${BASE}${PATH}`, expect.objectContaining({ method: 'GET' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


test('fetchApiTasks translates every response field to the app shape', async () => {
  mockResponse([serverTask()]);
  await expect(fetchApiTasks()).resolves.toEqual([appTask()]);
});


test('an empty server task list remains empty', async () => {
  mockResponse([]);
  await expect(fetchApiTasks()).resolves.toEqual([]);
});


test('list filters send only native PostgreSQL goal and rule IDs', async () => {
  const fetchMock = mockResponse([]);
  await fetchApiTasks({ goalId: 4, recurringRuleId: 8 });
  expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}${PATH}?goal_id=4&recurring_rule_id=8`);
});


test('undefined filters are omitted from the URL', async () => {
  const fetchMock = mockResponse([]);
  await fetchApiTasks({ goalId: undefined, recurringRuleId: undefined });
  expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}${PATH}`);
});


test('fetchApiTask reads one native task ID and translates its response', async () => {
  const fetchMock = mockResponse();
  await expect(fetchApiTask(12)).resolves.toEqual(appTask());
  expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}${PATH}/12`);
});


test('source-only imported relationships never masquerade as native IDs', async () => {
  mockResponse(serverTask({ goal_id: null, recurring_rule_id: null,
    source_recurring_rule_id: SOURCE_RULE, recurrence_occurrence_date: '2026-10-20' }));
  const result = await fetchApiTask(12);
  expect(result.goalId).toBeNull();
  expect(result.recurringRuleId).toBeNull();
  expect(result.sourceGoalId).toBe(SOURCE_GOAL);
  expect(result.sourceRecurringRuleId).toBe(SOURCE_RULE);
  expect(result.recurrenceOccurrenceDate).toBe('2026-10-20');
});


test('ordinary native tasks may have all source metadata null', async () => {
  mockResponse(serverTask({ source_task_id: null, source_goal_id: null }));
  const result = await fetchApiTask(12);
  expect(result.sourceTaskId).toBeNull();
  expect(result.sourceGoalId).toBeNull();
  expect(result.goalId).toBe(4);
});


test('reading a moved recurring task preserves due and original dates separately', async () => {
  mockResponse(serverTask({ recurring_rule_id: 8, source_recurring_rule_id: SOURCE_RULE,
    recurrence_occurrence_date: '2026-10-20', due_date: null, day: 'Inbox' }));
  const result = await fetchApiTask(12);
  expect(result.dueDate).toBeNull();
  expect(result.day).toBe('Inbox');
  expect(result.recurrenceOccurrenceDate).toBe('2026-10-20');
});


test('completed legacy tasks with no completion timestamp remain readable', async () => {
  mockResponse(serverTask({ completed: true, completed_at: null }));
  await expect(fetchApiTask(12)).resolves.toEqual(appTask({ completed: true }));
});


test('timestamp offsets and calendar date strings are preserved without conversion', async () => {
  const stamp = '2026-10-20T23:30:00-07:00';
  mockResponse(serverTask({ created_at: stamp, completed: true, completed_at: stamp }));
  const result = await fetchApiTask(12);
  expect(result.createdAt).toBe(stamp);
  expect(result.completedAt).toBe(stamp);
  expect(result.dueDate).toBe('2026-10-20');
});


test('create sends normalized camel-case input as a snake-case JSON body', async () => {
  const fetchMock = mockResponse(serverTask(), 201);
  const input = { title: '  Study  ', notes: '  Saved notes  ', priority: 2,
    dueDate: '2026-10-20', goalId: 4 };
  const before = { ...input };
  await expect(createApiTask(input)).resolves.toEqual(appTask());
  expect(fetchMock).toHaveBeenCalledWith(`${BASE}${PATH}`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ title: 'Study', due_date: '2026-10-20',
      notes: 'Saved notes', priority: 2, goal_id: 4 }),
  }));
  expect(input).toEqual(before);
});


test('minimal create omits optional fields and all server-managed identities', async () => {
  const fetchMock = mockResponse(serverTask(), 201);
  await createApiTask({ title: 'Study' });
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ title: 'Study' });
});


test.each([null, '', '   '])('create normalizes cleared notes: %s', async (notes) => {
  const fetchMock = mockResponse(serverTask(), 201);
  await createApiTask({ title: 'Study', notes });
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ title: 'Study', notes: null });
});


test('recurring create preserves an omitted goal so the backend can inherit it', async () => {
  const fetchMock = mockResponse(serverTask({ recurring_rule_id: 8, recurrence_occurrence_date: '2026-10-20' }), 201);
  await createApiTask({ title: 'Study', recurringRuleId: 8, recurrenceOccurrenceDate: '2026-10-20' });
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
    title: 'Study', recurring_rule_id: 8, recurrence_occurrence_date: '2026-10-20',
  });
});


test('recurring create preserves explicit null when the user clears the goal', async () => {
  const fetchMock = mockResponse(serverTask({ goal_id: null, recurring_rule_id: 8, recurrence_occurrence_date: '2026-10-20' }), 201);
  await createApiTask({ title: 'Study', goalId: null, recurringRuleId: 8, recurrenceOccurrenceDate: '2026-10-20' });
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).goal_id).toBeNull();
});


test.each([
  [{ completed: true }, { completed: true }],
  [{ completed: false }, { completed: false }],
  [{ dueDate: '2026-10-22' }, { due_date: '2026-10-22' }],
  [{ dueDate: null }, { due_date: null }],
  [{ goalId: null }, { goal_id: null }],
  [{ goalId: 5 }, { goal_id: 5 }],
  [{ notes: null }, { notes: null }],
  [{ notes: '   ' }, { notes: null }],
  [{ title: '  Revised  ' }, { title: 'Revised' }],
  [{ priority: 0 }, { priority: 0 }],
  [{ title: undefined, dueDate: undefined, goalId: undefined }, {}],
  [{}, {}],
] as Array<[UpdateApiTaskInput, Record<string, unknown>]>)('PATCH changes only supplied fields: %j', async (input, expected) => {
  const fetchMock = mockResponse();
  const before = { ...input };
  await updateApiTask(12, input);
  expect(fetchMock).toHaveBeenCalledWith(`${BASE}${PATH}/12`, expect.objectContaining({
    method: 'PATCH', body: JSON.stringify(expected),
  }));
  expect(input).toEqual(before);
});


test('DELETE accepts the empty backend response and sends no task body', async () => {
  const fetchMock = mockResponse(undefined, 204);
  await expect(deleteApiTask(12)).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledWith(`${BASE}${PATH}/12`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


test('DELETE rejects an unexpected task object in the response', async () => {
  mockResponse(serverTask());
  const error = await getError(deleteApiTask(12));
  expect(error.kind).toBe('invalid-response');
  expect(error.mutationMayHaveSucceeded).toBe(true);
});


test('options forward the chosen server and future sync headers', async () => {
  const controller = new AbortController();
  const fetchMock = mockResponse();
  await updateApiTask(12, { completed: true }, {
    baseUrl: 'https://weekflow.example.test/', signal: controller.signal,
    timeoutMs: 1000, headers: { 'If-Match': 'synthetic-revision' },
  });
  expect(fetchMock.mock.calls[0][0]).toBe(`https://weekflow.example.test${PATH}/12`);
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ 'If-Match': 'synthetic-revision' }));
  expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});


test.each([0, -1, 2_147_483_648, SOURCE_TASK, 1.5, true, '12'])(
  'rejects invalid task identifiers before sending: %s', async (invalid) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const identity = invalid as unknown as number;
    for (const operation of [() => fetchApiTask(identity), () => updateApiTask(identity, {}), () => deleteApiTask(identity)]) {
      const error = await getError(operation());
      expect(error.kind).toBe('configuration');
      expect(error.mutationMayHaveSucceeded).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  }
);


test.each([1, 2_147_483_647])('accepts the PostgreSQL ID boundary %s', async (identity) => {
  mockResponse(serverTask({ id: identity }));
  expect((await fetchApiTask(identity)).id).toBe(identity);
});


test.each([
  { goalId: SOURCE_GOAL }, { goalId: null }, { recurringRuleId: 0 },
  { recurringRuleId: true }, { sourceGoalId: SOURCE_GOAL },
])('rejects invalid or unsupported list filters: %j', async (input) => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await getError(fetchApiTasks(input as unknown as TaskApiFilters));
  expect(error.kind).toBe('configuration');
  expect(fetchMock).not.toHaveBeenCalled();
});


test.each([
  { title: '' }, { title: '   ' }, { title: null }, { title: 12 },
  { title: 'Study', notes: 12 }, { title: 'Study', priority: true },
  { title: 'Study', priority: '1' }, { title: 'Study', priority: 3 },
  { title: 'Study', priority: -1 }, { title: 'Study', goalId: SOURCE_GOAL },
  { title: 'Study', dueDate: '2026-02-29' }, { title: 'Study', dueDate: '1900-02-29' },
  { title: 'Study', dueDate: '2026-10-20T00:00:00Z' },
  { title: 'Study', recurringRuleId: 8 },
  { title: 'Study', recurrenceOccurrenceDate: '2026-10-20' },
  { title: 'Study', recurringRuleId: 8, recurrenceOccurrenceDate: '2026-02-30' },
  { title: 'Study', sourceTaskId: SOURCE_TASK }, { title: 'Study', id: 12 },
  { title: 'Study', createdAt: '2026-10-20T00:00:00Z' },
  { title: 'Study', completed: true }, { title: 'Study', day: 'Monday' },
])('rejects invalid create data without sending: %j', async (input) => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await getError(createApiTask(input as unknown as CreateApiTaskInput));
  expect(error.kind).toBe('configuration');
  expect(error.mutationMayHaveSucceeded).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});


test.each([
  { completed: null }, { completed: 1 }, { completed: 'true' },
  { title: null }, { priority: null }, { notes: 12 },
  { goalId: SOURCE_GOAL }, { recurringRuleId: 8 },
  { recurrenceOccurrenceDate: '2026-10-20' },
  { source_goal_id: SOURCE_GOAL }, { sourceTaskId: SOURCE_TASK },
  { completedAt: '2026-10-20T12:00:00Z' },
])('rejects invalid PATCH data without sending: %j', async (input) => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await getError(updateApiTask(12, input as unknown as UpdateApiTaskInput));
  expect(error.kind).toBe('configuration');
  expect(fetchMock).not.toHaveBeenCalled();
});


test.each(['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])(
  'accepts a valid calendar date without changing its timezone: %s', async (dueDate) => {
    const fetchMock = mockResponse(serverTask({ due_date: dueDate }), 201);
    const result = await createApiTask({ title: 'Study', dueDate });
    expect(result.dueDate).toBe(dueDate);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).due_date).toBe(dueDate);
  }
);


test.each([
  ['id', 0], ['id', '12'], ['title', '  '], ['day', 'NotADay'],
  ['due_date', '2026-02-30'], ['due_date', undefined],
  ['notes', 12], ['priority', 3], ['priority', true], ['completed', 1],
  ['created_at', 'invalid'], ['created_at', '2026-10-20'],
  ['created_at', '2026-02-30T12:00:00Z'], ['completed_at', 'invalid'],
  ['goal_id', SOURCE_GOAL], ['recurring_rule_id', SOURCE_RULE],
  ['source_task_id', Number.MAX_SAFE_INTEGER + 1],
  ['source_goal_id', 0], ['source_recurring_rule_id', -1],
  ['recurrence_occurrence_date', '2026-10-20'],
  ['recurring_rule_id', 8],
] as Array<[string, unknown]>)('rejects malformed TaskRead field %s=%s', async (field, value) => {
  mockResponse({ ...serverTask(), [field]: value });
  const error = await getError(fetchApiTask(12));
  expect(error.kind).toBe('invalid-response');
  expect(error.mutationMayHaveSucceeded).toBe(false);
});


test('list validation rejects duplicate task IDs', async () => {
  mockResponse([serverTask(), serverTask()]);
  await expect(fetchApiTasks()).rejects.toMatchObject({ kind: 'invalid-response' });
});


test('list validation rejects one invalid row instead of returning a partial cache', async () => {
  mockResponse([serverTask(), { ...serverTask({ id: 13 }), completed: 'false' }]);
  await expect(fetchApiTasks()).rejects.toMatchObject({ kind: 'invalid-response' });
});


test('a non-list response is rejected by both list clients', async () => {
  mockResponse({ tasks: [] });
  await expect(fetchApiTasks()).rejects.toMatchObject({ kind: 'invalid-response' });
  await expect(fetchServerTasks(BASE)).rejects.toMatchObject({ kind: 'invalid-response' });
});


test('reading a different task than requested is rejected', async () => {
  mockResponse(serverTask({ id: 13 }));
  const error = await getError(fetchApiTask(12));
  expect(error.kind).toBe('invalid-response');
  expect(error.mutationMayHaveSucceeded).toBe(false);
});


test('a mismatched update response leaves the write outcome uncertain', async () => {
  mockResponse(serverTask({ id: 13 }));
  const error = await getError(updateApiTask(12, { completed: true }));
  expect(error.kind).toBe('invalid-response');
  expect(error.mutationMayHaveSucceeded).toBe(true);
});


test.each([409, 422, 500])('server error %s propagates without retry or local success', async (status) => {
  const fetchMock = mockResponse({ detail: 'Server rejected or failed the operation' }, status);
  const error = await getError(updateApiTask(12, { completed: true }));
  expect(error.kind).toBe('http');
  expect(error.status).toBe(status);
  expect(error.mutationMayHaveSucceeded).toBe(status >= 500);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


test('a disconnected create remains uncertain and is not automatically repeated', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Mock lost connection'));
  const error = await getError(createApiTask({ title: 'Study' }));
  expect(error.kind).toBe('network');
  expect(error.mutationMayHaveSucceeded).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
