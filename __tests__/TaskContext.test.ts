// Mocks precede imports because WeekFlow's transformer does not hoist them.
jest.mock('@/lib/api/taskApi', () => ({
  createApiTask: jest.fn(), deleteApiTask: jest.fn(), fetchApiTasks: jest.fn(), updateApiTask: jest.fn(),
}));
jest.mock('@/lib/api/taskTemplateApi', () => ({
  createApiTaskFromTemplate: jest.fn(), createApiTaskTemplate: jest.fn(),
  deleteApiTaskTemplate: jest.fn(), fetchApiTaskTemplates: jest.fn(), updateApiTaskTemplate: jest.fn(),
}));
jest.mock('@/lib/api/recurringRuleApi', () => ({
  createApiRecurringRule: jest.fn(), deleteApiRecurringRule: jest.fn(), fetchApiRecurringRules: jest.fn(),
  generateApiRecurringTasks: jest.fn(), updateApiRecurringRule: jest.fn(),
}));
jest.mock('@/lib/api/recurringTaskWorkflowApi', () => ({
  convertApiTaskToRecurring: jest.fn(), detachApiRecurringTask: jest.fn(),
  editApiRecurringFromOccurrence: jest.fn(), editApiRecurringSeries: jest.fn(),
}));
jest.mock('@/context/CelebrationContext', () => ({ useCelebrations: jest.fn() }));
jest.mock('@/lib/taskStorage', () => { throw new Error('TaskContext must not load SQLite storage'); });
jest.mock('@/lib/recurringStorage', () => { throw new Error('TaskContext must not load SQLite schedules'); });
jest.mock('@/lib/taskTemplateStorage', () => { throw new Error('TaskContext must not load SQLite templates'); });

