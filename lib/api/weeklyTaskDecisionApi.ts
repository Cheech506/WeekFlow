/** Apply unfinished-task actions and read their preserved weekly history. */

import type { WeeklyTaskDecision, WeeklyTaskDecisionAction } from '../weeklyReviewStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

export type ApiWeeklyTaskDecision = WeeklyTaskDecision & {
  sourceWeeklyTaskDecisionId: number | null;
  sourceRecurringRuleId: number | null;
};
type DecisionTaskInput = {
  weekStart: string;
  taskId: number;
  /** The task's due date BEFORE this action, not its original recurring date. */
  originalDueDate: string;
};
export type ApplyApiWeeklyTaskDecisionInput = DecisionTaskInput & (
  { action: 'nextWeek'; resolvedDueDate?: string | null } |
  { action: 'reschedule'; resolvedDueDate: string } |
  { action: 'inbox' | 'keep' | 'delete'; resolvedDueDate?: null }
);
export type WeeklyTaskDecisionApiFilters = {
  weekStart?: string;
  taskId?: number;
  recurringRuleId?: number;
  action?: WeeklyTaskDecisionAction;
};
export type WeeklyTaskDecisionApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;
const PATH = '/api/v1/weekly-task-decisions';
const ACTIONS: readonly WeeklyTaskDecisionAction[] = ['nextWeek', 'inbox', 'reschedule', 'keep', 'delete'];

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
function isWithinWeek(weekStart: string, originalDate: string): boolean {
  const days = (Date.parse(`${originalDate}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days < 7;
}
function nextWeekDate(originalDate: string): string | null {
  const date = new Date(`${originalDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
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
function isAction(value: unknown): value is WeeklyTaskDecisionAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireId(value: unknown, label = 'Decision ID'): asserts value is number {
  if (!isPostgresId(value)) invalidInput(`${label} must be a native PostgreSQL ID.`);
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Weekly task-decision input contains unsupported fields.');
  }
}

/** A decision can outlive its task or schedule; historical links may be null. */
function decodeDecision(value: unknown): ApiWeeklyTaskDecision {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_weekly_task_decision_id) ||
      !isMonday(value.week_start) || !isNullableId(value.task_id) ||
      typeof value.task_title !== 'string' || !value.task_title.trim() ||
      !isDateKey(value.original_due_date) || !isWithinWeek(value.week_start, value.original_due_date) ||
      !isAction(value.action) || !(value.resolved_due_date === null || isDateKey(value.resolved_due_date)) ||
      !isNullableId(value.recurring_rule_id) || !isSourceId(value.source_recurring_rule_id) ||
      !(value.recurrence_occurrence_date === null || isDateKey(value.recurrence_occurrence_date)) ||
      !isTimestamp(value.decided_at)) {
    throw new Error('Invalid weekly task-decision response.');
  }
  const hasRecurrence = value.recurring_rule_id !== null || value.source_recurring_rule_id !== null;
  const needsResolvedDate = value.action === 'nextWeek' || value.action === 'reschedule';
  if (hasRecurrence !== (value.recurrence_occurrence_date !== null) ||
      needsResolvedDate !== (value.resolved_due_date !== null) ||
      (value.action === 'nextWeek' && (nextWeekDate(value.original_due_date) === null ||
        value.resolved_due_date !== nextWeekDate(value.original_due_date))) ||
      (value.action === 'delete' && value.task_id !== null)) {
    throw new Error('Inconsistent weekly task-decision dates or identity.');
  }
  return {
    id: value.id, sourceWeeklyTaskDecisionId: value.source_weekly_task_decision_id,
    weekStart: value.week_start, taskId: value.task_id, taskTitle: value.task_title,
    originalDueDate: value.original_due_date, action: value.action,
    resolvedDueDate: value.resolved_due_date as string | null,
    recurringRuleId: value.recurring_rule_id, sourceRecurringRuleId: value.source_recurring_rule_id,
    recurrenceOccurrenceDate: value.recurrence_occurrence_date as string | null, decidedAt: value.decided_at,
  };
}
function decodeMatchingDecision(value: unknown, id: number): ApiWeeklyTaskDecision {
  const decision = decodeDecision(value);
  if (decision.id !== id) throw new Error('The returned decision ID does not match.');
  return decision;
}

/** Validate the selected task's original scheduled date and the action's target. */
function requestBody(input: unknown): Record<string, unknown> {
  requireFields(input, ['weekStart', 'taskId', 'originalDueDate', 'action', 'resolvedDueDate']);
  if (!isMonday(input.weekStart)) invalidInput('weekStart must be a Monday in YYYY-MM-DD format.');
  requireId(input.taskId, 'Task ID');
  if (!isDateKey(input.originalDueDate) || !isWithinWeek(input.weekStart, input.originalDueDate)) {
    invalidInput('originalDueDate must be a real date within the selected review week.');
  }
  if (!isAction(input.action)) invalidInput('Unsupported weekly task decision.');
  let resolved = input.resolvedDueDate === undefined ? null : input.resolvedDueDate;
  if (input.action === 'nextWeek') {
    const expected = nextWeekDate(input.originalDueDate);
    if (expected === null) invalidInput('The next-week date exceeds the supported calendar.');
    if (resolved !== null && resolved !== expected) invalidInput('nextWeek must move the task exactly seven days forward.');
    resolved = expected;
  } else if (input.action === 'reschedule') {
    if (!isDateKey(resolved)) invalidInput('Choose a real resolvedDueDate for reschedule.');
  } else if (resolved !== null) {
    invalidInput('inbox, keep, and delete must not include a resolved date.');
  }
  return { week_start: input.weekStart, task_id: input.taskId, original_due_date: input.originalDueDate,
    action: input.action, resolved_due_date: resolved };
}

export async function fetchApiWeeklyTaskDecisions(
  filters: WeeklyTaskDecisionApiFilters = {}, options: WeeklyTaskDecisionApiOptions = {}
): Promise<ApiWeeklyTaskDecision[]> {
  requireFields(filters, ['weekStart', 'taskId', 'recurringRuleId', 'action']);
  const { weekStart, taskId, recurringRuleId, action } = filters;
  if (weekStart !== undefined && !isMonday(weekStart)) invalidInput('weekStart must be a Monday in YYYY-MM-DD format.');
  if (taskId !== undefined) requireId(taskId, 'Task ID');
  if (recurringRuleId !== undefined) requireId(recurringRuleId, 'Schedule ID');
  if (action !== undefined && !isAction(action)) invalidInput('Unsupported weekly task decision.');
  const query: string[] = [];
  if (weekStart !== undefined) query.push(`week_start=${weekStart}`);
  if (taskId !== undefined) query.push(`task_id=${taskId}`);
  if (recurringRuleId !== undefined) query.push(`recurring_rule_id=${recurringRuleId}`);
  if (action !== undefined) query.push(`action=${action}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a weekly task-decision list.');
    const decisions = value.map(decodeDecision);
    const liveKeys = decisions.filter((row) => row.taskId !== null)
      .map((row) => `${row.weekStart}:${row.taskId}:${row.originalDueDate}`);
    if (new Set(decisions.map((row) => row.id)).size !== decisions.length ||
        new Set(liveKeys).size !== liveKeys.length) throw new Error('Duplicate weekly task-decision identities.');
    if (decisions.some((row) => (weekStart !== undefined && row.weekStart !== weekStart) ||
        (taskId !== undefined && row.taskId !== taskId) ||
        (recurringRuleId !== undefined && row.recurringRuleId !== recurringRuleId) ||
        (action !== undefined && row.action !== action))) {
      throw new Error('The returned decisions do not match the requested filters.');
    }
    return decisions;
  }, { ...options, method: 'GET' });
}

export async function fetchApiWeeklyTaskDecision(id: number, options: WeeklyTaskDecisionApiOptions = {}): Promise<ApiWeeklyTaskDecision> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingDecision(value, id), { ...options, method: 'GET' });
}

/**
 * Apply the task action AND save history in one backend transaction. Do not
 * move/delete the task through the Task API before calling this function.
 * The result contains decision history; refresh app task state afterward.
 */
export async function applyApiWeeklyTaskDecision(
  input: ApplyApiWeeklyTaskDecisionInput, options: WeeklyTaskDecisionApiOptions = {}
): Promise<ApiWeeklyTaskDecision> {
  const body = requestBody(input);
  return apiRequest(PATH, (value) => {
    const decision = decodeDecision(value);
    if (decision.weekStart !== body.week_start || decision.originalDueDate !== body.original_due_date ||
        decision.action !== body.action || decision.resolvedDueDate !== body.resolved_due_date ||
        decision.taskId !== (body.action === 'delete' ? null : body.task_id)) {
      throw new Error('The saved decision does not match the requested action.');
    }
    return decision;
  }, { ...options, method: 'POST', body });
}

/** Delete history only. This does not undo a move, restore a task, or remove a skip. */
export async function deleteApiWeeklyTaskDecision(id: number, options: WeeklyTaskDecisionApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty decision-delete response.');
  }, { ...options, method: 'DELETE', body: undefined });
}
