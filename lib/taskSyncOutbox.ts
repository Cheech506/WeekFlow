/** Save offline task changes and their upload records in one transaction. */

import type { ApiTask, CreateApiTaskInput, UpdateApiTaskInput } from './api/taskApi';
import { withTaskSyncTransaction, type TaskSyncDatabase } from './taskSyncDatabase';
import {
    taskWorkingCopy,
    type CachedSyncTask,
    type TaskSyncCreatePayload,
    type TaskSyncOperation,
    type TaskSyncOutboxState,
    type TaskSyncUpdatePayload,
    type TaskSyncWorkingCopy,
} from './taskSyncTypes';

export type OfflineTaskCreateInput = Omit<CreateApiTaskInput, 'recurringRuleId' | 'recurrenceOccurrenceDate'>;
export type OfflineTaskUpdateInput = UpdateApiTaskInput;

type CacheRow = {
  local_id: number; scope_key: string; server_id: number | null; client_task_key: string;
  working_json: string; server_snapshot_json: string | null; local_revision: number;
  is_deleted: number; created_at: string; updated_at: string; last_synced_at: string | null;
};
type OutboxRow = {
  operation_key: string; local_task_id: number; action: string; state: string;
  payload_json: string; base_snapshot_json: string | null; local_revision: number;
  attempt_count: number; created_at: string; updated_at: string;
  last_attempt_at: string | null; last_error: string | null; conflict_json: string | null;
};
type LoadedTask = { row: CacheRow; task: CachedSyncTask; operation: TaskSyncOperation | null };

const EDIT_FIELDS = ['title', 'dueDate', 'notes', 'priority', 'goalId'] as const;
const WORKING_FIELDS = [
  ...EDIT_FIELDS, 'day', 'completed', 'createdAt', 'completedAt', 'recurringRuleId',
  'sourceTaskId', 'sourceGoalId', 'sourceRecurringRuleId', 'recurrenceOccurrenceDate',
] as const;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATES = new Set(['pending', 'sending', 'uncertain', 'conflict', 'rejected']);

function invalid(): never {
  throw new Error('Invalid task-sync data. Existing local work was preserved.');
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function nativeId(value: unknown): value is number {
  return positive(value) && value <= 2_147_483_647;
}
function key(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}
function dateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10));
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 &&
    d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && dateKey(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}
function nullable(value: unknown, check: (candidate: unknown) => boolean): boolean {
  return value === null || check(value);
}
function parse(value: string): unknown {
  try { return JSON.parse(value); } catch { return invalid(); }
}
function validateWorking(value: unknown): TaskSyncWorkingCopy {
  if (!object(value) || Object.keys(value).length !== WORKING_FIELDS.length ||
      !WORKING_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field)) ||
      typeof value.title !== 'string' || !value.title.trim() ||
      typeof value.day !== 'string' || ![...DAYS, 'Inbox'].includes(value.day) ||
      !nullable(value.dueDate, dateKey) || !nullable(value.notes, (v) => typeof v === 'string') ||
      ![0, 1, 2].includes(value.priority as number) || typeof value.completed !== 'boolean' ||
      !timestamp(value.createdAt) || !nullable(value.completedAt, timestamp) ||
      !nullable(value.goalId, nativeId) || !nullable(value.recurringRuleId, nativeId) ||
      !nullable(value.sourceTaskId, positive) || !nullable(value.sourceGoalId, positive) ||
      !nullable(value.sourceRecurringRuleId, positive) || !nullable(value.recurrenceOccurrenceDate, dateKey) ||
      (value.recurringRuleId !== null || value.sourceRecurringRuleId !== null) !== (value.recurrenceOccurrenceDate !== null)) return invalid();
  return Object.fromEntries(WORKING_FIELDS.map((field) => [field, value[field]])) as TaskSyncWorkingCopy;
}
function validateSnapshot(value: unknown): ApiTask {
  if (!object(value) || !nativeId(value.id)) return invalid();
  const { id, ...working } = value;
  return { id, ...validateWorking(working) };
}
function sameWorking(left: TaskSyncWorkingCopy, right: TaskSyncWorkingCopy): boolean {
  return WORKING_FIELDS.every((field) => left[field] === right[field]);
}
function scopeKey(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Scope key must not be blank.');
  return value.trim();
}
function localId(value: number): number {
  if (!positive(value)) throw new Error('Local task ID must be a positive safe integer.');
  return value;
}
async function requireScope(db: TaskSyncDatabase, scope: string): Promise<void> {
  if (!await db.getFirstAsync('SELECT scope_key FROM task_sync_scopes WHERE scope_key = ?', [scope])) {
    throw new Error('Unknown task-sync scope. Connect to the intended server and owner first.');
  }
}

