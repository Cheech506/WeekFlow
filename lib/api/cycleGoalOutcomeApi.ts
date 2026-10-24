/** Read cycle goal-outcome history and validate selections for review drafts. */

import type { StoredCycleGoalOutcome } from '../cycleReviewStorage';
import type { CycleGoalOutcomeAction, CycleGoalOutcomeInput } from '../cycleReviewUtils';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

export type ApiCycleGoalOutcome = StoredCycleGoalOutcome & { sourceCycleGoalOutcomeId: number | null };
export type ApiCycleGoalOutcomeSelection = CycleGoalOutcomeInput;
export type CycleGoalOutcomeApiFilters = {
  cycleReviewId?: number;
  goalId?: number;
  destinationGoalId?: number;
  action?: CycleGoalOutcomeAction;
};
export type CycleGoalOutcomeApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;
export type EncodedApiCycleGoalOutcomeSelection = {
  goal_id: number;
  action: CycleGoalOutcomeAction;
  replacement_title: string | null;
};

const PATH = '/api/v1/cycle-goal-outcomes';
const ACTIONS: readonly CycleGoalOutcomeAction[] = ['complete', 'carryForward', 'archive', 'replace'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function isNullableId(value: unknown): value is number | null {
  return value === null || isPostgresId(value);
}
function isSourceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function isAction(value: unknown): value is CycleGoalOutcomeAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
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
function requireId(value: unknown, label = 'Outcome ID'): asserts value is number {
  if (!isPostgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Cycle goal-outcome input contains unsupported fields.');
  }
}

/** Shared with the cycle-review client when decoding nested saved outcomes. */
export function decodeApiCycleGoalOutcome(value: unknown): ApiCycleGoalOutcome {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_cycle_goal_outcome_id) ||
      !isPostgresId(value.cycle_review_id) || !isNullableId(value.goal_id) ||
      typeof value.goal_title !== 'string' || !value.goal_title.trim() || !isAction(value.action) ||
      !isNullableId(value.destination_goal_id) || !isTimestamp(value.created_at) || !isTimestamp(value.updated_at)) {
    throw new Error('Invalid cycle goal-outcome response.');
  }
  if (value.action === 'replace' ?
      typeof value.replacement_title !== 'string' || !value.replacement_title.trim() || [...value.replacement_title].length > 180 :
      value.replacement_title !== null) {
    throw new Error('The replacement title does not match the saved goal action.');
  }
  return {
    id: value.id, sourceCycleGoalOutcomeId: value.source_cycle_goal_outcome_id,
    cycleReviewId: value.cycle_review_id, goalId: value.goal_id, goalTitle: value.goal_title,
    action: value.action, replacementTitle: value.replacement_title as string | null,
    destinationGoalId: value.destination_goal_id,
    createdAt: value.created_at, updatedAt: value.updated_at,
  };
}

/**
 * Validate one choice and translate field names for a review's draft request.
 * This is a pure helper: it sends no request and does not change the goal.
 */
export function encodeApiCycleGoalOutcomeSelection(
  input: ApiCycleGoalOutcomeSelection
): EncodedApiCycleGoalOutcomeSelection {
  requireFields(input, ['goalId', 'action', 'replacementTitle']);
  requireId(input.goalId, 'Goal ID');
  if (!isAction(input.action)) invalidInput('Unsupported cycle goal outcome.');
  const rawTitle = input.replacementTitle === undefined ? null : input.replacementTitle;
  if (rawTitle !== null && typeof rawTitle !== 'string') invalidInput('Replacement title must be text or null.');
  const title = typeof rawTitle === 'string' ? rawTitle.trim() || null : null;
  if (title !== null && [...title].length > 180) invalidInput('Replacement titles must be 180 characters or fewer.');
  if (input.action === 'replace' && title === null) invalidInput('A replace outcome needs a replacement title.');
  if (input.action !== 'replace' && title !== null) invalidInput('Only a replace outcome can include a replacement title.');
  return { goal_id: input.goalId, action: input.action, replacement_title: title };
}

export async function fetchApiCycleGoalOutcomes(
  filters: CycleGoalOutcomeApiFilters = {}, options: CycleGoalOutcomeApiOptions = {}
): Promise<ApiCycleGoalOutcome[]> {
  requireFields(filters, ['cycleReviewId', 'goalId', 'destinationGoalId', 'action']);
  const { cycleReviewId, goalId, destinationGoalId, action } = filters;
  if (cycleReviewId !== undefined) requireId(cycleReviewId, 'Cycle-review ID');
  if (goalId !== undefined) requireId(goalId, 'Goal ID');
  if (destinationGoalId !== undefined) requireId(destinationGoalId, 'Destination goal ID');
  if (action !== undefined && !isAction(action)) invalidInput('Unsupported cycle goal outcome.');
  const query: string[] = [];
  if (cycleReviewId !== undefined) query.push(`cycle_review_id=${cycleReviewId}`);
  if (goalId !== undefined) query.push(`goal_id=${goalId}`);
  if (destinationGoalId !== undefined) query.push(`destination_goal_id=${destinationGoalId}`);
  if (action !== undefined) query.push(`action=${action}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a cycle goal-outcome list.');
    const outcomes = value.map(decodeApiCycleGoalOutcome);
    const goalKeys = outcomes.filter((row) => row.goalId !== null).map((row) => `${row.cycleReviewId}:${row.goalId}`);
    if (new Set(outcomes.map((row) => row.id)).size !== outcomes.length ||
        new Set(goalKeys).size !== goalKeys.length) throw new Error('Duplicate cycle goal-outcome identities.');
    if (outcomes.some((row) => (cycleReviewId !== undefined && row.cycleReviewId !== cycleReviewId) ||
        (goalId !== undefined && row.goalId !== goalId) ||
        (destinationGoalId !== undefined && row.destinationGoalId !== destinationGoalId) ||
        (action !== undefined && row.action !== action))) {
      throw new Error('The returned outcomes do not match the requested filters.');
    }
    return outcomes;
  }, { ...options, method: 'GET' });
}

export async function fetchApiCycleGoalOutcome(id: number, options: CycleGoalOutcomeApiOptions = {}): Promise<ApiCycleGoalOutcome> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    const outcome = decodeApiCycleGoalOutcome(value);
    if (outcome.id !== id) throw new Error('The returned outcome ID does not match.');
    return outcome;
  }, { ...options, method: 'GET' });
}
