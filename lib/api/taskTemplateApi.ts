/** Read and manage reusable task setups through the existing FastAPI endpoints. */

import type { TaskTemplate } from '../taskTemplateStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';
import { decodeApiTask, type ApiTask } from './taskApi';

// Reuse the app's existing shape. This type-only import does not run SQLite.
export type ApiTaskTemplate = TaskTemplate & { sourceTaskTemplateId: number | null };
export type CreateApiTaskTemplateInput = {
  title: string;
  notes?: string | null;
  priority?: number;
  goalId?: number | null;
};
export type UpdateApiTaskTemplateInput = Partial<CreateApiTaskTemplateInput>;
export type TaskTemplateApiFilters = { goalId?: number };
export type TaskTemplateApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;

const PATH = '/api/v1/task-templates';
const EDIT_FIELDS = ['title', 'notes', 'priority', 'goalId'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function isSourceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function isPriority(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2;
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
function requireId(value: unknown, label = 'Template ID'): asserts value is number {
  if (!isPostgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Task-template input contains unsupported fields.');
  }
}

/** Validate the server's fields before translating snake_case to camelCase. */
function decodeTemplate(value: unknown): ApiTaskTemplate {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_task_template_id) ||
      !(value.goal_id === null || isPostgresId(value.goal_id)) ||
      typeof value.title !== 'string' || !value.title.trim() ||
      !(value.notes === null || typeof value.notes === 'string') || !isPriority(value.priority) ||
      !isTimestamp(value.created_at) || !isTimestamp(value.updated_at)) {
    throw new Error('Invalid task-template response.');
  }
  return {
    id: value.id, sourceTaskTemplateId: value.source_task_template_id,
    goalId: value.goal_id as number | null, title: value.title,
    notes: value.notes as string | null, priority: value.priority,
    createdAt: value.created_at, updatedAt: value.updated_at,
  };
}
function decodeMatchingTemplate(value: unknown, id: number): ApiTaskTemplate {
  const template = decodeTemplate(value);
  if (template.id !== id) throw new Error('The returned template ID does not match.');
  return template;
}

/** Omission preserves a PATCH field; null explicitly clears notes or goalId. */
function requestBody(input: unknown, creating: boolean): Record<string, unknown> {
  requireFields(input, EDIT_FIELDS);
  const body: Record<string, unknown> = {};
  if (creating || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) invalidInput('A task template needs a title.');
    body.title = input.title.trim();
  }
  if (creating || input.notes !== undefined) {
    const notes = input.notes === undefined ? null : input.notes;
    if (notes !== null && typeof notes !== 'string') invalidInput('Notes must be text or null.');
    body.notes = typeof notes === 'string' ? notes.trim() || null : null;
  }
  if (creating || input.priority !== undefined) {
    const priority = input.priority === undefined ? 0 : input.priority;
    if (!isPriority(priority)) invalidInput('Priority must be 0, 1, or 2.');
    body.priority = priority;
  }
  if (creating || input.goalId !== undefined) {
    const goalId = input.goalId === undefined ? null : input.goalId;
    if (goalId !== null) requireId(goalId, 'Goal ID');
    body.goal_id = goalId;
  }
  return body;
}
function decodeWrittenTemplate(value: unknown, body: Record<string, unknown>, id?: number): ApiTaskTemplate {
  const template = id === undefined ? decodeTemplate(value) : decodeMatchingTemplate(value, id);
  if ((body.title !== undefined && template.title !== body.title) ||
      (body.notes !== undefined && template.notes !== body.notes) ||
      (body.priority !== undefined && template.priority !== body.priority) ||
      (body.goal_id !== undefined && template.goalId !== body.goal_id)) {
    throw new Error('The returned template does not match the submitted changes.');
  }
  return template;
}

export async function fetchApiTaskTemplates(
  filters: TaskTemplateApiFilters = {}, options: TaskTemplateApiOptions = {}
): Promise<ApiTaskTemplate[]> {
  requireFields(filters, ['goalId']);
  const goalId = filters.goalId;
  if (goalId !== undefined) requireId(goalId, 'Goal ID');
  const path = goalId === undefined ? PATH : `${PATH}?goal_id=${goalId}`;
  return apiRequest(path, (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a task-template list.');
    const templates = value.map(decodeTemplate);
    if (new Set(templates.map((template) => template.id)).size !== templates.length) {
      throw new Error('Duplicate task-template IDs.');
    }
    if (goalId !== undefined && templates.some((template) => template.goalId !== goalId)) {
      throw new Error('The returned templates do not match the requested goal.');
    }
    return templates;
  }, { ...options, method: 'GET' });
}

export async function fetchApiTaskTemplate(id: number, options: TaskTemplateApiOptions = {}): Promise<ApiTaskTemplate> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingTemplate(value, id), { ...options, method: 'GET' });
}

/** Save a reusable setup. This does not create a task or a recurring schedule. */
export async function createApiTaskTemplate(
  input: CreateApiTaskTemplateInput, options: TaskTemplateApiOptions = {}
): Promise<ApiTaskTemplate> {
  const body = requestBody(input, true);
  return apiRequest(PATH, (value) => decodeWrittenTemplate(value, body), { ...options, method: 'POST', body });
}

/** Edit the template without changing tasks already created from it. */
export async function updateApiTaskTemplate(
  id: number, input: UpdateApiTaskTemplateInput, options: TaskTemplateApiOptions = {}
): Promise<ApiTaskTemplate> {
  requireId(id);
  const body = requestBody(input, false);
  return apiRequest(`${PATH}/${id}`, (value) => decodeWrittenTemplate(value, body, id), { ...options, method: 'PATCH', body });
}

/** Delete only the reusable template; its previously created tasks remain. */
export async function deleteApiTaskTemplate(id: number, options: TaskTemplateApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty template-delete response.');
  }, { ...options, method: 'DELETE', body: undefined });
}

/**
 * Create one independent Inbox task from the saved template's current details.
 * Each successful call creates another task. Never automatically repeat an
 * uncertain request; read the tasks to reconcile a lost response first.
 */
export async function createApiTaskFromTemplate(id: number, options: TaskTemplateApiOptions = {}): Promise<ApiTask> {
  requireId(id);
  return apiRequest(`${PATH}/${id}/create-task`, (value) => {
    const task = decodeApiTask(value);
    if (task.day !== 'Inbox' || task.dueDate !== null || task.completed || task.completedAt !== null ||
        task.recurringRuleId !== null || task.sourceRecurringRuleId !== null ||
        task.recurrenceOccurrenceDate !== null || task.sourceTaskId !== null) {
      throw new Error('Expected a new standalone Inbox task from the template.');
    }
    return task;
  }, { ...options, method: 'POST', body: undefined });
}
