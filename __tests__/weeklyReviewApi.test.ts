/** Mock HTTP checks for weekly reviews and frozen historical snapshots. */
import {
    createApiWeeklyReview, deleteApiWeeklyReview, fetchApiWeeklyReview,
    fetchApiWeeklyReviews, updateApiWeeklyReview,
} from '../lib/api/weeklyReviewApi';
import type { WeeklyReviewSnapshot } from '../lib/weeklyReview';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/weekly-reviews';
const WEEK = '2026-10-19';
const SNAPSHOT: WeeklyReviewSnapshot = {
  completedCount: 3, unfinishedCount: 1, overdueCount: 1, completionRate: 75,
  goalsProgressedCount: 2, bestDay: 'Tuesday', bestDayCount: 2,
  archivedBrainDumpCount: 3, highPriorityCompletedCount: 2, recurringCompletedCount: 1,
};
function review(changes: Record<string, unknown> = {}) {
  return { id: 41, source_weekly_review_id: 1781204320001, week_start: WEEK, cycle_id: 9,
    what_went_well: 'Kept showing up', what_caused_problems: null, what_learned: null,
    what_change_next_week: null, next_week_focus: null,
    snapshot_completed_count: 3, snapshot_unfinished_count: 1, snapshot_overdue_count: 1,
    snapshot_completion_rate: 75, snapshot_goals_progressed_count: 2,
    snapshot_best_day: 'Tuesday', snapshot_best_day_count: 2, snapshot_archived_brain_dump_count: 3,
    snapshot_high_priority_completed_count: 2, snapshot_recurring_completed_count: 1,
    created_at: '2026-10-22T12:00:00Z', updated_at: '2026-10-22T13:00:00+00:00',
    reviewed_at: '2026-10-22T13:00:00+00:00', ...changes };
}
function wireSnapshot(snapshot: WeeklyReviewSnapshot) {
  return { completed_count: snapshot.completedCount, unfinished_count: snapshot.unfinishedCount,
    overdue_count: snapshot.overdueCount, completion_rate: snapshot.completionRate,
    goals_progressed_count: snapshot.goalsProgressedCount, best_day: snapshot.bestDay,
    best_day_count: snapshot.bestDayCount, archived_brain_dump_count: snapshot.archivedBrainDumpCount,
    high_priority_completed_count: snapshot.highPriorityCompletedCount, recurring_completed_count: snapshot.recurringCompletedCount };
}
function createdReview(snapshot = SNAPSHOT, changes: Record<string, unknown> = {}) {
  const frozen = Object.fromEntries(Object.entries(wireSnapshot(snapshot)).map(([key, value]) => [`snapshot_${key}`, value]));
  return review({ source_weekly_review_id: null, cycle_id: null, what_went_well: null, ...frozen, ...changes });
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockImplementation(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(value), { status })));
}
function body() { return JSON.parse(fetchSpy.mock.calls[0][1].body); }

test('maps saved reflections, calendar date, source ID, timestamps, and flat snapshot fields', async () => {
  respond([review()]);
  const [saved] = await fetchApiWeeklyReviews({}, OPTIONS);
  expect(saved).toMatchObject({ id: 41, sourceWeeklyReviewId: 1781204320001, weekStart: WEEK,
    cycleId: 9, whatWentWell: 'Kept showing up', whatLearned: null, ...SNAPSHOT,
    createdAt: '2026-10-22T12:00:00Z', reviewedAt: '2026-10-22T13:00:00+00:00' });
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
});

