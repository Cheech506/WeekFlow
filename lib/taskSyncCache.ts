/** Store confirmed server tasks without overwriting pending local work. */

import type { ApiTask } from './api/taskApi';
import { withTaskSyncTransaction, type TaskSyncDatabase } from './taskSyncDatabase';
import {
    taskWorkingCopy,
    type CachedSyncTask,
    type TaskSyncScope,
    type TaskSyncStatus,
    type TaskSyncWorkingCopy,
} from './taskSyncTypes';

type ScopeRow = {
  scope_key: string; base_url: string; server_instance_key: string; owner_key: string;
  created_at: string; last_download_at: string | null; last_upload_at: string | null;
};

type CacheRow = {
  local_id: number; scope_key: string; server_id: number | null; client_task_key: string;
  working_json: string; server_snapshot_json: string | null; local_revision: number;
  is_deleted: number; created_at: string; updated_at: string; last_synced_at: string | null;
  outbox_state: string | null;
};

export type TaskSyncScopeInput = {
  baseUrl: string;
  /** A stable identity returned by the backend, never an invented URL alias. */
  serverInstanceKey: string;
  ownerKey?: string;
};

export type TaskCacheMergeResult = {
  saved: number;
  /** These tasks keep their working copy, baseline, revision, and queue entry. */
  protectedLocalIds: number[];
};

