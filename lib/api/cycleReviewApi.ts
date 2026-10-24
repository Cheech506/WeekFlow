/** Cycle-review drafts, saved reports, and explicit transactional finalization. */

import type { StoredCycleReview } from '../cycleReviewStorage';
import type {
    CycleReviewReflectionInput, CycleReviewSnapshot, NextCyclePlanInput, NormalizedCycleReviewReflection,
} from '../cycleReviewUtils';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';
import {
    decodeApiCycleGoalOutcome, encodeApiCycleGoalOutcomeSelection,
    type ApiCycleGoalOutcome, type ApiCycleGoalOutcomeSelection, type EncodedApiCycleGoalOutcomeSelection,
} from './cycleGoalOutcomeApi';
import { decodeApiPlanningCycle, type ApiPlanningCycle } from './planningCycleApi';

export type ApiCycleReview = StoredCycleReview & { sourceCycleReviewId: number | null };
export type SaveApiCycleReviewDraftInput = {
  cycleId: number;
  reflection: CycleReviewReflectionInput;
  snapshot: CycleReviewSnapshot;
  nextCycle: NextCyclePlanInput;
  outcomes: ApiCycleGoalOutcomeSelection[];
};
export type ApiCycleReviewDetail = { review: ApiCycleReview; outcomes: ApiCycleGoalOutcome[] };
export type ApiCycleReviewFinalizeResult = ApiCycleReviewDetail & {
  nextCycle: ApiPlanningCycle | null;
  alreadyFinalized: boolean;
};
export type CycleReviewApiFilters = { cycleId?: number; finalized?: boolean };
export type CycleReviewApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;
const PATH = '/api/v1/cycle-reviews';
const MAX_COUNT = 2_147_483_647;
const REFLECTION_FIELDS = {
  biggestAccomplishment: 'biggest_accomplishment', biggestChallenge: 'biggest_challenge',
  whatWorkedWell: 'what_worked_well', whatChangeNextCycle: 'what_change_next_cycle',
  whatStopDoing: 'what_stop_doing', whatContinueDoing: 'what_continue_doing', whatLearned: 'what_learned',
} as const;
const SNAPSHOT_FIELDS = {
  goalTotal: 'goal_total', goalCompleted: 'goal_completed', taskCompleted: 'task_completed',
  milestoneTotal: 'milestone_total', milestoneCompleted: 'milestone_completed',
  weeklyReviewsCompleted: 'weekly_reviews_completed', longestStreak: 'longest_streak',
  bestWeekNumber: 'best_week_number', bestWeekCount: 'best_week_count', bestDay: 'best_day',
  bestDayCount: 'best_day_count', highPriorityCompleted: 'high_priority_completed',
  recurringCompleted: 'recurring_completed', rewardsUnlocked: 'rewards_unlocked', brainDumpsArchived: 'brain_dumps_archived',
} as const;
const REFLECTION_KEYS = Object.keys(REFLECTION_FIELDS) as Array<keyof typeof REFLECTION_FIELDS>;
const SNAPSHOT_KEYS = Object.keys(SNAPSHOT_FIELDS) as Array<keyof typeof SNAPSHOT_FIELDS>;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type EncodedPlan = {
  name: string | null; primary_focus: string | null; theme: string | null;
  start_date: string; first_week_commitments: string[];
};
type PreparedDraft = {
  cycle_id: number;
  reflection: Record<string, string | null>;
  snapshot: Record<string, number | string | null>;
  next_cycle: EncodedPlan;
  outcomes: EncodedApiCycleGoalOutcomeSelection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_COUNT;
}
function isNullableId(value: unknown): value is number | null {
  return value === null || isPostgresId(value);
}
function isSourceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}
function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function cycleEndDate(startDate: string): string | null {
  const date = new Date(`${startDate}T00:00:00Z`);
  // Match the backend's current twelve-inclusive-week successor calculation.
  date.setUTCDate(date.getUTCDate() + 83);
  return date.getUTCFullYear() <= 9999 ? date.toISOString().slice(0, 10) : null;
}
function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] &&
    Number.isFinite(Date.parse(value));
}
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireId(value: unknown, label = 'Cycle-review ID'): asserts value is number {
  if (!isPostgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Cycle-review input contains unsupported fields.');
  }
}
function readText(value: unknown, limit: number): string | null {
  if (value !== null && (typeof value !== 'string' || [...value].length > limit)) {
    throw new Error('Invalid saved cycle-review text.');
  }
  return value;
}
function inputText(value: unknown, limit: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalidInput(`${label} must be text or null.`);
  const text = value.trim();
  if ([...text].length > limit) invalidInput(`${label} must be ${limit} characters or fewer.`);
  return text || null;
}

