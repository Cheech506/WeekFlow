/** Offline task changes use isolated in-memory SQLite, never the API. */
import type * as SQLite from 'expo-sqlite';
import type { ApiTask } from '../../lib/api/taskApi';
import type { TaskSyncDatabase } from '../../lib/taskSyncDatabase';
import type { CachedSyncTask, TaskSyncScope } from '../../lib/taskSyncTypes';

type OutboxModule = typeof import('../../lib/taskSyncOutbox');
type CacheModule = typeof import('../../lib/taskSyncCache');
type DatabaseModule = typeof import('../../lib/taskSyncDatabase');
let outbox: OutboxModule, cache: CacheModule, database: DatabaseModule;
let opened: TaskSyncDatabase[];
let fetchSpy: jest.SpyInstance;
let scope: TaskSyncScope;
const STAMP = '2026-10-21T12:00:00Z';

function serverTask(overrides: Partial<ApiTask> = {}): ApiTask {
  return {
    id: 401, title: 'Server task', day: 'Inbox', dueDate: null, notes: null,
    priority: 0, completed: false, createdAt: STAMP, completedAt: null,
    goalId: 7, recurringRuleId: null, sourceTaskId: 1781204320001,
    sourceGoalId: 1781204320002, sourceRecurringRuleId: null,
    recurrenceOccurrenceDate: null, ...overrides,
  };
}
async function download(overrides: Partial<ApiTask> = {}): Promise<CachedSyncTask> {
  await cache.cacheDownloadedTasks(scope.scopeKey, [serverTask(overrides)]);
  return (await cache.readCachedTasks(scope.scopeKey))[0];
}
async function queued() { return outbox.readTaskSyncOperations(scope.scopeKey); }
async function raw(table: 'task_sync_cache' | 'task_sync_outbox' | 'task_sync_scopes') {
  return database.withTaskSyncTransaction((db) => db.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid`));
}
async function setState(state: string, attempted = true) {
  await database.withTaskSyncTransaction((db) => db.runAsync(`UPDATE task_sync_outbox
    SET state = ?, attempt_count = ?, last_attempt_at = ?`, [state, attempted ? 1 : 0, attempted ? STAMP : null]));
}

beforeEach(async () => {
  jest.resetModules();
  opened = [];
  const sqlite = jest.requireActual<typeof SQLite>('expo-sqlite');
  const original = sqlite.openDatabaseAsync.bind(sqlite);
  jest.spyOn(sqlite, 'openDatabaseAsync').mockImplementation(async (...args) => {
    const db = await original(...args); opened.push(db); return db;
  });
  fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('No API access in outbox tests'));
  database = await import('../../lib/taskSyncDatabase');
  cache = await import('../../lib/taskSyncCache');
  outbox = await import('../../lib/taskSyncOutbox');
  scope = await cache.getOrCreateTaskSyncScope({ baseUrl: 'http://localhost:8000', serverInstanceKey: 'server-one' });
});
afterEach(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); }
  finally {
    jest.restoreAllMocks();
    for (const db of opened) await db.closeAsync();
  }
});

test('creates a local task and upload record together with separate stable identities', async () => {
  const task = await outbox.createOfflineTask(scope.scopeKey, { title: ' Offline task ', notes: ' ', dueDate: '2026-10-22', priority: 2, goalId: 7 });
  expect(task).toMatchObject({ serverId: null, serverSnapshot: null, localRevision: 1, status: 'pending', isDeleted: false });
  expect(task.workingCopy).toMatchObject({ title: 'Offline task', notes: null, dueDate: '2026-10-22', day: 'Thursday', priority: 2, goalId: 7, completed: false, completedAt: null, sourceTaskId: null, sourceGoalId: null });
  const [operation] = await queued();
  expect(operation).toMatchObject({ action: 'create', localTaskId: task.localId, clientTaskKey: task.clientTaskKey, serverId: null, baseSnapshot: null, state: 'pending', localRevision: 1, attemptCount: 0 });
  expect(operation.payload).toEqual({ title: 'Offline task', notes: null, dueDate: '2026-10-22', priority: 2, goalId: 7, createdAt: task.workingCopy.createdAt, completed: false, completedAt: null });
  expect(operation.operationKey).toMatch(/^[0-9a-f]{32}$/);
  expect(operation.operationKey).not.toBe(task.clientTaskKey);
  expect((await cache.getTaskSyncScope(scope.scopeKey)).lastUploadAt).toBeNull();
});

test('uses defaults and handles years below 100 without a timezone weekday shift', async () => {
  const initial = await outbox.createOfflineTask(scope.scopeKey, { title: 'Defaults' });
  expect(initial.workingCopy).toMatchObject({ priority: 0, goalId: null, notes: null, dueDate: null, day: 'Inbox' });
  const dated = await outbox.updateOfflineTask(scope.scopeKey, initial.localId, { dueDate: '0001-01-01' });
  expect(dated.workingCopy.day).toBe('Monday');
});

test('coalesces edits to an unsent create while preserving client identity and action time', async () => {
  const created = await outbox.createOfflineTask(scope.scopeKey, { title: 'First' });
  const [original] = await queued();
  const edited = await outbox.updateOfflineTask(scope.scopeKey, created.localId, { title: 'Final', completed: true });
  const [operation] = await queued();
  expect(operation.action).toBe('create');
  expect(operation.operationKey).not.toBe(original.operationKey);
  expect(operation.clientTaskKey).toBe(original.clientTaskKey);
  expect(operation.payload).toMatchObject({ title: 'Final', completed: true, completedAt: edited.workingCopy.completedAt, createdAt: created.workingCopy.createdAt });
  expect(edited).toMatchObject({ localId: created.localId, clientTaskKey: created.clientTaskKey, localRevision: 2 });
  expect(await queued()).toHaveLength(1);
});

test('queues only changed fields using the original confirmed baseline', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Changed', notes: ' Note ' });
  const [first] = await queued();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { priority: 2 });
  const [second] = await queued();
  expect(second).toMatchObject({ action: 'update', serverId: 401, localRevision: 2, baseSnapshot: serverTask(), payload: { title: 'Changed', notes: 'Note', priority: 2 } });
  expect(second.operationKey).not.toBe(first.operationKey);
  expect(await queued()).toHaveLength(1);
  expect((await cache.readCachedTask(scope.scopeKey, task.localId))?.serverSnapshot).toEqual(serverTask());
});

test('preserves false, zero and explicit null and does not clear omitted fields', async () => {
  const task = await download({ priority: 2, notes: 'Old', dueDate: '2026-10-22', day: 'Thursday', completed: true, completedAt: STAMP });
  const edited = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { priority: 0, notes: null, goalId: null, dueDate: null, completed: false });
  expect(edited.workingCopy).toMatchObject({ title: 'Server task', priority: 0, notes: null, goalId: null, sourceGoalId: null, dueDate: null, day: 'Inbox', completed: false, completedAt: null });
  expect((await queued())[0].payload).toEqual({ priority: 0, notes: null, goalId: null, dueDate: null, completed: false, completedAt: null });
});

test('completion records offline action time and a repeated completion is a no-op', async () => {
  const task = await download();
  const completed = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { completed: true });
  expect(completed.workingCopy.completedAt).not.toBeNull();
  const before = await raw('task_sync_outbox');
  const again = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { completed: true });
  expect(again).toEqual(completed);
  expect(await raw('task_sync_outbox')).toEqual(before);
});

test('leaves unchanged legacy completion timestamps alone', async () => {
  const task = await download({ completed: true, completedAt: null });
  const again = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { completed: true });
  expect(again.workingCopy.completedAt).toBeNull();
  expect(await queued()).toEqual([]);
});

test('returning to the baseline removes an unsent update, including restored source goal metadata', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Changed', goalId: 8 });
  const restored = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Server task', goalId: 7 });
  expect(restored.status).toBe('synced');
  expect(restored.localRevision).toBe(2);
  expect(restored.workingCopy).toEqual(task.workingCopy);
  expect(await queued()).toEqual([]);
});

test('empty and normalized-identical updates leave revision and queue untouched', async () => {
  const task = await download();
  const before = await raw('task_sync_cache');
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, {});
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: ' Server task ', notes: undefined });
  expect(await raw('task_sync_cache')).toEqual(before);
  expect(await queued()).toEqual([]);
});

test.each(['pending', 'sending', 'uncertain', 'conflict', 'rejected'])('freezes an attempted %s operation while retaining a newer local edit', async (state) => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'First edit' });
  await setState(state);
  const before = await raw('task_sync_outbox');
  const edited = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Newer edit', completed: true });
  expect(edited).toMatchObject({ localRevision: 2, status: state, workingCopy: { title: 'Newer edit', completed: true } });
  expect(await raw('task_sync_outbox')).toEqual(before);
  expect((await queued())[0]).toMatchObject({ localRevision: 1, payload: { title: 'First edit' } });
});

test('an attempted operation stays frozen even if the UI returns to the original baseline', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Might have reached server' });
  await setState('uncertain');
  const before = await raw('task_sync_outbox');
  const restored = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Server task' });
  expect(restored.workingCopy).toEqual(task.workingCopy);
  expect(restored.localRevision).toBe(2);
  expect(await raw('task_sync_outbox')).toEqual(before);
});

test('deletes an unsent local create and its queue record together', async () => {
  const task = await outbox.createOfflineTask(scope.scopeKey, { title: 'Never uploaded' });
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { completed: true });
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  expect(await cache.readCachedTask(scope.scopeKey, task.localId)).toBeNull();
  expect(await queued()).toEqual([]);
});

test('an uncertain create stays queued and hidden until its server result can be reconciled', async () => {
  const task = await outbox.createOfflineTask(scope.scopeKey, { title: 'Possibly uploaded' });
  await setState('uncertain');
  const before = await raw('task_sync_outbox');
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  expect(await cache.readCachedTasks(scope.scopeKey)).toEqual([]);
  expect(await cache.readCachedTask(scope.scopeKey, task.localId)).toMatchObject({ isDeleted: true, localRevision: 2, serverId: null });
  expect(await raw('task_sync_outbox')).toEqual(before);
});

test('hides a server task and queues deletion without discarding history or baseline', async () => {
  const task = await download();
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  const [operation] = await queued();
  expect(operation).toMatchObject({ action: 'delete', serverId: 401, baseSnapshot: serverTask(), payload: {}, localRevision: 1 });
  expect(await cache.readCachedTasks(scope.scopeKey)).toEqual([]);
  expect(await cache.readCachedTask(scope.scopeKey, task.localId)).toMatchObject({ isDeleted: true, workingCopy: task.workingCopy, serverSnapshot: serverTask() });
  const before = await raw('task_sync_outbox');
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  expect(await raw('task_sync_outbox')).toEqual(before);
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Restore?' })).rejects.toThrow('pending deletion');
});

test('replaces an unsent update with one delete, retaining the confirmed baseline', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Unsent edit' });
  const [oldOperation] = await queued();
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  const [operation] = await queued();
  expect(operation).toMatchObject({ action: 'delete', baseSnapshot: serverTask(), localRevision: 2 });
  expect(operation.operationKey).not.toBe(oldOperation.operationKey);
  expect(await queued()).toHaveLength(1);
});

test('retains the attempted update during a newer local deletion', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Uncertain edit' });
  await setState('sending');
  const before = await raw('task_sync_outbox');
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  expect(await raw('task_sync_outbox')).toEqual(before);
  expect(await cache.readCachedTask(scope.scopeKey, task.localId)).toMatchObject({ isDeleted: true, localRevision: 2 });
});

test('a native recurring occurrence keeps its rule, original date, and historical goal metadata', async () => {
  const task = await download({ recurringRuleId: 3, sourceRecurringRuleId: 1781204320003, recurrenceOccurrenceDate: '2026-10-22' });
  const edited = await outbox.updateOfflineTask(scope.scopeKey, task.localId, { completed: true });
  expect(edited.workingCopy).toMatchObject({ recurringRuleId: 3, sourceRecurringRuleId: 1781204320003, recurrenceOccurrenceDate: '2026-10-22', goalId: 7, sourceGoalId: 1781204320002 });
  expect((await queued())[0].payload).toEqual({ completed: true, completedAt: edited.workingCopy.completedAt });
});

test('scope separation prevents editing, deleting, or listing another owner\'s queue', async () => {
  const created = await outbox.createOfflineTask(scope.scopeKey, { title: 'Private task' });
  const other = await cache.getOrCreateTaskSyncScope({ baseUrl: scope.baseUrl, serverInstanceKey: scope.serverInstanceKey, ownerKey: 'someone-else' });
  await expect(outbox.updateOfflineTask(other.scopeKey, created.localId, { title: 'Wrong scope' })).rejects.toThrow('not found');
  await expect(outbox.deleteOfflineTask(other.scopeKey, created.localId)).rejects.toThrow('not found');
  expect(await outbox.readTaskSyncOperations(other.scopeKey)).toEqual([]);
  expect((await queued())[0].payload).toMatchObject({ title: 'Private task' });
});

test('unknown scope cannot create a local task', async () => {
  await expect(outbox.createOfflineTask('missing', { title: 'No scope' })).rejects.toThrow('Unknown');
  expect(await raw('task_sync_cache')).toEqual([]);
});

test.each([
  { title: '' }, { title: 'Valid', sourceTaskId: 1781204320001 },
  { title: 'Valid', id: 1 }, { title: 'Valid', completed: true },
  { title: 'Valid', recurringRuleId: 3 }, { title: 'Valid', recurrenceOccurrenceDate: '2026-10-22' },
  { title: 'Valid', goalId: 1781204320002 }, { title: 'Valid', dueDate: '2026-02-29' },
  { title: 'Valid', priority: '2' }, { title: 'Valid', priority: 3 },
])('rejects invalid offline creation %j', async (input) => {
  await expect(outbox.createOfflineTask(scope.scopeKey, input as never)).rejects.toThrow();
  expect(await raw('task_sync_cache')).toEqual([]);
  expect(await queued()).toEqual([]);
});

test.each([
  { title: null }, { completed: null }, { completed: 1 }, { dueDate: '2026-04-31' },
  { goalId: 0 }, { goalId: 1781204320002 }, { createdAt: STAMP }, { completedAt: STAMP },
  { recurringRuleId: 1 }, { notes: 5 },
])('rejects invalid offline update %j without modifying data', async (input) => {
  const task = await download();
  const before = await raw('task_sync_cache');
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, input as never)).rejects.toThrow();
  expect(await raw('task_sync_cache')).toEqual(before);
  expect(await queued()).toEqual([]);
});

test('rolls back local creation if the queue insert fails and permits a later retry', async () => {
  await database.withTaskSyncTransaction((db) => db.execAsync(`CREATE TRIGGER fail_queue BEFORE INSERT ON task_sync_outbox
    BEGIN SELECT RAISE(ABORT, 'injected queue failure'); END;`));
  await expect(outbox.createOfflineTask(scope.scopeKey, { title: 'Must roll back' })).rejects.toThrow('injected');
  expect(await raw('task_sync_cache')).toEqual([]);
  await database.withTaskSyncTransaction((db) => db.execAsync('DROP TRIGGER fail_queue'));
  await expect(outbox.createOfflineTask(scope.scopeKey, { title: 'Retry' })).resolves.toMatchObject({ status: 'pending' });
});

test('rolls back edited cache and previous pending operation if replacement fails', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'First pending edit' });
  const beforeCache = await raw('task_sync_cache'), beforeQueue = await raw('task_sync_outbox');
  await database.withTaskSyncTransaction((db) => db.execAsync(`CREATE TRIGGER fail_queue BEFORE INSERT ON task_sync_outbox
    BEGIN SELECT RAISE(ABORT, 'injected queue failure'); END;`));
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Should roll back' })).rejects.toThrow('injected');
  expect(await raw('task_sync_cache')).toEqual(beforeCache);
  expect(await raw('task_sync_outbox')).toEqual(beforeQueue);
  await expect(outbox.deleteOfflineTask(scope.scopeKey, task.localId)).rejects.toThrow('injected');
  expect(await raw('task_sync_cache')).toEqual(beforeCache);
  expect(await raw('task_sync_outbox')).toEqual(beforeQueue);
});

test('rolls back queue cancellation if deleting a never-uploaded task fails', async () => {
  const task = await outbox.createOfflineTask(scope.scopeKey, { title: 'Keep if delete fails' });
  const beforeCache = await raw('task_sync_cache'), beforeQueue = await raw('task_sync_outbox');
  await database.withTaskSyncTransaction((db) => db.execAsync(`CREATE TRIGGER fail_delete BEFORE DELETE ON task_sync_cache
    BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END;`));
  await expect(outbox.deleteOfflineTask(scope.scopeKey, task.localId)).rejects.toThrow('injected');
  expect(await raw('task_sync_cache')).toEqual(beforeCache);
  expect(await raw('task_sync_outbox')).toEqual(beforeQueue);
});

test('serialized concurrent edits both survive in the merged pending request', async () => {
  const task = await download();
  await Promise.all([
    outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'First concurrent edit' }),
    outbox.updateOfflineTask(scope.scopeKey, task.localId, { priority: 2 }),
  ]);
  expect((await queued())[0]).toMatchObject({ localRevision: 2, payload: { title: 'First concurrent edit', priority: 2 } });
  expect(await queued()).toHaveLength(1);
});

test('incoming downloads cannot overwrite queued edits or their confirmed baseline', async () => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Keep my edit' });
  const before = await queued();
  expect(await cache.cacheDownloadedTasks(scope.scopeKey, [serverTask({ title: 'Changed on another device' })])).toEqual({ saved: 0, protectedLocalIds: [task.localId] });
  expect(await queued()).toEqual(before);
  expect((await cache.readCachedTask(scope.scopeKey, task.localId))?.workingCopy.title).toBe('Keep my edit');
});

test('copies input immediately and never changes caller-owned values', async () => {
  const input = { title: 'Original input' };
  const save = outbox.createOfflineTask(scope.scopeKey, input);
  input.title = 'Mutated after call';
  const created = await save;
  expect(created.workingCopy.title).toBe('Original input');
  const edit = { title: 'Captured edit' };
  const update = outbox.updateOfflineTask(scope.scopeKey, created.localId, edit);
  edit.title = 'Mutated later';
  expect((await update).workingCopy.title).toBe('Captured edit');
});

test.each([
  { payload_json: '{"source_task_id":2}' }, { payload_json: '{}' },
  { payload_json: '{"title":"Mismatched same-revision payload"}' },
  { payload_json: '{"completed":true}' }, { payload_json: '{"title":" whitespace "}' },
  { base_snapshot_json: '{}' }, { local_revision: 5 },
])('refuses a corrupt queued request %j without replacing or deleting it', async (changes) => {
  const task = await download();
  await outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Keep queued data' });
  await database.withTaskSyncTransaction(async (db) => {
    for (const [field, value] of Object.entries(changes)) {
      await db.runAsync(`UPDATE task_sync_outbox SET ${field} = ?`, [value]);
    }
  });
  const beforeCache = await raw('task_sync_cache'), beforeQueue = await raw('task_sync_outbox');
  await expect(queued()).rejects.toThrow();
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Another edit' })).rejects.toThrow();
  await expect(outbox.deleteOfflineTask(scope.scopeKey, task.localId)).rejects.toThrow();
  expect(await raw('task_sync_cache')).toEqual(beforeCache);
  expect(await raw('task_sync_outbox')).toEqual(beforeQueue);
});

test('refuses untracked local edits and revision overflow', async () => {
  const task = await download();
  await database.withTaskSyncTransaction((db) => db.runAsync(`UPDATE task_sync_cache SET working_json = json_set(working_json, '$.title', 'Untracked')`));
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Replace?' })).rejects.toThrow();
  await database.withTaskSyncTransaction((db) => db.runAsync('UPDATE task_sync_cache SET working_json = ?, local_revision = ?', [JSON.stringify(task.workingCopy), Number.MAX_SAFE_INTEGER]));
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Overflow?' })).rejects.toThrow('limit');
  await expect(outbox.deleteOfflineTask(scope.scopeKey, task.localId)).rejects.toThrow('limit');
  expect(await queued()).toEqual([]);
});

test('refuses a same-revision delete request whose local task is still visible', async () => {
  const task = await download();
  await outbox.deleteOfflineTask(scope.scopeKey, task.localId);
  await database.withTaskSyncTransaction((db) => db.runAsync('UPDATE task_sync_cache SET is_deleted = 0'));
  const before = await raw('task_sync_outbox');
  await expect(queued()).rejects.toThrow();
  await expect(outbox.updateOfflineTask(scope.scopeKey, task.localId, { title: 'Do not cancel corrupt delete' })).rejects.toThrow();
  expect(await raw('task_sync_outbox')).toEqual(before);
});