const SELECT_CACHE = `
  SELECT c.*, o.state AS outbox_state
  FROM task_sync_cache AS c
  LEFT JOIN task_sync_outbox AS o ON o.local_task_id = c.local_id
`;
const WORKING_FIELDS = [
  'title', 'day', 'dueDate', 'notes', 'priority', 'completed', 'createdAt',
  'completedAt', 'goalId', 'recurringRuleId', 'sourceTaskId', 'sourceGoalId',
  'sourceRecurringRuleId', 'recurrenceOccurrenceDate',
] as const;
const DAYS = new Set(['Inbox', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const STATUSES = new Set(['pending', 'sending', 'uncertain', 'conflict', 'rejected']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function serverId(value: unknown): value is number {
  return positiveInteger(value) && value <= 2_147_483_647;
}
function dateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= lengths[month - 1];
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && dateKey(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}
function nonblank(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must not be blank.`);
  return value.trim();
}
function nullable<T>(value: unknown, check: (candidate: unknown) => candidate is T): value is T | null {
  return value === null || check(value);
}
function corrupt(): never {
  throw new Error('Invalid task-cache data. No local work was discarded; repair is required before continuing.');
}

/** SQLite checks JSON shape; validate its actual fields before returning it. */
function decodeWorking(value: unknown): TaskSyncWorkingCopy {
  if (!record(value) || Object.keys(value).length !== WORKING_FIELDS.length ||
      !WORKING_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
      typeof value.title !== 'string' || !value.title.trim() ||
      typeof value.day !== 'string' || !DAYS.has(value.day) ||
      !nullable(value.dueDate, dateKey) ||
      !(value.notes === null || typeof value.notes === 'string') ||
      typeof value.priority !== 'number' || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > 2 ||
      typeof value.completed !== 'boolean' || !timestamp(value.createdAt) ||
      !nullable(value.completedAt, timestamp) ||
      !nullable(value.goalId, serverId) || !nullable(value.recurringRuleId, serverId) ||
      !nullable(value.sourceTaskId, positiveInteger) || !nullable(value.sourceGoalId, positiveInteger) ||
      !nullable(value.sourceRecurringRuleId, positiveInteger) || !nullable(value.recurrenceOccurrenceDate, dateKey)) {
    return corrupt();
  }
  const hasRule = value.recurringRuleId !== null || value.sourceRecurringRuleId !== null;
  if (hasRule !== (value.recurrenceOccurrenceDate !== null)) return corrupt();
  // The checks above cover every field. Copy only the known, primitive fields.
  return Object.fromEntries(WORKING_FIELDS.map((key) => [key, value[key]])) as TaskSyncWorkingCopy;
}
function decodeTask(value: unknown): ApiTask {
  if (!record(value) || !serverId(value.id)) return corrupt();
  const { id, ...working } = value;
  return { id, ...decodeWorking(working) };
}
function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return corrupt(); }
}
function sameWorking(left: TaskSyncWorkingCopy, right: TaskSyncWorkingCopy): boolean {
  return WORKING_FIELDS.every((field) => left[field] === right[field]);
}
function mapScope(row: ScopeRow): TaskSyncScope {
  return {
    scopeKey: row.scope_key, baseUrl: row.base_url,
    serverInstanceKey: row.server_instance_key, ownerKey: row.owner_key,
    createdAt: row.created_at, lastDownloadAt: row.last_download_at, lastUploadAt: row.last_upload_at,
  };
}
function mapCached(row: CacheRow): CachedSyncTask {
  const workingCopy = decodeWorking(parseJson(row.working_json));
  const snapshot = row.server_snapshot_json === null ? null : decodeTask(parseJson(row.server_snapshot_json));
  if (!positiveInteger(row.local_id) || !Number.isSafeInteger(row.local_revision) || row.local_revision < 0 ||
      !/^[0-9a-f]{32}$/.test(row.client_task_key) || !timestamp(row.created_at) || !timestamp(row.updated_at) ||
      !nullable(row.last_synced_at, timestamp) || ![0, 1].includes(row.is_deleted) ||
      (row.server_id === null ? snapshot !== null : !serverId(row.server_id) || snapshot?.id !== row.server_id) ||
      (row.outbox_state !== null && !STATUSES.has(row.outbox_state))) return corrupt();
  if (row.outbox_state === null &&
      (snapshot === null || row.is_deleted !== 0 || !sameWorking(workingCopy, taskWorkingCopy(snapshot)))) {
    // Untracked edits must never be silently replaced by a server download.
    return corrupt();
  }
  return {
    localId: row.local_id, scopeKey: row.scope_key, serverId: row.server_id,
    clientTaskKey: row.client_task_key, workingCopy, serverSnapshot: snapshot,
    localRevision: row.local_revision, isDeleted: row.is_deleted === 1,
    status: (row.outbox_state ?? 'synced') as TaskSyncStatus,
    cachedAt: row.created_at, updatedAt: row.updated_at, lastSyncedAt: row.last_synced_at,
  };
}
async function requireScope(db: TaskSyncDatabase, scopeKey: string): Promise<ScopeRow> {
  const row = await db.getFirstAsync<ScopeRow>('SELECT * FROM task_sync_scopes WHERE scope_key = ?', [scopeKey]);
  if (!row) throw new Error('Unknown task-sync scope. Connect to the intended server and owner first.');
  return row;
}

/** Reuse a scope only when URL, backend identity, and owner all match. */
export async function getOrCreateTaskSyncScope(input: TaskSyncScopeInput): Promise<TaskSyncScope> {
  const rawUrl = nonblank(input.baseUrl, 'API URL');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('API URL must be an absolute HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      rawUrl.includes('?') || rawUrl.includes('#')) {
    throw new Error('API URL must use HTTP or HTTPS without credentials, a query, or a fragment.');
  }
  const baseUrl = url.toString().replace(/\/+$/, '');
  const instance = nonblank(input.serverInstanceKey, 'Server identity');
  const owner = nonblank(input.ownerKey ?? 'single-owner', 'Owner identity');
  return withTaskSyncTransaction(async (db) => {
    await db.runAsync(`
      INSERT INTO task_sync_scopes (scope_key, base_url, server_instance_key, owner_key, created_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)
      ON CONFLICT (base_url, server_instance_key, owner_key) DO NOTHING
    `, [baseUrl, instance, owner, new Date().toISOString()]);
    const row = await db.getFirstAsync<ScopeRow>(`
      SELECT * FROM task_sync_scopes WHERE base_url = ? AND server_instance_key = ? AND owner_key = ?
    `, [baseUrl, instance, owner]);
    if (!row) throw new Error('Could not register the task-sync scope.');
    return mapScope(row);
  });
}

export async function getTaskSyncScope(scopeKey: string): Promise<TaskSyncScope> {
  const key = nonblank(scopeKey, 'Scope key');
  return withTaskSyncTransaction(async (db) => mapScope(await requireScope(db, key)));
}

/** Merge downloads only. A partial/filtered response never implies deletion. */
export async function cacheDownloadedTasks(
  scopeKey: string,
  tasks: readonly ApiTask[]
): Promise<TaskCacheMergeResult> {
  const key = nonblank(scopeKey, 'Scope key');
  if (!Array.isArray(tasks)) throw new Error('Downloaded tasks must be a list.');
  // Validate and copy before waiting for SQLite, so caller mutations cannot
  // change the batch while another cache operation is finishing.
  const batch = tasks.map(decodeTask);
  if (new Set(batch.map((task) => task.id)).size !== batch.length) {
    throw new Error('Downloaded tasks contain duplicate PostgreSQL IDs.');
  }
  return withTaskSyncTransaction(async (db) => {
    await requireScope(db, key);
    const now = new Date().toISOString();
    const result: TaskCacheMergeResult = { saved: 0, protectedLocalIds: [] };
    for (const task of batch) {
      const row = await db.getFirstAsync<CacheRow>(`${SELECT_CACHE} WHERE c.scope_key = ? AND c.server_id = ?`, [key, task.id]);
      if (row) {
        const existing = mapCached(row);
        if (existing.status !== 'synced') {
          result.protectedLocalIds.push(existing.localId);
          continue;
        }
        // UPDATE preserves local_id, client_task_key, revision and cached_at.
        await db.runAsync(`
          UPDATE task_sync_cache SET working_json = ?, server_snapshot_json = ?, updated_at = ?, last_synced_at = ?
          WHERE local_id = ? AND scope_key = ?
        `, [JSON.stringify(taskWorkingCopy(task)), JSON.stringify(task), now, now, existing.localId, key]);
      } else {
        await db.runAsync(`
          INSERT INTO task_sync_cache
            (scope_key, server_id, working_json, server_snapshot_json, created_at, updated_at, last_synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [key, task.id, JSON.stringify(taskWorkingCopy(task)), JSON.stringify(task), now, now, now]);
      }
      result.saved += 1;
    }
    // This means a batch was received, not that the entire server is cached
    // or that protected tasks have been reconciled.
    await db.runAsync('UPDATE task_sync_scopes SET last_download_at = ? WHERE scope_key = ?', [now, key]);
    return result;
  });
}

