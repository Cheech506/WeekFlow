/** SQLite sync schema and transaction tests; all databases stay in memory. */

import type * as SQLite from 'expo-sqlite';
import type { TaskSyncDatabase } from '../../lib/taskSyncDatabase';

type SyncModule = typeof import('../../lib/taskSyncDatabase');
const STAMP = '2026-10-21T12:00:00Z';
let sync: SyncModule;
let opened: TaskSyncDatabase[];
let originalOpen: typeof SQLite.openDatabaseAsync;
let openSpy: jest.SpyInstance<ReturnType<typeof SQLite.openDatabaseAsync>, Parameters<typeof SQLite.openDatabaseAsync>>;
let fetchSpy: jest.SpyInstance;

beforeEach(async () => {
  jest.resetModules();
  opened = [];
  // The project's moduleNameMapper resolves this to the existing in-memory
  // Node SQLite adapter, even though requireActual bypasses Jest mocks.
  const sqlite = jest.requireActual<typeof SQLite>('expo-sqlite');
  originalOpen = sqlite.openDatabaseAsync.bind(sqlite);
  openSpy = jest.spyOn(sqlite, 'openDatabaseAsync').mockImplementation(async (...args) => {
    const db = await originalOpen(...args);
    opened.push(db);
    return db;
  });
  fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Database tests must not contact the API'));
  sync = await import('../../lib/taskSyncDatabase');
});

afterEach(async () => {
  try {
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    for (const db of opened) await db.closeAsync();
  }
});

async function addScope(key = 'scope-a', server = key, owner = 'single-owner') {
  return sync.withTaskSyncTransaction((db) => db.runAsync(
    `INSERT INTO task_sync_scopes
      (scope_key, base_url, server_instance_key, owner_key, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    [key, 'http://127.0.0.1:8000', server, owner, STAMP]
  ));
}

type CacheValues = {
  scope: string; server: number | null; working: string; snapshot: string | null;
  revision: number; deleted: number;
};
async function addCache(changes: Partial<CacheValues> = {}) {
  const v: CacheValues = {
    scope: 'scope-a', server: null, working: '{"title":"Offline task"}',
    snapshot: null, revision: 1, deleted: 0, ...changes,
  };
  return sync.withTaskSyncTransaction((db) => db.runAsync(
    `INSERT INTO task_sync_cache
      (scope_key, server_id, working_json, server_snapshot_json,
       local_revision, is_deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.scope, v.server, v.working, v.snapshot, v.revision, v.deleted, STAMP, STAMP]
  ));
}

type QueueValues = {
  action: string; state: string; payload: string; base: string | null;
  revision: number; attempts: number; conflict: string | null;
};
async function addOperation(localId: number, changes: Partial<QueueValues> = {}) {
  const v: QueueValues = {
    action: 'create', state: 'pending', payload: '{"title":"Offline task"}',
    base: null, revision: 1, attempts: 0, conflict: null, ...changes,
  };
  return sync.withTaskSyncTransaction((db) => db.runAsync(
    `INSERT INTO task_sync_outbox
      (local_task_id, action, state, payload_json, base_snapshot_json,
       local_revision, attempt_count, conflict_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [localId, v.action, v.state, v.payload, v.base, v.revision, v.attempts, v.conflict, STAMP, STAMP]
  ));
}

async function allRows(table: 'task_sync_scopes' | 'task_sync_cache' | 'task_sync_outbox') {
  return sync.withTaskSyncTransaction((db) => db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY rowid`));
}


test('initializes only the dedicated in-memory sync database and is repeatable', async () => {
  await sync.initializeTaskSyncDatabase();
  await sync.initializeTaskSyncDatabase();
  expect(openSpy).toHaveBeenCalledTimes(1);
  expect(openSpy).toHaveBeenCalledWith('weekflow-task-sync.db');
  const tables = await sync.withTaskSyncTransaction((db) => db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'task_sync_%' ORDER BY name"
  ));
  expect(tables.map((row) => row.name)).toEqual(['task_sync_cache', 'task_sync_outbox', 'task_sync_scopes']);
  expect(await sync.withTaskSyncTransaction((db) => db.getFirstAsync('PRAGMA user_version'))).toEqual({ user_version: 1 });
  expect((opened[0] as unknown as { __databaseLocation: string }).__databaseLocation).toBe(':memory:');
});


