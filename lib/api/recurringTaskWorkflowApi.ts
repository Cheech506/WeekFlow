/** Convert tasks and edit recurring series through one transactional API action. */

import { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from '../recurrenceUtils';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';
import {
  decodeApiRecurringRule,
  type ApiRecurrenceGenerationResult,
  type ApiRecurringRule,
  type CreateApiRecurringRuleInput,
} from './recurringRuleApi';
import { decodeApiTask, type ApiTask } from './taskApi';

// Conversion creates an active schedule. The server supplies active=true.
export type ConvertApiTaskToRecurringInput = Omit<CreateApiRecurringRuleInput, 'active'> & {
  /** Today's date on the user's device, formatted YYYY-MM-DD. */
  currentDate: string;
  horizonDays?: number;
};

// This is a full edit form. Require these values so omission cannot silently
// clear notes/goal/endDate or reset priority when the caller meant to retain them.
export type EditApiRecurringFromOccurrenceInput = {
  title: string;
  notes: string | null;
  priority: number;
  goalId: number | null;
  frequency: RecurrenceFrequency;
  endDate: string | null;
  weekdays: number[];
  currentDate: string;
  horizonDays?: number;
};

/** Full schedule edit; active/paused state remains owned by the server. */
export type EditApiRecurringSeriesInput = EditApiRecurringFromOccurrenceInput & {
  startDate: string;
};

export type ApiRecurringSeriesEditResult = {
  rule: ApiRecurringRule;
  generation: ApiRecurrenceGenerationResult;
  deletedTaskIds: number[];
  updatedTaskIds: number[];
};

export type ApiRecurringTaskWorkflowResult = {
  task: ApiTask;
  rule: ApiRecurringRule;
  generation: ApiRecurrenceGenerationResult;
  deletedTaskIds: number[];
};
export type RecurringTaskWorkflowApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;

type PreparedRequest = {
  body: Record<string, unknown>;
  currentDate: string;
  horizonDays: number;
  windowEnd: string;
};
const COMMON_FIELDS = [
  'title', 'notes', 'priority', 'goalId', 'frequency', 'endDate',
  'weekdays', 'currentDate', 'horizonDays',
];
const FULL_EDIT_FIELDS = ['title', 'notes', 'priority', 'goalId', 'frequency', 'endDate', 'weekdays'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireTaskId(id: unknown): asserts id is number {
  if (!isPostgresId(id)) invalidInput('Task ID must be a native PostgreSQL ID.');
}

/** Check the form and translate app field names into the backend's names. */
function prepareRequest(
  input: unknown, converting: boolean, editingSeries = false
): PreparedRequest {
  const needsStartDate = converting || editingSeries;
  const allowed = needsStartDate ? [...COMMON_FIELDS, 'startDate'] : COMMON_FIELDS;
  if (!isRecord(input) || Object.keys(input).some((key) => !allowed.includes(key))) {
    invalidInput('Recurring task action contains unsupported fields.');
  }
  if (!converting && FULL_EDIT_FIELDS.some((key) => input[key] === undefined)) {
    invalidInput('Send the full recurring edit form, including values you want to retain.');
  }
  if (typeof input.title !== 'string' || !input.title.trim()) invalidInput('A title is required.');
  if (typeof input.frequency !== 'string' ||
      !(RECURRENCE_FREQUENCIES as readonly string[]).includes(input.frequency)) {
    invalidInput('Unsupported recurrence frequency.');
  }
  if (!isDateKey(input.currentDate)) invalidInput('currentDate must be a real YYYY-MM-DD date.');
  const currentDate = input.currentDate;
  const horizonDays = input.horizonDays === undefined ? 30 : input.horizonDays;
  if (!isCount(horizonDays) || horizonDays > 366) invalidInput('horizonDays must be an integer from 0 to 366.');
  // UTC arithmetic keeps this calendar window independent of daylight saving time.
  const end = new Date(`${currentDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + horizonDays);
  if (end.getUTCFullYear() > 9999) invalidInput('The generation window exceeds the supported date range.');
  const windowEnd = end.toISOString().slice(0, 10);

  const notes = input.notes === undefined ? null : input.notes;
  const priority = input.priority === undefined ? 0 : input.priority;
  const goalId = input.goalId === undefined ? null : input.goalId;
  const endDate = input.endDate === undefined ? null : input.endDate;
  const weekdays = input.weekdays === undefined ? [] : input.weekdays;
  if (notes !== null && typeof notes !== 'string') invalidInput('Notes must be text or null.');
  if (!isCount(priority) || priority > 2) invalidInput('Priority must be 0, 1, or 2.');
  if (goalId !== null && !isPostgresId(goalId)) invalidInput('Goal ID must be a native PostgreSQL ID or null.');
  if (endDate !== null && !isDateKey(endDate)) invalidInput('endDate must be a real YYYY-MM-DD date or null.');
  if (!Array.isArray(weekdays) || weekdays.length > 7 ||
      !weekdays.every((day) => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6) ||
      new Set(weekdays).size !== weekdays.length) {
    invalidInput('Weekdays must be unique integers from Sunday=0 to Saturday=6.');
  }
  const sortedWeekdays: number[] = [...weekdays].sort((a, b) => a - b);
  if (input.frequency === 'certainDays' && sortedWeekdays.length === 0) {
    invalidInput('certainDays requires at least one weekday.');
  }
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    notes: typeof notes === 'string' ? notes.trim() || null : null,
    priority, goal_id: goalId, frequency: input.frequency, end_date: endDate,
    weekdays: sortedWeekdays, current_date: currentDate, horizon_days: horizonDays,
  };
  if (needsStartDate) {
    if (!isDateKey(input.startDate)) invalidInput('startDate must be a real YYYY-MM-DD date.');
    if (endDate !== null && endDate < input.startDate) invalidInput('The end date cannot be before the start date.');
    if (converting && input.frequency === 'certainDays' &&
        !sortedWeekdays.includes(new Date(`${input.startDate}T00:00:00Z`).getUTCDay())) {
      invalidInput('The first occurrence must fall on a selected weekday.');
    }
    body.start_date = input.startDate;
  }
  // An occurrence edit reads its start date from the selected task. A full
  // schedule edit supplies startDate. Both preserve the saved active state.
  return { body, currentDate, horizonDays, windowEnd };
}

function decodeGeneration(value: unknown, request: PreparedRequest): ApiRecurrenceGenerationResult {
  if (!isRecord(value) || value.current_date !== request.currentDate ||
      value.horizon_days !== request.horizonDays || value.window_end !== request.windowEnd ||
      value.rules_checked !== 1 || !isCount(value.candidate_count) ||
      !isCount(value.created_count) || !isCount(value.existing_count) || !isCount(value.skipped_count) ||
      value.candidate_count !== value.created_count + value.existing_count + value.skipped_count ||
      !Array.isArray(value.created_task_ids) || !value.created_task_ids.every(isPostgresId) ||
      value.created_task_ids.length !== value.created_count ||
      new Set(value.created_task_ids).size !== value.created_task_ids.length ||
      value.database_changed !== (value.created_count > 0)) {
    throw new Error('Invalid recurring-task generation summary.');
  }
  return {
    currentDate: request.currentDate, horizonDays: request.horizonDays, windowEnd: request.windowEnd,
    rulesChecked: 1, candidateCount: value.candidate_count, createdCount: value.created_count,
    existingCount: value.existing_count, skippedCount: value.skipped_count,
    createdTaskIds: [...value.created_task_ids], databaseChanged: value.database_changed as boolean,
  };
}

/** Validate each returned object, then check that the objects agree. */
function decodeWorkflow(
  value: unknown, taskId: number, request: PreparedRequest, converting: boolean
): ApiRecurringTaskWorkflowResult {
  if (!isRecord(value)) throw new Error('Expected a recurring task action result.');
  const task = decodeApiTask(value.task);
  const rule = decodeApiRecurringRule(value.rule);
  const generation = decodeGeneration(value.generation, request);
  if (!Array.isArray(value.deleted_task_ids) || !value.deleted_task_ids.every(isPostgresId) ||
      new Set(value.deleted_task_ids).size !== value.deleted_task_ids.length) {
    throw new Error('Invalid deleted task IDs.');
  }
  const deletedTaskIds: number[] = [...value.deleted_task_ids];
  const created = new Set(generation.createdTaskIds);
  if (task.id !== taskId || task.completed || task.completedAt !== null ||
      task.recurringRuleId !== rule.id || task.recurrenceOccurrenceDate !== rule.startDate ||
      task.title !== rule.title || task.notes !== rule.notes || task.priority !== rule.priority ||
      task.goalId !== rule.goalId || rule.title !== request.body.title || rule.notes !== request.body.notes ||
      rule.priority !== request.body.priority || rule.goalId !== request.body.goal_id ||
      rule.frequency !== request.body.frequency || rule.endDate !== request.body.end_date ||
      JSON.stringify([...rule.weekdays].sort((a, b) => a - b)) !== JSON.stringify(request.body.weekdays) ||
      deletedTaskIds.includes(taskId) || created.has(taskId) || deletedTaskIds.some((id) => created.has(id))) {
    throw new Error('The returned task, schedule, or generation IDs do not agree.');
  }
  if (converting && (!rule.active || rule.startDate !== request.body.start_date ||
      task.dueDate !== request.body.start_date || deletedTaskIds.length !== 0)) {
    throw new Error('The conversion did not retain the selected first occurrence.');
  }
  return { task, rule, generation, deletedTaskIds };
}

/**
 * Convert an unfinished standalone task. The backend retains its ID, creates
 * the schedule, links the task, and generates upcoming tasks in one transaction.
 */
export async function convertApiTaskToRecurring(
  taskId: number,
  input: ConvertApiTaskToRecurringInput,
  options: RecurringTaskWorkflowApiOptions = {}
): Promise<ApiRecurringTaskWorkflowResult> {
  requireTaskId(taskId);
  const request = prepareRequest(input, true);
  return apiRequest(`/api/v1/tasks/${taskId}/convert-to-recurring`,
    (value) => decodeWorkflow(value, taskId, request, true),
    { ...options, method: 'POST', body: request.body });
}

/**
 * Send the complete series edit. The backend retains the selected task's ID
 * and due date/Inbox placement, preserves completed history, and rebuilds only
 * later unfinished occurrences. This action is never automatically retried.
 */
export async function editApiRecurringFromOccurrence(
  taskId: number,
  input: EditApiRecurringFromOccurrenceInput,
  options: RecurringTaskWorkflowApiOptions = {}
): Promise<ApiRecurringTaskWorkflowResult> {
  requireTaskId(taskId);
  const request = prepareRequest(input, false);
  return apiRequest(`/api/v1/tasks/${taskId}/edit-recurring-from-occurrence`,
    (value) => decodeWorkflow(value, taskId, request, false),
    { ...options, method: 'POST', body: request.body });
}

/**
 * Keep one unfinished recurring task as a standalone task.
 * The backend saves its skip and clears its recurring links together.
 */
export async function detachApiRecurringTask(
  taskId: number,
  options: RecurringTaskWorkflowApiOptions = {}
): Promise<ApiTask> {
  requireTaskId(taskId);

  return apiRequest(
    `/api/v1/tasks/${taskId}/detach-recurring`,
    (value) => {
      const task = decodeApiTask(value);

      if (
        task.id !== taskId ||
        task.recurringRuleId !== null ||
        task.sourceRecurringRuleId !== null ||
        task.recurrenceOccurrenceDate !== null ||
        task.completed ||
        task.completedAt !== null
      ) {
        throw new Error(
          'The response does not contain the requested detached task.'
        );
      }

      return task;
    },
    { ...options, method: 'POST', body: undefined }
  );
}

/** Check a list of affected native task IDs without accepting duplicates. */
function decodeAffectedTaskIds(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || !value.every(isPostgresId) ||
      new Set(value).size !== value.length) {
    throw new Error(`Invalid ${label} task IDs.`);
  }
  return [...value];
}

/** Match the saved schedule and all rebuild lists to the submitted action. */
function decodeSeriesEdit(
  value: unknown, ruleId: number, request: PreparedRequest
): ApiRecurringSeriesEditResult {
  if (!isRecord(value)) throw new Error('Expected a recurring schedule edit result.');
  const rule = decodeApiRecurringRule(value.rule);
  const generation = decodeGeneration(value.generation, request);
  const deletedTaskIds = decodeAffectedTaskIds(value.deleted_task_ids, 'deleted');
  const updatedTaskIds = decodeAffectedTaskIds(value.updated_task_ids, 'updated');
  const created = new Set(generation.createdTaskIds);
  const deleted = new Set(deletedTaskIds);

  if (rule.id !== ruleId || rule.title !== request.body.title ||
      rule.notes !== request.body.notes || rule.priority !== request.body.priority ||
      rule.goalId !== request.body.goal_id || rule.frequency !== request.body.frequency ||
      rule.startDate !== request.body.start_date || rule.endDate !== request.body.end_date ||
      JSON.stringify([...rule.weekdays].sort((a, b) => a - b)) !== JSON.stringify(request.body.weekdays) ||
      deletedTaskIds.some((id) => created.has(id)) ||
      updatedTaskIds.some((id) => created.has(id) || deleted.has(id)) ||
      (!rule.active && generation.candidateCount !== 0)) {
    throw new Error('The saved schedule or affected task IDs do not agree with the edit.');
  }

  return { rule, generation, deletedTaskIds, updatedTaskIds };
}

/**
 * Save a complete schedule edit, update earlier unfinished task details, and
 * rebuild unfinished occurrences from the device's current date onward.
 * Completed history and the saved active/paused state remain unchanged.
 * Replacement tasks receive new IDs. Never automatically retry this action
 * after an uncertain response; refresh before deciding to submit again.
 */
export async function editApiRecurringSeries(
  ruleId: number,
  input: EditApiRecurringSeriesInput,
  options: RecurringTaskWorkflowApiOptions = {}
): Promise<ApiRecurringSeriesEditResult> {
  if (!isPostgresId(ruleId)) invalidInput('Schedule ID must be a native PostgreSQL ID.');
  const request = prepareRequest(input, false, true);

  return apiRequest(
    `/api/v1/recurring-rules/${ruleId}/edit-series`,
    (value) => decodeSeriesEdit(value, ruleId, request),
    { ...options, method: 'POST', body: request.body }
  );
}
