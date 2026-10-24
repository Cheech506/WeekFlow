/** Mocked HTTP tests: no live API or PostgreSQL writes. */
import {
    convertApiTaskToRecurring,
    detachApiRecurringTask,
    editApiRecurringFromOccurrence,
    type EditApiRecurringFromOccurrenceInput,
} from '../lib/api/recurringTaskWorkflowApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const CONVERT = { title: 'Study', frequency: 'weekly' as const, startDate: '2026-10-22', currentDate: '2026-10-22' };
const EDIT: EditApiRecurringFromOccurrenceInput = {
  title: 'Study', notes: null, priority: 0, goalId: null,
  frequency: 'weekly', endDate: null, weekdays: [], currentDate: '2026-10-22',
};
function result() {
  return {
    task: {
      id: 12, title: 'Study', day: 'Thursday', due_date: '2026-10-22', notes: null,
      priority: 0, completed: false, created_at: '2026-10-01T12:00:00Z', completed_at: null,
      goal_id: null, recurring_rule_id: 41, source_task_id: 1781204320001,
      source_goal_id: null, source_recurring_rule_id: null, recurrence_occurrence_date: '2026-10-22',
    },
    rule: {
      id: 41, source_recurring_rule_id: null, goal_id: null, title: 'Study', notes: null,
      priority: 0, frequency: 'weekly', start_date: '2026-10-22', end_date: null,
      weekdays: [], active: true, created_at: '2026-10-22T12:00:00Z',
    },
    generation: {
      current_date: '2026-10-22', horizon_days: 30, window_end: '2026-11-21', rules_checked: 1,
      candidate_count: 2, created_count: 1, existing_count: 1, skipped_count: 0,
      created_task_ids: [501], database_changed: true,
    },
    deleted_task_ids: [] as number[],
  };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify(value), { status }));
}
function sentBody() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('converts in one POST and decodes all returned objects without changing identity', async () => {
  respond(result(), 201);
  const saved = await convertApiTaskToRecurring(12, CONVERT, OPTIONS);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/tasks/12/convert-to-recurring');
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(sentBody()).toEqual({ title: 'Study', notes: null, priority: 0, goal_id: null,
    frequency: 'weekly', start_date: '2026-10-22', end_date: null, weekdays: [],
    current_date: '2026-10-22', horizon_days: 30 });
  expect(saved.task).toMatchObject({ id: 12, recurringRuleId: 41, sourceTaskId: 1781204320001, createdAt: '2026-10-01T12:00:00Z' });
  expect(saved.rule.id).toBe(41);
  expect(saved.generation.createdTaskIds).toEqual([501]);
  expect(saved.deletedTaskIds).toEqual([]);
});