test('enables foreign keys and creates the cache/queue lookup indexes', async () => {
  await sync.initializeTaskSyncDatabase();
  expect(await sync.withTaskSyncTransaction((db) => db.getFirstAsync('PRAGMA foreign_keys'))).toEqual({ foreign_keys: 1 });
  const indexes = await sync.withTaskSyncTransaction((db) => db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_task_sync_%' ORDER BY name"
  ));
  expect(indexes.map((row) => row.name)).toEqual(['idx_task_sync_cache_scope_visible', 'idx_task_sync_outbox_state_created']);
});


test('scope creation defaults the owner and starts with no completed uploads', async () => {
  await sync.withTaskSyncTransaction((db) => db.runAsync(
    'INSERT INTO task_sync_scopes (scope_key,base_url,server_instance_key,created_at) VALUES (?,?,?,?)',
    ['scope-a', 'http://127.0.0.1:8000', 'server-a', STAMP]
  ));
  expect(await allRows('task_sync_scopes')).toEqual([{
    scope_key: 'scope-a', base_url: 'http://127.0.0.1:8000', server_instance_key: 'server-a',
    owner_key: 'single-owner', created_at: STAMP, last_download_at: null, last_upload_at: null,
  }]);
});


test('local task IDs and stable client keys exist before PostgreSQL assigns an ID', async () => {
  await addScope();
  const first = await addCache();
  const second = await addCache();
  const rows = await allRows('task_sync_cache');
  expect(rows.map((row) => row.local_id)).toEqual([first.lastInsertRowId, second.lastInsertRowId]);
  expect(first.lastInsertRowId).not.toBe(second.lastInsertRowId);
  expect(rows.every((row) => row.server_id === null && row.server_snapshot_json === null)).toBe(true);
  for (const row of rows) expect(row.client_task_key).toMatch(/^[0-9a-f]{32}$/);
  expect(rows[0].client_task_key).not.toBe(rows[1].client_task_key);
});


test('the same PostgreSQL ID is isolated across server scopes', async () => {
  await addScope('scope-a'); await addScope('scope-b');
  await addCache({ scope: 'scope-a', server: 12, snapshot: '{"id":12}' });
  await addCache({ scope: 'scope-b', server: 12, snapshot: '{"id":12}' });
  const rows = await allRows('task_sync_cache');
  expect(rows.map((row) => row.server_id)).toEqual([12, 12]);
  expect(rows[0].local_id).not.toBe(rows[1].local_id);
});


test('duplicate server IDs within one scope cannot create a second cached task', async () => {
  await addScope(); await addCache({ server: 12, snapshot: '{}' });
  const before = await allRows('task_sync_cache');
  await expect(addCache({ server: 12, snapshot: '{}' })).rejects.toThrow();
  expect(await allRows('task_sync_cache')).toEqual(before);
});


test('a duplicate server/account scope cannot accidentally start a separate cache', async () => {
  await addScope('scope-a', 'server-a', 'owner-a');
  await expect(addScope('scope-b', 'server-a', 'owner-a')).rejects.toThrow();
  await addScope('scope-c', 'server-a', 'owner-b');
  await addScope('scope-d', 'server-b', 'owner-a');
  expect(await allRows('task_sync_scopes')).toHaveLength(3);
});


test.each([
  { scope: 'missing' }, { server: 0, snapshot: '{}' },
  { server: 2_147_483_648, snapshot: '{}' },
  { server: 1_781_204_340_001, snapshot: '{}' },
  { server: 12, snapshot: null }, { server: null, snapshot: '{}' },
  { working: 'invalid-json' }, { working: '[]' }, { working: 'null' },
  { server: 12, snapshot: '[]' }, { revision: -1 }, { deleted: 2 },
])('rejects invalid cache bookkeeping without saving it: %j', async (values) => {
  await addScope();
  await expect(addCache(values)).rejects.toThrow();
  expect(await allRows('task_sync_cache')).toEqual([]);
});


test('queue entries get a stable operation key and retain their frozen payload', async () => {
  await addScope();
  const cached = await addCache();
  await addOperation(cached.lastInsertRowId);
  const [original] = await allRows('task_sync_outbox');
  expect(original.operation_key).toMatch(/^[0-9a-f]{32}$/);
  expect(original.state).toBe('pending');
  expect(original.attempt_count).toBe(0);
  await sync.withTaskSyncTransaction((db) => db.runAsync(
    'UPDATE task_sync_cache SET working_json=?, local_revision=2 WHERE local_id=?',
    ['{"title":"A later edit"}', cached.lastInsertRowId]
  ));
  // Updating a working copy alone cannot silently alter a queued request.
  expect(await allRows('task_sync_outbox')).toEqual([original]);
});


