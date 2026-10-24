/** Cache integration checks use the project's in-memory SQLite adapter. */
import type * as SQLite from 'expo-sqlite';
import type { ApiTask } from '../../lib/api/taskApi';
import type { TaskSyncDatabase } from '../../lib/taskSyncDatabase';

type CacheModule = typeof import('../../lib/taskSyncCache');
type DatabaseModule = typeof import('../../lib/taskSyncDatabase');
let cache: CacheModule;
let database: DatabaseModule;
let connections: TaskSyncDatabase[];
let fetchSpy: jest.SpyInstance;
const STAMP = '2026-10-21T12:00:00Z';

function task(id = 100, overrides: Partial<ApiTask> = {}): ApiTask {
  return {
    id, title: 'Original task', day: 'Inbox', dueDate: null, notes: null,
    priority: 0, completed: false, createdAt: STAMP, completedAt: null,
    goalId: 7, recurringRuleId: null, sourceTaskId: 1781204320001,
    sourceGoalId: 1781204320002, sourceRecurringRuleId: null,
    recurrenceOccurrenceDate: null, ...overrides,
  };
}
async function scope(overrides = {}) {
  return cache.getOrCreateTaskSyncScope({
    baseUrl: 'http://localhost:8000', serverInstanceKey: 'database-one', ...overrides,
  });
}
async function raw(table: 'task_sync_cache' | 'task_sync_outbox' | 'task_sync_scopes') {
  return database.withTaskSyncTransaction((db) => db.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid`));
}

beforeEach(async () => {
  jest.resetModules();
  connections = [];
  const sqlite = jest.requireActual<typeof SQLite>('expo-sqlite');
  const original = sqlite.openDatabaseAsync.bind(sqlite);
  jest.spyOn(sqlite, 'openDatabaseAsync').mockImplementation(async (...args) => {
    const db = await original(...args);
    connections.push(db);
    return db;
  });
  fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Cache tests must not contact the server'));
  database = await import('../../lib/taskSyncDatabase');
  cache = await import('../../lib/taskSyncCache');
});
afterEach(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); }
  finally {
    jest.restoreAllMocks();
    for (const db of connections) await db.closeAsync();
  }
});

test('normalizes URL and reuses only the same server and owner scope', async () => {
  const first = await scope();
  const second = await scope({ baseUrl: ' http://LOCALHOST:8000/// ' });
  expect(second).toEqual(first);
  expect(first).toMatchObject({ baseUrl: 'http://localhost:8000', ownerKey: 'single-owner', lastDownloadAt: null, lastUploadAt: null });
  expect(first.scopeKey).toMatch(/^[0-9a-f]{32}$/);
  expect(await cache.getTaskSyncScope(first.scopeKey)).toEqual(first);
  const otherServer = await scope({ serverInstanceKey: 'database-two' });
  const otherOwner = await scope({ ownerKey: 'another-owner' });
  const otherUrl = await scope({ baseUrl: 'http://localhost:9000' });
  expect(new Set([first, otherServer, otherOwner, otherUrl].map((item) => item.scopeKey)).size).toBe(4);
});

test.each(['', '/relative', 'ftp://localhost', 'http://user:password@localhost', 'http://localhost?', 'http://localhost#'])('rejects invalid scope URL %j before saving', async (baseUrl) => {
  await expect(scope({ baseUrl })).rejects.toThrow();
  expect(await raw('task_sync_scopes')).toEqual([]);
});

test.each([{serverInstanceKey: ''}, {ownerKey: ' '}])('rejects missing identity %j', async (overrides) => {
  await expect(scope(overrides)).rejects.toThrow();
});

test('downloads complete field values and keeps the local ID separate from PostgreSQL', async () => {
  const s = await scope();
  const download = task(208, { completed: true, completedAt: STAMP, priority: 2, notes: 'Retain this' });
  expect(await cache.cacheDownloadedTasks(s.scopeKey, [download])).toEqual({ saved: 1, protectedLocalIds: [] });
  const [saved] = await cache.readCachedTasks(s.scopeKey);
  expect(saved).toMatchObject({ localId: 1, serverId: 208, status: 'synced', localRevision: 0, isDeleted: false, serverSnapshot: download });
  expect(saved.workingCopy).not.toHaveProperty('id');
  expect(saved.workingCopy).toMatchObject({ goalId: 7, sourceGoalId: 1781204320002, completed: true, completedAt: STAMP });
  expect(await cache.readCachedTask(s.scopeKey, saved.localId)).toEqual(saved);
  expect(await cache.readCachedTask(s.scopeKey, 208)).toBeNull();
  const metadata = await cache.getTaskSyncScope(s.scopeKey);
  expect(metadata.lastDownloadAt).not.toBeNull();
  expect(metadata.lastUploadAt).toBeNull();
});

test('refresh changes server fields while preserving local identity, revision, and first cached time', async () => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  const [before] = await cache.readCachedTasks(s.scopeKey);
  await database.withTaskSyncTransaction((db) => db.runAsync('UPDATE task_sync_cache SET local_revision = 4 WHERE local_id = ?', [before.localId]));
  const changed = task(100, { title: 'Updated', goalId: 8, completed: true, completedAt: STAMP });
  await cache.cacheDownloadedTasks(s.scopeKey, [changed]);
  const [after] = await cache.readCachedTasks(s.scopeKey);
  expect(after).toMatchObject({ localId: before.localId, clientTaskKey: before.clientTaskKey, cachedAt: before.cachedAt, localRevision: 4, serverSnapshot: changed });
  expect(after.workingCopy.title).toBe('Updated');
});

test('identical numeric task IDs remain separate between servers and owners', async () => {
  const a = await scope();
  const b = await scope({ serverInstanceKey: 'another-database' });
  await cache.cacheDownloadedTasks(a.scopeKey, [task()]);
  await cache.cacheDownloadedTasks(b.scopeKey, [task(100, { title: 'Different server' })]);
  const [first] = await cache.readCachedTasks(a.scopeKey);
  const [second] = await cache.readCachedTasks(b.scopeKey);
  expect(first.localId).not.toBe(second.localId);
  expect(await cache.readCachedTask(b.scopeKey, first.localId)).toBeNull();
  expect(first.workingCopy.title).toBe('Original task');
  expect(second.workingCopy.title).toBe('Different server');
});

test.each(['pending','sending','uncertain','conflict','rejected'])('protects all local data and the frozen queue while %s', async (state) => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  const [initial] = await cache.readCachedTasks(s.scopeKey);
  const localCopy = { ...initial.workingCopy, title: 'Offline edit', completed: true, completedAt: STAMP };
  await database.withTaskSyncTransaction(async (db) => {
    await db.runAsync('UPDATE task_sync_cache SET working_json = ?, local_revision = 2 WHERE local_id = ?', [JSON.stringify(localCopy), initial.localId]);
    await db.runAsync(`INSERT INTO task_sync_outbox
      (local_task_id, action, state, payload_json, base_snapshot_json, local_revision, created_at, updated_at)
      VALUES (?, 'update', ?, ?, ?, 1, ?, ?)`,
      [initial.localId, state, JSON.stringify({ title: 'Frozen first edit' }), JSON.stringify(task()), STAMP, STAMP]);
  });
  const before = await raw('task_sync_cache');
  const queueBefore = await raw('task_sync_outbox');
  const result = await cache.cacheDownloadedTasks(s.scopeKey, [task(100, { title: 'Concurrent server edit' }), task(101)]);
  expect(result).toEqual({ saved: 1, protectedLocalIds: [initial.localId] });
  expect((await raw('task_sync_cache'))[0]).toEqual(before[0]);
  expect(await raw('task_sync_outbox')).toEqual(queueBefore);
  expect(await cache.readCachedTask(s.scopeKey, initial.localId)).toMatchObject({ status: state, workingCopy: localCopy, serverSnapshot: task(), localRevision: 2 });
});

test('tombstones stay hidden unless requested and downloads do not resurrect them', async () => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  const [initial] = await cache.readCachedTasks(s.scopeKey);
  await database.withTaskSyncTransaction(async (db) => {
    await db.runAsync('UPDATE task_sync_cache SET is_deleted = 1, local_revision = 1 WHERE local_id = ?', [initial.localId]);
    await db.runAsync(`INSERT INTO task_sync_outbox
      (local_task_id, action, payload_json, base_snapshot_json, local_revision, created_at, updated_at)
      VALUES (?, 'delete', '{}', ?, 1, ?, ?)`, [initial.localId, JSON.stringify(task()), STAMP, STAMP]);
  });
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  expect(await cache.readCachedTasks(s.scopeKey)).toEqual([]);
  expect(await cache.readCachedTasks(s.scopeKey, { includeDeleted: true })).toEqual([expect.objectContaining({ isDeleted: true, status: 'pending' })]);
});

test('new offline tasks remain visible without a server ID', async () => {
  const s = await scope();
  const { id: _id, ...working } = task(100, { sourceTaskId: null });
  await database.withTaskSyncTransaction(async (db) => {
    const result = await db.runAsync(`INSERT INTO task_sync_cache
      (scope_key, working_json, local_revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`, [s.scopeKey, JSON.stringify(working), STAMP, STAMP]);
    await db.runAsync(`INSERT INTO task_sync_outbox
      (local_task_id, action, payload_json, local_revision, created_at, updated_at)
      VALUES (?, 'create', '{}', 1, ?, ?)`, [result.lastInsertRowId, STAMP, STAMP]);
  });
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  expect(await cache.readCachedTasks(s.scopeKey)).toHaveLength(2);
  expect((await cache.readCachedTasks(s.scopeKey))[0]).toMatchObject({ serverId: null, serverSnapshot: null, status: 'pending' });
});

test('filtered and empty batches never delete omitted cache rows', async () => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task(100), task(101)]);
  await cache.cacheDownloadedTasks(s.scopeKey, [task(101)]);
  await cache.cacheDownloadedTasks(s.scopeKey, []);
  expect((await cache.readCachedTasks(s.scopeKey)).map((item) => item.serverId)).toEqual([100, 101]);
});

test('rejects duplicate server IDs without partially storing the batch', async () => {
  const s = await scope();
  await expect(cache.cacheDownloadedTasks(s.scopeKey, [task(), task()])).rejects.toThrow('duplicate');
  expect(await cache.readCachedTasks(s.scopeKey)).toEqual([]);
  expect((await cache.getTaskSyncScope(s.scopeKey)).lastDownloadAt).toBeNull();
});

test.each([
  { id: 1781204320001 }, { title: '' }, { dueDate: '2026-02-30' },
  { goalId: 1781204320002 }, { priority: 3 }, { completed: 'yes' },
  { recurringRuleId: 2 }, { recurrenceOccurrenceDate: '2026-10-21' },
  { sourceGoalId: Number.MAX_SAFE_INTEGER + 1 }, { createdAt: 'yesterday' },
])('rejects invalid task fields %j before saving any task', async (invalid) => {
  const s = await scope();
  await expect(cache.cacheDownloadedTasks(s.scopeKey, [task(101), task(100, invalid as Partial<ApiTask>)])).rejects.toThrow();
  expect(await raw('task_sync_cache')).toEqual([]);
});

test('keeps legacy source-only recurring links and completed history with no timestamp', async () => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task(100, {
    completed: true, completedAt: null, sourceRecurringRuleId: 1781204320003,
    recurrenceOccurrenceDate: '2026-10-21',
  })]);
  expect((await cache.readCachedTasks(s.scopeKey))[0].workingCopy).toMatchObject({ completed: true, completedAt: null, recurringRuleId: null, sourceRecurringRuleId: 1781204320003 });
});

test('takes a defensive snapshot before waiting for the database', async () => {
  const s = await scope();
  const input = task();
  const download = cache.cacheDownloadedTasks(s.scopeKey, [input]);
  input.title = 'Changed after invocation';
  await download;
  expect((await cache.readCachedTasks(s.scopeKey))[0].workingCopy.title).toBe('Original task');
});

test('fails on unknown scope without creating it or touching another scope', async () => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  const before = await raw('task_sync_cache');
  await expect(cache.cacheDownloadedTasks('missing', [task(101)])).rejects.toThrow('Unknown');
  await expect(cache.readCachedTasks('missing')).rejects.toThrow('Unknown');
  await expect(cache.getTaskSyncScope('missing')).rejects.toThrow('Unknown');
  expect(await raw('task_sync_cache')).toEqual(before);
});

test.each(['working_json', 'server_snapshot_json'])('rejects corrupt %s rather than wiping it', async (field) => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  await database.withTaskSyncTransaction((db) => db.runAsync(`UPDATE task_sync_cache SET ${field} = '{}'`));
  const before = await raw('task_sync_cache');
  await expect(cache.readCachedTasks(s.scopeKey)).rejects.toThrow('Invalid task-cache');
  await expect(cache.cacheDownloadedTasks(s.scopeKey, [task(101), task()])).rejects.toThrow('Invalid task-cache');
  expect(await raw('task_sync_cache')).toEqual(before);
});

test('does not discard untracked local edits with no outbox entry', async () => {
  const s = await scope();
  await cache.cacheDownloadedTasks(s.scopeKey, [task()]);
  await database.withTaskSyncTransaction((db) => db.runAsync(`UPDATE task_sync_cache SET working_json = json_set(working_json, '$.title', 'Untracked edit')`));
  const before = await raw('task_sync_cache');
  await expect(cache.cacheDownloadedTasks(s.scopeKey, [task()])).rejects.toThrow('Invalid task-cache');
  expect(await raw('task_sync_cache')).toEqual(before);
});

test('rolls back earlier writes and download time if a later write fails', async () => {
  const s = await scope();
  await database.withTaskSyncTransaction((db) => db.execAsync(`
    CREATE TRIGGER fail_second_task BEFORE INSERT ON task_sync_cache
    WHEN NEW.server_id = 101 BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;
  `));
  await expect(cache.cacheDownloadedTasks(s.scopeKey, [task(100), task(101)])).rejects.toThrow('injected');
  expect(await raw('task_sync_cache')).toEqual([]);
  expect((await cache.getTaskSyncScope(s.scopeKey)).lastDownloadAt).toBeNull();
  await database.withTaskSyncTransaction((db) => db.execAsync('DROP TRIGGER fail_second_task'));
  await expect(cache.cacheDownloadedTasks(s.scopeKey, [task()])).resolves.toEqual({ saved: 1, protectedLocalIds: [] });
});

test('reads reject an invalid local ID and invalid deletion filter', async () => {
  const s = await scope();
  await expect(cache.readCachedTask(s.scopeKey, 0)).rejects.toThrow();
  await expect(cache.readCachedTasks(s.scopeKey, { includeDeleted: 'yes' as unknown as boolean })).rejects.toThrow();
});
