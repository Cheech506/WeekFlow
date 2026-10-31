/** Mocked HTTP checks; these tests never write to a live database. */
import {
    editApiRecurringSeries,
    type EditApiRecurringSeriesInput,
} from '../lib/api/recurringTaskWorkflowApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const INPUT: EditApiRecurringSeriesInput = {
  title: 'Study', notes: null, priority: 0, goalId: null,
  frequency: 'weekly', startDate: '2026-10-22', endDate: null,
  weekdays: [], currentDate: '2026-10-22',
};
function result() {
  return {
    rule: {
      id: 41, source_recurring_rule_id: null as number | null,
      goal_id: null as number | null, title: 'Study', notes: null as string | null,
      priority: 0, frequency: 'weekly', start_date: '2026-10-22', end_date: null as string | null,
      weekdays: [] as number[], active: true, created_at: '2026-10-01T12:00:00Z',
    },
    generation: {
      current_date: '2026-10-22', horizon_days: 30, window_end: '2026-11-21',
      rules_checked: 1, candidate_count: 2, created_count: 1, existing_count: 1,
      skipped_count: 0, created_task_ids: [501], database_changed: true,
    },
    deleted_task_ids: [20, 21], updated_task_ids: [19],
  };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(JSON.stringify(value), { status }));
}
function sentBody() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('posts one complete edit and decodes the saved schedule and affected task IDs', async () => {
  respond(result());
  const saved = await editApiRecurringSeries(41, INPUT, OPTIONS);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/recurring-rules/41/edit-series');
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(sentBody()).toEqual({
    title: 'Study', notes: null, priority: 0, goal_id: null,
    frequency: 'weekly', start_date: '2026-10-22', end_date: null,
    weekdays: [], current_date: '2026-10-22', horizon_days: 30,
  });
  expect(saved.rule).toMatchObject({ id: 41, startDate: '2026-10-22', active: true });
  expect(saved.generation.createdTaskIds).toEqual([501]);
  expect(saved.deletedTaskIds).toEqual([20, 21]);
  expect(saved.updatedTaskIds).toEqual([19]);
});

test('normalizes fields and accepts a selected-days pattern that starts on an unselected day', async () => {
  const response = result();
  Object.assign(response.rule, { frequency: 'certainDays', weekdays: [1, 3], notes: 'Notes', goal_id: 9 });
  respond(response);
  const weekdays = [3, 1];
  await editApiRecurringSeries(41, { ...INPUT, title: ' Study ', notes: ' Notes ',
    goalId: 9, frequency: 'certainDays', weekdays }, OPTIONS);
  expect(sentBody()).toMatchObject({ title: 'Study', notes: 'Notes', goal_id: 9, weekdays: [1, 3] });
  expect(weekdays).toEqual([3, 1]);
});

test('accepts a paused schedule with no generated candidates', async () => {
  const response = result();
  response.rule.active = false;
  Object.assign(response.generation, { candidate_count: 0, created_count: 0,
    existing_count: 0, created_task_ids: [], database_changed: false });
  respond(response);
  const saved = await editApiRecurringSeries(41, INPUT, OPTIONS);
  expect(saved.rule.active).toBe(false);
  expect(saved.generation.databaseChanged).toBe(false);
  expect(saved.deletedTaskIds).toEqual([20, 21]);
  expect(sentBody()).not.toHaveProperty('active');
});

test('captures the submitted form and weekdays before awaiting the response', async () => {
  const response = result();
  Object.assign(response.rule, { frequency: 'certainDays', weekdays: [1, 3] });
  respond(response);
  const form = { ...INPUT, weekdays: [3, 1], frequency: 'certainDays' as const };
  const pending = editApiRecurringSeries(41, form, OPTIONS);
  form.title = 'Changed';
  form.startDate = '2026-10-29';
  form.weekdays.push(5);
  expect((await pending).rule.title).toBe('Study');
  expect(sentBody().weekdays).toEqual([1, 3]);
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source schedule ID %j before sending', async (id) => {
  await expect(editApiRecurringSeries(id as number, INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['notes', 'priority', 'goalId', 'endDate', 'weekdays', 'startDate'])('requires full edit field %s', async (field) => {
  const input: Record<string, unknown> = { ...INPUT };
  delete input[field];
  await expect(editApiRecurringSeries(41, input as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { active: true }, { sourceRecurringRuleId: 1781204320001 },
  { title: ' ' }, { priority: true }, { goalId: 1781204320001 },
  { frequency: 'yearly' }, { startDate: '2026-02-29' }, { endDate: '2026-10-21' },
  { weekdays: [1, 1] }, { frequency: 'certainDays', weekdays: [] },
  { horizonDays: 367 }, { horizonDays: '30' },
  { currentDate: '9999-12-31', horizonDays: 1 },
])('rejects invalid edit input %j without sending', async (changes) => {
  await expect(editApiRecurringSeries(41, { ...INPUT, ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['0001-01-01', '2028-02-29'])('accepts supported date %s with zero-day horizon', async (date) => {
  const response = result();
  response.rule.start_date = date;
  Object.assign(response.generation, { current_date: date, horizon_days: 0, window_end: date });
  respond(response);
  expect((await editApiRecurringSeries(41, { ...INPUT, startDate: date, currentDate: date, horizonDays: 0 }, OPTIONS)).rule.startDate).toBe(date);
});

const BAD_RESPONSES: Array<[string, (value: ReturnType<typeof result>) => void]> = [
  ['wrong schedule', (r) => { r.rule.id = 42; }],
  ['wrong title', (r) => { r.rule.title = 'Other'; }],
  ['wrong goal', (r) => { r.rule.goal_id = 9; }],
  ['wrong start', (r) => { r.rule.start_date = '2026-10-23'; }],
  ['wrong generation date', (r) => { r.generation.current_date = '2026-10-23'; }],
  ['wrong generation horizon', (r) => { r.generation.horizon_days = 31; }],
  ['wrong generation total', (r) => { r.generation.candidate_count = 99; }],
  ['multiple schedules', (r) => { r.generation.rules_checked = 2; }],
  ['created and deleted overlap', (r) => { r.deleted_task_ids = [501]; }],
  ['created and updated overlap', (r) => { r.updated_task_ids = [501]; }],
  ['deleted and updated overlap', (r) => { r.updated_task_ids = [20]; }],
  ['duplicate deleted IDs', (r) => { r.deleted_task_ids = [20, 20]; }],
  ['duplicate updated IDs', (r) => { r.updated_task_ids = [19, 19]; }],
  ['source ID in affected tasks', (r) => { r.updated_task_ids = [1781204320001]; }],
  ['missing affected list', (r) => { delete (r as Partial<typeof r>).updated_task_ids; }],
  ['paused schedule with generated tasks', (r) => { r.rule.active = false; }],
];
test.each(BAD_RESPONSES)('rejects inconsistent response: %s without retrying', async (_name, change) => {
  const response = result(); change(response); respond(response);
  await expect(editApiRecurringSeries(41, INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([404, 409, 422, 500])('preserves HTTP %s without retrying', async (status) => {
  respond({ detail: 'Schedule edit failed.' }, status);
  await expect(editApiRecurringSeries(41, INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('network failure marks the write uncertain and does not resend it', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(editApiRecurringSeries(41, INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