test('only one queue entry can own a local task at a time', async () => {
  await addScope(); const cached = await addCache();
  await addOperation(cached.lastInsertRowId);
  const before = await allRows('task_sync_outbox');
  await expect(addOperation(cached.lastInsertRowId)).rejects.toThrow();
  expect(await allRows('task_sync_outbox')).toEqual(before);
});


test.each(['create', 'update', 'delete'])('accepts the required baseline for %s operations', async (action) => {
  await addScope();
  const cached = await addCache(action === 'create' ? {} : { server: 12, snapshot: '{"id":12}' });
  await addOperation(cached.lastInsertRowId, { action, base: action === 'create' ? null : '{"id":12}' });
  const [operation] = await allRows('task_sync_outbox');
  expect(operation.action).toBe(action);
  expect(operation.base_snapshot_json).toBe(action === 'create' ? null : '{"id":12}');
});


test.each(['pending', 'sending', 'uncertain', 'conflict', 'rejected'])(
  'retains a queue entry in the %s state', async (state) => {
    await addScope(); const cached = await addCache();
    await addOperation(cached.lastInsertRowId, { state });
    expect((await allRows('task_sync_outbox'))[0].state).toBe(state);
  }
);


test.each([
  { action: 'unknown' }, { state: 'lost' },
  { action: 'create', base: '{}' }, { action: 'update', base: null },
  { action: 'delete', base: null }, { revision: 0 },
  { attempts: -1 }, { payload: 'not json' }, { payload: '[]' },
  { conflict: '[]' }, { conflict: 'not json' },
])('rejects invalid queue entries without losing the cached task: %j', async (values) => {
  await addScope(); const cached = await addCache();
  const before = await allRows('task_sync_cache');
  await expect(addOperation(cached.lastInsertRowId, values)).rejects.toThrow();
  expect(await allRows('task_sync_cache')).toEqual(before);
  expect(await allRows('task_sync_outbox')).toEqual([]);
});


test('a queue entry must reference an existing cached task', async () => {
  await addScope();
  await expect(addOperation(999)).rejects.toThrow();
  expect(await allRows('task_sync_outbox')).toEqual([]);
});


test('unresolved queue entries prevent accidental cache or scope deletion', async () => {
  await addScope(); const cached = await addCache();
  await addOperation(cached.lastInsertRowId);
  const cacheBefore = await allRows('task_sync_cache');
  const queueBefore = await allRows('task_sync_outbox');
  await expect(sync.withTaskSyncTransaction((db) => db.runAsync(
    'DELETE FROM task_sync_cache WHERE local_id=?', [cached.lastInsertRowId]
  ))).rejects.toThrow();
  await expect(sync.withTaskSyncTransaction((db) => db.runAsync(
    'DELETE FROM task_sync_scopes WHERE scope_key=?', ['scope-a']
  ))).rejects.toThrow();
  expect(await allRows('task_sync_cache')).toEqual(cacheBefore);
  expect(await allRows('task_sync_outbox')).toEqual(queueBefore);
});


test('invalid queue insertion rolls back the new cached task in the same transaction', async () => {
  await addScope();
  await expect(sync.withTaskSyncTransaction(async (db) => {
    const row = await db.runAsync(
      'INSERT INTO task_sync_cache (scope_key,working_json,created_at,updated_at) VALUES (?,?,?,?)',
      ['scope-a', '{"title":"Must roll back"}', STAMP, STAMP]
    );
    await db.runAsync(
      "INSERT INTO task_sync_outbox (local_task_id,action,payload_json,local_revision,created_at,updated_at) VALUES (?,'invalid','{}',1,?,?)",
      [row.lastInsertRowId, STAMP, STAMP]
    );
  })).rejects.toThrow();
  expect(await allRows('task_sync_cache')).toEqual([]);
  expect(await allRows('task_sync_outbox')).toEqual([]);
});


test('failure after changing existing cache and queue restores both snapshots', async () => {
  await addScope(); const cached = await addCache();
  await addOperation(cached.lastInsertRowId);
  const cacheBefore = await allRows('task_sync_cache');
  const queueBefore = await allRows('task_sync_outbox');
  await expect(sync.withTaskSyncTransaction(async (db) => {
    await db.runAsync('UPDATE task_sync_cache SET working_json=?,local_revision=2 WHERE local_id=?',
      ['{"title":"Unsaved edit"}', cached.lastInsertRowId]);
    await db.runAsync("UPDATE task_sync_outbox SET state='sending',attempt_count=1 WHERE local_task_id=?", [cached.lastInsertRowId]);
    throw new Error('Synthetic failure after both writes');
  })).rejects.toThrow('Synthetic failure');
  expect(await allRows('task_sync_cache')).toEqual(cacheBefore);
  expect(await allRows('task_sync_outbox')).toEqual(queueBefore);
});


