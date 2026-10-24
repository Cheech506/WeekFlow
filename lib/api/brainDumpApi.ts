/** Brain Dump requests, including archive/restore and atomic task conversion. */

import type { StoredBrainDump } from '../brainDumpStorage';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';
import { decodeApiTask, type ApiTask } from './taskApi';

// This type-only import reuses the UI shape without executing SQLite storage.
export type ApiBrainDump = StoredBrainDump & { sourceBrainDumpId: number | null };
export type CreateApiBrainDumpInput = { body: string };
export type UpdateApiBrainDumpInput = { body?: string; archived?: boolean };
export type BrainDumpApiFilters = { archived?: boolean };
export type BrainDumpApiOptions = Pick<
  ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'
>;
const PATH = '/api/v1/brain-dumps';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPostgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function isSourceId(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
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
function requireId(value: unknown): asserts value is number {
  if (!isPostgresId(value)) invalidInput('Brain Dump ID must be a native PostgreSQL ID.');
}
function requireFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowed.includes(field))) {
    invalidInput('Brain Dump input contains unsupported fields.');
  }
}

/** Check required data and the archive/timestamp pair before mapping names. */
function decodeNote(value: unknown): ApiBrainDump {
  if (!isRecord(value) || !isPostgresId(value.id) || !isSourceId(value.source_brain_dump_id) ||
      typeof value.body !== 'string' || !value.body.trim() || typeof value.archived !== 'boolean' ||
      !isTimestamp(value.created_at) ||
      !(value.archived ? isTimestamp(value.archived_at) : value.archived_at === null)) {
    throw new Error('Invalid Brain Dump response.');
  }
  return {
    id: value.id, sourceBrainDumpId: value.source_brain_dump_id,
    body: value.body, archived: value.archived,
    createdAt: value.created_at, archivedAt: value.archived_at as string | null,
  };
}
function decodeMatchingNote(value: unknown, id: number): ApiBrainDump {
  const note = decodeNote(value);
  if (note.id !== id) throw new Error('The returned Brain Dump ID does not match.');
  return note;
}

/** Omitted PATCH fields stay unchanged; null cannot erase text or archive state. */
function requestBody(input: unknown, creating: boolean): Record<string, unknown> {
  requireFields(input, creating ? ['body'] : ['body', 'archived']);
  const body: Record<string, unknown> = {};
  if (creating || input.body !== undefined) {
    if (typeof input.body !== 'string' || !input.body.trim()) invalidInput('A Brain Dump note cannot be empty.');
    body.body = input.body.trim();
  }
  if (!creating && input.archived !== undefined) {
    if (typeof input.archived !== 'boolean') invalidInput('archived must be true or false.');
    body.archived = input.archived;
  }
  return body;
}
function decodeWrittenNote(value: unknown, body: Record<string, unknown>, id?: number): ApiBrainDump {
  const note = id === undefined ? decodeNote(value) : decodeMatchingNote(value, id);
  if ((body.body !== undefined && note.body !== body.body) ||
      (body.archived !== undefined && note.archived !== body.archived) ||
      (id === undefined && (note.archived || note.sourceBrainDumpId !== null))) {
    throw new Error('The returned note does not match the requested save.');
  }
  return note;
}

export async function fetchApiBrainDumps(
  filters: BrainDumpApiFilters = {}, options: BrainDumpApiOptions = {}
): Promise<ApiBrainDump[]> {
  requireFields(filters, ['archived']);
  const archived = filters.archived;
  if (archived !== undefined && typeof archived !== 'boolean') invalidInput('archived must be true or false.');
  // Check undefined explicitly: false is a real filter for active notes.
  const path = archived === undefined ? PATH : `${PATH}?archived=${archived}`;
  return apiRequest(path, (value) => {
    if (!Array.isArray(value)) throw new Error('Expected a Brain Dump list.');
    const notes = value.map(decodeNote);
    if (new Set(notes.map((note) => note.id)).size !== notes.length) throw new Error('Duplicate Brain Dump IDs.');
    if (archived !== undefined && notes.some((note) => note.archived !== archived)) {
      throw new Error('The returned notes do not match the archive filter.');
    }
    return notes;
  }, { ...options, method: 'GET' });
}

export async function fetchApiBrainDump(id: number, options: BrainDumpApiOptions = {}): Promise<ApiBrainDump> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => decodeMatchingNote(value, id), { ...options, method: 'GET' });
}

/** Create an active note; PostgreSQL supplies the ID and creation timestamp. */
export async function createApiBrainDump(
  input: CreateApiBrainDumpInput, options: BrainDumpApiOptions = {}
): Promise<ApiBrainDump> {
  const body = requestBody(input, true);
  return apiRequest(PATH, (value) => decodeWrittenNote(value, body), { ...options, method: 'POST', body });
}

export async function updateApiBrainDump(
  id: number, input: UpdateApiBrainDumpInput, options: BrainDumpApiOptions = {}
): Promise<ApiBrainDump> {
  requireId(id);
  const body = requestBody(input, false);
  return apiRequest(`${PATH}/${id}`, (value) => decodeWrittenNote(value, body, id), { ...options, method: 'PATCH', body });
}

/** The server records archive time; repeated archive requests retain that time. */
export async function archiveApiBrainDump(id: number, options: BrainDumpApiOptions = {}): Promise<ApiBrainDump> {
  return updateApiBrainDump(id, { archived: true }, options);
}

/** Restore the same note and clear its archive timestamp. */
export async function restoreApiBrainDump(id: number, options: BrainDumpApiOptions = {}): Promise<ApiBrainDump> {
  return updateApiBrainDump(id, { archived: false }, options);
}

export async function deleteApiBrainDump(id: number, options: BrainDumpApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty Brain Dump delete response.');
  }, { ...options, method: 'DELETE', body: undefined });
}

/**
 * In one backend transaction, create an independent Inbox task and remove the
 * active note. Do not automatically repeat an uncertain conversion request:
 * the task may already exist even if its response never reached the device.
 */
export async function convertApiBrainDumpToTask(id: number, options: BrainDumpApiOptions = {}): Promise<ApiTask> {
  requireId(id);
  return apiRequest(`${PATH}/${id}/convert-to-task`, (value) => {
    const task = decodeApiTask(value);
    if (task.day !== 'Inbox' || task.dueDate !== null || task.notes !== null || task.priority !== 0 ||
        task.completed || task.completedAt !== null || task.goalId !== null || task.sourceGoalId !== null ||
        task.sourceTaskId !== null || task.recurringRuleId !== null ||
        task.sourceRecurringRuleId !== null || task.recurrenceOccurrenceDate !== null) {
      throw new Error('Expected a new independent Inbox task from the Brain Dump.');
    }
    return task;
  }, { ...options, method: 'POST', body: undefined });
}