function isSnapshot(value: unknown): value is CycleReviewSnapshot {
  if (!isRecord(value)) return false;
  for (const key of SNAPSHOT_KEYS) {
    if (key !== 'bestWeekNumber' && key !== 'bestDay' && !isCount(value[key])) return false;
  }
  if (value.bestWeekNumber !== null && (!isCount(value.bestWeekNumber) || value.bestWeekNumber < 1 || value.bestWeekNumber > 12)) return false;
  if (value.bestDay !== null && (typeof value.bestDay !== 'string' || !WEEKDAYS.includes(value.bestDay))) return false;
  // All field types have now been checked; compare the related counts.
  const snapshot = value as unknown as CycleReviewSnapshot;
  for (const [part, total] of [
    ['goalCompleted', 'goalTotal'], ['milestoneCompleted', 'milestoneTotal'],
    ['highPriorityCompleted', 'taskCompleted'], ['recurringCompleted', 'taskCompleted'],
    ['bestWeekCount', 'taskCompleted'], ['bestDayCount', 'taskCompleted'], ['rewardsUnlocked', 'goalCompleted'],
  ] as const) {
    if (snapshot[part] > snapshot[total]) return false;
  }
  return (snapshot.bestWeekNumber === null) === (snapshot.bestWeekCount === 0) &&
    (snapshot.bestDay === null) === (snapshot.bestDayCount === 0);
}
function decodeSnapshot(value: Record<string, unknown>): CycleReviewSnapshot {
  const snapshot = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, value[`snapshot_${SNAPSHOT_FIELDS[key]}`]]));
  if (!isSnapshot(snapshot)) throw new Error('Invalid saved cycle-review snapshot.');
  return snapshot;
}
function decodeReflections(value: Record<string, unknown>): NormalizedCycleReviewReflection {
  return Object.fromEntries(REFLECTION_KEYS.map((key) => [key, readText(value[REFLECTION_FIELDS[key]], 2000)])) as NormalizedCycleReviewReflection;
}
function decodeReview(value: unknown): ApiCycleReview {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_cycle_review_id) ||
      !isPostgresId(value.cycle_id) || !isNullableId(value.next_cycle_id) ||
      !(value.next_cycle_start_date === null || isDateKey(value.next_cycle_start_date)) ||
      !isTimestamp(value.created_at) || !isTimestamp(value.updated_at) ||
      !(value.finalized_at === null || isTimestamp(value.finalized_at)) ||
      (value.finalized_at !== null && value.next_cycle_start_date === null) ||
      !Array.isArray(value.next_cycle_first_commitments) || value.next_cycle_first_commitments.length > 5 ||
      !value.next_cycle_first_commitments.every((title) => typeof title === 'string' && [...title].length <= 180)) {
    throw new Error('Invalid cycle-review response.');
  }
  return {
    id: value.id, sourceCycleReviewId: value.source_cycle_review_id, cycleId: value.cycle_id,
    ...decodeReflections(value), ...decodeSnapshot(value),
    nextCycleName: readText(value.next_cycle_name, 80), nextCyclePrimaryFocus: readText(value.next_cycle_primary_focus, 300),
    nextCycleTheme: readText(value.next_cycle_theme, 120), nextCycleStartDate: value.next_cycle_start_date as string | null,
    nextCycleFirstWeekCommitments: [...value.next_cycle_first_commitments], nextCycleId: value.next_cycle_id,
    createdAt: value.created_at, updatedAt: value.updated_at, finalizedAt: value.finalized_at as string | null,
  };
}
function decodeDetail(value: unknown, expectedId?: number): ApiCycleReviewDetail {
  if (!isRecord(value) || !Array.isArray(value.outcomes)) throw new Error('Expected a cycle review and its outcomes.');
  const review = decodeReview(value.review);
  if (expectedId !== undefined && review.id !== expectedId) throw new Error('The returned review ID does not match.');
  const outcomes = value.outcomes.map(decodeApiCycleGoalOutcome);
  const goals = outcomes.filter((row) => row.goalId !== null).map((row) => row.goalId);
  if (outcomes.some((row) => row.cycleReviewId !== review.id) ||
      new Set(outcomes.map((row) => row.id)).size !== outcomes.length || new Set(goals).size !== goals.length) {
    throw new Error('The returned outcomes do not match this cycle review.');
  }
  return { review, outcomes };
}

