jest.mock('@/lib/api/weeklyReviewApi', () => ({
  createApiWeeklyReview: jest.fn(), fetchApiWeeklyReviews: jest.fn(), updateApiWeeklyReview: jest.fn(),
}));
jest.mock('@/lib/api/weeklyCommitmentApi', () => ({
  createApiWeeklyCommitment: jest.fn(), deleteApiWeeklyCommitment: jest.fn(),
  fetchApiWeeklyCommitment: jest.fn(), fetchApiWeeklyCommitments: jest.fn(), updateApiWeeklyCommitment: jest.fn(),
}));
jest.mock('@/lib/api/weeklyTaskDecisionApi', () => ({
  applyApiWeeklyTaskDecision: jest.fn(), deleteApiWeeklyTaskDecision: jest.fn(), fetchApiWeeklyTaskDecisions: jest.fn(),
}));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/lib/weeklyReviewStorage', () => { throw new Error('The API provider must not execute SQLite history storage'); });
import { useTasks } from '@/context/TaskContext';
import { WeeklyReviewProvider, useWeeklyReviews } from '@/context/WeeklyReviewContext';
import * as commitmentsApi from '@/lib/api/weeklyCommitmentApi';
import * as reviewsApi from '@/lib/api/weeklyReviewApi';
import * as decisionsApi from '@/lib/api/weeklyTaskDecisionApi';
import type { WeeklyReviewSnapshot } from '@/lib/weeklyReview';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const reviews = jest.mocked(reviewsApi);
const commitments = jest.mocked(commitmentsApi);
const decisions = jest.mocked(decisionsApi);
const refreshTasks = jest.fn<Promise<void>, []>();
const WEEK = '2026-10-19';
const snapshot: WeeklyReviewSnapshot = {
  completedCount: 3, unfinishedCount: 1, overdueCount: 1, completionRate: 75,
  goalsProgressedCount: 1, bestDay: 'Tuesday', bestDayCount: 2,
  archivedBrainDumpCount: 1, highPriorityCompletedCount: 1, recurringCompletedCount: 2,
};
const review: reviewsApi.ApiWeeklyReview = {
  id: 11, sourceWeeklyReviewId: 1781204320011, weekStart: WEEK, cycleId: 7,
  whatWentWell: 'Focused', whatCausedProblems: null, whatLearned: null,
  whatChangeNextWeek: null, nextWeekFocus: null, ...snapshot,
  createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z', reviewedAt: '2026-10-24T12:00:00Z',
};
const commitment: commitmentsApi.ApiWeeklyCommitment = {
  id: 21, sourceWeeklyCommitmentId: 1781204320021, weekStart: WEEK, cycleId: 7,
  taskId: 41, title: 'Study', completed: false, completedAt: null, createdAt: '2026-10-19T12:00:00Z',
};
const decision: decisionsApi.ApiWeeklyTaskDecision = {
  id: 31, sourceWeeklyTaskDecisionId: null, weekStart: WEEK, taskId: 41,
  taskTitle: 'Server task title', originalDueDate: '2026-10-20', action: 'keep', resolvedDueDate: null,
  recurringRuleId: 51, sourceRecurringRuleId: 1781204320051,
  recurrenceOccurrenceDate: '2026-10-01', decidedAt: '2026-10-24T12:00:00Z',
};
const decisionInput = {
  weekStart: WEEK, taskId: 41, taskTitle: 'Screen title', originalDueDate: '2026-10-20',
  action: 'keep' as const, recurringRuleId: 51, recurrenceOccurrenceDate: '2026-10-01',
};
let value: ReturnType<typeof useWeeklyReviews>;
let root: ReturnType<typeof createRoot> | undefined;
function Probe() { value = useWeeklyReviews(); return null; }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(WeeklyReviewProvider, { children: React.createElement(Probe) })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  reviews.fetchApiWeeklyReviews.mockResolvedValue([review]);
  commitments.fetchApiWeeklyCommitments.mockResolvedValue([commitment]);
  decisions.fetchApiWeeklyTaskDecisions.mockResolvedValue([decision]);
  refreshTasks.mockResolvedValue(undefined);
  jest.mocked(useTasks).mockReturnValue({ refreshTasks } as unknown as ReturnType<typeof useTasks>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test('loads all weekly lists through the API without SQLite', async () => {
  await mount();
  expect(value.reviews).toEqual([review]);
  expect(value.commitments).toEqual([commitment]);
  expect(value.taskDecisions).toEqual([decision]);
  expect(value.isLoading).toBe(false);
  expect(value.error).toBeNull();
});

test('startup failure exposes the error and finishes loading', async () => {
  const failure = new Error('Unavailable');
  decisions.fetchApiWeeklyTaskDecisions.mockRejectedValueOnce(failure);
  await mount();
  expect(value.error).toBe(failure);
  expect(value.isLoading).toBe(false);
  expect(value.reviews).toEqual([]);
});

test('a partial refresh preserves all three earlier lists and a later refresh recovers', async () => {
  await mount();
  reviews.fetchApiWeeklyReviews.mockResolvedValueOnce([]);
  commitments.fetchApiWeeklyCommitments.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.refreshWeeklyReviews()).rejects.toThrow('Read failed'); });
  expect(value.reviews).toEqual([review]);
  expect(value.commitments).toEqual([commitment]);
  expect(value.taskDecisions).toEqual([decision]);
  await act(async () => { await value.refreshWeeklyReviews(); });
  expect(value.error).toBeNull();
});

