/** API calls for recurring schedules and explicit occurrence generation. */

import { RECURRENCE_FREQUENCIES, type RecurrenceFrequency } from '../recurrenceUtils';
import type { DeleteRecurringRuleMode, RecurringRule } from '../recurringStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

export type ApiRecurringRule = RecurringRule & { sourceRecurringRuleId: number | null };
export type CreateApiRecurringRuleInput = {
  title: string;
  notes?: string | null;
  priority?: number;
  goalId?: number | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
  weekdays?: number[];
  active?: boolean;
};
export type UpdateApiRecurringRuleInput = Partial<CreateApiRecurringRuleInput>;
export type RecurringRuleApiFilters = { goalId?: number; active?: boolean };
export type RecurringRuleApiOptions = Pick<ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'>;
export type GenerateApiRecurringTasksInput = {
  /** The user's local calendar date, not the server's UTC date. */
  currentDate: string;
  horizonDays?: number;
  /** Omit or use null to process all schedules. */
  recurringRuleId?: number | null;
};
export type ApiRecurrenceGenerationResult = {
  currentDate: string;
  horizonDays: number;
  windowEnd: string;
  rulesChecked: number;
  candidateCount: number;
  createdCount: number;
  existingCount: number;
  skippedCount: number;
  createdTaskIds: number[];
  databaseChanged: boolean;
};

const PATH = '/api/v1/recurring-rules';
const EDIT_FIELDS = ['title', 'notes', 'priority', 'goalId', 'frequency', 'startDate', 'endDate', 'weekdays', 'active'];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function postgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
function frequency(value: unknown): value is RecurrenceFrequency {
  return typeof value === 'string' && (RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}
function weekdays(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 7 &&
    value.every((day) => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6) &&
    new Set(value).size === value.length;
}
function horizon(value: unknown): value is number {
  return nonnegative(value) && value <= 366;
}
function windowEnd(currentDate: string, horizonDays: number): string {
  const date = new Date(`${currentDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + horizonDays);
  if (date.getUTCFullYear() > 9999) throw new Error('The generation window exceeds the supported date range.');
  return date.toISOString().slice(0, 10);
}
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireId(value: unknown, label = 'Schedule ID'): asserts value is number {
  if (!postgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Recurring-schedule input contains unsupported fields.');
  }
}
function decodeRule(value: unknown): ApiRecurringRule {
  if (!object(value) || !postgresId(value.id) ||
      !(value.source_recurring_rule_id === null ||
        (typeof value.source_recurring_rule_id === 'number' && Number.isSafeInteger(value.source_recurring_rule_id) && value.source_recurring_rule_id > 0)) ||
      !(value.goal_id === null || postgresId(value.goal_id)) ||
      typeof value.title !== 'string' || !value.title.trim() ||
      !(value.notes === null || typeof value.notes === 'string') ||
      !nonnegative(value.priority) || value.priority > 2 ||
      !frequency(value.frequency) || !dateKey(value.start_date) ||
      !(value.end_date === null || (dateKey(value.end_date) && value.end_date >= value.start_date)) ||
      !weekdays(value.weekdays) || (value.frequency === 'certainDays' && value.weekdays.length === 0) ||
      typeof value.active !== 'boolean' || !timestamp(value.created_at)) {
    throw new Error('Invalid recurring-schedule response.');
  }
  return {
    id: value.id, sourceRecurringRuleId: value.source_recurring_rule_id as number | null,
    title: value.title, notes: value.notes as string | null, priority: value.priority,
    goalId: value.goal_id as number | null, frequency: value.frequency,
    startDate: value.start_date, endDate: value.end_date as string | null,
    weekdays: [...value.weekdays], active: value.active, createdAt: value.created_at,
  };
}
function decodeMatchingRule(value: unknown, id: number): ApiRecurringRule {
  const rule = decodeRule(value);
  if (rule.id !== id) throw new Error('The returned schedule ID does not match.');
  return rule;
}
function requestBody(input: unknown, creating: boolean): Record<string, unknown> {
  requireFields(input, EDIT_FIELDS);
  const body: Record<string, unknown> = {};
  if (creating || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) invalidInput('A recurring schedule needs a title.');
    body.title = input.title.trim();
  }
  if (input.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== 'string') invalidInput('Notes must be text or null.');
    body.notes = typeof input.notes === 'string' ? input.notes.trim() || null : null;
  }
  if (input.priority !== undefined) {
    if (!nonnegative(input.priority) || input.priority > 2) invalidInput('Priority must be 0, 1, or 2.');
    body.priority = input.priority;
  }
  if (input.goalId !== undefined) {
    if (input.goalId !== null) requireId(input.goalId, 'Goal ID');
    body.goal_id = input.goalId;
  }
  if (creating || input.frequency !== undefined) {
    if (!frequency(input.frequency)) invalidInput('Unsupported recurrence frequency.');
    body.frequency = input.frequency;
  }
  if (creating || input.startDate !== undefined) {
    if (!dateKey(input.startDate)) invalidInput('startDate must be a real YYYY-MM-DD date.');
    body.start_date = input.startDate;
  }
  if (input.endDate !== undefined) {
    if (input.endDate !== null && !dateKey(input.endDate)) invalidInput('endDate must be a real YYYY-MM-DD date or null.');
    body.end_date = input.endDate;
  }
  if (typeof body.start_date === 'string' && typeof body.end_date === 'string' && body.end_date < body.start_date) {
    invalidInput('The schedule end date cannot be before its start date.');
  }
  if (input.weekdays !== undefined) {
    if (!weekdays(input.weekdays)) invalidInput('Weekdays must be unique integers from Sunday=0 to Saturday=6.');
    body.weekdays = [...input.weekdays].sort((a, b) => a - b);
  }
  if (body.frequency === 'certainDays' &&
      ((Array.isArray(body.weekdays) && body.weekdays.length === 0) || (creating && body.weekdays === undefined))) {
    invalidInput('certainDays requires at least one weekday.');
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') invalidInput('active must be a boolean.');
    body.active = input.active;
  }
  return body;
}

export async function fetchApiRecurringRules(filters: RecurringRuleApiFilters = {}, options: RecurringRuleApiOptions = {}): Promise<ApiRecurringRule[]> {
  requireFields(filters, ['goalId', 'active']);
  const goalId = filters.goalId, active = filters.active;
  if (goalId !== undefined) requireId(goalId, 'Goal ID');
  if (active !== undefined && typeof active !== 'boolean') invalidInput('active must be a boolean.');
  const query: string[] = [];
  if (goalId !== undefined) query.push(`goal_id=${goalId}`);
  if (active !== undefined) query.push(`active=${active}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a schedule list.');
    const rules = value.map(decodeRule);
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error('Duplicate recurring-schedule IDs.');
    if (rules.some((rule) => (goalId !== undefined && rule.goalId !== goalId) || (active !== undefined && rule.active !== active))) {
      throw new Error('The returned schedules do not match the requested filters.');
    }
    return rules;
  }, { ...options, method: 'GET' });
}

