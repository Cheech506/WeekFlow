/** Connect goal-milestone screens to the existing FastAPI endpoints. */

import type { GoalMilestone } from '../goalMilestoneStorage';
import { MAX_MILESTONE_NOTES_LENGTH, MAX_MILESTONE_TITLE_LENGTH } from '../goalPlanningUtils';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

/** All ordinary IDs are PostgreSQL IDs. Target dates remain YYYY-MM-DD. */
export type ApiGoalMilestone = GoalMilestone & { sourceGoalMilestoneId: number | null };
export type CreateApiGoalMilestoneInput = {
  goalId: number;
  title: string;
  targetDate?: string | null;
  notes?: string | null;
};
export type UpdateApiGoalMilestoneInput = {
  title?: string;
  targetDate?: string | null;
  notes?: string | null;
  completed?: boolean;
};
export type GoalMilestoneApiFilters = { goalId?: number };
export type GoalMilestoneApiOptions = Pick<ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'>;

const PATH = '/api/v1/goal-milestones';
const EDITABLE_FIELDS = ['title', 'targetDate', 'notes'];

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
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireId(value: unknown, label: string): asserts value is number {
  if (!postgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Milestone input contains unsupported fields.');
  }
}
function decodeMilestone(value: unknown): ApiGoalMilestone {
  if (!object(value) || !postgresId(value.id) || !postgresId(value.goal_id) ||
      !(value.source_goal_milestone_id === null ||
        (typeof value.source_goal_milestone_id === 'number' && Number.isSafeInteger(value.source_goal_milestone_id) && value.source_goal_milestone_id > 0)) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_MILESTONE_TITLE_LENGTH ||
      !(value.notes === null || (typeof value.notes === 'string' && value.notes.length <= MAX_MILESTONE_NOTES_LENGTH)) ||
      !(value.target_date === null || dateKey(value.target_date)) ||
      typeof value.completed !== 'boolean' || !timestamp(value.created_at) ||
      (value.completed ? !timestamp(value.completed_at) : value.completed_at !== null)) {
    throw new Error('Invalid goal-milestone response.');
  }
  return {
    id: value.id, sourceGoalMilestoneId: value.source_goal_milestone_id as number | null,
    goalId: value.goal_id, title: value.title, notes: value.notes as string | null,
    targetDate: value.target_date as string | null, completed: value.completed,
    createdAt: value.created_at, completedAt: value.completed_at as string | null,
  };
}
function decodeMatchingMilestone(value: unknown, id: number): ApiGoalMilestone {
  const milestone = decodeMilestone(value);
  if (milestone.id !== id) throw new Error('The returned milestone ID does not match.');
  return milestone;
}
function requestBody(input: unknown, creating: boolean): Record<string, unknown> {
  requireFields(input, [...EDITABLE_FIELDS, creating ? 'goalId' : 'completed']);
  const body: Record<string, unknown> = {};
  if (creating) {
    requireId(input.goalId, 'Goal ID');
    body.goal_id = input.goalId;
  }
  if (creating || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) invalidInput('Milestone title must not be blank.');
    const title = input.title.trim();
    if (title.length > MAX_MILESTONE_TITLE_LENGTH) invalidInput(`Milestone title must be ${MAX_MILESTONE_TITLE_LENGTH} characters or fewer.`);
    body.title = title;
  }
  if (input.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== 'string') invalidInput('Milestone notes must be text or null.');
    const notes = typeof input.notes === 'string' ? input.notes.trim() : null;
    if (notes !== null && notes.length > MAX_MILESTONE_NOTES_LENGTH) invalidInput(`Milestone notes must be ${MAX_MILESTONE_NOTES_LENGTH} characters or fewer.`);
    body.notes = notes || null;
  }
  if (input.targetDate !== undefined) {
    if (input.targetDate !== null && typeof input.targetDate !== 'string') invalidInput('Target date must be YYYY-MM-DD or null.');
    const targetDate = typeof input.targetDate === 'string' ? input.targetDate.trim() || null : null;
    if (targetDate !== null && !dateKey(targetDate)) invalidInput('Target date must be a real YYYY-MM-DD date.');
    body.target_date = targetDate;
  }
  if (!creating && input.completed !== undefined) {
    if (typeof input.completed !== 'boolean') invalidInput('completed must be a boolean.');
    body.completed = input.completed;
  }
  return body;
}

export async function fetchApiGoalMilestones(
  filters: GoalMilestoneApiFilters = {},
  options: GoalMilestoneApiOptions = {}
): Promise<ApiGoalMilestone[]> {
  requireFields(filters, ['goalId']);
  const goalId = filters.goalId;
  if (goalId !== undefined) requireId(goalId, 'Goal ID');
  const path = PATH + (goalId === undefined ? '' : `?goal_id=${goalId}`);
  return apiRequest(path, (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a milestone list.');
    const milestones = value.map(decodeMilestone);
    if (new Set(milestones.map((milestone) => milestone.id)).size !== milestones.length) throw new Error('Duplicate milestone IDs.');
    if (goalId !== undefined && milestones.some((milestone) => milestone.goalId !== goalId)) {
      throw new Error('The returned milestones do not belong to the requested goal.');
    }
    return milestones;
  }, { ...options, method: 'GET' });
}

export async function fetchApiGoalMilestone(id: number, options: GoalMilestoneApiOptions = {}): Promise<ApiGoalMilestone> {
  requireId(id, 'Milestone ID');
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingMilestone(value, id), { ...options, method: 'GET' });
}

export async function createApiGoalMilestone(
  input: CreateApiGoalMilestoneInput,
  options: GoalMilestoneApiOptions = {}
): Promise<ApiGoalMilestone> {
  const body = requestBody(input, true);
  return apiRequest(PATH, (value) => {
    const milestone = decodeMilestone(value);
    if (milestone.goalId !== body.goal_id) throw new Error('The created milestone belongs to a different goal.');
    return milestone;
  }, { ...options, method: 'POST', body });
}

/** Use completed:true to complete or completed:false to reopen the milestone. */
export async function updateApiGoalMilestone(
  id: number,
  input: UpdateApiGoalMilestoneInput,
  options: GoalMilestoneApiOptions = {}
): Promise<ApiGoalMilestone> {
  requireId(id, 'Milestone ID');
  const body = requestBody(input, false);
  return apiRequest(`${PATH}/${id}`, (value) => {
    const milestone = decodeMatchingMilestone(value, id);
    if (typeof body.completed === 'boolean' && milestone.completed !== body.completed) {
      throw new Error('The returned milestone completion status does not match.');
    }
    return milestone;
  }, { ...options, method: 'PATCH', body });
}

export async function deleteApiGoalMilestone(id: number, options: GoalMilestoneApiOptions = {}): Promise<void> {
  requireId(id, 'Milestone ID');
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty delete response.');
  }, { ...options, method: 'DELETE' });
}
