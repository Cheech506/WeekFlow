/** Mock HTTP and pure validation checks for saved cycle goal outcomes. */
import {
    decodeApiCycleGoalOutcome, encodeApiCycleGoalOutcomeSelection,
    fetchApiCycleGoalOutcome, fetchApiCycleGoalOutcomes,
} from '../lib/api/cycleGoalOutcomeApi';

const OPTIONS = { baseUrl: 'http://localhost:8000' };
const PATH = 'http://localhost:8000/api/v1/cycle-goal-outcomes';
function outcome(changes: Record<string, unknown> = {}) {
  return { id: 41, source_cycle_goal_outcome_id: 1781204320001, cycle_review_id: 9,
    goal_id: 12, goal_title: 'Saved original goal', action: 'carryForward', replacement_title: null,
    destination_goal_id: 13, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-22T14:00:00+00:00', ...changes };
}
let fetchSpy: jest.SpyInstance;
beforeEach(() => { fetchSpy = jest.spyOn(global, 'fetch'); });
afterEach(() => { jest.restoreAllMocks(); });
function respond(value: unknown, status = 200) {
  fetchSpy.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(value), { status })));
}

test('maps saved titles, native parent links, source identity, and timestamps', async () => {
  respond([outcome()]);
  const [saved] = await fetchApiCycleGoalOutcomes({}, OPTIONS);
  expect(saved).toEqual({ id: 41, sourceCycleGoalOutcomeId: 1781204320001, cycleReviewId: 9,
    goalId: 12, goalTitle: 'Saved original goal', action: 'carryForward', replacementTitle: null,
    destinationGoalId: 13, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-22T14:00:00+00:00' });
  expect(fetchSpy.mock.calls[0][0]).toBe(PATH);
  expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
});

test('captures all filters before awaiting and uses native IDs in the query', async () => {
  respond([outcome()]);
  const filters = { cycleReviewId: 9, goalId: 12, destinationGoalId: 13, action: 'carryForward' as const };
  const pending = fetchApiCycleGoalOutcomes(filters, OPTIONS);
  filters.goalId = 99; filters.cycleReviewId = 10; filters.destinationGoalId = 100;
  expect((await pending)[0].goalId).toBe(12);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${PATH}?cycle_review_id=9&goal_id=12&destination_goal_id=13&action=carryForward`);
});

test('reads one outcome with its native ID', async () => {
  respond(outcome());
  expect((await fetchApiCycleGoalOutcome(41, OPTIONS)).id).toBe(41);
  expect(fetchSpy).toHaveBeenCalledWith(`${PATH}/41`, expect.objectContaining({ method: 'GET' }));
});

test('saved titles remain readable after original and destination goals are deleted', async () => {
  respond(outcome({ goal_id: null, destination_goal_id: null }));
  const saved = await fetchApiCycleGoalOutcome(41, OPTIONS);
  expect(saved.goalId).toBeNull(); expect(saved.destinationGoalId).toBeNull();
  expect(saved.goalTitle).toBe('Saved original goal');
});

test('draft carry-forward selection can have no destination goal yet', async () => {
  respond(outcome({ destination_goal_id: null }));
  expect((await fetchApiCycleGoalOutcome(41, OPTIONS)).destinationGoalId).toBeNull();
});

test.each(['complete', 'carryForward', 'archive'])('encodes %s selection without making a request or changing a goal', (action) => {
  expect(encodeApiCycleGoalOutcomeSelection({ goalId: 12, action } as never))
    .toEqual({ goal_id: 12, action, replacement_title: null });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('encodes replace with a normalized title and no forged history fields', () => {
  expect(encodeApiCycleGoalOutcomeSelection({ goalId: 12, action: 'replace', replacementTitle: ' New goal ' }))
    .toEqual({ goal_id: 12, action: 'replace', replacement_title: 'New goal' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('blank replacement text becomes null for a non-replacement selection', () => {
  expect(encodeApiCycleGoalOutcomeSelection({ goalId: 12, action: 'archive', replacementTitle: '   ' })).toEqual({
    goal_id: 12, action: 'archive', replacement_title: null,
  });
});

test('does not mutate the caller selection', () => {
  const input = { goalId: 12, action: 'replace' as const, replacementTitle: ' New goal ' };
  const encoded = encodeApiCycleGoalOutcomeSelection(input);
  expect(input.replacementTitle).toBe(' New goal ');
  expect(encoded.replacement_title).toBe('New goal');
});

test.each([0, -1, 1.5, true, 1781204320001])('rejects invalid/source IDs %j without sending', async (id) => {
  await expect(fetchApiCycleGoalOutcome(id as number, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiCycleGoalOutcomes({ cycleReviewId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiCycleGoalOutcomes({ goalId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiCycleGoalOutcomes({ destinationGoalId: id } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(() => encodeApiCycleGoalOutcomeSelection({ goalId: id, action: 'archive' } as never)).toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  { action: 'delete' }, { action: 'replace' }, { action: 'replace', replacementTitle: null },
  { action: 'replace', replacementTitle: ' ' }, { action: 'replace', replacementTitle: 42 },
  { action: 'replace', replacementTitle: 'x'.repeat(181) },
  { action: 'archive', replacementTitle: 'Not allowed' }, { sourceCycleGoalOutcomeId: 1781204320001 },
  { goalTitle: 'Forged title' }, { cycleReviewId: 9 }, { destinationGoalId: 13 },
  { createdAt: '2026-10-01T12:00:00Z' },
])('rejects invalid or server-owned selection fields %j', (changes) => {
  expect(() => encodeApiCycleGoalOutcomeSelection({ goalId: 12, action: 'archive', ...changes } as never))
    .toThrow(expect.objectContaining({ kind: 'configuration' }));
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('missing goal ID and unexpected filters are rejected', async () => {
  expect(() => encodeApiCycleGoalOutcomeSelection({ action: 'archive' } as never)).toThrow();
  await expect(fetchApiCycleGoalOutcomes({ sourceGoalId: 1781204320001 } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  await expect(fetchApiCycleGoalOutcomes({ action: 'delete' } as never, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('replacement title limit counts Unicode code points', () => {
  const title = '😀'.repeat(180);
  expect(encodeApiCycleGoalOutcomeSelection({ goalId: 12, action: 'replace', replacementTitle: title }).replacement_title).toBe(title);
  expect(() => encodeApiCycleGoalOutcomeSelection({ goalId: 12, action: 'replace', replacementTitle: title + '😀' })).toThrow();
});

test.each([
  { id: 0 }, { source_cycle_goal_outcome_id: -1 }, { cycle_review_id: null },
  { goal_id: 1781204320001 }, { destination_goal_id: 0 }, { goal_title: ' ' },
  { action: 'delete' }, { action: 'replace', replacement_title: null },
  { action: 'replace', replacement_title: ' ' }, { action: 'replace', replacement_title: 'x'.repeat(181) },
  { action: 'archive', replacement_title: 'Wrong' },
  { created_at: '2026-02-29T12:00:00Z' }, { updated_at: '2026-10-22T24:00:00Z' },
])('rejects malformed or inconsistent saved outcome %j', async (changes) => {
  respond(outcome(changes));
  await expect(fetchApiCycleGoalOutcome(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('shared decoder validates a nested replacement outcome without HTTP', () => {
  const saved = decodeApiCycleGoalOutcome(outcome({ action: 'replace', replacement_title: 'New goal' }));
  expect(saved.action).toBe('replace'); expect(saved.replacementTitle).toBe('New goal');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('long original goal titles remain intact as historical text', async () => {
  const title = 'x'.repeat(20000);
  respond(outcome({ goal_title: title }));
  expect((await fetchApiCycleGoalOutcome(41, OPTIONS)).goalTitle).toBe(title);
});

test.each([
  { rows: [outcome(), outcome()] },
  { rows: [outcome(), outcome({ id: 42 })] },
  { rows: [outcome({ cycle_review_id: 10 })] },
  { rows: [outcome({ goal_id: 99 })] },
  { rows: [outcome({ destination_goal_id: 99 })] },
  { rows: [outcome({ action: 'replace', replacement_title: 'New title' })] },
])('rejects duplicate identities or items outside requested filters', async ({ rows }) => {
  respond(rows);
  await expect(fetchApiCycleGoalOutcomes({ cycleReviewId: 9, goalId: 12, destinationGoalId: 13, action: 'carryForward' }, OPTIONS))
    .rejects.toMatchObject({ kind: 'invalid-response' });
});

test('multiple outcomes with deleted original goal links remain valid history', async () => {
  respond([outcome({ goal_id: null }), outcome({ id: 42, goal_id: null })]);
  expect(await fetchApiCycleGoalOutcomes({}, OPTIONS)).toHaveLength(2);
});

test('the same goal can appear under different reviews', async () => {
  respond([outcome(), outcome({ id: 42, cycle_review_id: 10 })]);
  expect(await fetchApiCycleGoalOutcomes({}, OPTIONS)).toHaveLength(2);
});

test('rejects a different outcome ID on a single read', async () => {
  respond(outcome({ id: 42 }));
  await expect(fetchApiCycleGoalOutcome(41, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test.each([404, 422, 500])('preserves read HTTP %s and performs no writes', async (status) => {
  respond({ detail: 'Outcome could not be read.' }, status);
  await expect(fetchApiCycleGoalOutcome(41, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, mutationMayHaveSucceeded: false });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
});

test('network failure on a read does not retry or pretend to save a selection', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Connection lost'));
  await expect(fetchApiCycleGoalOutcome(41, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: false });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