/** Normalize only ordinary editable fields; forbid source IDs and server metadata. */
function normalizeInput(value: unknown, create: boolean): OfflineTaskUpdateInput {
  const allowed = create ? EDIT_FIELDS : [...EDIT_FIELDS, 'completed'];
  if (!object(value) || Object.keys(value).some((field) => !(allowed as readonly string[]).includes(field))) {
    throw new Error('Offline task input contains unsupported fields.');
  }
  const output: OfflineTaskUpdateInput = {};
  if (create || value.title !== undefined) {
    if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('Task title must not be blank.');
    output.title = value.title.trim();
  }
  if (value.dueDate !== undefined) {
    if (!nullable(value.dueDate, dateKey)) throw new Error('dueDate must be a real YYYY-MM-DD date or null.');
    output.dueDate = value.dueDate as string | null;
  }
  if (value.notes !== undefined) {
    if (value.notes !== null && typeof value.notes !== 'string') throw new Error('Task notes must be text or null.');
    output.notes = typeof value.notes === 'string' ? value.notes.trim() || null : null;
  }
  if (value.priority !== undefined) {
    if (![0, 1, 2].includes(value.priority as number)) throw new Error('Task priority must be 0, 1, or 2.');
    output.priority = value.priority as number;
  }
  if (value.goalId !== undefined) {
    if (!nullable(value.goalId, nativeId)) throw new Error('goalId must be a native PostgreSQL ID or null.');
    output.goalId = value.goalId as number | null;
  }
  if (!create && value.completed !== undefined) {
    if (typeof value.completed !== 'boolean') throw new Error('completed must be a boolean.');
    output.completed = value.completed;
  }
  return output;
}
function dayFor(dueDate: string | null): string {
  return dueDate === null ? 'Inbox' : DAYS[new Date(`${dueDate}T00:00:00Z`).getUTCDay()];
}
function createPayload(working: TaskSyncWorkingCopy): TaskSyncCreatePayload {
  const fields = {
    title: working.title, dueDate: working.dueDate, notes: working.notes,
    priority: working.priority, goalId: working.goalId, createdAt: working.createdAt,
  };
  if (working.completed) {
    if (!timestamp(working.completedAt)) return invalid();
    return { ...fields, completed: true, completedAt: working.completedAt };
  }
  return { ...fields, completed: false, completedAt: null };
}
function updatePayload(working: TaskSyncWorkingCopy, base: ApiTask): TaskSyncUpdatePayload {
  const output: OfflineTaskUpdateInput = {};
  if (working.title !== base.title) output.title = working.title;
  if (working.dueDate !== base.dueDate) output.dueDate = working.dueDate;
  if (working.notes !== base.notes) output.notes = working.notes;
  if (working.priority !== base.priority) output.priority = working.priority;
  if (working.goalId !== base.goalId) output.goalId = working.goalId;
  const { completed: _unused, ...fields } = output;
  if (working.completed !== base.completed || working.completedAt !== base.completedAt) {
    if (!working.completed) return { ...fields, completed: false, completedAt: null };
    if (!timestamp(working.completedAt)) return invalid();
    return { ...fields, completed: true, completedAt: working.completedAt };
  }
  return fields;
}
function validatePayload(value: unknown, action: string): void {
  if (!object(value)) return invalid();
  if (action === 'delete') {
    if (Object.keys(value).length !== 0) return invalid();
    return;
  }
  const allowed = action === 'create'
    ? [...EDIT_FIELDS, 'createdAt', 'completed', 'completedAt']
    : [...EDIT_FIELDS, 'completed', 'completedAt'];
  if (Object.keys(value).some((field) => !allowed.includes(field))) return invalid();
  const editable = Object.fromEntries(Object.entries(value).filter(([field]) => (EDIT_FIELDS as readonly string[]).includes(field)));
  // Validate without normalizing away bad stored values.
  const normalized = normalizeInput(editable, action === 'create');
  if (Object.entries(editable).some(([field, entry]) => entry !== normalized[field as keyof typeof normalized])) return invalid();
  const hasCompletion = Object.prototype.hasOwnProperty.call(value, 'completed');
  const hasTime = Object.prototype.hasOwnProperty.call(value, 'completedAt');
  if (hasCompletion !== hasTime || (action === 'create' && (!hasCompletion || !timestamp(value.createdAt)))) return invalid();
  if (hasCompletion && !(value.completed === true ? timestamp(value.completedAt) : value.completed === false && value.completedAt === null)) return invalid();
  if (action === 'update' && Object.keys(value).length === 0) return invalid();
}
/** An operation at the current revision must describe that exact local edit. */
function checkCurrentOperation(operation: TaskSyncOperation, cached: CachedSyncTask): TaskSyncOperation {
  if (operation.localRevision !== cached.localRevision) return operation;
  if (cached.isDeleted !== (operation.action === 'delete')) return invalid();
  const expected = operation.action === 'create' ? createPayload(cached.workingCopy)
    : operation.action === 'update' ? updatePayload(cached.workingCopy, operation.baseSnapshot) : {};
  const actual = new Map(Object.entries(operation.payload));
  const fields = Object.entries(expected);
  if (fields.length !== actual.size || fields.some(([field, value]) => actual.get(field) !== value)) return invalid();
  return operation;
}
function operationFromRow(row: OutboxRow, cached: CachedSyncTask): TaskSyncOperation {
  if (!key(row.operation_key) || row.local_task_id !== cached.localId || !STATES.has(row.state) ||
      !positive(row.local_revision) || row.local_revision > cached.localRevision ||
      !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 ||
      !timestamp(row.created_at) || !timestamp(row.updated_at) || !nullable(row.last_attempt_at, timestamp) ||
      !nullable(row.last_error, (v) => typeof v === 'string') ||
      !['create', 'update', 'delete'].includes(row.action)) return invalid();
  const payload = parse(row.payload_json);
  validatePayload(payload, row.action);
  const conflict = row.conflict_json === null ? null : parse(row.conflict_json);
  if (conflict !== null && !object(conflict)) return invalid();
  const meta = {
    operationKey: row.operation_key, scopeKey: cached.scopeKey, localTaskId: cached.localId,
    clientTaskKey: cached.clientTaskKey, state: row.state as TaskSyncOutboxState,
    localRevision: row.local_revision, attemptCount: row.attempt_count,
    createdAt: row.created_at, updatedAt: row.updated_at, lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error, conflict,
  };
  if (row.action === 'create') {
    if (cached.serverId !== null || cached.serverSnapshot !== null || row.base_snapshot_json !== null) return invalid();
    return checkCurrentOperation({ ...meta, action: 'create', serverId: null, baseSnapshot: null, payload: payload as TaskSyncCreatePayload }, cached);
  }
  const base = row.base_snapshot_json === null ? null : validateSnapshot(parse(row.base_snapshot_json));
  if (cached.serverId === null || !base || base.id !== cached.serverId || !cached.serverSnapshot ||
      !sameWorking(taskWorkingCopy(base), taskWorkingCopy(cached.serverSnapshot))) return invalid();
  return checkCurrentOperation(row.action === 'delete'
    ? { ...meta, action: 'delete', serverId: cached.serverId, baseSnapshot: base, payload: {} }
    : { ...meta, action: 'update', serverId: cached.serverId, baseSnapshot: base, payload: payload as TaskSyncUpdatePayload }, cached);
}
async function loadTask(db: TaskSyncDatabase, scope: string, id: number): Promise<LoadedTask> {
  const row = await db.getFirstAsync<CacheRow>('SELECT * FROM task_sync_cache WHERE scope_key = ? AND local_id = ?', [scope, id]);
  if (!row) throw new Error('Task was not found in this server/owner cache.');
  const workingCopy = validateWorking(parse(row.working_json));
  const snapshot = row.server_snapshot_json === null ? null : validateSnapshot(parse(row.server_snapshot_json));
  const queued = await db.getFirstAsync<OutboxRow>('SELECT * FROM task_sync_outbox WHERE local_task_id = ?', [id]);
  if (!key(row.client_task_key) || !Number.isSafeInteger(row.local_revision) || row.local_revision < 0 ||
      ![0, 1].includes(row.is_deleted) || !timestamp(row.created_at) || !timestamp(row.updated_at) ||
      !nullable(row.last_synced_at, timestamp) ||
      (row.server_id === null ? snapshot !== null : !nativeId(row.server_id) || snapshot?.id !== row.server_id)) return invalid();
  if (!queued && (!snapshot || row.is_deleted !== 0 || !sameWorking(workingCopy, taskWorkingCopy(snapshot)))) return invalid();
  const task: CachedSyncTask = {
    localId: row.local_id, scopeKey: row.scope_key, serverId: row.server_id,
    clientTaskKey: row.client_task_key, workingCopy, serverSnapshot: snapshot,
    localRevision: row.local_revision, isDeleted: row.is_deleted === 1,
    status: queued ? queued.state as TaskSyncOutboxState : 'synced',
    cachedAt: row.created_at, updatedAt: row.updated_at, lastSyncedAt: row.last_synced_at,
  };
  return { row, task, operation: queued ? operationFromRow(queued, task) : null };
}
function nextRevision(task: CachedSyncTask): number {
  if (task.localRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Task revision limit reached.');
  return task.localRevision + 1;
}
function canReplace(operation: TaskSyncOperation | null): boolean {
  return operation === null || (operation.state === 'pending' && operation.attemptCount === 0 && operation.lastAttemptAt === null);
}

/** Replace only a never-attempted request; changed content receives a fresh key. */
async function replaceOperation(
  db: TaskSyncDatabase, task: CachedSyncTask, working: TaskSyncWorkingCopy,
  revision: number, deleted: boolean, now: string
): Promise<void> {
  await db.runAsync('DELETE FROM task_sync_outbox WHERE local_task_id = ?', [task.localId]);
  const base = task.serverSnapshot;
  const action = base === null ? 'create' : deleted ? 'delete' : 'update';
  const payload = base === null ? createPayload(working) : deleted ? {} : updatePayload(working, base);
  if (action === 'update' && Object.keys(payload).length === 0) return;
  await db.runAsync(`INSERT INTO task_sync_outbox
    (local_task_id, action, payload_json, base_snapshot_json, local_revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [task.localId, action, JSON.stringify(payload), base === null ? null : JSON.stringify(base), revision, now, now]);
}

/**
 * Only the future online-first storage layer should call these save functions
 * after deciding an action belongs offline. They never test connectivity or
 * send requests. A timed-out API write must be reconciled before retrying it.
 */
export async function createOfflineTask(scope: string, input: OfflineTaskCreateInput): Promise<CachedSyncTask> {
  const selectedScope = scopeKey(scope);
  const fields = normalizeInput(input, true);
  // Capture when the user acted, rather than when the upload eventually runs.
  const now = new Date().toISOString();
  const working: TaskSyncWorkingCopy = {
    title: fields.title!, dueDate: fields.dueDate ?? null, notes: fields.notes ?? null,
    priority: fields.priority ?? 0, goalId: fields.goalId ?? null,
    day: dayFor(fields.dueDate ?? null), completed: false, completedAt: null, createdAt: now,
    recurringRuleId: null, recurrenceOccurrenceDate: null,
    sourceTaskId: null, sourceGoalId: null, sourceRecurringRuleId: null,
  };
  return withTaskSyncTransaction(async (db) => {
    await requireScope(db, selectedScope);
    const result = await db.runAsync(`INSERT INTO task_sync_cache
      (scope_key, working_json, local_revision, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)`, [selectedScope, JSON.stringify(working), now, now]);
    const id = result.lastInsertRowId;
    await db.runAsync(`INSERT INTO task_sync_outbox
      (local_task_id, action, payload_json, local_revision, created_at, updated_at)
      VALUES (?, 'create', ?, 1, ?, ?)`, [id, JSON.stringify(createPayload(working)), now, now]);
    return (await loadTask(db, selectedScope, id)).task;
  });
}

/** Save an edit and coalesce unattempted changes against the confirmed baseline. */
export async function updateOfflineTask(scope: string, id: number, input: OfflineTaskUpdateInput): Promise<CachedSyncTask> {
  const selectedScope = scopeKey(scope), selectedId = localId(id);
  const fields = normalizeInput(input, false);
  const now = new Date().toISOString();
  return withTaskSyncTransaction(async (db) => {
    await requireScope(db, selectedScope);
    const loaded = await loadTask(db, selectedScope, selectedId);
    const current = loaded.task;
    if (current.isDeleted) throw new Error('This task is pending deletion and cannot be edited.');
    const working = { ...current.workingCopy, ...fields };
    if (fields.dueDate !== undefined) working.day = dayFor(fields.dueDate);
    if (fields.completed !== undefined && fields.completed !== current.workingCopy.completed) {
      working.completedAt = fields.completed ? now : null;
    }
    if (fields.goalId !== undefined && fields.goalId !== current.workingCopy.goalId) {
      // A native link is enough offline. Do not invent SQLite source metadata.
      working.sourceGoalId = fields.goalId === current.serverSnapshot?.goalId ? current.serverSnapshot.sourceGoalId : null;
    }
    if (sameWorking(working, current.workingCopy)) return current;
    const revision = nextRevision(current);
    await db.runAsync(`UPDATE task_sync_cache SET working_json = ?, local_revision = ?, updated_at = ?
      WHERE local_id = ? AND scope_key = ?`, [JSON.stringify(working), revision, now, selectedId, selectedScope]);
    if (canReplace(loaded.operation)) {
      await replaceOperation(db, current, working, revision, false, now);
    }
    // Attempted/sending/uncertain/conflict/rejected requests remain frozen.
    // Their older revision lets the future acknowledgement handler detect and
    // queue this newer edit after reconciling the original request.
    return (await loadTask(db, selectedScope, selectedId)).task;
  });
}

/** Hide server tasks until deletion is confirmed; cancel unsent local creates. */
export async function deleteOfflineTask(scope: string, id: number): Promise<void> {
  const selectedScope = scopeKey(scope), selectedId = localId(id);
  const now = new Date().toISOString();
  await withTaskSyncTransaction(async (db) => {
    await requireScope(db, selectedScope);
    const loaded = await loadTask(db, selectedScope, selectedId);
    const current = loaded.task;
    if (current.isDeleted) return;
    if (current.serverId === null && canReplace(loaded.operation)) {
      await db.runAsync('DELETE FROM task_sync_outbox WHERE local_task_id = ?', [selectedId]);
      await db.runAsync('DELETE FROM task_sync_cache WHERE scope_key = ? AND local_id = ?', [selectedScope, selectedId]);
      return;
    }
    const revision = nextRevision(current);
    await db.runAsync(`UPDATE task_sync_cache SET is_deleted = 1, local_revision = ?, updated_at = ?
      WHERE local_id = ? AND scope_key = ?`, [revision, now, selectedId, selectedScope]);
    if (canReplace(loaded.operation)) {
      await replaceOperation(db, current, current.workingCopy, revision, true, now);
    }
  });
}

/** Read pending AND blocked operations. Reading never starts an upload. */
export async function readTaskSyncOperations(scope: string): Promise<TaskSyncOperation[]> {
  const selectedScope = scopeKey(scope);
  return withTaskSyncTransaction(async (db) => {
    await requireScope(db, selectedScope);
    const rows = await db.getAllAsync<{ local_task_id: number }>(`
      SELECT o.local_task_id FROM task_sync_outbox AS o
      JOIN task_sync_cache AS c ON c.local_id = o.local_task_id
      WHERE c.scope_key = ? ORDER BY o.created_at, o.operation_key
    `, [selectedScope]);
    const result: TaskSyncOperation[] = [];
    for (const row of rows) {
      const loaded = await loadTask(db, selectedScope, row.local_task_id);
      if (!loaded.operation) return invalid();
      result.push(loaded.operation);
    }
    return result;
  });
}
