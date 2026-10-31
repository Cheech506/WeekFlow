jest.mock('@/lib/api/cycleReviewApi', () => ({
  fetchApiCycleReviews: jest.fn(), finalizeApiCycleReview: jest.fn(), saveApiCycleReviewDraft: jest.fn(),
}));
jest.mock('@/lib/api/cycleGoalOutcomeApi', () => ({ fetchApiCycleGoalOutcomes: jest.fn() }));
jest.mock('@/lib/cycleReviewStorage', () => { throw new Error('The API provider must not load SQLite cycle reports'); });
jest.mock('@/lib/cycleReportExport', () => ({ exportCycleReport: jest.fn() }));
jest.mock('@/lib/cycleReviewUtils', () => ({
  ...jest.requireActual('@/lib/cycleReviewUtils'), calculateCycleReviewSnapshot: jest.fn(),
}));
jest.mock('@/context/CycleContext', () => ({ useCycle: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: jest.fn() }));
jest.mock('@/context/WeeklyReviewContext', () => ({ useWeeklyReviews: jest.fn() }));
jest.mock('@/context/CelebrationContext', () => ({ useCelebrations: jest.fn() }));
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCelebrations } from '@/context/CelebrationContext';
import { useCycle } from '@/context/CycleContext';
import { CycleReviewProvider, useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import * as outcomesApi from '@/lib/api/cycleGoalOutcomeApi';
import * as reviewsApi from '@/lib/api/cycleReviewApi';
import type { ApiPlanningCycle } from '@/lib/api/planningCycleApi';
import { exportCycleReport } from '@/lib/cycleReportExport';
import { calculateCycleReviewSnapshot, type CycleReviewSnapshot } from '@/lib/cycleReviewUtils';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const reviews = jest.mocked(reviewsApi);
const outcomes = jest.mocked(outcomesApi);
const refreshCycles = jest.fn<Promise<void>, []>();
const refreshGoals = jest.fn<Promise<void>, []>();
const refreshWeeklyReviews = jest.fn<Promise<void>, []>();
const celebrate = jest.fn();
const cycle: ApiPlanningCycle = {
  id: 7, sourcePlanningCycleId: 1781204320007, name: 'Autumn', primaryFocus: 'Study', theme: 'Steady',
  startDate: '2026-08-01', endDate: '2026-10-23', active: true,
  createdAt: '2026-08-01T12:00:00Z', completedAt: null,
};
const stats: CycleReviewSnapshot = {
  goalTotal: 2, goalCompleted: 1, taskCompleted: 5, milestoneTotal: 1, milestoneCompleted: 1,
  weeklyReviewsCompleted: 2, longestStreak: 3, bestWeekNumber: 1, bestWeekCount: 5,
  bestDay: 'Monday', bestDayCount: 3, highPriorityCompleted: 2, recurringCompleted: 1,
  rewardsUnlocked: 1, brainDumpsArchived: 1,
};
const review: reviewsApi.ApiCycleReview = {
  id: 17, sourceCycleReviewId: 1781204320017, cycleId: 7,
  biggestAccomplishment: 'Progress', biggestChallenge: null, whatWorkedWell: null,
  whatChangeNextCycle: null, whatStopDoing: null, whatContinueDoing: null, whatLearned: null,
  ...stats, nextCycleName: 'Winter', nextCyclePrimaryFocus: null, nextCycleTheme: null,
  nextCycleStartDate: '2026-10-24', nextCycleFirstWeekCommitments: ['Read'], nextCycleId: null,
  createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z', finalizedAt: null,
};
const outcome: outcomesApi.ApiCycleGoalOutcome = {
  id: 27, sourceCycleGoalOutcomeId: null, cycleReviewId: 17, goalId: 9, goalTitle: 'Study',
  action: 'carryForward', replacementTitle: null, destinationGoalId: null,
  createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z',
};
const detail = { review, outcomes: [outcome] };
const finalized: reviewsApi.ApiCycleReviewFinalizeResult = {
  review: { ...review, goalCompleted: 2, nextCycleId: 8, finalizedAt: '2026-10-25T12:00:00Z' },
  outcomes: [{ ...outcome, destinationGoalId: 10 }],
  nextCycle: { ...cycle, id: 8, sourcePlanningCycleId: null, name: 'Winter', startDate: '2026-10-24', endDate: '2027-01-15' },
  alreadyFinalized: false,
};
const input = {
  cycleId: 7, reflection: { biggestAccomplishment: 'Progress' },
  nextCycle: { name: 'Winter', startDate: '2026-10-24', firstWeekCommitments: ['Read'] },
  outcomes: [{ goalId: 9, action: 'carryForward' as const }],
};
let value: ReturnType<typeof useCycleReviews>;
let root: ReturnType<typeof createRoot> | undefined;
function Probe() { value = useCycleReviews(); return null; }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(CycleReviewProvider, { children: React.createElement(Probe) })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function prepareFinalization() {
  reviews.saveApiCycleReviewDraft.mockResolvedValue(detail);
  reviews.finalizeApiCycleReview.mockResolvedValue(finalized);
  reviews.fetchApiCycleReviews.mockResolvedValue([finalized.review]);
  outcomes.fetchApiCycleGoalOutcomes.mockResolvedValue(finalized.outcomes);
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  reviews.fetchApiCycleReviews.mockResolvedValue([review]);
  outcomes.fetchApiCycleGoalOutcomes.mockResolvedValue([outcome]);
  refreshCycles.mockResolvedValue(undefined);
  refreshGoals.mockResolvedValue(undefined);
  refreshWeeklyReviews.mockResolvedValue(undefined);
  jest.mocked(calculateCycleReviewSnapshot).mockReturnValue(stats);
  jest.mocked(exportCycleReport).mockResolvedValue('report.md');
  const ready = { isLoading: false, isSaving: false, error: null };
  jest.mocked(useCycle).mockReturnValue({ ...ready, cycles: [cycle], refreshCycles } as unknown as ReturnType<typeof useCycle>);
  jest.mocked(useGoals).mockReturnValue({ ...ready, goals: [], milestones: [], refreshGoals } as unknown as ReturnType<typeof useGoals>);
  jest.mocked(useTasks).mockReturnValue({ ...ready, tasks: [] } as unknown as ReturnType<typeof useTasks>);
  jest.mocked(useBrainDumps).mockReturnValue({ ...ready, brainDumps: [] } as unknown as ReturnType<typeof useBrainDumps>);
  jest.mocked(useWeeklyReviews).mockReturnValue({ ...ready, reviews: [], refreshWeeklyReviews } as unknown as ReturnType<typeof useWeeklyReviews>);
  jest.mocked(useCelebrations).mockReturnValue({ celebrate } as unknown as ReturnType<typeof useCelebrations>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test('loads cycle reports and outcomes through APIs without SQLite', async () => {
  await mount();
  expect(value.cycleReviews).toEqual([review]);
  expect(value.goalOutcomes).toEqual([outcome]);
  expect(value.isLoading).toBe(false);
  expect(value.error).toBeNull();
});

test('startup failure exposes the error and finishes loading', async () => {
  const failure = new Error('Unavailable');
  outcomes.fetchApiCycleGoalOutcomes.mockRejectedValueOnce(failure);
  await mount();
  expect(value.error).toBe(failure);
  expect(value.cycleReviews).toEqual([]);
  expect(value.isLoading).toBe(false);
});

test('partial refresh keeps both last-good lists and a later refresh recovers', async () => {
  await mount();
  reviews.fetchApiCycleReviews.mockResolvedValueOnce([]);
  outcomes.fetchApiCycleGoalOutcomes.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.refreshCycleReviews()).rejects.toThrow('Read failed'); });
  expect(value.cycleReviews).toEqual([review]);
  expect(value.goalOutcomes).toEqual([outcome]);
  await act(async () => { await value.refreshCycleReviews(); });
  expect(value.error).toBeNull();
});