test('first review creation sends native cycle ID and a copied analytics snapshot', async () => {
  reviews.fetchApiWeeklyReviews.mockResolvedValueOnce([]);
  await mount();
  const saved = { ...review, sourceWeeklyReviewId: null };
  reviews.createApiWeeklyReview.mockResolvedValue(saved);
  const initial = { ...snapshot };
  const reflection = { whatWentWell: 'Focused' };
  await act(async () => {
    const pending = value.saveReview(WEEK, 7, reflection, initial);
    initial.completedCount = 999;
    reflection.whatWentWell = 'Changed later';
    await pending;
  });
  expect(reviews.createApiWeeklyReview).toHaveBeenCalledWith({
    weekStart: WEEK, cycleId: 7, whatWentWell: 'Focused', whatCausedProblems: null,
    whatLearned: null, whatChangeNextWeek: null, nextWeekFocus: null, snapshot,
  });
  expect(value.reviews).toEqual([saved]);
  expect(reviews.updateApiWeeklyReview).not.toHaveBeenCalled();
});

test('editing a saved review changes reflections without sending a replacement snapshot', async () => {
  await mount();
  const edited = { ...review, whatWentWell: null, whatLearned: 'Practice' };
  reviews.updateApiWeeklyReview.mockResolvedValue(edited);
  await act(async () => { await value.saveReview(WEEK, null, { whatLearned: 'Practice' }, { ...snapshot, completedCount: 999 }); });
  expect(reviews.updateApiWeeklyReview).toHaveBeenCalledWith(11, {
    cycleId: null, whatWentWell: null, whatCausedProblems: null,
    whatLearned: 'Practice', whatChangeNextWeek: null, nextWeekFocus: null,
  });
  expect(value.reviews[0].completedCount).toBe(3);
  expect(reviews.createApiWeeklyReview).not.toHaveBeenCalled();
});

test('a create conflict is not silently retried as an overwrite', async () => {
  reviews.fetchApiWeeklyReviews.mockResolvedValueOnce([]);
  await mount();
  const failure = Object.assign(new Error('Already exists'), { status: 409 });
  reviews.createApiWeeklyReview.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.saveReview(WEEK, 7, {}, snapshot)).rejects.toBe(failure); });
  expect(reviews.updateApiWeeklyReview).not.toHaveBeenCalled();
  expect(value.reviews).toEqual([]);
});

test('standalone commitments send a title while linked commitments send the native task ID', async () => {
  await mount();
  const standalone = { ...commitment, id: 22, taskId: null, sourceWeeklyCommitmentId: null };
  const linked = { ...commitment, id: 23, sourceWeeklyCommitmentId: null };
  commitments.createApiWeeklyCommitment.mockResolvedValueOnce(standalone).mockResolvedValueOnce(linked);
  await act(async () => { await value.addCommitment(WEEK, 7, 'Study'); });
  await act(async () => { await value.addTaskCommitment(WEEK, 7, 41); });
  expect(commitments.createApiWeeklyCommitment).toHaveBeenNthCalledWith(1, { weekStart: WEEK, cycleId: 7, title: 'Study' });
  expect(commitments.createApiWeeklyCommitment).toHaveBeenNthCalledWith(2, { weekStart: WEEK, cycleId: 7, taskId: 41 });
  expect(value.commitments.map(row => row.id)).toEqual([23, 22, 21]);
});

