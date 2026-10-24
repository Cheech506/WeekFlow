/** Saved weekly reflections and their frozen historical analytics snapshots. */

import type { WeeklyReviewSnapshot } from '../weeklyReview';
import type { StoredWeeklyReview } from '../weeklyReviewStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

// Type-only imports reuse the UI shapes without executing SQLite storage.
export type ApiWeeklyReview = StoredWeeklyReview & { sourceWeeklyReviewId: number | null };
export type ApiWeeklyReviewReflectionInput = {
  whatWentWell?: string | null;
  whatCausedProblems?: string | null;
  whatLearned?: string | null;
  whatChangeNextWeek?: string | null;
  nextWeekFocus?: string | null;
};
export type CreateApiWeeklyReviewInput = ApiWeeklyReviewReflectionInput & {
  weekStart: string;
  cycleId?: number | null;
  snapshot: WeeklyReviewSnapshot;
};
// A saved snapshot and its week cannot be overwritten through a reflection edit.
export type UpdateApiWeeklyReviewInput = ApiWeeklyReviewReflectionInput & { cycleId?: number | null };
export type WeeklyReviewApiFilters = { weekStart?: string; cycleId?: number };
export type WeeklyReviewApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;

const PATH = '/api/v1/weekly-reviews';
const MAX_COUNT = 2_147_483_647;
const REFLECTION_FIELDS = {
  whatWentWell: 'what_went_well', whatCausedProblems: 'what_caused_problems',
  whatLearned: 'what_learned', whatChangeNextWeek: 'what_change_next_week', nextWeekFocus: 'next_week_focus',
} as const;
const SNAPSHOT_FIELDS = {
  completedCount: 'completed_count', unfinishedCount: 'unfinished_count', overdueCount: 'overdue_count',
  completionRate: 'completion_rate', goalsProgressedCount: 'goals_progressed_count',
  bestDay: 'best_day', bestDayCount: 'best_day_count', archivedBrainDumpCount: 'archived_brain_dump_count',
  highPriorityCompletedCount: 'high_priority_completed_count', recurringCompletedCount: 'recurring_completed_count',
} as const;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const REFLECTION_KEYS = Object.keys(REFLECTION_FIELDS) as Array<keyof typeof REFLECTION_FIELDS>;
const SNAPSHOT_KEYS = Object.keys(SNAPSHOT_FIELDS) as Array<keyof typeof SNAPSHOT_FIELDS>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_COUNT;
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}
function isSourceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function isMonday(value: unknown): value is string {
  return isDateKey(value) && new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
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
function requireId(value: unknown, label = 'Weekly review ID'): asserts value is number {
  if (!isPostgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Weekly-review input contains unsupported fields.');
  }
}

/** Check consistency, matching the backend's integer limits and rounding. */
function isSnapshot(value: unknown): value is WeeklyReviewSnapshot {
  if (!isRecord(value) || !isCount(value.completedCount) || !isCount(value.unfinishedCount) ||
      !isCount(value.overdueCount) || !isCount(value.archivedBrainDumpCount) ||
      !isCount(value.completionRate) || value.completionRate > 100) return false;
  const total = value.completedCount + value.unfinishedCount;
  if (total > MAX_COUNT) return false;
  // All operands are safe integers. This matches half-up rounding in PostgreSQL.
  const expectedRate = total === 0 ? 0 : Math.floor((2 * value.completedCount * 100 + total) / (2 * total));
  if (value.completionRate !== expectedRate || value.overdueCount > value.unfinishedCount) return false;
  for (const key of ['goalsProgressedCount', 'bestDayCount', 'highPriorityCompletedCount', 'recurringCompletedCount']) {
    if (!isCount(value[key]) || value[key] > value.completedCount) return false;
  }
  return value.bestDay === null ? value.bestDayCount === 0 :
    typeof value.bestDay === 'string' && WEEKDAYS.includes(value.bestDay) && (value.bestDayCount as number) > 0;
}
function decodeSnapshot(value: Record<string, unknown>): WeeklyReviewSnapshot {
  const snapshot = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, value[`snapshot_${SNAPSHOT_FIELDS[key]}`]]));
  if (!isSnapshot(snapshot)) throw new Error('Invalid saved weekly-review snapshot.');
  return snapshot;
}
function decodeReflections(value: Record<string, unknown>): Required<ApiWeeklyReviewReflectionInput> {
  const reflections: Required<ApiWeeklyReviewReflectionInput> = {
    whatWentWell: null, whatCausedProblems: null, whatLearned: null, whatChangeNextWeek: null, nextWeekFocus: null,
  };
  for (const key of REFLECTION_KEYS) {
    const text = value[REFLECTION_FIELDS[key]];
    // PostgreSQL/Pydantic count Unicode characters rather than UTF-16 units.
    if (text !== null && (typeof text !== 'string' || [...text].length > 2000)) {
      throw new Error('Invalid saved weekly-review reflection.');
    }
    reflections[key] = text;
  }
  return reflections;
}
function decodeReview(value: unknown): ApiWeeklyReview {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_weekly_review_id) ||
      !isMonday(value.week_start) || !(value.cycle_id === null || isPostgresId(value.cycle_id)) ||
      !isTimestamp(value.created_at) || !isTimestamp(value.updated_at) || !isTimestamp(value.reviewed_at)) {
    throw new Error('Invalid weekly-review response.');
  }
  return {
    id: value.id, sourceWeeklyReviewId: value.source_weekly_review_id,
    weekStart: value.week_start, cycleId: value.cycle_id as number | null,
    ...decodeReflections(value), ...decodeSnapshot(value),
    createdAt: value.created_at, updatedAt: value.updated_at, reviewedAt: value.reviewed_at,
  };
}
function decodeMatchingReview(value: unknown, id: number): ApiWeeklyReview {
  const review = decodeReview(value);
  if (review.id !== id) throw new Error('The returned weekly-review ID does not match.');
  return review;
}