import { useCelebrations } from '@/context/CelebrationContext';
import { TaskProvider, useTasks } from '@/context/TaskContext';
import * as rulesApi from '@/lib/api/recurringRuleApi';
import * as workflowsApi from '@/lib/api/recurringTaskWorkflowApi';
import * as tasksApi from '@/lib/api/taskApi';
import * as templatesApi from '@/lib/api/taskTemplateApi';
import { getLocalDateKey, getNextOccurrenceDateKey } from '@/lib/dateUtils';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const tasks = jest.mocked(tasksApi);
const templates = jest.mocked(templatesApi);
const rules = jest.mocked(rulesApi);
const workflows = jest.mocked(workflowsApi);
const celebrate = jest.fn();
const original: tasksApi.ApiTask = {
  id: 12, sourceTaskId: 1781204320001, title: 'Study', notes: 'Notes', priority: 1,
  day: 'Inbox', dueDate: null, goalId: 9, recurringRuleId: null,
  sourceGoalId: 1781204320002, sourceRecurringRuleId: null,
  recurrenceOccurrenceDate: null, completed: false, completedAt: null,
  createdAt: '2026-10-01T12:00:00Z',
};
const rule: rulesApi.ApiRecurringRule = {
  id: 41, sourceRecurringRuleId: 1781204320003, title: 'Study', notes: 'Notes', priority: 1,
  goalId: 9, frequency: 'daily', startDate: '2026-10-01', endDate: null,
  weekdays: [], active: true, createdAt: '2026-10-01T12:00:00Z',
};
const template: templatesApi.ApiTaskTemplate = {
  id: 51, sourceTaskTemplateId: 1781204320004, title: 'Study', notes: 'Notes',
  priority: 1, goalId: 9, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
};
const generation: rulesApi.ApiRecurrenceGenerationResult = {
  currentDate: getLocalDateKey(new Date()), horizonDays: 30, windowEnd: '2026-11-23',
  rulesChecked: 1, candidateCount: 0, createdCount: 0, existingCount: 0,
  skippedCount: 0, createdTaskIds: [], databaseChanged: false,
};
const workflow = { task: original, rule, generation, deletedTaskIds: [] };
const scheduleInput = {
  title: 'Schedule edit', frequency: 'daily' as const, startDate: '2026-10-01',
  notes: 'Keep notes', priority: 2, goalId: 9, endDate: null, weekdays: [] as number[],
};
let value: ReturnType<typeof useTasks>;
let root: ReturnType<typeof createRoot> | undefined;
function Probe() { value = useTasks(); return null; }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(TaskProvider, { children: React.createElement(Probe) })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  tasks.fetchApiTasks.mockResolvedValue([original]);
  rules.fetchApiRecurringRules.mockResolvedValue([rule]);
  templates.fetchApiTaskTemplates.mockResolvedValue([template]);
  rules.generateApiRecurringTasks.mockResolvedValue(generation);
  jest.mocked(useCelebrations).mockReturnValue({ celebrate } as unknown as ReturnType<typeof useCelebrations>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test('startup generates server occurrences then loads all three lists without SQLite', async () => {
  await mount();
  expect(rules.generateApiRecurringTasks).toHaveBeenCalledWith({ currentDate: getLocalDateKey(new Date()), horizonDays: 30 });
  expect(value.tasks).toEqual([original]);
  expect(value.recurringRules).toEqual([rule]);
  expect(value.taskTemplates).toEqual([template]);
  expect(value.isLoading).toBe(false);
  expect(value.error).toBeNull();
  expect(rules.generateApiRecurringTasks.mock.invocationCallOrder[0]).toBeLessThan(tasks.fetchApiTasks.mock.invocationCallOrder[0]);
});

test('a startup failure stays visible and finishes loading', async () => {
  const failure = new Error('Unavailable');
  rules.generateApiRecurringTasks.mockRejectedValueOnce(failure);
  await mount();
  expect(value.error).toBe(failure);
  expect(value.isLoading).toBe(false);
  expect(tasks.fetchApiTasks).not.toHaveBeenCalled();
});

test('a partial list refresh keeps all previous data and a subsequent refresh recovers', async () => {
  await mount();
  tasks.fetchApiTasks.mockResolvedValueOnce([]);
  templates.fetchApiTaskTemplates.mockRejectedValueOnce(new Error('Template read failed'));
  await act(async () => { await expect(value.refreshTasks()).rejects.toThrow('Template read failed'); });
  expect(value.tasks).toEqual([original]);
  expect(value.recurringRules).toEqual([rule]);
  expect(value.taskTemplates).toEqual([template]);
  await act(async () => { await value.refreshTasks(); });
  expect(value.error).toBeNull();
});

test('task creation sends the native goal ID and retains the server identity and timestamps', async () => {
  await mount();
  const created = { ...original, id: 13, sourceTaskId: null, title: 'New' };
  tasks.createApiTask.mockResolvedValue(created);
  let id: number | null = null;
  await act(async () => { id = await value.addTask('New', 'Inbox', 'Details', 2, 9); });
  expect(tasks.createApiTask).toHaveBeenCalledWith({ title: 'New', notes: 'Details', priority: 2, goalId: 9, dueDate: null });
  expect(id).toBe(13);
  expect(value.tasks[0]).toEqual(created);
  expect(tasks.fetchApiTasks).toHaveBeenCalledTimes(1);
});

test('weekday creation resolves a real calendar date and explicit dates take precedence', async () => {
  await mount();
  tasks.createApiTask.mockResolvedValue({ ...original, id: 13 });
  await act(async () => { await value.addTask('New', 'Monday'); });
  expect(tasks.createApiTask).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: getNextOccurrenceDateKey('Monday') }));
  await act(async () => { await value.addTask('New', 'Monday', '', 0, null, '2027-01-01'); });
  expect(tasks.createApiTask).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: '2027-01-01' }));
});

test('blank task forms and invalid weekdays cannot create tasks', async () => {
  await mount();
  expect(await value.addTask(' ', 'Inbox')).toBeNull();
  await expect(value.addTask('New', 'Invalid')).rejects.toThrow('Invalid weekday');
  expect(tasks.createApiTask).not.toHaveBeenCalled();
});

test('editing replaces one record with the server response', async () => {
  await mount();
  const changed = { ...original, title: 'Changed', notes: null, goalId: null };
  tasks.updateApiTask.mockResolvedValue(changed);
  await act(async () => { await value.editTask(12, 'Changed'); });
  expect(tasks.updateApiTask).toHaveBeenCalledWith(12, { title: 'Changed', notes: '', priority: 0, goalId: null });
  expect(value.tasks).toEqual([changed]);
});

test('completion uses the returned timestamp and celebrates only once', async () => {
  await mount();
  const completed = { ...original, completed: true, completedAt: '2026-10-24T18:00:00Z' };
  tasks.updateApiTask.mockResolvedValue(completed);
  await act(async () => { await value.completeTask(12); });
  await value.completeTask(12);
  expect(tasks.updateApiTask).toHaveBeenCalledTimes(1);
  expect(tasks.updateApiTask).toHaveBeenCalledWith(12, { completed: true });
  expect(value.tasks[0].completedAt).toBe(completed.completedAt);
  expect(celebrate).toHaveBeenCalledTimes(1);
});

