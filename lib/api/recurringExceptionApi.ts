/** Read, save, and remove skipped recurring occurrences through FastAPI. */

import type { RecurringOccurrenceException } from '../recurringStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

/** The PostgreSQL schedule ID and ORIGINAL occurrence date form the identity. */
export type ApiRecurringException = RecurringOccurrenceException;
export type CreateApiRecurringExceptionInput = {
  recurringRuleId: number;
  occurrenceDate: string;
};
export type RecurringExceptionApiFilters = {
  recurringRuleId?: number;
  occurrenceDate?: string;
};
export type RecurringExceptionApiOptions = Pick<ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'>;

const PATH = '/api/v1/recurring-exceptions';
const FIELDS = ['recurringRuleId', 'occurrenceDate'];

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
function requireId(value: unknown): asserts value is number {
  if (!postgresId(value)) invalidInput('Schedule ID must be a native PostgreSQL ID.');
}
function requireDate(value: unknown): asserts value is string {
  if (!dateKey(value)) invalidInput('Use the original occurrence date in YYYY-MM-DD format.');
}
function requireFields(value: unknown): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((field) => !FIELDS.includes(field))) {
    invalidInput('Recurring-exception input contains unsupported fields.');
  }
}
function decodeException(value: unknown): ApiRecurringException {
  if (!object(value) || !postgresId(value.recurring_rule_id) || !dateKey(value.occurrence_date) || !timestamp(value.created_at)) {
    throw new Error('Invalid recurring-exception response.');
  }
  return { recurringRuleId: value.recurring_rule_id, occurrenceDate: value.occurrence_date, createdAt: value.created_at };
}
function decodeMatchingException(value: unknown, ruleId: number, date: string): ApiRecurringException {
  const exception = decodeException(value);
  if (exception.recurringRuleId !== ruleId || exception.occurrenceDate !== date) {
    throw new Error('The returned skip record does not match the requested occurrence.');
  }
  return exception;
}

export async function fetchApiRecurringExceptions(
  filters: RecurringExceptionApiFilters = {},
  options: RecurringExceptionApiOptions = {}
): Promise<ApiRecurringException[]> {
  requireFields(filters);
  const ruleId = filters.recurringRuleId, date = filters.occurrenceDate;
  if (ruleId !== undefined) requireId(ruleId);
  if (date !== undefined) requireDate(date);
  const query: string[] = [];
  if (ruleId !== undefined) query.push(`recurring_rule_id=${ruleId}`);
  if (date !== undefined) query.push(`occurrence_date=${date}`);
  return apiRequest(PATH + (query.length ? `?${query.join('&')}` : ''), (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a recurring-exception list.');
    const exceptions = value.map(decodeException);
    const keys = exceptions.map((exception) => `${exception.recurringRuleId}:${exception.occurrenceDate}`);
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate recurring-exception identities.');
    if (exceptions.some((exception) =>
      (ruleId !== undefined && exception.recurringRuleId !== ruleId) ||
      (date !== undefined && exception.occurrenceDate !== date))) {
      throw new Error('The returned skip records do not match the requested filters.');
    }
    return exceptions;
  }, { ...options, method: 'GET' });
}

export async function fetchApiRecurringException(
  recurringRuleId: number,
  occurrenceDate: string,
  options: RecurringExceptionApiOptions = {}
): Promise<ApiRecurringException> {
  requireId(recurringRuleId);
  requireDate(occurrenceDate);
  return apiRequest(`${PATH}/${recurringRuleId}/${occurrenceDate}`,
    (value) => decodeMatchingException(value, recurringRuleId, occurrenceDate),
    { ...options, method: 'GET' });
}

/**
 * Skip an occurrence that has no task. The server returns the original skip
 * for an identical repeat (HTTP 200) or creates one (HTTP 201).
 * Existing recurring tasks are deleted through the Task API, which saves
 * their skip and task deletion atomically. This function never deletes tasks.
 */
export async function createApiRecurringException(
  input: CreateApiRecurringExceptionInput,
  options: RecurringExceptionApiOptions = {}
): Promise<ApiRecurringException> {
  requireFields(input);
  const ruleId = input.recurringRuleId, date = input.occurrenceDate;
  requireId(ruleId);
  requireDate(date);
  return apiRequest(PATH, (value) => decodeMatchingException(value, ruleId, date), {
    ...options, method: 'POST', body: { recurring_rule_id: ruleId, occurrence_date: date },
  });
}

/** Remove a skip only. A later generation request may recreate the occurrence. */
export async function deleteApiRecurringException(
  recurringRuleId: number,
  occurrenceDate: string,
  options: RecurringExceptionApiOptions = {}
): Promise<void> {
  requireId(recurringRuleId);
  requireDate(occurrenceDate);
  return apiRequest(`${PATH}/${recurringRuleId}/${occurrenceDate}`, (value) => {
    if (value !== null) throw new Error('Expected an empty delete response.');
  }, { ...options, method: 'DELETE' });
}