/** Read one task by its LOCAL cache ID, always within its selected scope. */
export async function readCachedTask(scopeKey: string, localId: number): Promise<CachedSyncTask | null> {
  const key = nonblank(scopeKey, 'Scope key');
  if (!positiveInteger(localId)) throw new Error('Local cache ID must be a positive safe integer.');
  return withTaskSyncTransaction(async (db) => {
    await requireScope(db, key);
    const row = await db.getFirstAsync<CacheRow>(`${SELECT_CACHE} WHERE c.scope_key = ? AND c.local_id = ?`, [key, localId]);
    return row ? mapCached(row) : null;
  });
}

/** Deleted tasks stay stored for upload/reconciliation but are normally hidden. */
export async function readCachedTasks(
  scopeKey: string,
  options: { includeDeleted?: boolean } = {}
): Promise<CachedSyncTask[]> {
  const key = nonblank(scopeKey, 'Scope key');
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== 'boolean') {
    throw new Error('includeDeleted must be a boolean.');
  }
  return withTaskSyncTransaction(async (db) => {
    await requireScope(db, key);
    const rows = await db.getAllAsync<CacheRow>(`
      ${SELECT_CACHE} WHERE c.scope_key = ? AND (? = 1 OR c.is_deleted = 0) ORDER BY c.local_id
    `, [key, options.includeDeleted ? 1 : 0]);
    return rows.map(mapCached);
  });
}