test('a rejected delete retains the task; an acknowledged delete removes it', async () => {
  await mount();
  tasks.deleteApiTask.mockRejectedValueOnce(new Error('Rejected')).mockResolvedValueOnce(undefined);
  await act(async () => { await expect(value.deleteTask(12)).rejects.toThrow('Rejected'); });
  expect(value.tasks).toEqual([original]);
  await act(async () => { await value.deleteTask(12); });
  expect(value.tasks).toEqual([]);
});

test('rescheduling and Inbox moves update placement while retaining original recurring identity', async () => {
  const occurrence = { ...original, recurringRuleId: 41, sourceRecurringRuleId: 1781204320003,
    recurrenceOccurrenceDate: '2026-10-01', dueDate: '2026-10-01', day: 'Thursday' };
  tasks.fetchApiTasks.mockResolvedValue([occurrence]);
  await mount();
  tasks.updateApiTask.mockResolvedValueOnce({ ...occurrence, dueDate: '2027-01-01', day: 'Friday' })
    .mockResolvedValueOnce({ ...occurrence, dueDate: null, day: 'Inbox' });
  await act(async () => { await value.scheduleTask(12, '2027-01-01'); });
  expect(tasks.updateApiTask).toHaveBeenNthCalledWith(1, 12, { dueDate: '2027-01-01' });
  await act(async () => { await value.moveTaskToInbox(12); });
  expect(tasks.updateApiTask).toHaveBeenNthCalledWith(2, 12, { dueDate: null });
  expect(value.tasks[0].recurrenceOccurrenceDate).toBe('2026-10-01');
  expect(value.tasks[0].recurringRuleId).toBe(41);
});

test('moving to a weekday sends its calendar date and rejects invalid weekdays', async () => {
  await mount();
  tasks.updateApiTask.mockResolvedValue(original);
  await act(async () => { await value.moveTaskToDay(12, 'Tuesday'); });
  expect(tasks.updateApiTask).toHaveBeenCalledWith(12, { dueDate: getNextOccurrenceDateKey('Tuesday') });
  await expect(value.moveTaskToDay(12, 'Invalid')).rejects.toThrow('Invalid weekday');
  expect(tasks.updateApiTask).toHaveBeenCalledTimes(1);
});

test('detaching delegates the transaction to the backend and uses the returned task', async () => {
  await mount();
  workflows.detachApiRecurringTask.mockResolvedValue(original);
  await act(async () => { await value.detachTaskFromRecurring(12); });
  expect(workflows.detachApiRecurringTask).toHaveBeenCalledWith(12);
  expect(value.tasks).toEqual([original]);
});

test('template create, edit, and delete use native IDs and returned records', async () => {
  await mount();
  const created = { ...template, id: 52, sourceTaskTemplateId: null };
  templates.createApiTaskTemplate.mockResolvedValue(created);
  templates.updateApiTaskTemplate.mockResolvedValue({ ...created, title: 'Changed' });
  templates.deleteApiTaskTemplate.mockResolvedValue(undefined);
  await act(async () => { await value.addTaskTemplate('Study', 'Notes', 1, 9); });
  expect(templates.createApiTaskTemplate).toHaveBeenCalledWith({ title: 'Study', notes: 'Notes', priority: 1, goalId: 9 });
  await act(async () => { await value.editTaskTemplate(52, 'Changed'); });
  expect(templates.updateApiTaskTemplate).toHaveBeenCalledWith(52, { title: 'Changed', notes: '', priority: 0, goalId: null });
  expect(value.taskTemplates[0].title).toBe('Changed');
  await act(async () => { await value.deleteTaskTemplate(52); });
  expect(value.taskTemplates).toEqual([template]);
});

test('creating from a template makes one backend action and retains the template', async () => {
  await mount();
  templates.createApiTaskFromTemplate.mockResolvedValue({ ...original, id: 13 });
  await act(async () => { await value.addTaskFromTemplate(51); });
  expect(templates.createApiTaskFromTemplate).toHaveBeenCalledWith(51);
  expect(tasks.createApiTask).not.toHaveBeenCalled();
  expect(value.taskTemplates).toEqual([template]);
  expect(value.tasks[0].id).toBe(13);
});

