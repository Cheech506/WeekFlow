/** Connect the goal screens to WeekFlow's existing FastAPI goal endpoints. */

import {
    MAX_GOAL_NOTES_LENGTH, MAX_GOAL_PURPOSE_LENGTH, MAX_GOAL_SUCCESS_DEFINITION_LENGTH,
} from '../goalPlanningUtils';
import type { GoalCompletionReflection } from '../goalReviewUtils';
import { MAX_GOAL_REWARD_LENGTH } from '../goalRewardUtils';
import type { GoalPlanningDetails, StoredGoal } from '../goalStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

/**
 * Native PostgreSQL IDs, with the existing goal screen's field layout.
 * startDate/endDate use local-noon ISO timestamps for compatibility with the
 * current screens. API REQUEST dates remain YYYY-MM-DD calendar dates.
 */
export type ApiGoal = StoredGoal & { sourceGoalId: number | null };
export type CreateApiGoalInput = GoalPlanningDetails & {
  title: string;
  startDate: string;
  endDate: string;
  cycleId?: number | null;
  reward?: string | null;
};
export type UpdateApiGoalInput = Partial<Omit<CreateApiGoalInput, 'cycleId'>>;
export type GoalApiFilters = { cycleId?: number };
export type GoalApiOptions = Pick<ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'>;

const PATH = '/api/v1/goals';
const TEXT_FIELDS = [
  ['reward', 'reward', MAX_GOAL_REWARD_LENGTH],
  ['purpose', 'purpose', MAX_GOAL_PURPOSE_LENGTH],
  ['successDefinition', 'success_definition', MAX_GOAL_SUCCESS_DEFINITION_LENGTH],
  ['notes', 'notes', MAX_GOAL_NOTES_LENGTH],
] as const;
const REFLECTION_FIELDS = [
  ['whatHelped', 'what_helped', 'completion_what_helped'],
  ['hardestPart', 'hardest_part', 'completion_hardest_part'],
  ['learned', 'learned', 'completion_learned'],
  ['doDifferently', 'do_differently', 'completion_do_differently'],
] as const;
const COUNT_FIELDS = [
  'completion_task_total', 'completion_task_completed', 'completion_milestone_total',
  'completion_milestone_completed', 'completion_high_priority_completed',
] as const;
const DETAILS_FIELDS = ['title', 'startDate', 'endDate', ...TEXT_FIELDS.map(([field]) => field)];

type ServerGoal = {
  id: number; source_goal_id: number | null; cycle_id: number | null;
  title: string; start_date: string; end_date: string; completed: boolean;
  created_at: string; completed_at: string | null;
} & Record<typeof TEXT_FIELDS[number][1] | typeof REFLECTION_FIELDS[number][2], string | null>
  & Record<typeof COUNT_FIELDS[number], number | null>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function postgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function dateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && dateKey(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}
function optionalText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= max);
}
function count(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
function exceeds(part: unknown, total: unknown): boolean {
  return typeof part === 'number' && typeof total === 'number' && part > total;
}
function validGoal(value: unknown): value is ServerGoal {
  if (!object(value)) return false;
  return postgresId(value.id) && (value.cycle_id === null || postgresId(value.cycle_id)) &&
    (value.source_goal_id === null || (typeof value.source_goal_id === 'number' && Number.isSafeInteger(value.source_goal_id) && value.source_goal_id > 0)) &&
    typeof value.title === 'string' && value.title.trim().length > 0 &&
    dateKey(value.start_date) && dateKey(value.end_date) && value.end_date >= value.start_date &&
    typeof value.completed === 'boolean' && timestamp(value.created_at) &&
    (value.completed ? timestamp(value.completed_at) : value.completed_at === null) &&
    TEXT_FIELDS.every(([, field, max]) => optionalText(value[field], max)) &&
    REFLECTION_FIELDS.every(([, , field]) => optionalText(value[field], 1000)) &&
    COUNT_FIELDS.every((field) => count(value[field])) &&
    !exceeds(value.completion_task_completed, value.completion_task_total) &&
    !exceeds(value.completion_milestone_completed, value.completion_milestone_total) &&
    !exceeds(value.completion_high_priority_completed, value.completion_task_completed);
}

/** Avoid interpreting a bare YYYY-MM-DD as UTC in the existing goal screens. */
function screenDate(value: string): string {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  if (date.getFullYear() !== Number(value.slice(0, 4)) || date.getMonth() + 1 !== Number(value.slice(5, 7)) || date.getDate() !== Number(value.slice(8, 10))) {
    throw new Error('The goal date cannot be represented in this device timezone.');
  }
  return date.toISOString();
}
function decodeGoal(value: unknown): ApiGoal {
  if (!validGoal(value)) throw new Error('Invalid GoalRead response.');
  return {
    id: value.id, sourceGoalId: value.source_goal_id, cycleId: value.cycle_id,
    title: value.title, startDate: screenDate(value.start_date), endDate: screenDate(value.end_date),
    reward: value.reward, purpose: value.purpose, successDefinition: value.success_definition, notes: value.notes,
    completed: value.completed, createdAt: value.created_at, completedAt: value.completed_at,
    completionWhatHelped: value.completion_what_helped, completionHardestPart: value.completion_hardest_part,
    completionLearned: value.completion_learned, completionDoDifferently: value.completion_do_differently,
    completionTaskTotal: value.completion_task_total, completionTaskCompleted: value.completion_task_completed,
    completionMilestoneTotal: value.completion_milestone_total, completionMilestoneCompleted: value.completion_milestone_completed,
    completionHighPriorityCompleted: value.completion_high_priority_completed,
  };
}
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireId(id: unknown, label = 'Goal ID'): asserts id is number {
  if (!postgresId(id)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Goal input contains unsupported fields.');
  }
}
function normalizedText(value: unknown, max: number, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidInput(`${label} must be text or null.`);
  const normalized = value.trim();
  if (normalized.length > max) invalidInput(`${label} must be ${max} characters or fewer.`);
  return normalized || null;
}
function detailsBody(input: unknown, creating: boolean): Record<string, unknown> {
  requireFields(input, creating ? [...DETAILS_FIELDS, 'cycleId'] : DETAILS_FIELDS);
  const body: Record<string, unknown> = {};
  if (creating || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) invalidInput('Goal title must not be blank.');
    body.title = input.title.trim();
  }
  for (const [field, wireField] of [['startDate', 'start_date'], ['endDate', 'end_date']] as const) {
    if (creating || input[field] !== undefined) {
      if (!dateKey(input[field])) invalidInput(`${field} must be a real YYYY-MM-DD date.`);
      body[wireField] = input[field];
    }
  }
  if (typeof body.start_date === 'string' && typeof body.end_date === 'string' && body.end_date < body.start_date) {
    invalidInput('Goal end date cannot be before its start date.');
  }
  if (creating && input.cycleId !== undefined) {
    if (input.cycleId !== null) requireId(input.cycleId, 'Cycle ID');
    body.cycle_id = input.cycleId;
  }
  for (const [field, wireField, max] of TEXT_FIELDS) {
    if (input[field] !== undefined) body[wireField] = normalizedText(input[field], max, field);
  }
  return body;
}
function decodeMatchingGoal(value: unknown, id: number): ApiGoal {
  const goal = decodeGoal(value);
  if (goal.id !== id) throw new Error('The returned goal ID does not match.');
  return goal;
}