export async function fetchApiRecurringRule(id: number, options: RecurringRuleApiOptions = {}): Promise<ApiRecurringRule> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingRule(value, id), { ...options, method: 'GET' });
}

/** Saving a schedule does not generate its task occurrences. */
export async function createApiRecurringRule(input: CreateApiRecurringRuleInput, options: RecurringRuleApiOptions = {}): Promise<ApiRecurringRule> {
  return apiRequest(PATH, decodeRule, { ...options, method: 'POST', body: requestBody(input, true) });
}

/** Edits affect future generation; existing task occurrences retain their values. */
export async function updateApiRecurringRule(id: number, input: UpdateApiRecurringRuleInput, options: RecurringRuleApiOptions = {}): Promise<ApiRecurringRule> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingRule(value, id), { ...options, method: 'PATCH', body: requestBody(input, false) });
}

/** Both server deletion modes retain completed task history. */
export async function deleteApiRecurringRule(id: number, mode: DeleteRecurringRuleMode, options: RecurringRuleApiOptions = {}): Promise<void> {
  requireId(id);
  if (mode !== 'stopOnly' && mode !== 'deleteUnfinished') invalidInput('Choose stopOnly or deleteUnfinished.');
  return apiRequest(`${PATH}/${id}?mode=${mode}`, (value) => {
    if (value !== null) throw new Error('Expected an empty delete response.');
  }, { ...options, method: 'DELETE' });
}

/** Generate missing tasks explicitly using the user's local calendar date. */
export async function generateApiRecurringTasks(input: GenerateApiRecurringTasksInput, options: RecurringRuleApiOptions = {}): Promise<ApiRecurrenceGenerationResult> {
  requireFields(input, ['currentDate', 'horizonDays', 'recurringRuleId']);
  const currentDate = input.currentDate;
  const horizonDays = input.horizonDays === undefined ? 30 : input.horizonDays;
  const ruleId = input.recurringRuleId;
  if (!dateKey(currentDate)) invalidInput('currentDate must be a real YYYY-MM-DD date.');
  if (!horizon(horizonDays)) invalidInput('horizonDays must be an integer from 0 to 366.');
  if (ruleId !== undefined && ruleId !== null) requireId(ruleId);
  let end: string;
  try { end = windowEnd(currentDate, horizonDays); }
  catch { invalidInput('The generation window exceeds the supported date range.'); }
  const body: Record<string, unknown> = { current_date: currentDate, horizon_days: horizonDays };
  if (ruleId !== undefined) body.recurring_rule_id = ruleId;
  return apiRequest(`${PATH}/generate`, (value) => {
    if (!object(value) || value.current_date !== currentDate || value.horizon_days !== horizonDays || value.window_end !== end ||
        !nonnegative(value.rules_checked) || !nonnegative(value.candidate_count) || !nonnegative(value.created_count) ||
        !nonnegative(value.existing_count) || !nonnegative(value.skipped_count) ||
        value.candidate_count !== value.created_count + value.existing_count + value.skipped_count ||
        !Array.isArray(value.created_task_ids) || !value.created_task_ids.every(postgresId) ||
        value.created_task_ids.length !== value.created_count || new Set(value.created_task_ids).size !== value.created_task_ids.length ||
        value.database_changed !== (value.created_count > 0) ||
        (ruleId !== undefined && ruleId !== null && value.rules_checked !== 1)) {
      throw new Error('Invalid recurring-task generation summary.');
    }
    return {
      currentDate, horizonDays, windowEnd: end, rulesChecked: value.rules_checked,
      candidateCount: value.candidate_count, createdCount: value.created_count,
      existingCount: value.existing_count, skippedCount: value.skipped_count,
      createdTaskIds: [...value.created_task_ids], databaseChanged: value.database_changed as boolean,
    };
  }, { ...options, method: 'POST', body });
}

/** Validate a schedule returned inside another API action and map it for the app. */
export function decodeApiRecurringRule(
  value: unknown
): ApiRecurringRule {
  return decodeRule(value);
}