test('creating a schedule generates only for the created schedule and refreshes all task data', async () => {
  await mount();
  rules.createApiRecurringRule.mockResolvedValue(rule);
  rules.generateApiRecurringTasks.mockClear();
  await act(async () => { await value.createRecurringTask(scheduleInput); });
  expect(rules.createApiRecurringRule).toHaveBeenCalledWith(scheduleInput);
  expect(rules.generateApiRecurringTasks).toHaveBeenCalledWith({ currentDate: getLocalDateKey(new Date()), horizonDays: 30, recurringRuleId: 41 });
  expect(tasks.fetchApiTasks).toHaveBeenCalledTimes(2);
});

test('a generation failure after schedule creation reports the saved write without creating it again', async () => {
  await mount();
  rules.createApiRecurringRule.mockResolvedValue(rule);
  rules.generateApiRecurringTasks.mockRejectedValueOnce(new Error('Connection lost'));
  await act(async () => { await expect(value.createRecurringTask(scheduleInput)).rejects.toThrow('The change was saved'); });
  expect(rules.createApiRecurringRule).toHaveBeenCalledTimes(1);
});

test('conversion uses one workflow action and does not run a second generation', async () => {
  await mount();
  workflows.convertApiTaskToRecurring.mockResolvedValue(workflow);
  rules.generateApiRecurringTasks.mockClear();
  await act(async () => { await value.convertTaskToRecurring(12, scheduleInput); });
  expect(workflows.convertApiTaskToRecurring).toHaveBeenCalledWith(12, { ...scheduleInput, currentDate: getLocalDateKey(new Date()), horizonDays: 30 });
  expect(rules.generateApiRecurringTasks).not.toHaveBeenCalled();
  expect(tasks.fetchApiTasks).toHaveBeenCalledTimes(2);
});

test('the full schedule editor uses the new transactional endpoint and reads the rebuilt task list', async () => {
  await mount();
  const replacement = { ...original, id: 60, title: 'Schedule edit' };
  workflows.editApiRecurringSeries.mockResolvedValue({ rule, generation, deletedTaskIds: [12], updatedTaskIds: [] });
  tasks.fetchApiTasks.mockResolvedValueOnce([replacement]);
  rules.generateApiRecurringTasks.mockClear();
  await act(async () => { await value.updateRecurringTask(41, scheduleInput); });
  expect(workflows.editApiRecurringSeries).toHaveBeenCalledWith(41, { ...scheduleInput, currentDate: getLocalDateKey(new Date()), horizonDays: 30 });
  expect(rules.updateApiRecurringRule).not.toHaveBeenCalled();
  expect(rules.generateApiRecurringTasks).not.toHaveBeenCalled();
  expect(value.tasks).toEqual([replacement]);
});

test('occurrence editing sends a complete form without a schedule start date', async () => {
  await mount();
  workflows.editApiRecurringFromOccurrence.mockResolvedValue(workflow);
  const { startDate, ...input } = scheduleInput;
  await act(async () => { await value.updateRecurringTaskFromOccurrence(12, input); });
  expect(workflows.editApiRecurringFromOccurrence).toHaveBeenCalledWith(12, { ...input, currentDate: getLocalDateKey(new Date()), horizonDays: 30 });
});

test('pausing and resuming use current state and generate only when resuming', async () => {
  await mount();
  rules.updateApiRecurringRule.mockResolvedValueOnce({ ...rule, active: false }).mockResolvedValueOnce(rule);
  rules.fetchApiRecurringRules.mockResolvedValueOnce([{ ...rule, active: false }]).mockResolvedValueOnce([rule]);
  rules.generateApiRecurringTasks.mockClear();
  await act(async () => { await value.toggleRecurringRule(41); });
  expect(rules.updateApiRecurringRule).toHaveBeenNthCalledWith(1, 41, { active: false });
  expect(rules.generateApiRecurringTasks).not.toHaveBeenCalled();
  await act(async () => { await value.toggleRecurringRule(41); });
  expect(rules.updateApiRecurringRule).toHaveBeenNthCalledWith(2, 41, { active: true });
  expect(rules.generateApiRecurringTasks).toHaveBeenCalledWith(expect.objectContaining({ recurringRuleId: 41 }));
});

test('an unknown schedule cannot accidentally be toggled', async () => {
  await mount();
  await act(async () => { await expect(value.toggleRecurringRule(99)).rejects.toThrow('Refresh schedules'); });
  expect(rules.updateApiRecurringRule).not.toHaveBeenCalled();
});