export async function fetchApiGoals(filters: GoalApiFilters = {}, options: GoalApiOptions = {}): Promise<ApiGoal[]> {
  requireFields(filters, ['cycleId']);
  const cycleId = filters.cycleId;
  if (cycleId !== undefined) requireId(cycleId, 'Cycle ID');
  const path = PATH + (cycleId === undefined ? '' : `?cycle_id=${cycleId}`);
  return apiRequest(path, (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a goal list.');
    const goals = value.map(decodeGoal);
    if (new Set(goals.map((goal) => goal.id)).size !== goals.length) throw new Error('Duplicate goal IDs.');
    if (cycleId !== undefined && goals.some((goal) => goal.cycleId !== cycleId)) {
      throw new Error('The returned goals do not belong to the requested cycle.');
    }
    return goals;
  }, { ...options, method: 'GET' });
}

export async function fetchApiGoal(id: number, options: GoalApiOptions = {}): Promise<ApiGoal> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingGoal(value, id), { ...options, method: 'GET' });
}

export async function createApiGoal(input: CreateApiGoalInput, options: GoalApiOptions = {}): Promise<ApiGoal> {
  return apiRequest(PATH, decodeGoal, { ...options, method: 'POST', body: detailsBody(input, true) });
}

/** Editing details cannot move the goal between cycles or replace its history. */
export async function updateApiGoal(id: number, input: UpdateApiGoalInput, options: GoalApiOptions = {}): Promise<ApiGoal> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingGoal(value, id), { ...options, method: 'PATCH', body: detailsBody(input, false) });
}

/** Send reflection answers; PostgreSQL computes and stores the completion totals. */
export async function completeApiGoal(id: number, reflection: GoalCompletionReflection = {}, options: GoalApiOptions = {}): Promise<ApiGoal> {
  requireId(id);
  requireFields(reflection, REFLECTION_FIELDS.map(([field]) => field));
  const body: Record<string, unknown> = {};
  for (const [field, wireField] of REFLECTION_FIELDS) {
    if (reflection[field] !== undefined) body[wireField] = normalizedText(reflection[field], 1000, field);
  }
  return apiRequest(`${PATH}/${id}/complete`, (value) => {
    const goal = decodeMatchingGoal(value, id);
    if (!goal.completed) throw new Error('The goal was not completed.');
    return goal;
  }, { ...options, method: 'POST', body });
}

export async function reopenApiGoal(id: number, options: GoalApiOptions = {}): Promise<ApiGoal> {
  requireId(id);
  return apiRequest(`${PATH}/${id}/reopen`, (value) => {
    const goal = decodeMatchingGoal(value, id);
    if (goal.completed) throw new Error('The goal was not reopened.');
    return goal;
  }, { ...options, method: 'POST' });
}

export async function deleteApiGoal(id: number, options: GoalApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty delete response.');
  }, { ...options, method: 'DELETE' });
}