test('overlapping async operations run in order with separate transactions', async () => {
  const order: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const first = sync.withTaskSyncTransaction(async () => {
    order.push('first-start'); entered(); await hold; order.push('first-end'); return 10;
  });
  await started;
  const second = sync.withTaskSyncTransaction(async () => {
    order.push('second'); return 20;
  });
  try {
    await Promise.resolve();
    expect(order).toEqual(['first-start']);
  } finally {
    release();
  }
  expect(await Promise.all([first, second])).toEqual([10, 20]);
  expect(order).toEqual(['first-start', 'first-end', 'second']);
});


test('one rejected operation does not block the next queued operation', async () => {
  const first = sync.withTaskSyncTransaction(async () => { throw new Error('Synthetic failure'); });
  const rejected = expect(first).rejects.toThrow('Synthetic failure');
  const second = sync.withTaskSyncTransaction(async () => 42);
  await rejected;
  await expect(second).resolves.toBe(42);
});


test('a failed initial open can be retried', async () => {
  openSpy.mockRejectedValueOnce(new Error('Synthetic open failure'));
  await expect(sync.initializeTaskSyncDatabase()).rejects.toThrow('Synthetic open failure');
  await sync.initializeTaskSyncDatabase();
  expect(openSpy).toHaveBeenCalledTimes(2);
  expect(await allRows('task_sync_cache')).toEqual([]);
});


test('a partially failed migration rolls back and initializes successfully on retry', async () => {
  openSpy.mockImplementationOnce(async (...args) => {
    const db = await originalOpen(...args);
    opened.push(db);
    const realExec = db.execAsync.bind(db);
    let fail = true;
    jest.spyOn(db, 'execAsync').mockImplementation(async (sql) => {
      if (fail && sql.includes('CREATE TABLE task_sync_scopes')) {
        fail = false;
        await realExec('CREATE TABLE partial_migration (id INTEGER);');
        throw new Error('Synthetic migration failure');
      }
      return realExec(sql);
    });
    return db;
  });
  await expect(sync.initializeTaskSyncDatabase()).rejects.toThrow('Synthetic migration failure');
  await sync.initializeTaskSyncDatabase();
  const rows = await sync.withTaskSyncTransaction((db) => db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE name='partial_migration'"
  ));
  expect(rows).toEqual([]);
  expect(openSpy).toHaveBeenCalledTimes(1);
});


test('a newer database is rejected without deleting its data', async () => {
  const db = await originalOpen('test-only');
  opened.push(db);
  await db.execAsync("CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep'); PRAGMA user_version=2;");
  openSpy.mockResolvedValueOnce(db);
  await expect(sync.initializeTaskSyncDatabase()).rejects.toThrow('newer WeekFlow');
  expect(await db.getFirstAsync('SELECT value FROM future_data')).toEqual({ value: 'keep' });
  expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 2 });
});


test('reloading the module preserves pending operations and their permanent keys', async () => {
  await addScope(); const cached = await addCache();
  await addOperation(cached.lastInsertRowId);
  const beforeCache = await allRows('task_sync_cache');
  const beforeQueue = await allRows('task_sync_outbox');
  const database = opened[0];
  jest.resetModules();
  const sqlite = jest.requireActual<typeof SQLite>('expo-sqlite');
  jest.spyOn(sqlite, 'openDatabaseAsync').mockResolvedValue(database);
  sync = await import('../../lib/taskSyncDatabase');
  await sync.initializeTaskSyncDatabase();
  expect(await allRows('task_sync_cache')).toEqual(beforeCache);
  expect(await allRows('task_sync_outbox')).toEqual(beforeQueue);
});


test('the existing application task database remains separate and unchanged', async () => {
  const storage = await import('../../lib/taskStorage');
  await storage.insertTask('Original app task', 'Inbox');
  const before = await storage.getTasks();
  await addScope();
  await addCache({ server: 12, snapshot: '{"id":12}', working: '{"title":"Server task"}' });
  expect(await storage.getTasks()).toEqual(before);
  expect(openSpy.mock.calls.map((call) => call[0])).toEqual(['weekflow.db', 'weekflow-task-sync.db']);
  expect(await allRows('task_sync_cache')).toHaveLength(1);
});