test('draft save uses native IDs and a snapshot of loaded API data', async () => {
  await mount();
  reviews.saveApiCycleReviewDraft.mockResolvedValue(detail);
  await act(async () => { await value.saveReviewDraft(input); });
  expect(reviews.saveApiCycleReviewDraft).toHaveBeenCalledWith({ ...input, snapshot: stats });
  expect(calculateCycleReviewSnapshot).toHaveBeenCalledWith(cycle, [], [], [], [], []);
  expect(reviews.finalizeApiCycleReview).not.toHaveBeenCalled();
  expect(refreshCycles).not.toHaveBeenCalled();
});

test('draft saves replace only their own outcomes and allow explicit empty selections', async () => {
  const other = { ...outcome, id: 28, cycleReviewId: 18 };
  outcomes.fetchApiCycleGoalOutcomes.mockResolvedValueOnce([outcome, other]);
  await mount();
  reviews.saveApiCycleReviewDraft.mockResolvedValue({ review, outcomes: [] });
  await act(async () => { await value.saveReviewDraft({ ...input, outcomes: [] }); });
  expect(value.goalOutcomes).toEqual([other]);
});

test('draft input arrays and reflection values are captured before queueing', async () => {
  await mount();
  reviews.saveApiCycleReviewDraft.mockResolvedValue(detail);
  const form = { ...input, reflection: { ...input.reflection }, nextCycle: { ...input.nextCycle,
    firstWeekCommitments: [...input.nextCycle.firstWeekCommitments] }, outcomes: input.outcomes.map(row => ({ ...row })) };
  await act(async () => {
    const pending = value.saveReviewDraft(form);
    form.reflection.biggestAccomplishment = 'Changed';
    form.nextCycle.firstWeekCommitments.push('Changed');
    form.outcomes[0].goalId = 999;
    await pending;
  });
  expect(reviews.saveApiCycleReviewDraft).toHaveBeenCalledWith({ ...input, snapshot: stats });
});

