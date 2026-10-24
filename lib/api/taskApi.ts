/** Task API calls and translation between server and app field names. */

import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

/** Complete TaskRead response from FastAPI, including migration metadata. */
export type ServerTask = {
  id: number;
  title: string;
  day: string;
  due_date: string | null;
  notes: string | null;
  priority: number;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  goal_id: number | null;
  recurring_rule_id: number | null;
  source_task_id: number | null;
  source_goal_id: number | null;
  source_recurring_rule_id: number | null;
  recurrence_occurrence_date: string | null;
};

/**
 * Camel-case task returned to the app. All ordinary IDs here are PostgreSQL
 * IDs. The future SQLite cache must store its local ID separately; do not
 * insert these IDs into the existing local tables as if they were SQLite IDs.
 * Source IDs are migration metadata, never substitutes for native links.
 */
export type ApiTask = {
  id: number;
  title: string;
  day: string;
  dueDate: string | null;
  notes: string | null;
  priority: number;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  goalId: number | null;
  recurringRuleId: number | null;
  sourceTaskId: number | null;
  sourceGoalId: number | null;
  sourceRecurringRuleId: number | null;
  recurrenceOccurrenceDate: string | null;
};

export type CreateApiTaskInput = {
  title: string;
  dueDate?: string | null;
  notes?: string | null;
  priority?: number;
  goalId?: number | null;
  recurringRuleId?: number | null;
  recurrenceOccurrenceDate?: string | null;
};

export type UpdateApiTaskInput = {
  title?: string;
  dueDate?: string | null;
  notes?: string | null;
  priority?: number;
  completed?: boolean;
  goalId?: number | null;
};

export type TaskApiFilters = {
  goalId?: number;
  recurringRuleId?: number;
};

export type TaskApiOptions = Pick<
  ApiRequestOptions,
  'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;

const TASKS_PATH = '/api/v1/tasks';
const MAX_POSTGRES_ID = 2_147_483_647;
const DAYS = new Set([
  'Inbox', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_POSTGRES_ID;
}

function isSourceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}

function isNullablePostgresId(value: unknown): value is number | null {
  return value === null || isPostgresId(value);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function isNullableDateKey(value: unknown): value is string | null {
  return value === null || isDateKey(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && isDateKey(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isServerTask(value: unknown): value is ServerTask {
  if (!isRecord(value)) return false;
  const validFields =
    isPostgresId(value.id) &&
    typeof value.title === 'string' && value.title.trim().length > 0 &&
    typeof value.day === 'string' && DAYS.has(value.day) &&
    isNullableDateKey(value.due_date) &&
    (value.notes === null || typeof value.notes === 'string') &&
    typeof value.priority === 'number' && Number.isInteger(value.priority) && value.priority >= 0 && value.priority <= 2 &&
    typeof value.completed === 'boolean' &&
    isTimestamp(value.created_at) &&
    (value.completed_at === null || isTimestamp(value.completed_at)) &&
    isNullablePostgresId(value.goal_id) &&
    isNullablePostgresId(value.recurring_rule_id) &&
    isSourceId(value.source_task_id) &&
    isSourceId(value.source_goal_id) &&
    isSourceId(value.source_recurring_rule_id) &&
    isNullableDateKey(value.recurrence_occurrence_date);
  if (!validFields) return false;

  // Legacy imports may have a source rule link before the native mapping.
  const hasRule = value.recurring_rule_id !== null || value.source_recurring_rule_id !== null;
  return hasRule === (value.recurrence_occurrence_date !== null);
}

function decodeServerTask(value: unknown): ServerTask {
  if (!isServerTask(value)) throw new Error('Invalid TaskRead response');
  return value;
}

function decodeServerTaskList(value: unknown): ServerTask[] {
  if (!Array.isArray(value)) throw new Error('Expected a task list');
  const tasks = value.map(decodeServerTask);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new Error('The response contains duplicate task IDs');
  }
  return tasks;
}

function appTask(task: ServerTask): ApiTask {
  return {
    id: task.id, title: task.title, day: task.day,
    dueDate: task.due_date, notes: task.notes, priority: task.priority,
    completed: task.completed, createdAt: task.created_at, completedAt: task.completed_at,
    goalId: task.goal_id, recurringRuleId: task.recurring_rule_id,
    sourceTaskId: task.source_task_id, sourceGoalId: task.source_goal_id,
    sourceRecurringRuleId: task.source_recurring_rule_id,
    recurrenceOccurrenceDate: task.recurrence_occurrence_date,
  };
}

function inputError(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}

function requirePostgresId(value: unknown, field: string): asserts value is number {
  if (!isPostgresId(value)) inputError(`${field} must be a positive PostgreSQL ID, not a SQLite source ID.`);
}

function requireInput(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value)) inputError('Task input must be an object.');
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    inputError('Task input contains unsupported fields. IDs, source metadata, and timestamps are managed separately.');
  }
}

const EDITABLE_FIELDS = ['title', 'dueDate', 'notes', 'priority', 'goalId'] as const;