test('toggle reads live completion state and refreshes linked task data', async () => {
  await mount();
  const done = { ...commitment, completed: true, completedAt: '2026-10-25T12:00:00Z' };
  commitments.fetchApiWeeklyCommitment.mockResolvedValue(done);
  commitments.updateApiWeeklyCommitment.mockResolvedValue(commitment);
  await act(async () => { await value.toggleCommitment(21); });
  expect(commitments.fetchApiWeeklyCommitment).toHaveBeenCalledWith(21);
  expect(commitments.updateApiWeeklyCommitment).toHaveBeenCalledWith(21, { completed: false });
  expect(refreshTasks).toHaveBeenCalledTimes(1);
  expect(commitments.fetchApiWeeklyCommitments).toHaveBeenCalledTimes(2);
});

test('standalone toggle uses the server timestamp and does not refresh tasks', async () => {
  await mount();
  const standalone = { ...commitment, taskId: null };
  const done = { ...standalone, completed: true, completedAt: '2026-10-25T12:00:00Z' };
  commitments.fetchApiWeeklyCommitment.mockResolvedValue(standalone);
  commitments.updateApiWeeklyCommitment.mockResolvedValue(done);
  commitments.fetchApiWeeklyCommitments.mockResolvedValueOnce([done]);
  await act(async () => { await value.toggleCommitment(21); });
  expect(value.commitments[0].completedAt).toBe(done.completedAt);
  expect(refreshTasks).not.toHaveBeenCalled();
});

test('a failed live-state read cannot toggle a commitment', async () => {
  await mount();
  commitments.fetchApiWeeklyCommitment.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.toggleCommitment(21)).rejects.toThrow('Read failed'); });
  expect(commitments.updateApiWeeklyCommitment).not.toHaveBeenCalled();
  expect(value.commitments).toEqual([commitment]);
});

test('commitment deletion removes only the commitment and performs no task action', async () => {
  await mount();
  commitments.deleteApiWeeklyCommitment.mockResolvedValue(undefined);
  await act(async () => { await value.deleteCommitment(21); });
  expect(commitments.deleteApiWeeklyCommitment).toHaveBeenCalledWith(21);
  expect(value.commitments).toEqual([]);
  expect(refreshTasks).not.toHaveBeenCalled();
});

test.each(['keep', 'inbox', 'delete', 'nextWeek', 'reschedule'] as const)('decision %s uses one backend action with the live task ID', async (action) => {
  await mount();
  const resolved = action === 'nextWeek' ? '2026-10-27' : action === 'reschedule' ? '2026-11-01' : null;
  const saved = { ...decision, action, taskId: action === 'delete' ? null : 41, resolvedDueDate: resolved };
  decisions.applyApiWeeklyTaskDecision.mockResolvedValue(saved);
  decisions.fetchApiWeeklyTaskDecisions.mockResolvedValueOnce([saved]);
  await act(async () => { await value.recordTaskDecision({ ...decisionInput, action, resolvedDueDate: resolved }); });
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledWith({
    weekStart: WEEK, taskId: 41, originalDueDate: '2026-10-20', action, resolvedDueDate: resolved,
  });
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledTimes(1);
  expect(value.taskDecisions).toEqual([saved]);
  expect(refreshTasks).toHaveBeenCalledTimes(1);
});

test('missing next-week target is left for the API client to calculate', async () => {
  await mount();
  decisions.applyApiWeeklyTaskDecision.mockResolvedValue(decision);
  await act(async () => { await value.recordTaskDecision({ ...decisionInput, action: 'nextWeek' }); });
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'nextWeek', resolvedDueDate: null }));
});

test.each([
  { taskId: null, action: 'delete' as const },
  { action: 'reschedule' as const },
  { action: 'keep' as const, resolvedDueDate: '2026-11-01' },
])('invalid decision %j is rejected before the API action', async (change) => {
  await mount();
  await act(async () => { await expect(value.recordTaskDecision({ ...decisionInput, ...change })).rejects.toThrow(); });
  expect(decisions.applyApiWeeklyTaskDecision).not.toHaveBeenCalled();
  expect(refreshTasks).not.toHaveBeenCalled();
  expect(value.taskDecisions).toEqual([decision]);
});

test('a failed decision leaves state unchanged and never refreshes tasks', async () => {
  await mount();
  const failure = Object.assign(new Error('Connection lost'), { mutationMayHaveSucceeded: true });
  decisions.applyApiWeeklyTaskDecision.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.recordTaskDecision(decisionInput)).rejects.toBe(failure); });
  expect(value.error).toBe(failure);
  expect(value.taskDecisions).toEqual([decision]);
  expect(refreshTasks).not.toHaveBeenCalled();
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledTimes(1);
});

