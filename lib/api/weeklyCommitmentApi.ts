/** Weekly promises and task-linked commitments through FastAPI. */

import type { WeeklyCommitment } from '../weeklyReviewStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

export type ApiWeeklyCommitment = WeeklyCommitment & { sourceWeeklyCommitmentId: number | null };
type CommitmentWeekInput = { weekStart: string; cycleId?: number | null };
// A standalone promise needs a title. A linked commitment uses its task's title.
export type CreateApiWeeklyCommitmentInput = CommitmentWeekInput & (
  { title: string; taskId?: null } | { taskId: number; title?: null }
);
export type UpdateApiWeeklyCommitmentInput = { title?: string; completed?: boolean };
export type WeeklyCommitmentApiFilters = {
  weekStart?: string;
  cycleId?: number;
  taskId?: number;
  completed?: boolean;
};
export type WeeklyCommitmentApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;
const PATH = '/api/v1/weekly-commitments';

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
function isMonday(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (year < 1 || month < 1 || month > 12 || day < 1 ||
      day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return false;
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
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
function requireId(value: unknown, label = 'Commitment ID'): asserts value is number {
  if (!isPostgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Weekly-commitment input contains unsupported fields.');
  }
}
function normalizedTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 180) {
    invalidInput('A standalone commitment needs a title between 1 and 180 characters.');
  }
  return value.trim();
}

/** Decode the server's displayed state, which follows a live task when linked. */
function decodeCommitment(value: unknown): ApiWeeklyCommitment {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_weekly_commitment_id) ||
      !isMonday(value.week_start) || !isNullableId(value.cycle_id) || !isNullableId(value.task_id) ||
      typeof value.title !== 'string' || !value.title.trim() || typeof value.completed !== 'boolean' ||
      !isTimestamp(value.created_at) || !(value.completed_at === null || isTimestamp(value.completed_at))) {
    throw new Error('Invalid weekly-commitment response.');
  }
  // Stored standalone promises have a 180-character title and paired completion
  // timestamp. Linked reads project live task fields instead: a task may have
  // been renamed beyond 180 characters, or imported without a completion time.
  if (value.task_id === null && ([...value.title].length > 180 ||
      value.completed !== (value.completed_at !== null))) {
    throw new Error('Invalid standalone commitment title or completion state.');
  }
  return {
    id: value.id, sourceWeeklyCommitmentId: value.source_weekly_commitment_id,
    weekStart: value.week_start, cycleId: value.cycle_id, taskId: value.task_id,
    title: value.title, completed: value.completed,
    createdAt: value.created_at, completedAt: value.completed_at as string | null,
  };
}
function decodeMatchingCommitment(value: unknown, id: number): ApiWeeklyCommitment {
  const commitment = decodeCommitment(value);
  if (commitment.id !== id) throw new Error('The returned commitment ID does not match.');
  return commitment;
}

function createBody(input: unknown): Record<string, unknown> {
  requireFields(input, ['weekStart', 'cycleId', 'taskId', 'title']);
  if (!isMonday(input.weekStart)) invalidInput('weekStart must be a Monday in YYYY-MM-DD format.');
  const cycleId = input.cycleId === undefined ? null : input.cycleId;
  const taskId = input.taskId === undefined ? null : input.taskId;
  if (cycleId !== null) requireId(cycleId, 'Planning-cycle ID');
  if (taskId !== null) requireId(taskId, 'Task ID');
  const body: Record<string, unknown> = { week_start: input.weekStart, cycle_id: cycleId, task_id: taskId };
  if (taskId === null) {
    body.title = normalizedTitle(input.title);
  } else if (input.title !== undefined && input.title !== null) {
    invalidInput('Omit title for a task-linked commitment; the backend uses the task title.');
  }
  return body;
}
function updateBody(input: unknown): Record<string, unknown> {
  requireFields(input, ['title', 'completed']);
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.title = normalizedTitle(input.title);
  if (input.completed !== undefined) {
    if (typeof input.completed !== 'boolean') invalidInput('completed must be true or false.');
    body.completed = input.completed;
  }
  return body;
}