/** Build a complete create request or a PATCH containing only supplied edits. */
function requestBody(input: unknown, creating: boolean): Record<string, unknown> {
  requireFields(input, [...REFLECTION_KEYS, 'cycleId', ...(creating ? ['weekStart', 'snapshot'] : [])]);
  const body: Record<string, unknown> = {};
  for (const key of REFLECTION_KEYS) {
    if (creating || input[key] !== undefined) {
      const text = input[key] === undefined ? null : input[key];
      if (text !== null && typeof text !== 'string') invalidInput('Reflection responses must be text or null.');
      const normalized = typeof text === 'string' ? text.trim() || null : null;
      if (normalized !== null && [...normalized].length > 2000) invalidInput('Each reflection response must be 2000 characters or fewer.');
      body[REFLECTION_FIELDS[key]] = normalized;
    }
  }
  if (creating || input.cycleId !== undefined) {
    const cycleId = input.cycleId === undefined ? null : input.cycleId;
    if (cycleId !== null) requireId(cycleId, 'Planning-cycle ID');
    body.cycle_id = cycleId;
  }
  if (creating) {
    if (!isMonday(input.weekStart)) invalidInput('weekStart must be a Monday in YYYY-MM-DD format.');
    requireFields(input.snapshot, SNAPSHOT_KEYS);
    if (!isSnapshot(input.snapshot)) invalidInput('The weekly-review snapshot contains inconsistent or invalid numbers.');
    body.week_start = input.weekStart;
    const snapshot = input.snapshot;
    body.snapshot = Object.fromEntries(SNAPSHOT_KEYS.map((key) => [SNAPSHOT_FIELDS[key], snapshot[key]]));
  }
  return body;
}
function decodeWrittenReview(value: unknown, body: Record<string, unknown>, id?: number): ApiWeeklyReview {
  const review = id === undefined ? decodeReview(value) : decodeMatchingReview(value, id);
  if (body.cycle_id !== undefined && review.cycleId !== body.cycle_id) throw new Error('The returned planning-cycle link does not match.');
  for (const key of REFLECTION_KEYS) {
    if (body[REFLECTION_FIELDS[key]] !== undefined && review[key] !== body[REFLECTION_FIELDS[key]]) {
      throw new Error('The saved reflection does not match the submitted edit.');
    }
  }
  if (id === undefined) {
    if (review.weekStart !== body.week_start || review.sourceWeeklyReviewId !== null || !isRecord(body.snapshot)) {
      throw new Error('The created weekly-review identity does not match.');
    }
    const snapshot = body.snapshot;
    if (SNAPSHOT_KEYS.some((key) => review[key] !== snapshot[SNAPSHOT_FIELDS[key]])) {
      throw new Error('The saved snapshot does not match the supplied initial snapshot.');
    }
  }
  return review;
}

export async function fetchApiWeeklyReviews(
  filters: WeeklyReviewApiFilters = {}, options: WeeklyReviewApiOptions = {}
): Promise<ApiWeeklyReview[]> {
  requireFields(filters, ['weekStart', 'cycleId']);
  const weekStart = filters.weekStart, cycleId = filters.cycleId;
  if (weekStart !== undefined && !isMonday(weekStart)) invalidInput('weekStart must be a Monday in YYYY-MM-DD format.');
  if (cycleId !== undefined) requireId(cycleId, 'Planning-cycle ID');
  const query: string[] = [];
  if (weekStart !== undefined) query.push(`week_start=${weekStart}`);
  if (cycleId !== undefined) query.push(`cycle_id=${cycleId}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a weekly-review list.');
    const reviews = value.map(decodeReview);
    if (new Set(reviews.map((review) => review.id)).size !== reviews.length ||
        new Set(reviews.map((review) => review.weekStart)).size !== reviews.length) {
      throw new Error('Duplicate weekly-review identities or weeks.');
    }
    if (reviews.some((review) => (weekStart !== undefined && review.weekStart !== weekStart) ||
        (cycleId !== undefined && review.cycleId !== cycleId))) {
      throw new Error('The returned reviews do not match the requested filters.');
    }
    return reviews;
  }, { ...options, method: 'GET' });
}

export async function fetchApiWeeklyReview(id: number, options: WeeklyReviewApiOptions = {}): Promise<ApiWeeklyReview> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingReview(value, id), { ...options, method: 'GET' });
}

/** Save a new week's initial snapshot. An existing week returns HTTP 409. */
export async function createApiWeeklyReview(
  input: CreateApiWeeklyReviewInput, options: WeeklyReviewApiOptions = {}
): Promise<ApiWeeklyReview> {
  const body = requestBody(input, true);
  return apiRequest(PATH, (value) => decodeWrittenReview(value, body), { ...options, method: 'POST', body });
}

/** Edit reflections or the cycle link. Historical snapshot fields are read-only. */
export async function updateApiWeeklyReview(
  id: number, input: UpdateApiWeeklyReviewInput, options: WeeklyReviewApiOptions = {}
): Promise<ApiWeeklyReview> {
  requireId(id);
  const body = requestBody(input, false);
  return apiRequest(`${PATH}/${id}`, (value) => decodeWrittenReview(value, body, id), { ...options, method: 'PATCH', body });
}

/** Delete this review only; tasks, commitments, and task decisions remain. */
export async function deleteApiWeeklyReview(id: number, options: WeeklyReviewApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty weekly-review delete response.');
  }, { ...options, method: 'DELETE', body: undefined });
}