test.each(['loading', 'saving', 'error'] as const)('cannot save misleading analytics while task data has %s', async state => {
  const current = jest.mocked(useTasks).getMockImplementation()!();
  jest.mocked(useTasks).mockReturnValue({ ...current,
    isLoading: state === 'loading', isSaving: state === 'saving',
    error: state === 'error' ? new Error('Task load failed') : null });
  await mount();
  await act(async () => { await expect(value.saveReviewDraft(input)).rejects.toThrow('Refresh the app'); });
  expect(reviews.saveApiCycleReviewDraft).not.toHaveBeenCalled();
});

test('an unknown cycle cannot save a draft', async () => {
  await mount();
  await act(async () => { await expect(value.saveReviewDraft({ ...input, cycleId: 999 })).rejects.toThrow('could not be found'); });
  expect(reviews.saveApiCycleReviewDraft).not.toHaveBeenCalled();
});

test('finalization saves the latest form then finalizes its saved review ID', async () => {
  await mount();
  prepareFinalization();
  await act(async () => { await value.finalizeReview(input); });
  expect(reviews.saveApiCycleReviewDraft).toHaveBeenCalledWith({ ...input, snapshot: stats });
  expect(reviews.finalizeApiCycleReview).toHaveBeenCalledWith(17);
  expect(reviews.saveApiCycleReviewDraft.mock.invocationCallOrder[0]).toBeLessThan(reviews.finalizeApiCycleReview.mock.invocationCallOrder[0]);
  expect(value.cycleReviews).toEqual([finalized.review]);
  expect(value.goalOutcomes).toEqual(finalized.outcomes);
  expect(refreshCycles).toHaveBeenCalledTimes(1);
  expect(refreshGoals).toHaveBeenCalledTimes(1);
  expect(refreshWeeklyReviews).toHaveBeenCalledTimes(1);
  expect(celebrate).toHaveBeenCalledWith('cycle', 'Autumn');
});

test('a rejected draft prevents finalization and all related refreshes', async () => {
  await mount();
  reviews.saveApiCycleReviewDraft.mockRejectedValueOnce(new Error('Draft rejected'));
  await act(async () => { await expect(value.finalizeReview(input)).rejects.toThrow('Draft rejected'); });
  expect(reviews.finalizeApiCycleReview).not.toHaveBeenCalled();
  expect(refreshCycles).not.toHaveBeenCalled();
  expect(celebrate).not.toHaveBeenCalled();
});

test('a failed finalization retains the acknowledged draft and the original uncertain-write error', async () => {
  await mount();
  const saved = { review: { ...review, biggestAccomplishment: 'New draft' }, outcomes: [] };
  reviews.saveApiCycleReviewDraft.mockResolvedValueOnce(saved);
  const failure = Object.assign(new Error('Connection lost'), { mutationMayHaveSucceeded: true });
  reviews.finalizeApiCycleReview.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.finalizeReview(input)).rejects.toBe(failure); });
  expect(value.cycleReviews).toEqual([saved.review]);
  expect(value.goalOutcomes).toEqual([]);
  expect(value.error).toBe(failure);
  expect(reviews.finalizeApiCycleReview).toHaveBeenCalledTimes(1);
  expect(refreshCycles).not.toHaveBeenCalled();
  expect(celebrate).not.toHaveBeenCalled();
});

