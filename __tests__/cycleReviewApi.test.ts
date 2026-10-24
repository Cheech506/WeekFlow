/** Mock HTTP checks for whole drafts, saved reports, and cycle finalization. */
import {
    deleteApiCycleReviewDraft, fetchApiCycleReview, fetchApiCycleReviews,
    finalizeApiCycleReview, saveApiCycleReviewDraft,
    type SaveApiCycleReviewDraftInput,
} from '../lib/api/cycleReviewApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/cycle-reviews';
const STAMP = '2026-10-23T12:00:00Z';
const NEXT_START = '2026-10-26';
const SNAPSHOT = {
  goalTotal: 4, goalCompleted: 1, taskCompleted: 10, milestoneTotal: 5, milestoneCompleted: 2,
  weeklyReviewsCompleted: 5, longestStreak: 3, bestWeekNumber: 2, bestWeekCount: 5,
  bestDay: 'Tuesday', bestDayCount: 3, highPriorityCompleted: 4, recurringCompleted: 5,
  rewardsUnlocked: 1, brainDumpsArchived: 2,
};
const WIRE_SNAPSHOT = {
  goal_total: 4, goal_completed: 1, task_completed: 10, milestone_total: 5, milestone_completed: 2,
  weekly_reviews_completed: 5, longest_streak: 3, best_week_number: 2, best_week_count: 5,
  best_day: 'Tuesday', best_day_count: 3, high_priority_completed: 4, recurring_completed: 5,
  rewards_unlocked: 1, brain_dumps_archived: 2,
};
function input(): SaveApiCycleReviewDraftInput {
  return { cycleId: 9, reflection: {}, snapshot: { ...SNAPSHOT },
    nextCycle: { name: 'Next', theme: 'Calm', startDate: NEXT_START, firstWeekCommitments: ['Study'] },
    outcomes: [{ goalId: 12, action: 'carryForward' }] };
}
function review(changes: Record<string, unknown> = {}) {
  const frozen = Object.fromEntries(Object.entries(WIRE_SNAPSHOT).map(([key, value]) => [`snapshot_${key}`, value]));
  return { id: 41, source_cycle_review_id: 1781204320001, cycle_id: 9,
    biggest_accomplishment: null, biggest_challenge: null, what_worked_well: null,
    what_change_next_cycle: null, what_stop_doing: null, what_continue_doing: null, what_learned: null,
    ...frozen, next_cycle_name: 'Next', next_cycle_primary_focus: null, next_cycle_theme: 'Calm',
    next_cycle_start_date: NEXT_START, next_cycle_first_commitments: ['Study'], next_cycle_id: null,
    created_at: STAMP, updated_at: STAMP, finalized_at: null, ...changes };
}
function outcome(changes: Record<string, unknown> = {}) {
  return { id: 71, source_cycle_goal_outcome_id: 1781204320002, cycle_review_id: 41,
    goal_id: 12, goal_title: 'Original goal', action: 'carryForward', replacement_title: null,
    destination_goal_id: null, created_at: STAMP, updated_at: STAMP, ...changes };
}
function detail(reviewChanges: Record<string, unknown> = {}, outcomes = [outcome()]) {
  return { review: review(reviewChanges), outcomes };
}
function successor(changes: Record<string, unknown> = {}) {
  return { id: 10, source_planning_cycle_id: null, name: 'Next', primary_focus: null, theme: 'Calm',
    start_date: NEXT_START, end_date: '2027-01-17', active: true, created_at: STAMP, completed_at: null, ...changes };
}
function finalized(changes: Record<string, unknown> = {}) {
  return { ...detail({ finalized_at: STAMP, next_cycle_id: 10 }, [outcome({ destination_goal_id: 101 })]),
    next_cycle: successor(), already_finalized: false, ...changes };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockImplementation(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(value), { status })));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('lists saved reviews with flat UI snapshot fields and read-only source identity', async () => {
  respond([review()]);
  const [saved] = await fetchApiCycleReviews({}, OPTIONS);
  expect(saved).toMatchObject({ id: 41, cycleId: 9, sourceCycleReviewId: 1781204320001,
    ...SNAPSHOT, nextCycleStartDate: NEXT_START, nextCycleFirstWeekCommitments: ['Study'], finalizedAt: null });
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test.each([false, true])('captures cycle and finalized filter %j before awaiting', async (finalizedFlag) => {
  respond([review({ finalized_at: finalizedFlag ? STAMP : null })]);
  const filters = { cycleId: 9, finalized: finalizedFlag };
  const pending = fetchApiCycleReviews(filters, OPTIONS);
  filters.cycleId = 10; filters.finalized = !finalizedFlag;
  expect((await pending)[0].cycleId).toBe(9);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?cycle_id=9&finalized=${finalizedFlag}`);
});

test('reads one report and validates its nested goal outcomes', async () => {
  respond(detail());
  const saved = await fetchApiCycleReview(41, OPTIONS);
  expect(saved.review.id).toBe(41);
  expect(saved.outcomes[0]).toMatchObject({ cycleReviewId: 41, goalId: 12, goalTitle: 'Original goal', destinationGoalId: null });
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test('reads historical finalized reports after goal and successor deletion', async () => {
  respond(detail({ finalized_at: STAMP, next_cycle_id: null }, [outcome({ goal_id: null, destination_goal_id: null })]));
  const saved = await fetchApiCycleReview(41, OPTIONS);
  expect(saved.review.finalizedAt).toBe(STAMP);
  expect(saved.review.nextCycleId).toBeNull();
  expect(saved.outcomes[0].goalTitle).toBe('Original goal');
});

test('reads an imported unfinished draft whose next start date has not been filled in', async () => {
  respond(detail({ next_cycle_start_date: null }));
  expect((await fetchApiCycleReview(41, OPTIONS)).review.nextCycleStartDate).toBeNull();
});

test('saving sends the whole draft once and does not call finalization', async () => {
  respond(detail());
  const saved = await saveApiCycleReviewDraft(input(), OPTIONS);
  expect(saved.review.finalizedAt).toBeNull();
  expect(body()).toEqual({ cycle_id: 9,
    reflection: { biggest_accomplishment: null, biggest_challenge: null, what_worked_well: null,
      what_change_next_cycle: null, what_stop_doing: null, what_continue_doing: null, what_learned: null },
    snapshot: WIRE_SNAPSHOT,
    next_cycle: { name: 'Next', primary_focus: null, theme: 'Calm', start_date: NEXT_START, first_week_commitments: ['Study'] },
    outcomes: [{ goal_id: 12, action: 'carryForward', replacement_title: null }] });
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/draft`, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('normalizes all sections and matches outcomes independently of their response order', async () => {
  const form = input();
  form.reflection = { biggestAccomplishment: ' Finished work ', whatLearned: '   ' };
  form.nextCycle = { name: ' Next ', theme: ' Calm ', primaryFocus: '   ', startDate: NEXT_START,
    firstWeekCommitments: [' Study ', '  ', 'Rest'] };
  form.outcomes = [{ goalId: 12, action: 'replace', replacementTitle: ' New goal ' }, { goalId: 13, action: 'archive' }];
  respond(detail({ biggest_accomplishment: 'Finished work', next_cycle_first_commitments: ['Study', 'Rest'] }, [
    outcome({ id: 72, goal_id: 13, action: 'archive' }), outcome({ action: 'replace', replacement_title: 'New goal' }),
  ]));
  expect((await saveApiCycleReviewDraft(form, OPTIONS)).outcomes).toHaveLength(2);
  expect(body().reflection.biggest_accomplishment).toBe('Finished work');
  expect(body().reflection.what_learned).toBeNull();
  expect(body().next_cycle.first_week_commitments).toEqual(['Study', 'Rest']);
  expect(body().outcomes[0].replacement_title).toBe('New goal');
});

test('explicit outcomes=[] clears draft selections and remains separate from goal deletion', async () => {
  const form = input(); form.outcomes = [];
  respond(detail({}, []));
  expect((await saveApiCycleReviewDraft(form, OPTIONS)).outcomes).toEqual([]);
  expect(body().outcomes).toEqual([]);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('snapshot can be refreshed while saving an unfinalized draft', async () => {
  const form = input(); form.snapshot.taskCompleted = 11;
  respond(detail({ snapshot_task_completed: 11 }));
  expect((await saveApiCycleReviewDraft(form, OPTIONS)).review.taskCompleted).toBe(11);
});

test('captures nested form values before caller mutation', async () => {
  const form = input(); respond(detail());
  const pending = saveApiCycleReviewDraft(form, OPTIONS);
  form.snapshot.taskCompleted = 99; form.nextCycle.firstWeekCommitments?.push('Changed');
  form.outcomes[0].action = 'archive'; form.reflection.whatLearned = 'Changed';
  expect((await pending).review.taskCompleted).toBe(10);
  expect(body().next_cycle.first_week_commitments).toEqual(['Study']);
  expect(body().outcomes[0].action).toBe('carryForward');
});

test('finalization uses one bodyless POST and decodes the new successor', async () => {
  respond(finalized());
  const saved = await finalizeApiCycleReview(41, OPTIONS);
  expect(saved.alreadyFinalized).toBe(false);
  expect(saved.review.finalizedAt).toBe(STAMP);
  expect(saved.nextCycle).toMatchObject({ id: 10, startDate: NEXT_START, endDate: '2027-01-17', active: true });
  expect(saved.outcomes[0].destinationGoalId).toBe(101);
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41/finalize`, expect.objectContaining({ method: 'POST' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('already-finalized response can return a successor that was later renamed and completed', async () => {
  respond(finalized({ already_finalized: true, next_cycle: successor({ name: 'Renamed later', active: false, completed_at: STAMP,
    start_date: '2027-02-01', end_date: '2027-04-25' }) }));
  const saved = await finalizeApiCycleReview(41, OPTIONS);
  expect(saved.alreadyFinalized).toBe(true);
  expect(saved.nextCycle?.name).toBe('Renamed later');
  expect(saved.nextCycle?.active).toBe(false);
});

test('already-finalized imported report can have no live successor or goal links', async () => {
  respond(finalized({ already_finalized: true, next_cycle: null,
    ...detail({ finalized_at: STAMP, next_cycle_id: null }, [outcome({ goal_id: null, destination_goal_id: null })]) }));
  const saved = await finalizeApiCycleReview(41, OPTIONS);
  expect(saved.nextCycle).toBeNull(); expect(saved.outcomes[0].goalId).toBeNull();
});

test('first finalization accepts complete/archive outcomes without destination goals', async () => {
  respond(finalized({ outcomes: [outcome({ action: 'complete' }), outcome({ id: 72, goal_id: 13, action: 'archive' })] }));
  expect((await finalizeApiCycleReview(41, OPTIONS)).outcomes).toHaveLength(2);
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source IDs %j before sending', async (id) => {
  await expect(fetchApiCycleReview(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(finalizeApiCycleReview(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiCycleReviewDraft(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiCycleReviews({ cycleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(saveApiCycleReviewDraft({ ...input(), cycleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['reflection', 'snapshot', 'nextCycle', 'outcomes'])('requires explicit draft section %s', async (key) => {
  const form: Record<string, unknown> = { ...input() }; delete form[key];
  await expect(saveApiCycleReviewDraft(form as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { goalCompleted: 5 }, { milestoneCompleted: 6 }, { highPriorityCompleted: 11 },
  { recurringCompleted: 11 }, { bestWeekCount: 11 }, { bestDayCount: 11 }, { rewardsUnlocked: 2 },
  { bestWeekNumber: null }, { bestWeekNumber: 13 }, { bestWeekCount: 0 },
  { bestDay: 'Funday' }, { bestDay: null }, { bestDayCount: 0 },
  { taskCompleted: -1 }, { longestStreak: true }, { weeklyReviewsCompleted: 1.5 },
  { brainDumpsArchived: 2_147_483_648 }, { sourceCycleReviewId: 1781204320001 },
])('rejects inconsistent or unsupported snapshot values %j', async (changes) => {
  const form = input(); Object.assign(form.snapshot, changes);
  await expect(saveApiCycleReviewDraft(form, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { startDate: '2026-02-29' }, { startDate: '9999-12-31' }, { startDate: null },
  { name: 'x'.repeat(81) }, { primaryFocus: 'x'.repeat(301) }, { theme: 'x'.repeat(121) },
  { firstWeekCommitments: ['a', 'b', 'c', 'd', 'e', 'f'] }, { firstWeekCommitments: ['Study', ' study '] },
  { firstWeekCommitments: [null] }, { firstWeekCommitments: ['x'.repeat(181)] },
  { firstWeekCommitments: null }, { id: 10 }, { endDate: '2027-01-17' },
])('rejects invalid next-cycle plan values %j', async (changes) => {
  const form = input(); Object.assign(form.nextCycle, changes);
  await expect(saveApiCycleReviewDraft(form, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { biggestAccomplishment: 'x'.repeat(2001) }, { whatLearned: 5 }, { finalizedAt: STAMP },
])('rejects invalid reflection or protected reflection fields %j', async (changes) => {
  const form = input(); Object.assign(form.reflection, changes);
  await expect(saveApiCycleReviewDraft(form, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('reflection Unicode limit matches PostgreSQL character counting', async () => {
  const text = '😀'.repeat(2000); const form = input(); form.reflection.whatLearned = text;
  respond(detail({ what_learned: text }));
  expect((await saveApiCycleReviewDraft(form, OPTIONS)).review.whatLearned).toBe(text);
});

test.each([
  { outcomes: [{ goalId: 12, action: 'archive' }, { goalId: 12, action: 'complete' }] },
  { outcomes: [{ goalId: 1781204320001, action: 'archive' }] }, { outcomes: [{ goalId: 12, action: 'replace' }] },
  { outcomes: [{ goalId: 12, action: 'archive', destinationGoalId: 101 }] },
])('rejects duplicate or invalid goal selections', async ({ outcomes }) => {
  await expect(saveApiCycleReviewDraft({ ...input(), outcomes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { id: 0 }, { source_cycle_review_id: -1 }, { cycle_id: 1781204320001 },
  { snapshot_goal_completed: 5 }, { snapshot_best_day: 'Funday' }, { snapshot_best_week_number: 13 },
  { finalized_at: STAMP, next_cycle_start_date: null }, { next_cycle_id: 0 },
  { next_cycle_start_date: '2026-02-29' }, { next_cycle_first_commitments: [null] },
  { next_cycle_first_commitments: ['x'.repeat(181)] }, { biggest_accomplishment: 'x'.repeat(2001) },
  { updated_at: '2026-10-23T24:00:00Z' },
])('rejects invalid saved review responses %j', async (changes) => {
  respond(detail(changes));
  await expect(fetchApiCycleReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { outcomes: [outcome({ cycle_review_id: 42 })] },
  { outcomes: [outcome(), outcome()] },
  { outcomes: [outcome(), outcome({ id: 72 })] },
])('rejects nested outcomes attached to the wrong review or duplicated goals/IDs', async (changes) => {
  respond({ ...detail(), ...changes });
  await expect(fetchApiCycleReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { rows: [review(), review()] }, { rows: [review(), review({ id: 42 })] },
  { rows: [review({ cycle_id: 10 })] }, { rows: [review({ finalized_at: STAMP })] },
])('rejects duplicate cycle reviews or incorrect filtered results', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiCycleReviews({ cycleId: 9, finalized: false }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { cycle_id: 10 }, { finalized_at: STAMP }, { next_cycle_id: 10 },
  { what_learned: 'Unexpected text' }, { snapshot_task_completed: 11 },
  { next_cycle_name: 'Wrong plan' }, { next_cycle_first_commitments: ['Other promise'] },
])('rejects a save response that contradicts submitted draft values %j', async (changes) => {
  respond(detail(changes));
  await expect(saveApiCycleReviewDraft(input(), OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each([
  { outcomes: [] }, { outcomes: [outcome({ goal_id: 13 })] }, { outcomes: [outcome({ action: 'archive' })] },
  { outcomes: [outcome({ destination_goal_id: 101 })] }, { outcomes: [outcome({ goal_id: null })] },
])('rejects draft outcome results that do not match submitted choices', async ({ outcomes }) => {
  respond(detail({}, outcomes));
  await expect(saveApiCycleReviewDraft(input(), OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each([
  { next_cycle: null }, { already_finalized: 'false' }, { review: review() },
  { next_cycle: successor({ id: 11 }) }, { next_cycle: successor({ id: 9 }), review: review({ next_cycle_id: 9, finalized_at: STAMP }) },
  { next_cycle: successor({ active: false }) }, { next_cycle: successor({ name: 'Wrong' }) },
  { next_cycle: successor({ end_date: '2027-01-18' }) }, { next_cycle: successor({ source_planning_cycle_id: 1781204320001 }) },
  { outcomes: [outcome()] }, { outcomes: [outcome({ goal_id: null, destination_goal_id: 101 })] },
  { outcomes: [outcome({ destination_goal_id: 12 })] },
  { outcomes: [outcome({ destination_goal_id: 101 }), outcome({ id: 72, goal_id: 13, destination_goal_id: 101 })] },
])('rejects inconsistent first-finalization results', async (changes) => {
  respond(finalized(changes));
  await expect(finalizeApiCycleReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test.each(['read', 'finalize'])('rejects the wrong review ID during %s', async (action) => {
  respond(action === 'read' ? detail({ id: 42 }, []) : finalized({ review: review({ id: 42, finalized_at: STAMP, next_cycle_id: 10 }), outcomes: [] }));
  await expect(action === 'read' ? fetchApiCycleReview(41, OPTIONS) : finalizeApiCycleReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([404, 409, 422, 500])('finalization preserves HTTP %s and performs no separate cycle/goal writes', async (status) => {
  respond({ detail: 'Review could not be finalized.' }, status);
  await expect(finalizeApiCycleReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('lost finalization response stays uncertain without automatic retry', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(finalizeApiCycleReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('draft deletion sends one bodyless DELETE', async () => {
  respond(null, 204);
  await expect(deleteApiCycleReviewDraft(41, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