export async function fetchApiWeeklyCommitments(
  filters: WeeklyCommitmentApiFilters = {}, options: WeeklyCommitmentApiOptions = {}
): Promise<ApiWeeklyCommitment[]> {
  requireFields(filters, ['weekStart', 'cycleId', 'taskId', 'completed']);
  const { weekStart, cycleId, taskId, completed } = filters;
  if (weekStart !== undefined && !isMonday(weekStart)) invalidInput('weekStart must be a Monday in YYYY-MM-DD format.');
  if (cycleId !== undefined) requireId(cycleId, 'Planning-cycle ID');
  if (taskId !== undefined) requireId(taskId, 'Task ID');
  if (completed !== undefined && typeof completed !== 'boolean') invalidInput('completed must be true or false.');
  const query: string[] = [];
  if (weekStart !== undefined) query.push(`week_start=${weekStart}`);
  if (cycleId !== undefined) query.push(`cycle_id=${cycleId}`);
  if (taskId !== undefined) query.push(`task_id=${taskId}`);
  if (completed !== undefined) query.push(`completed=${completed}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a weekly-commitment list.');
    const commitments = value.map(decodeCommitment);
    const linkedKeys = commitments.filter((row) => row.taskId !== null).map((row) => `${row.weekStart}:${row.taskId}`);
    if (new Set(commitments.map((row) => row.id)).size !== commitments.length ||
        new Set(linkedKeys).size !== linkedKeys.length) throw new Error('Duplicate weekly-commitment identities.');
    if (commitments.some((row) => (weekStart !== undefined && row.weekStart !== weekStart) ||
        (cycleId !== undefined && row.cycleId !== cycleId) || (taskId !== undefined && row.taskId !== taskId) ||
        (completed !== undefined && row.completed !== completed))) {
      throw new Error('The returned commitments do not match the requested filters.');
    }
    return commitments;
  }, { ...options, method: 'GET' });
}

export async function fetchApiWeeklyCommitment(id: number, options: WeeklyCommitmentApiOptions = {}): Promise<ApiWeeklyCommitment> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingCommitment(value, id), { ...options, method: 'GET' });
}

/** Select one existing task or create a standalone promise; never create a task. */
export async function createApiWeeklyCommitment(
  input: CreateApiWeeklyCommitmentInput, options: WeeklyCommitmentApiOptions = {}
): Promise<ApiWeeklyCommitment> {
  const body = createBody(input);
  return apiRequest(PATH, (value) => {
    const commitment = decodeCommitment(value);
    if (commitment.weekStart !== body.week_start || commitment.cycleId !== body.cycle_id ||
        commitment.taskId !== body.task_id || commitment.sourceWeeklyCommitmentId !== null ||
        (body.task_id === null && (commitment.title !== body.title || commitment.completed || commitment.completedAt !== null))) {
      throw new Error('The created commitment does not match the requested selection.');
    }
    return commitment;
  }, { ...options, method: 'POST', body });
}

/**
 * Set completion explicitly with true/false. For a linked commitment the backend
 * updates the task in the same transaction. Refresh app task state afterward.
 * Linked titles must be edited through the Task API; this endpoint returns 409.
 */
export async function updateApiWeeklyCommitment(
  id: number, input: UpdateApiWeeklyCommitmentInput, options: WeeklyCommitmentApiOptions = {}
): Promise<ApiWeeklyCommitment> {
  requireId(id);
  const body = updateBody(input);
  return apiRequest(`${PATH}/${id}`, (value) => {
    const commitment = decodeMatchingCommitment(value, id);
    if ((body.title !== undefined && (commitment.taskId !== null || commitment.title !== body.title)) ||
        (body.completed !== undefined && (commitment.completed !== body.completed ||
          commitment.completed !== (commitment.completedAt !== null)))) {
      throw new Error('The saved commitment does not match the requested edit.');
    }
    return commitment;
  }, { ...options, method: 'PATCH', body });
}

/** Remove only the commitment. The linked task and planning cycle remain. */
export async function deleteApiWeeklyCommitment(id: number, options: WeeklyCommitmentApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty commitment-delete response.');
  }, { ...options, method: 'DELETE', body: undefined });
}
