jest.mock('@/lib/api/goalApi', () => ({
  completeApiGoal: jest.fn(), createApiGoal: jest.fn(), deleteApiGoal: jest.fn(),
  fetchApiGoals: jest.fn(), reopenApiGoal: jest.fn(), updateApiGoal: jest.fn(),
}));
jest.mock('@/lib/api/goalMilestoneApi', () => ({
  createApiGoalMilestone: jest.fn(), deleteApiGoalMilestone: jest.fn(),
  fetchApiGoalMilestones: jest.fn(), updateApiGoalMilestone: jest.fn(),
}));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/CelebrationContext', () => ({ useCelebrations: jest.fn() }));
import { useCelebrations } from '@/context/CelebrationContext';
import { GoalProvider, useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import * as goalsApi from '@/lib/api/goalApi';
import * as milestonesApi from '@/lib/api/goalMilestoneApi';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const goals = jest.mocked(goalsApi);
const milestones = jest.mocked(milestonesApi);
const refreshTasks = jest.fn<Promise<void>, []>();
const celebrate = jest.fn();
const original: goalsApi.ApiGoal = {
  id: 21, sourceGoalId: 1781204320001, cycleId: 9, title: 'Study',
  completed: false, createdAt: '2026-10-01T12:00:00Z', completedAt: null,
  startDate: '2026-10-01T16:00:00Z', endDate: '2026-12-24T17:00:00Z',
  reward: null, purpose: null, successDefinition: null, notes: null,
  completionWhatHelped: null, completionHardestPart: null, completionLearned: null,
  completionDoDifferently: null, completionTaskTotal: null, completionTaskCompleted: null,
  completionMilestoneTotal: null, completionMilestoneCompleted: null, completionHighPriorityCompleted: null,
};
const checkpoint: milestonesApi.ApiGoalMilestone = {
  id: 51, sourceGoalMilestoneId: 1781204320002, goalId: 21, title: 'First exam',
  targetDate: '2026-11-01', notes: null, completed: false,
  completedAt: null, createdAt: '2026-10-01T12:00:00Z',
};
const done = { ...original, completed: true, completedAt: '2026-10-24T12:00:00Z',
  completionTaskTotal: 8, completionTaskCompleted: 5, completionMilestoneTotal: 3,
  completionMilestoneCompleted: 2, completionHighPriorityCompleted: 4,
  completionLearned: 'Review daily' };
let value: ReturnType<typeof useGoals>;
let root: ReturnType<typeof createRoot>;
function Probe() { value = useGoals(); return null; }
async function mount() {
  root = createRoot();
  await act(async () => { root.render(React.createElement(GoalProvider, { children: React.createElement(Probe) })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  goals.fetchApiGoals.mockResolvedValue([original]);
  milestones.fetchApiGoalMilestones.mockResolvedValue([checkpoint]);
  refreshTasks.mockResolvedValue(undefined);
  jest.mocked(useTasks).mockReturnValue({ tasks: [], refreshTasks } as unknown as ReturnType<typeof useTasks>);
  jest.mocked(useCelebrations).mockReturnValue({ celebrate } as unknown as ReturnType<typeof useCelebrations>);
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  jest.restoreAllMocks();
});
test('loads goals and milestones through their APIs', async () => {
  await mount();
  expect(value.goals).toEqual([original]);
  expect(value.milestones).toEqual([checkpoint]);
  expect(value.isLoading).toBe(false);
  expect(value.error).toBeNull();
});
test('a startup error remains visible and loading finishes', async () => {
  const failure = new Error('No connection');
  goals.fetchApiGoals.mockRejectedValueOnce(failure);
  await mount();
  expect(value.error).toBe(failure);
  expect(value.isLoading).toBe(false);
});
test('a milestone refresh failure preserves both earlier lists', async () => {
  await mount();
  goals.fetchApiGoals.mockResolvedValueOnce([]);
  milestones.fetchApiGoalMilestones.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.refreshGoals()).rejects.toThrow('Read failed'); });
  expect(value.goals).toEqual([original]);
  expect(value.milestones).toEqual([checkpoint]);
});
test('a later refresh recovers after an initial error', async () => {
  goals.fetchApiGoals.mockRejectedValueOnce(new Error('Offline'));
  await mount();
  await act(async () => { await value.refreshGoals(); });
  expect(value.error).toBeNull();
  expect(value.goals).toEqual([original]);
});
test('create sends dates, planning details, and the native cycle ID', async () => {
  await mount();
  const created = { ...original, id: 22, sourceGoalId: null, title: 'New' };
  goals.createApiGoal.mockResolvedValue(created);
  await act(async () => { await value.addGoal('New', '2026-10-01', '2026-12-24', 'Dinner',
    { purpose: 'Learn', successDefinition: 'Pass', notes: 'Practice' }, 9); });
  expect(goals.createApiGoal).toHaveBeenCalledWith({ title: 'New', startDate: '2026-10-01',
    endDate: '2026-12-24', cycleId: 9, reward: 'Dinner', purpose: 'Learn',
    successDefinition: 'Pass', notes: 'Practice' });
  expect(value.goals[0]).toEqual(created);
});
test('creation retains the default date-range behavior', async () => {
  await mount();
  goals.createApiGoal.mockResolvedValue({ ...original, id: 22 });
  await act(async () => { await value.addGoal('New'); });
  const input = goals.createApiGoal.mock.calls[0][0];
  expect(input.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(input.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(input.cycleId).toBeNull();
});
test('blank goal input does not make a write', async () => {
  await mount();
  await value.addGoal('   ');
  expect(goals.createApiGoal).not.toHaveBeenCalled();
});
test('goal edits use native IDs and the full returned record', async () => {
  await mount();
  const updated = { ...original, title: 'Changed', notes: 'Saved note' };
  goals.updateApiGoal.mockResolvedValue(updated);
  await act(async () => { await value.editGoal(21, 'Changed', '2026-10-01', '2026-12-24', null,
    { notes: 'Saved note' }); });
  expect(goals.updateApiGoal).toHaveBeenCalledWith(21, expect.objectContaining({ title: 'Changed', notes: 'Saved note' }));
  expect(value.goals[0]).toEqual(updated);
});
test('completion sends reflections and uses backend totals without local task counting', async () => {
  await mount();
  goals.completeApiGoal.mockResolvedValue(done);
  await act(async () => { await value.completeGoal(21, { learned: 'Review daily' }); });
  expect(goals.completeApiGoal).toHaveBeenCalledWith(21, { learned: 'Review daily' });
  expect(value.goals[0]).toEqual(done);
  expect(value.goals[0].completionTaskTotal).toBe(8);
  expect(celebrate).toHaveBeenCalledWith('goal', 'Study');
  expect(refreshTasks).not.toHaveBeenCalled();
});
test('repeating completion after a successful save does not celebrate or submit twice', async () => {
  await mount();
  goals.completeApiGoal.mockResolvedValue(done);
  await act(async () => { await value.completeGoal(21); });
  await value.completeGoal(21);
  expect(goals.completeApiGoal).toHaveBeenCalledTimes(1);
  expect(celebrate).toHaveBeenCalledTimes(1);
});
test('reopening preserves the backend reflection and completion snapshot', async () => {
  goals.fetchApiGoals.mockResolvedValueOnce([done]);
  await mount();
  const reopened = { ...done, completed: false, completedAt: null };
  goals.reopenApiGoal.mockResolvedValue(reopened);
  await act(async () => { await value.reopenGoal(21); });
  expect(goals.reopenApiGoal).toHaveBeenCalledWith(21);
  expect(value.goals[0].completionLearned).toBe('Review daily');
  expect(value.goals[0].completionTaskTotal).toBe(8);
  expect(value.goals[0].completed).toBe(false);
});
test('deleting a goal removes its milestones and refreshes related task state', async () => {
  goals.fetchApiGoals.mockResolvedValueOnce([original, { ...original, id: 22 }]);
  milestones.fetchApiGoalMilestones.mockResolvedValueOnce([checkpoint, { ...checkpoint, id: 52, goalId: 22 }]);
  await mount();
  goals.deleteApiGoal.mockResolvedValue(undefined);
  await act(async () => { await value.deleteGoal(21); });
  expect(goals.deleteApiGoal).toHaveBeenCalledWith(21);
  expect(value.goals.map((goal) => goal.id)).toEqual([22]);
  expect(value.milestones.map((milestone) => milestone.id)).toEqual([52]);
  expect(refreshTasks).toHaveBeenCalledTimes(1);
});
test('a rejected delete leaves goals, milestones, and task state untouched', async () => {
  await mount();
  goals.deleteApiGoal.mockRejectedValue(new Error('Delete rejected'));
  await act(async () => { await expect(value.deleteGoal(21)).rejects.toThrow('Delete rejected'); });
  expect(value.goals).toEqual([original]);
  expect(value.milestones).toEqual([checkpoint]);
  expect(refreshTasks).not.toHaveBeenCalled();
});
test('a refresh failure after deletion reports that the deletion was already saved', async () => {
  await mount();
  goals.deleteApiGoal.mockResolvedValue(undefined);
  refreshTasks.mockRejectedValueOnce(new Error('Task read failed'));
  await act(async () => { await expect(value.deleteGoal(21)).rejects.toThrow('The change was saved'); });
  expect(value.goals).toEqual([]);
  expect(value.milestones).toEqual([]);
  expect(goals.deleteApiGoal).toHaveBeenCalledTimes(1);
});
test('creates milestones using native parent IDs', async () => {
  await mount();
  const created = { ...checkpoint, id: 52, sourceGoalMilestoneId: null };
  milestones.createApiGoalMilestone.mockResolvedValue(created);
  await act(async () => { await value.addMilestone(21, 'Exam', '2026-11-01', 'Prepare'); });
  expect(milestones.createApiGoalMilestone).toHaveBeenCalledWith({ goalId: 21, title: 'Exam', targetDate: '2026-11-01', notes: 'Prepare' });
  expect(value.milestones[1]).toEqual(created);
});
test('edits milestone details without manufacturing timestamps', async () => {
  await mount();
  const updated = { ...checkpoint, title: 'Changed', targetDate: null, notes: null };
  milestones.updateApiGoalMilestone.mockResolvedValue(updated);
  await act(async () => { await value.editMilestone(51, 'Changed'); });
  expect(milestones.updateApiGoalMilestone).toHaveBeenCalledWith(51, { title: 'Changed', targetDate: null, notes: null });
  expect(value.milestones).toEqual([updated]);
});
test('completes and reopens a milestone using backend completion timestamps', async () => {
  await mount();
  const completed = { ...checkpoint, completed: true, completedAt: '2026-10-24T18:00:00Z' };
  milestones.updateApiGoalMilestone.mockResolvedValueOnce(completed).mockResolvedValueOnce(checkpoint);
  await act(async () => { await value.toggleMilestone(51); });
  expect(milestones.updateApiGoalMilestone).toHaveBeenNthCalledWith(1, 51, { completed: true });
  expect(value.milestones[0].completedAt).toBe('2026-10-24T18:00:00Z');
  await act(async () => { await value.toggleMilestone(51); });
  expect(milestones.updateApiGoalMilestone).toHaveBeenNthCalledWith(2, 51, { completed: false });
  expect(value.milestones[0].completedAt).toBeNull();
});
test('an unknown milestone cannot be toggled accidentally', async () => {
  await mount();
  await act(async () => { await expect(value.toggleMilestone(99)).rejects.toThrow('Refresh milestones'); });
  expect(milestones.updateApiGoalMilestone).not.toHaveBeenCalled();
});
test('deleting a milestone preserves its parent goal', async () => {
  await mount();
  milestones.deleteApiGoalMilestone.mockResolvedValue(undefined);
  await act(async () => { await value.deleteMilestone(51); });
  expect(value.milestones).toEqual([]);
  expect(value.goals).toEqual([original]);
});
test('double taps on the same goal make one write request', async () => {
  await mount();
  const pending = deferred<typeof done>();
  goals.completeApiGoal.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const first = value.completeGoal(21);
    await expect(value.completeGoal(21)).rejects.toThrow('already being saved');
    pending.resolve(done);
    await first;
  });
  expect(goals.completeApiGoal).toHaveBeenCalledTimes(1);
  expect(value.isSaving).toBe(false);
});
test('writes to different records are serialized and retain both updates', async () => {
  await mount();
  const pending = deferred<typeof original>();
  const edited = { ...original, title: 'Edited' };
  goals.updateApiGoal.mockReturnValueOnce(pending.promise);
  milestones.updateApiGoalMilestone.mockResolvedValue({ ...checkpoint, completed: true, completedAt: '2026-10-24T18:00:00Z' });
  await act(async () => {
    const edit = value.editGoal(21, 'Edited', '2026-10-01', '2026-12-24');
    const toggle = value.toggleMilestone(51);
    await Promise.resolve();
    expect(milestones.updateApiGoalMilestone).not.toHaveBeenCalled();
    pending.resolve(edited);
    await Promise.all([edit, toggle]);
  });
  expect(value.goals[0].title).toBe('Edited');
  expect(value.milestones[0].completed).toBe(true);
  expect(value.isSaving).toBe(false);
});
test('uncertain writes retain the API error and are never automatically retried', async () => {
  await mount();
  const failure = Object.assign(new Error('Timed out'), { mutationMayHaveSucceeded: true });
  goals.updateApiGoal.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.editGoal(21, 'New', '2026-10-01', '2026-12-24')).rejects.toBe(failure); });
  expect(value.error).toBe(failure);
  expect(goals.updateApiGoal).toHaveBeenCalledTimes(1);
  expect(value.goals).toEqual([original]);
});