test('task refresh failure after a decision retains acknowledged history and reports the saved write', async () => {
  await mount();
  const saved = { ...decision, id: 32 };
  decisions.applyApiWeeklyTaskDecision.mockResolvedValue(saved);
  refreshTasks.mockRejectedValueOnce(new Error('Refresh failed'));
  await act(async () => { await expect(value.recordTaskDecision(decisionInput)).rejects.toThrow('The change was saved'); });
  expect(value.taskDecisions[0]).toEqual(saved);
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledTimes(1);
});

test('failed weekly read after a toggle retains the acknowledged completion state', async () => {
  await mount();
  const done = { ...commitment, completed: true, completedAt: '2026-10-25T12:00:00Z' };
  commitments.fetchApiWeeklyCommitment.mockResolvedValue(commitment);
  commitments.updateApiWeeklyCommitment.mockResolvedValue(done);
  decisions.fetchApiWeeklyTaskDecisions.mockRejectedValueOnce(new Error('History read failed'));
  await act(async () => { await expect(value.toggleCommitment(21)).rejects.toThrow('The change was saved'); });
  expect(value.commitments[0]).toEqual(done);
  expect(commitments.updateApiWeeklyCommitment).toHaveBeenCalledTimes(1);
});

test('deleting decision history does not undo the task action', async () => {
  await mount();
  decisions.deleteApiWeeklyTaskDecision.mockResolvedValue(undefined);
  await act(async () => { await value.deleteTaskDecision(31); });
  expect(decisions.deleteApiWeeklyTaskDecision).toHaveBeenCalledWith(31);
  expect(value.taskDecisions).toEqual([]);
  expect(refreshTasks).not.toHaveBeenCalled();
  expect(decisions.applyApiWeeklyTaskDecision).not.toHaveBeenCalled();
});

test('a rejected history deletion keeps the existing decision', async () => {
  await mount();
  decisions.deleteApiWeeklyTaskDecision.mockRejectedValueOnce(new Error('Rejected'));
  await act(async () => { await expect(value.deleteTaskDecision(31)).rejects.toThrow('Rejected'); });
  expect(value.taskDecisions).toEqual([decision]);
});

test('double taps on a review week make one save', async () => {
  await mount();
  const pending = deferred<reviewsApi.ApiWeeklyReview>();
  reviews.updateApiWeeklyReview.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const first = value.saveReview(WEEK, 7, {}, snapshot);
    await expect(value.saveReview(WEEK, 7, {}, snapshot)).rejects.toThrow('already being saved');
    pending.resolve(review);
    await first;
  });
  expect(reviews.updateApiWeeklyReview).toHaveBeenCalledTimes(1);
  expect(value.isSaving).toBe(false);
});

test('different decisions on one task are blocked while its first action is pending', async () => {
  await mount();
  const pending = deferred<decisionsApi.ApiWeeklyTaskDecision>();
  decisions.applyApiWeeklyTaskDecision.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const first = value.recordTaskDecision(decisionInput);
    await expect(value.recordTaskDecision({ ...decisionInput, action: 'delete' })).rejects.toThrow('already being saved');
    pending.resolve(decision);
    await first;
  });
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledTimes(1);
});

test('the queued decision captures its input before the caller edits it', async () => {
  await mount();
  decisions.applyApiWeeklyTaskDecision.mockResolvedValue(decision);
  const input = { ...decisionInput };
  await act(async () => {
    const pending = value.recordTaskDecision(input);
    input.taskId = 99;
    input.originalDueDate = '2026-10-21';
    await pending;
  });
  expect(decisions.applyApiWeeklyTaskDecision).toHaveBeenCalledWith(expect.objectContaining({ taskId: 41, originalDueDate: '2026-10-20' }));
});

test('a queued refresh cannot overwrite a later reflection edit', async () => {
  await mount();
  const pending = deferred<reviewsApi.ApiWeeklyReview[]>();
  reviews.fetchApiWeeklyReviews.mockReturnValueOnce(pending.promise);
  reviews.updateApiWeeklyReview.mockResolvedValue({ ...review, whatLearned: 'Newest' });
  await act(async () => {
    const refresh = value.refreshWeeklyReviews();
    const edit = value.saveReview(WEEK, 7, { whatLearned: 'Newest' }, snapshot);
    await Promise.resolve();
    expect(reviews.updateApiWeeklyReview).not.toHaveBeenCalled();
    pending.resolve([review]);
    await Promise.all([refresh, edit]);
  });
  expect(value.reviews[0].whatLearned).toBe('Newest');
});