test('captures both optional filters before caller mutation', async () => {
  respond([review()]);
  const filters = { weekStart: WEEK, cycleId: 9 };
  const pending = fetchApiWeeklyReviews(filters, OPTIONS);
  filters.weekStart = '2026-10-26'; filters.cycleId = 10;
  expect((await pending)[0].weekStart).toBe(WEEK);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?week_start=${WEEK}&cycle_id=9`);
});

test('reads a review by native PostgreSQL ID', async () => {
  respond(review());
  expect((await fetchApiWeeklyReview(41, OPTIONS)).id).toBe(41);
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test('creation sends a nested snapshot and normalized reflection fields', async () => {
  respond(createdReview(SNAPSHOT, { cycle_id: 9, what_went_well: 'Kept showing up' }), 201);
  await createApiWeeklyReview({ weekStart: WEEK, cycleId: 9, snapshot: SNAPSHOT,
    whatWentWell: ' Kept showing up ', whatLearned: '  ' }, OPTIONS);
  expect(body()).toEqual({ week_start: WEEK, cycle_id: 9, snapshot: wireSnapshot(SNAPSHOT),
    what_went_well: 'Kept showing up', what_caused_problems: null, what_learned: null,
    what_change_next_week: null, next_week_focus: null });
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('PATCH sends only supplied reflections and can explicitly clear optional fields', async () => {
  respond(review({ what_went_well: null, cycle_id: null }));
  await updateApiWeeklyReview(41, { whatWentWell: '  ', cycleId: null, whatLearned: undefined }, OPTIONS);
  expect(body()).toEqual({ what_went_well: null, cycle_id: null });
  expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
  expect(body()).not.toHaveProperty('snapshot');
  expect(body()).not.toHaveProperty('week_start');
});

test('empty PATCH does not invent changes', async () => {
  respond(review());
  const saved = await updateApiWeeklyReview(41, {}, OPTIONS);
  expect(body()).toEqual({});
  expect(saved).toMatchObject(SNAPSHOT);
});

test('captures the snapshot and reflection before the caller edits its input', async () => {
  respond(createdReview(SNAPSHOT, { next_week_focus: 'Rest' }), 201);
  const input = { weekStart: WEEK, snapshot: { ...SNAPSHOT }, nextWeekFocus: 'Rest' };
  const pending = createApiWeeklyReview(input, OPTIONS);
  input.snapshot.completedCount = 100; input.nextWeekFocus = 'Work';
  expect((await pending).completedCount).toBe(3);
  expect(body().next_week_focus).toBe('Rest');
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source IDs %j without sending', async (id) => {
  await expect(fetchApiWeeklyReview(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiWeeklyReview(id as number, {}, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(deleteApiWeeklyReview(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyReviews({ cycleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT, cycleId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['2026-10-20', '2026-02-30', '2026-10-19T00:00:00Z', '', '0000-01-03'])('rejects invalid or non-Monday week %j', async (weekStart) => {
  await expect(createApiWeeklyReview({ weekStart, snapshot: SNAPSHOT }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiWeeklyReviews({ weekStart }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

const INVALID_SNAPSHOTS = [
  { completedCount: -1 }, { unfinishedCount: 1.5 }, { overdueCount: true },
  { archivedBrainDumpCount: 2_147_483_648 },
  { completedCount: 2_147_483_647, unfinishedCount: 1 },
  { completionRate: 74 }, { overdueCount: 2 }, { goalsProgressedCount: 4 },
  { bestDayCount: 4 }, { highPriorityCompletedCount: 4 }, { recurringCompletedCount: 4 },
  { bestDay: null }, { bestDayCount: 0 }, { bestDay: 'Funday' },
  { bestDay: undefined }, { createdAt: '2026-10-22T12:00:00Z' },
];
test.each(INVALID_SNAPSHOTS)('rejects inconsistent or protected snapshot input %j', async (changes) => {
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: { ...SNAPSHOT, ...changes } } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['whatWentWell', 'whatCausedProblems', 'whatLearned', 'whatChangeNextWeek', 'nextWeekFocus'])('rejects oversized reflection field %s', async (key) => {
  const changes = { [key]: 'x'.repeat(2001) };
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT, ...changes }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiWeeklyReview(41, changes, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('reflection limits count Unicode code points consistently with PostgreSQL', async () => {
  const text = '😀'.repeat(2000);
  respond(createdReview(SNAPSHOT, { what_went_well: text }), 201);
  expect((await createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT, whatWentWell: text }, OPTIONS)).whatWentWell).toBe(text);
  await expect(updateApiWeeklyReview(41, { whatWentWell: text + '😀' }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test.each([{ whatLearned: 5 }, { sourceWeeklyReviewId: 1781204320001 },
  { reviewedAt: '2026-10-22T12:00:00Z' }, { id: 41 }])('rejects invalid reflection or protected metadata %j', async (changes) => {
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT, ...changes } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(updateApiWeeklyReview(41, changes as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([{ snapshot: SNAPSHOT }, { weekStart: WEEK }, { completedCount: 4 }])('PATCH cannot rewrite snapshot or week identity %j', async (changes) => {
  await expect(updateApiWeeklyReview(41, changes as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('rejects a missing initial snapshot', async () => {
  await expect(createApiWeeklyReview({ weekStart: WEEK } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { completedCount: 0, unfinishedCount: 0, overdueCount: 0, completionRate: 0, goalsProgressedCount: 0,
    bestDay: null, bestDayCount: 0, archivedBrainDumpCount: 0, highPriorityCompletedCount: 0, recurringCompletedCount: 0 },
  { ...SNAPSHOT, completedCount: 1, unfinishedCount: 7, completionRate: 13, goalsProgressedCount: 1,
    bestDayCount: 1, highPriorityCompletedCount: 1 },
  { ...SNAPSHOT, completedCount: 2_147_483_647, unfinishedCount: 0, overdueCount: 0, completionRate: 100 },
])('accepts empty, half-up-rounded, or maximum-count consistent snapshot', async (snapshot) => {
  respond(createdReview(snapshot), 201);
  const saved = await createApiWeeklyReview({ weekStart: WEEK, snapshot }, OPTIONS);
  expect(saved).toMatchObject(snapshot);
});

test('Monday validation supports year 0001 without shifting calendar dates', async () => {
  respond(createdReview(SNAPSHOT, { week_start: '0001-01-01' }), 201);
  expect((await createApiWeeklyReview({ weekStart: '0001-01-01', snapshot: SNAPSHOT }, OPTIONS)).weekStart).toBe('0001-01-01');
});

test.each([
  { id: 0 }, { source_weekly_review_id: -1 }, { cycle_id: 1781204320001 },
  { week_start: '2026-10-20' }, { what_went_well: 'x'.repeat(2001) }, { what_learned: undefined },
  { snapshot_completion_rate: 74 }, { snapshot_overdue_count: 2 }, { snapshot_best_day: null },
  { snapshot_recurring_completed_count: 4 }, { snapshot_unfinished_count: -1 },
  { created_at: '2026-10-22T24:00:00Z' }, { reviewed_at: '2026-02-29T12:00:00Z' },
])('rejects malformed review data or inconsistent historical snapshot %j', async (changes) => {
  respond(review(changes));
  await expect(fetchApiWeeklyReview(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { rows: [review(), review()] },
  { rows: [review(), review({ id: 42 })] },
  { rows: [review({ cycle_id: 10 })] },
  { rows: [review({ week_start: '2026-10-26' })] },
])('rejects duplicate IDs/weeks or responses outside requested filters', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiWeeklyReviews({ weekStart: WEEK, cycleId: 9 }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each(['fetch', 'update'])('rejects wrong returned review ID for %s', async (action) => {
  respond(review({ id: 42 }));
  const pending = action === 'fetch' ? fetchApiWeeklyReview(41, OPTIONS) : updateApiWeeklyReview(41, {}, OPTIONS);
  await expect(pending).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([
  { week_start: '2026-10-26' }, { source_weekly_review_id: 1781204320001 },
  { what_went_well: 'Unexpected text' }, { cycle_id: 9 },
  { snapshot_archived_brain_dump_count: 4 },
])('rejects create results that contradict submitted values %j', async (changes) => {
  respond(createdReview(SNAPSHOT, changes), 201);
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('a duplicate-week 409 does not trigger a PATCH that could overwrite history', async () => {
  respond({ detail: 'A review already exists for this week.' }, 409);
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 409, mutationMayHaveSucceeded: false });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
});

test.each([404, 422, 500])('preserves HTTP %s without retrying', async (status) => {
  respond({ detail: 'Review could not be saved.' }, status);
  await expect(createApiWeeklyReview({ weekStart: WEEK, snapshot: SNAPSHOT }, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: status >= 500 });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('lost write response remains uncertain and is not automatically repeated', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(updateApiWeeklyReview(41, { nextWeekFocus: 'Rest' }, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test('delete sends one bodyless DELETE without touching other feature endpoints', async () => {
  respond(null, 204);
  await expect(deleteApiWeeklyReview(41, OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'DELETE' }));
  expect(fetchSpy.mock.calls[0][1]).not.toHaveProperty('body');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