test.each(['stopOnly', 'deleteUnfinished'] as const)('schedule deletion delegates mode %s and reloads related data', async (mode) => {
  await mount();
  rules.deleteApiRecurringRule.mockResolvedValue(undefined);
  rules.fetchApiRecurringRules.mockResolvedValueOnce([]);
  await act(async () => { await value.deleteRecurringRule(41, mode); });
  expect(rules.deleteApiRecurringRule).toHaveBeenCalledWith(41, mode);
  expect(value.recurringRules).toEqual([]);
});

test('a read failure after a confirmed workflow action reports that the edit was already saved', async () => {
  await mount();
  workflows.editApiRecurringSeries.mockResolvedValue({ rule, generation, deletedTaskIds: [12], updatedTaskIds: [] });
  tasks.fetchApiTasks.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.updateRecurringTask(41, scheduleInput)).rejects.toThrow('The change was saved'); });
  expect(workflows.editApiRecurringSeries).toHaveBeenCalledTimes(1);
  expect(value.tasks).toEqual([original]);
});

test('double taps on one task make one write and saving state clears afterward', async () => {
  await mount();
  const pending = deferred<typeof original>();
  tasks.updateApiTask.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const first = value.editTask(12, 'Change');
    await expect(value.deleteTask(12)).rejects.toThrow('already being saved');
    pending.resolve(original);
    await first;
  });
  expect(tasks.updateApiTask).toHaveBeenCalledTimes(1);
  expect(tasks.deleteApiTask).not.toHaveBeenCalled();
  expect(value.isSaving).toBe(false);
});

test('writes for different records are serialized without losing either update', async () => {
  await mount();
  const pending = deferred<typeof original>();
  tasks.updateApiTask.mockReturnValueOnce(pending.promise);
  templates.updateApiTaskTemplate.mockResolvedValue({ ...template, title: 'Template edit' });
  await act(async () => {
    const first = value.editTask(12, 'Task edit');
    const second = value.editTaskTemplate(51, 'Template edit');
    await Promise.resolve();
    expect(templates.updateApiTaskTemplate).not.toHaveBeenCalled();
    pending.resolve({ ...original, title: 'Task edit' });
    await Promise.all([first, second]);
  });
  expect(value.tasks[0].title).toBe('Task edit');
  expect(value.taskTemplates[0].title).toBe('Template edit');
  expect(value.isSaving).toBe(false);
});

test('a queued refresh finishes before a later edit so its old list cannot overwrite the saved result', async () => {
  await mount();
  const pending = deferred<tasksApi.ApiTask[]>();
  tasks.fetchApiTasks.mockReturnValueOnce(pending.promise);
  tasks.updateApiTask.mockResolvedValue({ ...original, title: 'Newest' });
  await act(async () => {
    const refresh = value.refreshTasks();
    const edit = value.editTask(12, 'Newest');
    await Promise.resolve();
    expect(tasks.updateApiTask).not.toHaveBeenCalled();
    pending.resolve([original]);
    await Promise.all([refresh, edit]);
  });
  expect(value.tasks[0].title).toBe('Newest');
});

test('an uncertain write retains the exact API error and never retries or changes local data', async () => {
  await mount();
  const failure = Object.assign(new Error('Timed out'), { mutationMayHaveSucceeded: true });
  tasks.updateApiTask.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.editTask(12, 'Change')).rejects.toBe(failure); });
  expect(value.error).toBe(failure);
  expect(value.tasks).toEqual([original]);
  expect(tasks.updateApiTask).toHaveBeenCalledTimes(1);
  expect(value.isSaving).toBe(false);
});

test('filters retain Inbox, date, weekday, overdue ordering, and completion behavior', async () => {
  tasks.fetchApiTasks.mockResolvedValue([
    original,
    { ...original, id: 13, day: 'Tuesday', dueDate: '2026-10-20' },
    { ...original, id: 14, day: 'Monday', dueDate: '2026-10-19' },
    { ...original, id: 15, day: 'Tuesday', dueDate: '2026-10-20', completed: true, completedAt: '2026-10-20T12:00:00Z' },
  ]);
  await mount();
  expect(value.getInboxTasks().map(task => task.id)).toEqual([12]);
  expect(value.getActiveTasksByDate('2026-10-20').map(task => task.id)).toEqual([13]);
  expect(value.getActiveTasksByDay('Tuesday').map(task => task.id)).toEqual([13]);
  expect(value.getOverdueTasks(new Date(2026, 9, 21)).map(task => task.id)).toEqual([14, 13]);
  expect(value.getCompletedTasks().map(task => task.id)).toEqual([15]);
});