test.each([null, '2026-11-02'])('series editing preserves selected due date %j and accepts a paused schedule', async (dueDate) => {
  const response = result();
  Object.assign(response.task, { due_date: dueDate, day: dueDate === null ? 'Inbox' : 'Monday' });
  response.rule.active = false;
  response.deleted_task_ids = [20, 21];
  respond(response);
  const saved = await editApiRecurringFromOccurrence(12, EDIT, OPTIONS);
  expect(saved.task.dueDate).toBe(dueDate);
  expect(saved.task.recurrenceOccurrenceDate).toBe('2026-10-22');
  expect(saved.rule.active).toBe(false);
  expect(saved.deletedTaskIds).toEqual([20, 21]);
  expect(fetchSpy.mock.calls[0][0]).toContain('/12/edit-recurring-from-occurrence');
  expect(sentBody()).not.toHaveProperty('start_date');
  expect(sentBody()).not.toHaveProperty('active');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('normalizes the complete form and retains explicit zero, null, and selected weekdays', async () => {
  const response = result();
  Object.assign(response.rule, { frequency: 'certainDays', weekdays: [1, 4], notes: 'Keep notes', goal_id: 9 });
  Object.assign(response.task, { notes: 'Keep notes', goal_id: 9 });
  respond(response);
  const days = [4, 1];
  await editApiRecurringFromOccurrence(12, { ...EDIT, title: ' Study ', notes: ' Keep notes ',
    goalId: 9, frequency: 'certainDays', weekdays: days }, OPTIONS);
  expect(days).toEqual([4, 1]);
  expect(sentBody()).toMatchObject({ title: 'Study', notes: 'Keep notes', goal_id: 9, priority: 0, weekdays: [1, 4] });
});

test('captures the input before awaiting the response', async () => {
  respond(result(), 201);
  const form = { ...CONVERT };
  const pending = convertApiTaskToRecurring(12, form, OPTIONS);
  form.title = 'Changed';
  form.startDate = '2026-10-29';
  expect((await pending).task.title).toBe('Study');
  expect(sentBody().start_date).toBe('2026-10-22');
});

test.each([0, -1, 1.5, 1781204320001, true])('rejects invalid or source task ID %j', async (id) => {
  await expect(convertApiTaskToRecurring(id as number, CONVERT, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(editApiRecurringFromOccurrence(id as number, EDIT, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { title: ' ' }, { frequency: 'yearly' }, { startDate: '2026-02-29' },
  { currentDate: '2026-04-31' }, { horizonDays: -1 }, { horizonDays: 367 },
  { horizonDays: 1.5 }, { horizonDays: null }, { currentDate: '9999-12-31', horizonDays: 1 },
  { goalId: 1781204320001 }, { notes: 9 }, { priority: true }, { endDate: '2026-10-01' },
  { weekdays: [1, 1] }, { weekdays: [7] }, { frequency: 'certainDays', weekdays: [] },
  { frequency: 'certainDays', weekdays: [1] }, { active: false }, { sourceTaskId: 1781204320001 },
])('rejects invalid conversion input %j without sending', async (change) => {
  await expect(convertApiTaskToRecurring(12, { ...CONVERT, ...change } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['notes', 'priority', 'goalId', 'endDate', 'weekdays'])('requires full series-edit field %s', async (key) => {
  const form: Record<string, unknown> = { ...EDIT };
  delete form[key];
  await expect(editApiRecurringFromOccurrence(12, form as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ active: true }, { startDate: '2026-10-22' }, { sourceRecurringRuleId: 1781204320001 }])('rejects server-owned series-edit fields %j', async (extra) => {
  await expect(editApiRecurringFromOccurrence(12, { ...EDIT, ...extra } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['0001-01-01', '2028-02-29'])('accepts supported calendar date %s with a zero-day horizon', async (date) => {
  const response = result();
  response.rule.start_date = date;
  response.task.recurrence_occurrence_date = date;
  response.task.due_date = date;
  Object.assign(response.generation, { current_date: date, horizon_days: 0, window_end: date });
  respond(response, 201);
  expect((await convertApiTaskToRecurring(12, { ...CONVERT, startDate: date, currentDate: date, horizonDays: 0 }, OPTIONS)).rule.startDate).toBe(date);
});

const BAD_RESPONSES: Array<[string, (value: ReturnType<typeof result>) => void]> = [
  ['wrong selected task', (r) => { r.task.id = 13; }],
  ['completed selected task', (r) => { r.task.completed = true; r.task.completed_at = '2026-10-22T12:00:00Z' as never; }],
  ['wrong schedule link', (r) => { r.task.recurring_rule_id = 99; }],
  ['wrong occurrence anchor', (r) => { r.task.recurrence_occurrence_date = '2026-10-23'; }],
  ['task goal mismatch', (r) => { r.task.goal_id = 9 as never; }],
  ['changed form values', (r) => { r.task.title = 'Other'; r.rule.title = 'Other'; }],
  ['wrong generation date', (r) => { r.generation.current_date = '2026-10-23'; }],
  ['wrong horizon', (r) => { r.generation.horizon_days = 31; }],
  ['wrong window', (r) => { r.generation.window_end = '2026-11-22'; }],
  ['multiple schedules checked', (r) => { r.generation.rules_checked = 2; }],
  ['incorrect total', (r) => { r.generation.candidate_count = 99; }],
  ['duplicate generated IDs', (r) => { Object.assign(r.generation, { created_task_ids: [501, 501], created_count: 2, candidate_count: 3 }); }],
  ['retained task generated', (r) => { r.generation.created_task_ids = [12]; }],
  ['retained task deleted', (r) => { r.deleted_task_ids = [12]; }],
  ['created task also deleted', (r) => { r.deleted_task_ids = [501]; }],
  ['duplicate deleted IDs', (r) => { r.deleted_task_ids = [20, 20]; }],
  ['source ID in deleted list', (r) => { r.deleted_task_ids = [1781204320001]; }],
  ['incorrect change flag', (r) => { r.generation.database_changed = false; }],
];
test.each(BAD_RESPONSES)('rejects inconsistent series-edit response: %s', async (_label, change) => {
  const response = result(); change(response); respond(response);
  await expect(editApiRecurringFromOccurrence(12, EDIT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each(['deleted IDs', 'paused schedule', 'wrong first due date'])('rejects conversion-specific mismatch: %s', async (kind) => {
  const response = result();
  if (kind === 'deleted IDs') response.deleted_task_ids = [20];
  if (kind === 'paused schedule') response.rule.active = false;
  if (kind === 'wrong first due date') response.task.due_date = '2026-10-23';
  respond(response, 201);
  await expect(convertApiTaskToRecurring(12, CONVERT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([404, 409, 422])('preserves HTTP %s and does not retry', async (status) => {
  respond({ detail: 'Cannot apply this action.' }, status);
  await expect(convertApiTaskToRecurring(12, CONVERT, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: false });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('network failure marks the write uncertain and does not repeat it', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(editApiRecurringFromOccurrence(12, EDIT, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

function detachedTask(changes: Record<string, unknown> = {}) {
  return {
    ...result().task, recurring_rule_id: null, source_recurring_rule_id: null,
    recurrence_occurrence_date: null, ...changes,
  };
}

test('detach sends one bodyless POST and preserves returned task identity, goal, and metadata', async () => {
  respond(detachedTask({ goal_id: 9, source_goal_id: 1781204320002, notes: 'Keep notes', priority: 2 }));
  const saved = await detachApiRecurringTask(12, OPTIONS);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/tasks/12/detach-recurring');
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(saved).toMatchObject({ id: 12, sourceTaskId: 1781204320001, goalId: 9,
    sourceGoalId: 1781204320002, createdAt: '2026-10-01T12:00:00Z',
    notes: 'Keep notes', priority: 2, recurringRuleId: null,
    sourceRecurringRuleId: null, recurrenceOccurrenceDate: null });
});

test.each([null, '2026-11-02'])('detach accepts preserved due date %j', async (date) => {
  respond(detachedTask({ due_date: date, day: date === null ? 'Inbox' : 'Monday' }));
  expect((await detachApiRecurringTask(12, OPTIONS)).dueDate).toBe(date);
});

test.each([0, -1, 1.5, 1781204320001, true])('detach rejects invalid/source task ID %j before sending', async (id) => {
  await expect(detachApiRecurringTask(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 13 },
  { recurring_rule_id: 41, recurrence_occurrence_date: '2026-10-22' },
  { source_recurring_rule_id: 1781204320001, recurrence_occurrence_date: '2026-10-22' },
  { recurrence_occurrence_date: '2026-10-22' },
  { completed: true, completed_at: '2026-10-22T12:00:00Z' },
  { completed_at: '2026-10-22T12:00:00Z' },
  { title: null },
])('detach rejects an inconsistent successful response %j and marks the write uncertain', async (changes) => {
  respond(detachedTask(changes));
  await expect(detachApiRecurringTask(12, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([null, [], { task: detachedTask() }])('detach rejects a malformed response shape %j', async (value) => {
  respond(value);
  await expect(detachApiRecurringTask(12, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([404, 409, 422, 500])('detach preserves HTTP %s without retrying', async (status) => {
  respond({ detail: 'Detach could not be applied.' }, status);
  await expect(detachApiRecurringTask(12, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('detach network failure remains uncertain and is never automatically retried', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(detachApiRecurringTask(12, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
