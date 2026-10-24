/** Mock HTTP checks for weekly task actions and preserved decision history. */
import {
  applyApiWeeklyTaskDecision, deleteApiWeeklyTaskDecision,
  fetchApiWeeklyTaskDecision, fetchApiWeeklyTaskDecisions,
} from '../lib/api/weeklyTaskDecisionApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/weekly-task-decisions';
const WEEK = '2026-10-19';
const ORIGINAL = '2026-10-20';
function decision(changes: Record<string, unknown> = {}) {
  return { id: 41, source_weekly_task_decision_id: 1781204320001, week_start: WEEK,
    task_id: 12, task_title: 'Study', original_due_date: ORIGINAL, action: 'keep', resolved_due_date: null,
    recurring_rule_id: null, source_recurring_rule_id: null, recurrence_occurrence_date: null,
    decided_at: '2026-10-22T12:00:00Z', ...changes };
}
const BASE = { weekStart: WEEK, taskId: 12, originalDueDate: ORIGINAL };
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockImplementation(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(value), { status })));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('maps history with native and source identities and server decision time', async () => {
  respond([decision()]);
  expect((await fetchApiWeeklyTaskDecisions({}, OPTIONS))[0]).toEqual({ id: 41,
    sourceWeeklyTaskDecisionId: 1781204320001, weekStart: WEEK, taskId: 12, taskTitle: 'Study',
    originalDueDate: ORIGINAL, action: 'keep', resolvedDueDate: null, recurringRuleId: null,
    sourceRecurringRuleId: null, recurrenceOccurrenceDate: null, decidedAt: '2026-10-22T12:00:00Z' });
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test('captures all list filters before caller mutation', async () => {
  respond([decision({ recurring_rule_id: 9, recurrence_occurrence_date: '2026-09-01' })]);
  const filters = { weekStart: WEEK, taskId: 12, recurringRuleId: 9, action: 'keep' as const };
  const pending = fetchApiWeeklyTaskDecisions(filters, OPTIONS);
  filters.taskId = 13; filters.recurringRuleId = 10; filters.weekStart = '2026-10-26';
  expect((await pending)[0].taskId).toBe(12);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?week_start=${WEEK}&task_id=12&recurring_rule_id=9&action=keep`);
});

test('reads one decision by native ID', async () => {
  respond(decision());
  expect((await fetchApiWeeklyTaskDecision(41, OPTIONS)).id).toBe(41);
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test.each([
  { action: 'keep', resolved: null }, { action: 'inbox', resolved: null },
  { action: 'delete', resolved: null }, { action: 'nextWeek', resolved: '2026-10-27' },
  { action: 'reschedule', resolved: '2026-11-04' },
])('applies $action with one POST and accepts its returned history', async ({ action, resolved }) => {
  respond(decision({ source_weekly_task_decision_id: null, action,
    resolved_due_date: resolved, task_id: action === 'delete' ? null : 12 }), 201);
  const input = action === 'reschedule' ? { ...BASE, action, resolvedDueDate: resolved } : { ...BASE, action };
  const saved = await applyApiWeeklyTaskDecision(input as never, OPTIONS);
  expect(saved.action).toBe(action);
  expect(body()).toEqual({ week_start: WEEK, task_id: 12, original_due_date: ORIGINAL,
    action, resolved_due_date: resolved });
  // Even delete sends the existing task ID. Only the RESULT has taskId=null.
  expect(body().task_id).toBe(12);
  expect(fetchSpy).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([200, 201])('accepts existing/imported or new decision at HTTP %s', async (status) => {
  respond(decision(), status);
  const saved = await applyApiWeeklyTaskDecision({ ...BASE, action: 'keep' }, OPTIONS);
  expect(saved.sourceWeeklyTaskDecisionId).toBe(1781204320001);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('keeps original task due date separate from original recurring occurrence date', async () => {
  respond(decision({ action: 'inbox', recurring_rule_id: 9, source_recurring_rule_id: 1781204320002,
    recurrence_occurrence_date: '2026-09-01' }), 201);
  const saved = await applyApiWeeklyTaskDecision({ ...BASE, action: 'inbox' }, OPTIONS);
  expect(saved.originalDueDate).toBe(ORIGINAL);
  expect(saved.recurrenceOccurrenceDate).toBe('2026-09-01');
  expect(body()).not.toHaveProperty('recurrence_occurrence_date');
  expect(body()).not.toHaveProperty('recurring_rule_id');
});

test('reads legacy source-only recurring history without inventing a native schedule ID', async () => {
  respond(decision({ recurring_rule_id: null, source_recurring_rule_id: 1781204320002,
    recurrence_occurrence_date: '2026-09-01' }));
  expect((await fetchApiWeeklyTaskDecision(41, OPTIONS)).recurringRuleId).toBeNull();
});

test.each(['keep', 'inbox', 'reschedule', 'nextWeek'])('history can outlive a deleted task for action %s', async (action) => {
  respond(decision({ action, task_id: null,
    resolved_due_date: action === 'reschedule' ? '2026-11-04' : action === 'nextWeek' ? '2026-10-27' : null }));
  expect((await fetchApiWeeklyTaskDecision(41, OPTIONS)).taskId).toBeNull();
});

test('multiple task-less deleted history records are allowed', async () => {
  respond([decision({ action: 'delete', task_id: null }), decision({ id: 42, action: 'delete', task_id: null })]);
  expect(await fetchApiWeeklyTaskDecisions({}, OPTIONS)).toHaveLength(2);
});

test('the same live task may have history for different original due dates in one week', async () => {
  respond([decision(), decision({ id: 42, original_due_date: '2026-10-21' })]);
  expect(await fetchApiWeeklyTaskDecisions({}, OPTIONS)).toHaveLength(2);
});

test('captures the request before caller mutation', async () => {
  respond(decision(), 201);
  const input = { ...BASE, action: 'keep' as const };
  const pending = applyApiWeeklyTaskDecision(input, OPTIONS);
  input.originalDueDate = '2026-10-21'; input.taskId = 13;
  expect((await pending).taskId).toBe(12);
  expect(body().original_due_date).toBe(ORIGINAL);
});

test.each([undefined, null, '2026-10-27'])('nextWeek accepts omitted, null, or exact target %j', async (resolvedDueDate) => {
  respond(decision({ action: 'nextWeek', resolved_due_date: '2026-10-27' }), 201);
  await applyApiWeeklyTaskDecision({ ...BASE, action: 'nextWeek', resolvedDueDate }, OPTIONS);
  expect(body().resolved_due_date).toBe('2026-10-27');
});

test('nextWeek adds seven calendar days across a year boundary', async () => {
  respond(decision({ week_start: '2026-12-28', original_due_date: '2026-12-29', action: 'nextWeek', resolved_due_date: '2027-01-05' }), 201);
  const saved = await applyApiWeeklyTaskDecision({ weekStart: '2026-12-28', taskId: 12,
    originalDueDate: '2026-12-29', action: 'nextWeek' }, OPTIONS);
  expect(saved.resolvedDueDate).toBe('2027-01-05');
});

test('keep permits the final supported calendar week without overflowing', async () => {
  respond(decision({ week_start: '9999-12-27', original_due_date: '9999-12-31' }), 201);
  expect((await applyApiWeeklyTaskDecision({ weekStart: '9999-12-27', taskId: 12,
    originalDueDate: '9999-12-31', action: 'keep' }, OPTIONS)).originalDueDate).toBe('9999-12-31');
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source ID %j before sending', async (id) => {
  await expect(fetchApiWeeklyTaskDecision(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiWeeklyTaskDecision(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(applyApiWeeklyTaskDecision({ ...BASE, taskId: id, action: 'keep' } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyTaskDecisions({ taskId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyTaskDecisions({ recurringRuleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { weekStart: '2026-10-20' }, { originalDueDate: '2026-10-18' }, { originalDueDate: '2026-10-26' },
  { originalDueDate: '2026-02-30' }, { taskId: null }, { action: 'complete' },
  { action: 'nextWeek', resolvedDueDate: '2026-10-28' },
  { action: 'reschedule', resolvedDueDate: null }, { action: 'reschedule', resolvedDueDate: '2026-02-29' },
  { action: 'keep', resolvedDueDate: '2026-11-01' }, { action: 'inbox', resolvedDueDate: '2026-11-01' },
  { action: 'delete', resolvedDueDate: '2026-11-01' },
  { taskTitle: 'Forged title' }, { recurringRuleId: 9 }, { recurrenceOccurrenceDate: ORIGINAL },
  { sourceWeeklyTaskDecisionId: 1781204320001 }, { decidedAt: '2026-10-22T12:00:00Z' },
])('rejects invalid or server-owned action input %j', async (changes) => {
  await expect(applyApiWeeklyTaskDecision({ ...BASE, action: 'keep', ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('nextWeek rejects a calendar overflow before sending', async () => {
  await expect(applyApiWeeklyTaskDecision({ weekStart: '9999-12-27', taskId: 12,
    originalDueDate: '9999-12-31', action: 'nextWeek' }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ weekStart: '2026-10-20' }, { action: 'complete' }, { sourceTaskId: 1781204320001 }])('rejects invalid filters %j', async (filters) => {
  await expect(fetchApiWeeklyTaskDecisions(filters as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 0 }, { source_weekly_task_decision_id: -1 }, { task_id: 1781204320001 },
  { task_title: ' ' }, { week_start: '2026-10-20' }, { original_due_date: '2026-10-26' },
  { action: 'complete' }, { action: 'delete', task_id: 12 },
  { action: 'reschedule', resolved_due_date: null }, { action: 'keep', resolved_due_date: '2026-11-01' },
  { action: 'nextWeek', resolved_due_date: '2026-10-28' },
  { recurring_rule_id: 9, recurrence_occurrence_date: null },
  { source_recurring_rule_id: 1781204320002, recurrence_occurrence_date: null },
  { recurrence_occurrence_date: ORIGINAL }, { recurring_rule_id: 1781204320001 },
  { decided_at: '2026-02-29T12:00:00Z' },
])('rejects malformed or inconsistent history response %j', async (changes) => {
  respond(decision(changes));
  await expect(fetchApiWeeklyTaskDecision(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { rows: [decision(), decision()] },
  { rows: [decision(), decision({ id: 42 })] },
  { rows: [decision({ task_id: 13 })] },
  { rows: [decision({ recurring_rule_id: 10, recurrence_occurrence_date: ORIGINAL })] },
  { rows: [decision({ action: 'inbox' })] },
])('rejects duplicate identities or entries outside requested filters', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiWeeklyTaskDecisions({ weekStart: WEEK, taskId: 12, recurringRuleId: 9, action: 'keep' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('rejects a different returned decision ID', async () => {
  respond(decision({ id: 42 }));
  await expect(fetchApiWeeklyTaskDecision(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { task_id: 13 }, { task_id: null }, { action: 'inbox' },
  { original_due_date: '2026-10-21' }, { week_start: '2026-10-26', original_due_date: '2026-10-27' },
])('rejects a successful action response that contradicts its request %j', async (changes) => {
  respond(decision(changes), 201);
  await expect(applyApiWeeklyTaskDecision({ ...BASE, action: 'keep' }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('long saved task titles are retained without imposing a commitment title limit', async () => {
  const title = 'x'.repeat(20000);
  respond(decision({ task_title: title }));
  expect((await fetchApiWeeklyTaskDecision(41, OPTIONS)).taskTitle).toBe(title);
});

test.each([404, 409, 422, 500])('preserves action HTTP %s without retrying or applying a separate task edit', async (status) => {
  respond({ detail: 'Refresh the task before deciding.' }, status);
  await expect(applyApiWeeklyTaskDecision({ ...BASE, action: 'nextWeek' }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('a lost response never automatically repeats a task action', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(applyApiWeeklyTaskDecision({ ...BASE, action: 'delete' }, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('deleting history sends one DELETE and does not undo a move or remove a skip', async () => {
  respond(null, 204);
  await expect(deleteApiWeeklyTaskDecision(41, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