/** Normalize the proposed plan; saving it does not start a cycle yet. */
function planBody(input: unknown): EncodedPlan {
  requireFields(input, ['name', 'primaryFocus', 'theme', 'startDate', 'firstWeekCommitments']);
  if (!isDateKey(input.startDate) || cycleEndDate(input.startDate) === null) {
    invalidInput('The next cycle needs a real startDate with room for twelve inclusive weeks.');
  }
  const rows = input.firstWeekCommitments === undefined ? [] : input.firstWeekCommitments;
  if (!Array.isArray(rows) || rows.length > 5 || rows.some((title) => typeof title !== 'string')) {
    invalidInput('Supply at most five first-week commitment titles.');
  }
  const commitments: string[] = [];
  for (const row of rows) {
    const title = inputText(row, 180, 'Commitment title');
    if (title !== null) commitments.push(title);
  }
  if (new Set(commitments.map((title) => title.toLowerCase())).size !== commitments.length) {
    invalidInput('First-week commitments cannot contain duplicate titles.');
  }
  return {
    name: inputText(input.name, 80, 'Next-cycle name'),
    primary_focus: inputText(input.primaryFocus, 300, 'Next-cycle focus'),
    theme: inputText(input.theme, 120, 'Next-cycle theme'),
    start_date: input.startDate, first_week_commitments: commitments,
  };
}
function draftBody(input: unknown): PreparedDraft {
  requireFields(input, ['cycleId', 'reflection', 'snapshot', 'nextCycle', 'outcomes']);
  requireId(input.cycleId, 'Planning-cycle ID');
  requireFields(input.reflection, REFLECTION_KEYS);
  const reflectionInput = input.reflection;
  const reflection = Object.fromEntries(REFLECTION_KEYS.map((key) => [
    REFLECTION_FIELDS[key], inputText(reflectionInput[key], 2000, key),
  ]));
  requireFields(input.snapshot, SNAPSHOT_KEYS);
  if (!isSnapshot(input.snapshot)) invalidInput('The cycle-review snapshot contains invalid or inconsistent statistics.');
  const snapshotInput = input.snapshot;
  const snapshot = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [SNAPSHOT_FIELDS[key], snapshotInput[key]]));
  const plan = planBody(input.nextCycle);
  if (!Array.isArray(input.outcomes)) invalidInput('Supply outcomes explicitly; use [] to clear draft selections.');
  const outcomes = input.outcomes.map((choice) => encodeApiCycleGoalOutcomeSelection(choice));
  if (new Set(outcomes.map((choice) => choice.goal_id)).size !== outcomes.length) {
    invalidInput('Each goal can have only one outcome in a cycle review.');
  }
  return { cycle_id: input.cycleId, reflection, snapshot, next_cycle: plan, outcomes };
}
function decodeSavedDraft(value: unknown, body: PreparedDraft): ApiCycleReviewDetail {
  const detail = decodeDetail(value);
  const { review, outcomes } = detail;
  if (review.cycleId !== body.cycle_id || review.finalizedAt !== null || review.nextCycleId !== null ||
      review.nextCycleName !== body.next_cycle.name || review.nextCyclePrimaryFocus !== body.next_cycle.primary_focus ||
      review.nextCycleTheme !== body.next_cycle.theme || review.nextCycleStartDate !== body.next_cycle.start_date ||
      JSON.stringify(review.nextCycleFirstWeekCommitments) !== JSON.stringify(body.next_cycle.first_week_commitments) ||
      REFLECTION_KEYS.some((key) => review[key] !== body.reflection[REFLECTION_FIELDS[key]]) ||
      SNAPSHOT_KEYS.some((key) => review[key] !== body.snapshot[SNAPSHOT_FIELDS[key]]) ||
      outcomes.length !== body.outcomes.length) throw new Error('The saved draft does not match the submitted draft.');
  const selections = new Map(body.outcomes.map((choice) => [choice.goal_id, choice]));
  for (const outcome of outcomes) {
    const choice = outcome.goalId === null ? undefined : selections.get(outcome.goalId);
    if (!choice || outcome.action !== choice.action || outcome.replacementTitle !== choice.replacement_title ||
        outcome.destinationGoalId !== null) throw new Error('The saved goal choices do not match the submitted draft.');
  }
  return detail;
}