test('a manually retried finalized review is not resaved and does not celebrate again', async () => {
  reviews.fetchApiCycleReviews.mockResolvedValue([finalized.review]);
  outcomes.fetchApiCycleGoalOutcomes.mockResolvedValue(finalized.outcomes);
  await mount();
  reviews.finalizeApiCycleReview.mockResolvedValue({ ...finalized, alreadyFinalized: true });
  await act(async () => { await value.finalizeReview(input); });
  expect(reviews.saveApiCycleReviewDraft).not.toHaveBeenCalled();
  expect(calculateCycleReviewSnapshot).not.toHaveBeenCalled();
  expect(celebrate).not.toHaveBeenCalled();
  expect(refreshCycles).toHaveBeenCalledTimes(1);
});

test('a fresh result then manual retry celebrates once and saves the draft once', async () => {
  await mount();
  prepareFinalization();
  reviews.finalizeApiCycleReview.mockResolvedValueOnce(finalized).mockResolvedValueOnce({ ...finalized, alreadyFinalized: true });
  await act(async () => { await value.finalizeReview(input); });
  await act(async () => { await value.finalizeReview(input); });
  expect(reviews.saveApiCycleReviewDraft).toHaveBeenCalledTimes(1);
  expect(celebrate).toHaveBeenCalledTimes(1);
});

test('a related refresh failure retains the finalized report and reports the completed write', async () => {
  await mount();
  prepareFinalization();
  refreshGoals.mockRejectedValueOnce(new Error('Goal read failed'));
  await act(async () => { await expect(value.finalizeReview(input)).rejects.toThrow('The cycle was finalized'); });
  expect(value.cycleReviews[0].finalizedAt).toBe(finalized.review.finalizedAt);
  expect(reviews.finalizeApiCycleReview).toHaveBeenCalledTimes(1);
});

test('own refresh failure cannot discard the acknowledged finalization result', async () => {
  await mount();
  prepareFinalization();
  reviews.fetchApiCycleReviews.mockRejectedValueOnce(new Error('Report read failed'));
  await act(async () => { await expect(value.finalizeReview(input)).rejects.toThrow('The cycle was finalized'); });
  expect(value.cycleReviews).toEqual([finalized.review]);
  expect(value.goalOutcomes).toEqual(finalized.outcomes);
});

test('finalization waits for all related refreshes even when one has already failed', async () => {
  await mount();
  prepareFinalization();
  const pending = deferred<void>();
  refreshGoals.mockRejectedValueOnce(new Error('Read failed'));
  refreshCycles.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const completed = value.finalizeReview(input).then(() => 'saved', () => 'failed');
    let settled = false;
    void completed.then(() => { settled = true; });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(settled).toBe(false);
    pending.resolve(undefined);
    expect(await completed).toBe('failed');
  });
});

test('double taps cannot save a second draft or finalize while the first draft is pending', async () => {
  await mount();
  const pending = deferred<reviewsApi.ApiCycleReviewDetail>();
  reviews.saveApiCycleReviewDraft.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const first = value.saveReviewDraft(input);
    await expect(value.finalizeReview(input)).rejects.toThrow('already being saved');
    pending.resolve(detail);
    await first;
  });
  expect(reviews.saveApiCycleReviewDraft).toHaveBeenCalledTimes(1);
  expect(value.isSaving).toBe(false);
});

test('export uses the saved report statistics and reflections', async () => {
  await mount();
  let name = '';
  await act(async () => { name = await value.exportReport(7, 'Autumn'); });
  expect(name).toBe('report.md');
  expect(exportCycleReport).toHaveBeenCalledWith('Autumn', expect.stringContaining('**Tasks completed:** 5'));
  expect(exportCycleReport).toHaveBeenCalledWith('Autumn', expect.stringContaining('Progress'));
});

test('export accepts valid saved Unicode text without imposing a second UTF-16 limit', async () => {
  const unicode = '😀'.repeat(2000);
  reviews.fetchApiCycleReviews.mockResolvedValueOnce([{ ...review, whatLearned: unicode }]);
  await mount();
  await value.exportReport(7, 'Autumn');
  expect(exportCycleReport).toHaveBeenCalledWith('Autumn', expect.stringContaining(unicode));
});

test('a missing saved report cannot be exported', async () => {
  reviews.fetchApiCycleReviews.mockResolvedValueOnce([]);
  await mount();
  await expect(value.exportReport(7, 'Autumn')).rejects.toThrow('Save the cycle review');
  expect(exportCycleReport).not.toHaveBeenCalled();
});