function editableBody(input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) inputError('Task title must not be blank.');
    body.title = input.title.trim();
  }
  if (input.dueDate !== undefined) {
    if (!isNullableDateKey(input.dueDate)) inputError('dueDate must be a valid YYYY-MM-DD date or null.');
    body.due_date = input.dueDate;
  }
  if (input.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== 'string') inputError('Task notes must be text or null.');
    body.notes = typeof input.notes === 'string' ? input.notes.trim() || null : null;
  }
  if (input.priority !== undefined) {
    if (typeof input.priority !== 'number' || !Number.isInteger(input.priority) || input.priority < 0 || input.priority > 2) {
      inputError('Task priority must be 0, 1, or 2.');
    }
    body.priority = input.priority;
  }
  if (input.goalId !== undefined) {
    if (input.goalId !== null) requirePostgresId(input.goalId, 'goalId');
    body.goal_id = input.goalId;
  }
  return body;
}

/** Retain the existing Task API tools screen's raw response interface. */
export async function fetchServerTasks(baseUrl: string): Promise<ServerTask[]> {
  return apiRequest(TASKS_PATH, decodeServerTaskList, { method: 'GET', baseUrl });
}

/** Read tasks using native goal/schedule filters and camel-case app fields. */
export async function fetchApiTasks(
  filters: TaskApiFilters = {},
  options: TaskApiOptions = {}
): Promise<ApiTask[]> {
  requireInput(filters, ['goalId', 'recurringRuleId']);
  const query: string[] = [];
  for (const [field, serverField] of [['goalId', 'goal_id'], ['recurringRuleId', 'recurring_rule_id']] as const) {
    const value = filters[field];
    if (value !== undefined) {
      requirePostgresId(value, field);
      query.push(`${serverField}=${value}`);
    }
  }
  const path = TASKS_PATH + (query.length ? `?${query.join('&')}` : '');
  return apiRequest(path, (value) => decodeServerTaskList(value).map(appTask), { ...options, method: 'GET' });
}

export async function fetchApiTask(id: number, options: TaskApiOptions = {}): Promise<ApiTask> {
  requirePostgresId(id, 'task ID');
  return apiRequest(`${TASKS_PATH}/${id}`, (value) => {
    const task = decodeServerTask(value);
    if (task.id !== id) throw new Error('Returned task ID differs from requested ID');
    return appTask(task);
  }, { ...options, method: 'GET' });
}

export async function createApiTask(
  input: CreateApiTaskInput,
  options: TaskApiOptions = {}
): Promise<ApiTask> {
  requireInput(input, [...EDITABLE_FIELDS, 'recurringRuleId', 'recurrenceOccurrenceDate']);
  if (typeof input.title !== 'string' || !input.title.trim()) inputError('Task title must not be blank.');
  const body = editableBody(input);
  const hasRule = input.recurringRuleId !== undefined && input.recurringRuleId !== null;
  const hasDate = input.recurrenceOccurrenceDate !== undefined && input.recurrenceOccurrenceDate !== null;
  if (hasRule !== hasDate) inputError('A recurring rule and original occurrence date must be supplied together.');
  if (input.recurringRuleId !== undefined) {
    if (input.recurringRuleId !== null) requirePostgresId(input.recurringRuleId, 'recurringRuleId');
    body.recurring_rule_id = input.recurringRuleId;
  }
  if (input.recurrenceOccurrenceDate !== undefined) {
    if (!isNullableDateKey(input.recurrenceOccurrenceDate)) inputError('recurrenceOccurrenceDate must be a valid YYYY-MM-DD date or null.');
    body.recurrence_occurrence_date = input.recurrenceOccurrenceDate;
  }
  // In particular, do not fill an omitted goal_id with null: an occurrence
  // should inherit its schedule's goal unless the caller explicitly clears it.
  return apiRequest(TASKS_PATH, (value) => appTask(decodeServerTask(value)), {
    ...options, method: 'POST', body,
  });
}

/** Complete/reopen, reschedule, move to Inbox, or edit only this occurrence. */
export async function updateApiTask(
  id: number,
  input: UpdateApiTaskInput,
  options: TaskApiOptions = {}
): Promise<ApiTask> {
  requirePostgresId(id, 'task ID');
  requireInput(input, [...EDITABLE_FIELDS, 'completed']);
  const body = editableBody(input);
  if (input.completed !== undefined) {
    if (typeof input.completed !== 'boolean') inputError('Task completion must be true or false.');
    body.completed = input.completed;
  }
  return apiRequest(`${TASKS_PATH}/${id}`, (value) => {
    const task = decodeServerTask(value);
    if (task.id !== id) throw new Error('Returned task ID differs from updated ID');
    return appTask(task);
  }, { ...options, method: 'PATCH', body });
}

/** The backend also records a skip when deleting a recurring occurrence. */
export async function deleteApiTask(id: number, options: TaskApiOptions = {}): Promise<void> {
  requirePostgresId(id, 'task ID');
  return apiRequest(`${TASKS_PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty delete response');
  }, { ...options, method: 'DELETE' });
}

/** Validate a task returned inside another API action and map it for the app. */
export function decodeApiTask(value: unknown): ApiTask {
  return appTask(decodeServerTask(value));
}