export async function fetchApiCycleReviews(
  filters: CycleReviewApiFilters = {}, options: CycleReviewApiOptions = {}
): Promise<ApiCycleReview[]> {
  requireFields(filters, ['cycleId', 'finalized']);
  const { cycleId, finalized } = filters;
  if (cycleId !== undefined) requireId(cycleId, 'Planning-cycle ID');
  if (finalized !== undefined && typeof finalized !== 'boolean') invalidInput('finalized must be true or false.');
  const query: string[] = [];
  if (cycleId !== undefined) query.push(`cycle_id=${cycleId}`);
  if (finalized !== undefined) query.push(`finalized=${finalized}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a cycle-review list.');
    const reviews = value.map(decodeReview);
    if (new Set(reviews.map((row) => row.id)).size !== reviews.length ||
        new Set(reviews.map((row) => row.cycleId)).size !== reviews.length) throw new Error('Duplicate cycle-review identities.');
    if (reviews.some((row) => (cycleId !== undefined && row.cycleId !== cycleId) ||
        (finalized !== undefined && (row.finalizedAt !== null) !== finalized))) {
      throw new Error('The returned reports do not match the requested filters.');
    }
    return reviews;
  }, { ...options, method: 'GET' });
}

export async function fetchApiCycleReview(id: number, options: CycleReviewApiOptions = {}): Promise<ApiCycleReviewDetail> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeDetail(value, id), { ...options, method: 'GET' });
}

/** Save the complete draft. Explicit outcomes=[] clears draft selections only. */
export async function saveApiCycleReviewDraft(
  input: SaveApiCycleReviewDraftInput, options: CycleReviewApiOptions = {}
): Promise<ApiCycleReviewDetail> {
  const body = draftBody(input);
  return apiRequest(`${PATH}/draft`, (value) => decodeSavedDraft(value, body), { ...options, method: 'POST', body });
}

/**
 * Finalize the SAVED draft in one backend transaction. It applies goal choices,
 * closes the reviewed cycle, starts its successor, and freezes the report.
 * Refresh cycle, goal, milestone, and weekly-commitment state afterward.
 */
export async function finalizeApiCycleReview(id: number, options: CycleReviewApiOptions = {}): Promise<ApiCycleReviewFinalizeResult> {
  requireId(id);
  return apiRequest(`${PATH}/${id}/finalize`, (value) => {
    const detail = decodeDetail(value, id);
    if (!isRecord(value) || typeof value.already_finalized !== 'boolean' || detail.review.finalizedAt === null) {
      throw new Error('Expected a finalized cycle report.');
    }
    const nextCycle = value.next_cycle === null ? null : decodeApiPlanningCycle(value.next_cycle);
    const review = detail.review;
    if ((nextCycle === null ? review.nextCycleId !== null : nextCycle.id !== review.nextCycleId) ||
        (nextCycle !== null && nextCycle.id === review.cycleId)) {
      throw new Error('The successor does not match the report link.');
    }
    if (!value.already_finalized) {
      if (nextCycle === null || !nextCycle.active || nextCycle.completedAt !== null || nextCycle.sourcePlanningCycleId !== null ||
          nextCycle.startDate !== review.nextCycleStartDate || nextCycle.endDate !== cycleEndDate(nextCycle.startDate) ||
          nextCycle.name !== review.nextCycleName || nextCycle.primaryFocus !== review.nextCyclePrimaryFocus || nextCycle.theme !== review.nextCycleTheme) {
        throw new Error('Expected the newly created next planning cycle.');
      }
      const destinations: number[] = [];
      for (const outcome of detail.outcomes) {
        const needsDestination = outcome.action === 'carryForward' || outcome.action === 'replace';
        if (outcome.goalId === null || needsDestination !== (outcome.destinationGoalId !== null) ||
            outcome.destinationGoalId === outcome.goalId) throw new Error('Invalid newly finalized goal outcome.');
        if (outcome.destinationGoalId !== null) destinations.push(outcome.destinationGoalId);
      }
      if (new Set(destinations).size !== destinations.length) throw new Error('Duplicate newly created destination goals.');
    }
    // On an already-finalized report, its successor may have been edited,
    // completed, or deleted since finalization. Preserve that historical state.
    return { ...detail, nextCycle, alreadyFinalized: value.already_finalized };
  }, { ...options, method: 'POST', body: undefined });
}

/** Delete a draft and its selections. The backend protects finalized reports. */
export async function deleteApiCycleReviewDraft(id: number, options: CycleReviewApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty cycle-review delete response.');
  }, { ...options, method: 'DELETE', body: undefined });
}
