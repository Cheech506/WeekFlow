/** Authentication state transitions; all HTTP, storage, and transport are mocked. */
jest.mock('@/lib/api/authApi', () => ({
  createApiOwner: jest.fn(), fetchApiAuthSession: jest.fn(), fetchApiSetupStatus: jest.fn(),
  loginApiOwner: jest.fn(), logoutApiOwner: jest.fn(),
}));
jest.mock('@/lib/authSessionStorage', () => ({
  loadAuthSession: jest.fn(), saveAuthSession: jest.fn(), clearAuthSession: jest.fn(),
  AuthSessionStorageError: class extends Error {
    readonly code: string;
    constructor(code: string) { super(`Controlled storage ${code} failure.`); this.code = code; }
  },
}));
jest.mock('@/lib/api/apiClient', () => {
  const actual = jest.requireActual('@/lib/api/apiClient');
  return { ...actual, configureApiSession: jest.fn(), subscribeToApiSessionRejection: jest.fn() };
});
import * as transport from '@/lib/api/apiClient';
import { ApiError } from '@/lib/api/apiClient';
import * as api from '@/lib/api/authApi';
import * as storage from '@/lib/authSessionStorage';
import { AuthSessionStorageError, type StoredAuthSession } from '@/lib/authSessionStorage';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { AuthProvider, useAuth } from '../context/AuthContext';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const BASE = 'https://weekflow.example.test';
const SESSION = 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18';
const OTHER_SESSION = '63a424ed-a3f5-4fc1-b3fe-0825dac39a83';
const NOW = new Date('2026-11-08T12:00:00Z');
const TOKEN = 'a'.repeat(43), CSRF = 'b'.repeat(43);
const INPUT = { username: 'corey', password: 'My exact password!' };
const SETUP = { ...INPUT, setupCode: TOKEN };
const apiMock = jest.mocked(api), storageMock = jest.mocked(storage), transportMock = jest.mocked(transport);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let root: ReturnType<typeof createRoot> | undefined;
let value: ReturnType<typeof useAuth>;
let stored: StoredAuthSession | null;
let address: string;
let rejection: ((event: transport.ApiSessionRejection) => void) | undefined;
let unsubscribe: jest.Mock;
let events: Map<string, (event: StorageEvent) => void>;
let browserStorage: Storage;

function login(native = false): api.AuthLoginResult {
  return { identity: { sessionId: SESSION, accountId: 1, username: 'corey',
    clientType: native ? 'native' : 'web', expiresAt: '2026-11-08T20:00:00Z' },
    credentials: native ? { clientType: 'native', token: TOKEN } : { clientType: 'web', csrfToken: CSRF } };
}
function cache(native = false): StoredAuthSession {
  const result = login(native);
  return { sessionId: result.identity.sessionId, expiresAt: result.identity.expiresAt, credentials: result.credentials };
}
function Probe() { value = useAuth(); return null; }
async function render() {
  await act(async () => { root!.render(React.createElement(AuthProvider,
    { baseUrl: address, children: React.createElement(Probe) })); });
}
async function mount() { root = createRoot(); await render(); }
async function restore() { stored = cache(); await mount(); }
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function rejected(status = 401) { return new ApiError('A controlled API error.', { kind: 'http', status }); }
async function storageEvent(key: string | null = 'weekflow.auth.v1.fake', area = browserStorage) {
  await act(async () => { events.get('storage')?.({ key, storageArea: area } as StorageEvent); });
}

beforeEach(() => {
  jest.resetAllMocks(); jest.useFakeTimers(); jest.setSystemTime(NOW);
  address = BASE; stored = null; rejection = undefined; events = new Map(); unsubscribe = jest.fn();
  browserStorage = {} as Storage;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: new URL(BASE), localStorage: browserStorage,
    addEventListener: jest.fn((name: string, callback: (event: StorageEvent) => void) => { events.set(name, callback); }),
    removeEventListener: jest.fn((name: string) => { events.delete(name); }),
  } });
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: true, setupReady: false });
  apiMock.fetchApiAuthSession.mockResolvedValue(login().identity);
  apiMock.loginApiOwner.mockResolvedValue(login());
  apiMock.createApiOwner.mockResolvedValue({ id: 1, username: 'corey' });
  apiMock.logoutApiOwner.mockResolvedValue(undefined);
  storageMock.loadAuthSession.mockImplementation(async () => stored);
  storageMock.saveAuthSession.mockImplementation(async result => {
    stored = { sessionId: result.identity.sessionId, expiresAt: result.identity.expiresAt, credentials: result.credentials };
  });
  storageMock.clearAuthSession.mockImplementation(async () => { stored = null; });
  transportMock.subscribeToApiSessionRejection.mockImplementation(callback => { rejection = callback; return unsubscribe; });
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.useRealTimers(); jest.restoreAllMocks();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('an existing owner without saved login material sees login', async () => {
  await mount();
  expect(value.status).toBe('login'); expect(value.identity).toBeNull();
  expect(value.isSubmitting).toBe(false); expect(apiMock.fetchApiAuthSession).not.toHaveBeenCalled();
});
test('checking stays locked until setup status responds', async () => {
  const pending = deferred<api.AuthSetupStatus>(); apiMock.fetchApiSetupStatus.mockReturnValueOnce(pending.promise);
  await mount();
  expect(value.status).toBe('checking'); expect(value.identity).toBeNull();
  await act(async () => { pending.resolve({ ownerExists: true, setupReady: false }); });
  expect(value.status).toBe('login');
});
test.each([true, false])('no owner shows setup with readiness %s and removes stale stored material', async ready => {
  stored = cache(); apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: ready });
  await mount();
  expect(value.status).toBe('setup'); expect(value.setupReady).toBe(ready);
  expect(storageMock.clearAuthSession).toHaveBeenCalledWith({ baseUrl: BASE });
  expect(stored).toBeNull(); expect(apiMock.fetchApiAuthSession).not.toHaveBeenCalled();
});
test('setup status network failure shows an error and never opens the app', async () => {
  apiMock.fetchApiSetupStatus.mockRejectedValueOnce(new ApiError('No connection.', { kind: 'network' }));
  await mount();
  expect(value.status).toBe('error'); expect(value.errorMessage).toBe('No connection.'); expect(value.identity).toBeNull();
});
test('saved credentials do not authenticate until Python verifies them', async () => {
  stored = cache(); const pending = deferred<api.AuthSessionIdentity>();
  apiMock.fetchApiAuthSession.mockReturnValueOnce(pending.promise); await mount();
  expect(value.status).toBe('checking');
  expect(transportMock.configureApiSession).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION }));
  await act(async () => { pending.resolve(login().identity); });
  expect(value.status).toBe('authenticated'); expect(value.identity?.username).toBe('corey');
});
test('a verified restore installs the session before exposing authenticated state', async () => {
  await restore();
  expect(apiMock.fetchApiAuthSession).toHaveBeenCalledWith(cache().credentials, expect.objectContaining({ baseUrl: BASE, signal: expect.any(AbortSignal) }));
  expect(storageMock.saveAuthSession).toHaveBeenCalledWith(login(), { baseUrl: BASE });
  expect(transportMock.configureApiSession).toHaveBeenLastCalledWith({ baseUrl: BASE, sessionId: SESSION,
    expiresAt: login().identity.expiresAt, credentials: login().credentials });
  expect(value.status).toBe('authenticated');
  expect(value).not.toHaveProperty('credentials'); expect(value).not.toHaveProperty('token');
});
test('a rejected saved session is removed and returns to login', async () => {
  stored = cache(); apiMock.fetchApiAuthSession.mockRejectedValueOnce(rejected()); await mount();
  expect(value.status).toBe('login'); expect(value.noticeMessage).toContain('session has ended');
  expect(stored).toBeNull(); expect(value.identity).toBeNull();
});
test.each([403, 500, 503])('saved session HTTP %s stays locked but does not discard a potentially valid token', async status => {
  stored = cache(); apiMock.fetchApiAuthSession.mockRejectedValueOnce(rejected(status)); await mount();
  expect(value.status).toBe('error'); expect(stored).not.toBeNull();
  expect(storageMock.clearAuthSession).not.toHaveBeenCalled();
});
test('a saved-session network failure preserves the credential for a later verification retry', async () => {
  stored = cache(); apiMock.fetchApiAuthSession.mockRejectedValueOnce(new ApiError('Offline.', { kind: 'network' }));
  await mount(); expect(value.status).toBe('error'); expect(stored).not.toBeNull();
  await act(async () => { await value.refreshAuthentication(); });
  expect(value.status).toBe('authenticated');
});
test('a session-ID mismatch is never accepted even when the server returns a valid identity', async () => {
  stored = cache(); apiMock.fetchApiAuthSession.mockResolvedValueOnce({ ...login().identity, sessionId: OTHER_SESSION });
  await mount(); expect(value.status).toBe('login'); expect(stored).toBeNull();
  expect(value.noticeMessage).toContain('verify this device');
});
test('a client-type mismatch is never accepted', async () => {
  stored = cache(); apiMock.fetchApiAuthSession.mockResolvedValueOnce({ ...login().identity, clientType: 'native' });
  await mount(); expect(value.status).toBe('login'); expect(value.identity).toBeNull();
});
test('the server identity and deadline replace cached metadata', async () => {
  stored = cache(); const identity = { ...login().identity, username: 'renamed', expiresAt: '2026-11-08T19:00:00Z' };
  apiMock.fetchApiAuthSession.mockResolvedValueOnce(identity); await mount();
  expect(value.identity).toEqual(identity); expect(stored?.expiresAt).toBe(identity.expiresAt);
});
test('storage read failures fail closed with a controlled error', async () => {
  storageMock.loadAuthSession.mockRejectedValueOnce(new AuthSessionStorageError('read')); await mount();
  expect(value.status).toBe('error'); expect(value.errorMessage).toContain('Controlled storage read');
  expect(apiMock.fetchApiAuthSession).not.toHaveBeenCalled();
});

test('account creation transitions to login without automatically signing in', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: true }); await mount();
  await act(async () => { await value.createOwner(SETUP); });
  expect(apiMock.createApiOwner).toHaveBeenCalledWith(SETUP, expect.objectContaining({ baseUrl: BASE }));
  expect(value.status).toBe('login'); expect(value.suggestedUsername).toBe('corey');
  expect(value.noticeMessage).toBe('Account created. Sign in to continue.');
  expect(apiMock.loginApiOwner).not.toHaveBeenCalled();
});
test('setup is not submitted when no setup code is ready', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: false }); await mount();
  await act(async () => { await value.createOwner(SETUP); }); expect(apiMock.createApiOwner).not.toHaveBeenCalled();
});
test('double setup submissions are blocked immediately', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: true }); await mount();
  const pending = deferred<api.AuthOwnerCreated>(); apiMock.createApiOwner.mockReturnValueOnce(pending.promise);
  await act(async () => { const create = value.createOwner; void create(SETUP); void create(SETUP); });
  expect(apiMock.createApiOwner).toHaveBeenCalledTimes(1); expect(value.isSubmitting).toBe(true);
  await act(async () => { pending.resolve({ id: 1, username: 'corey' }); });
});
test('a rejected setup code remains on setup with the safe error', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: true }); await mount();
  apiMock.createApiOwner.mockRejectedValueOnce(rejected(403));
  await act(async () => { await value.createOwner(SETUP); });
  expect(value.status).toBe('setup'); expect(value.errorMessage).toBe('A controlled API error.');
});
test.each([409, 'uncertain'])('uncertain/conflicting setup %s rechecks status rather than repeating creation', async kind => {
  apiMock.fetchApiSetupStatus.mockResolvedValueOnce({ ownerExists: false, setupReady: true }); await mount();
  apiMock.createApiOwner.mockRejectedValueOnce(kind === 409 ? rejected(409)
    : new ApiError('Reply lost.', { kind: 'network', mutationMayHaveSucceeded: true }));
  await act(async () => { await value.createOwner(SETUP); });
  expect(value.status).toBe('login'); expect(value.noticeMessage).toContain('An account now exists');
  expect(apiMock.createApiOwner).toHaveBeenCalledTimes(1); expect(apiMock.fetchApiSetupStatus).toHaveBeenCalledTimes(2);
});
test('uncertain setup with no new owner remains setup and reports the original failure', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: true }); await mount();
  apiMock.createApiOwner.mockRejectedValueOnce(new ApiError('Reply lost.', { kind: 'network', mutationMayHaveSucceeded: true }));
  await act(async () => { await value.createOwner(SETUP); });
  expect(value.status).toBe('setup'); expect(value.errorMessage).toBe('Reply lost.');
});
test('failed setup reconciliation remains locked and offers a status retry', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValueOnce({ ownerExists: false, setupReady: true }); await mount();
  apiMock.createApiOwner.mockRejectedValueOnce(new ApiError('Reply lost.', { kind: 'network', mutationMayHaveSucceeded: true }));
  apiMock.fetchApiSetupStatus.mockRejectedValueOnce(new ApiError('Offline.', { kind: 'network' }));
  await act(async () => { await value.createOwner(SETUP); });
  expect(value.status).toBe('error'); expect(value.errorMessage).toContain('could not be confirmed');
});

test('login verifies and persists the new session before opening the app', async () => {
  await mount(); await act(async () => { await value.signIn(INPUT); });
  expect(apiMock.loginApiOwner).toHaveBeenCalledWith(INPUT, expect.objectContaining({ baseUrl: BASE }));
  expect(apiMock.fetchApiAuthSession).toHaveBeenCalledWith(login().credentials, expect.objectContaining({ baseUrl: BASE }));
  expect(storageMock.saveAuthSession).toHaveBeenCalledWith(login(), { baseUrl: BASE });
  expect(value.status).toBe('authenticated'); expect(value.identity).toEqual(login().identity);
  expect(value).not.toHaveProperty('password'); expect(value).not.toHaveProperty('csrfToken');
});
test('double login taps do not issue multiple sessions', async () => {
  await mount(); const pending = deferred<api.AuthLoginResult>(); apiMock.loginApiOwner.mockReturnValueOnce(pending.promise);
  await act(async () => { const signIn = value.signIn; void signIn(INPUT); void signIn(INPUT); });
  expect(apiMock.loginApiOwner).toHaveBeenCalledTimes(1); expect(value.isSubmitting).toBe(true);
  await act(async () => { pending.resolve(login()); }); expect(value.status).toBe('authenticated');
});
test('captures login input before awaiting storage cleanup', async () => {
  await mount(); const pending = deferred<void>(); storageMock.clearAuthSession.mockReturnValueOnce(pending.promise);
  const input = { ...INPUT };
  await act(async () => { void value.signIn(input); input.username = 'changed'; input.password = 'changed'; });
  await act(async () => { pending.resolve(); });
  expect(apiMock.loginApiOwner).toHaveBeenCalledWith(INPUT, expect.any(Object));
});
test('wrong password remains on login with no persisted session', async () => {
  await mount(); apiMock.loginApiOwner.mockRejectedValueOnce(rejected());
  await act(async () => { await value.signIn(INPUT); });
  expect(value.status).toBe('login'); expect(value.errorMessage).toBe('A controlled API error.');
  expect(storageMock.saveAuthSession).not.toHaveBeenCalled(); expect(value.isSubmitting).toBe(false);
});
test('network failure does not automatically repeat a login attempt', async () => {
  await mount(); apiMock.loginApiOwner.mockRejectedValueOnce(new ApiError('Reply lost.', { kind: 'timeout', mutationMayHaveSucceeded: true }));
  await act(async () => { await value.signIn(INPUT); });
  expect(value.status).toBe('login'); expect(apiMock.loginApiOwner).toHaveBeenCalledTimes(1);
});
test('failure to clear old storage prevents sending the password', async () => {
  await mount(); storageMock.clearAuthSession.mockRejectedValueOnce(new AuthSessionStorageError('clear'));
  await act(async () => { await value.signIn(INPUT); });
  expect(apiMock.loginApiOwner).not.toHaveBeenCalled(); expect(value.status).toBe('login');
});
test('failure to verify a new session rolls it back instead of opening the app', async () => {
  await mount(); apiMock.fetchApiAuthSession.mockRejectedValueOnce(rejected());
  await act(async () => { await value.signIn(INPUT); });
  expect(apiMock.logoutApiOwner).toHaveBeenCalledWith(login().credentials, { baseUrl: BASE });
  expect(value.status).toBe('login'); expect(value.identity).toBeNull();
  expect(storageMock.saveAuthSession).not.toHaveBeenCalled();
});
test.each(['sessionId', 'username', 'clientType'])('mismatched new-login %s is rolled back', async field => {
  await mount();
  apiMock.fetchApiAuthSession.mockResolvedValueOnce({ ...login().identity,
    [field]: field === 'sessionId' ? OTHER_SESSION : field === 'username' ? 'someone-else' : 'native' });
  await act(async () => { await value.signIn(INPUT); });
  expect(value.status).toBe('login'); expect(apiMock.logoutApiOwner).toHaveBeenCalledTimes(1);
  expect(value.errorMessage).toContain('could not be verified');
});
test('a new session that cannot be saved is revoked and never published', async () => {
  await mount(); storageMock.saveAuthSession.mockRejectedValueOnce(new AuthSessionStorageError('write'));
  await act(async () => { await value.signIn(INPUT); });
  expect(value.status).toBe('login'); expect(value.errorMessage).toContain('storage write');
  expect(apiMock.logoutApiOwner).toHaveBeenCalledTimes(1); expect(value.identity).toBeNull();
});
test('failed rollback cleanup stays locked and is retryable without sending the password again', async () => {
  await mount(); storageMock.saveAuthSession.mockRejectedValueOnce(new AuthSessionStorageError('write'));
  apiMock.logoutApiOwner.mockRejectedValueOnce(new ApiError('Offline.', { kind: 'network' }));
  await act(async () => { await value.signIn(INPUT); });
  expect(value.status).toBe('error'); expect(value.errorMessage).toContain('Logout could not be fully confirmed');
  await act(async () => { await value.refreshAuthentication(); });
  expect(value.status).toBe('login'); expect(apiMock.loginApiOwner).toHaveBeenCalledTimes(1);
  expect(apiMock.logoutApiOwner).toHaveBeenCalledTimes(2);
});
test('unexpected exceptions are replaced with safe text', async () => {
  await mount(); apiMock.loginApiOwner.mockRejectedValueOnce(new Error('SECRET-DO-NOT-RENDER'));
  await act(async () => { await value.signIn(INPUT); });
  expect(value.errorMessage).not.toContain('SECRET'); expect(value.errorMessage).toContain('could not be completed');
});
test('login does nothing while setup is required', async () => {
  apiMock.fetchApiSetupStatus.mockResolvedValue({ ownerExists: false, setupReady: true }); await mount();
  await act(async () => { await value.signIn(INPUT); }); expect(apiMock.loginApiOwner).not.toHaveBeenCalled();
});

test('logout immediately locks the app and revokes the server session before confirming success', async () => {
  await restore(); const pending = deferred<void>(); apiMock.logoutApiOwner.mockReturnValueOnce(pending.promise);
  await act(async () => { void value.signOut(); });
  expect(value.status).toBe('checking'); expect(value.identity).toBeNull();
  expect(transportMock.configureApiSession).toHaveBeenLastCalledWith(null);
  await act(async () => { pending.resolve(); });
  expect(value.status).toBe('login'); expect(value.noticeMessage).toBe('You have signed out.'); expect(stored).toBeNull();
});
test('an already expired server session can finish logout cleanup', async () => {
  await restore(); apiMock.logoutApiOwner.mockRejectedValueOnce(rejected());
  await act(async () => { await value.signOut(); });
  expect(value.status).toBe('login'); expect(stored).toBeNull();
});
test('failed remote logout removes local material but reports incomplete revocation until retry succeeds', async () => {
  await restore(); apiMock.logoutApiOwner.mockRejectedValueOnce(new ApiError('Offline.', { kind: 'network' }));
  await act(async () => { await value.signOut(); });
  expect(value.status).toBe('error'); expect(stored).toBeNull();
  expect(value.errorMessage).toContain('Logout could not be fully confirmed');
  await act(async () => { await value.refreshAuthentication(); });
  expect(value.status).toBe('login'); expect(apiMock.logoutApiOwner).toHaveBeenCalledTimes(2);
});
test('local cleanup failure remains locked and retry does not needlessly revoke twice', async () => {
  await restore(); storageMock.clearAuthSession.mockRejectedValueOnce(new AuthSessionStorageError('clear'));
  await act(async () => { await value.signOut(); }); expect(value.status).toBe('error');
  await act(async () => { await value.refreshAuthentication(); });
  expect(value.status).toBe('login'); expect(apiMock.logoutApiOwner).toHaveBeenCalledTimes(1);
});
test('double logout taps revoke only once', async () => {
  await restore(); const pending = deferred<void>(); apiMock.logoutApiOwner.mockReturnValueOnce(pending.promise);
  await act(async () => { const logout = value.signOut; void logout(); void logout(); });
  expect(apiMock.logoutApiOwner).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); });
});
test('logout verifies a replacement browser session before revoking the shared current cookie', async () => {
  await restore();
  stored = { ...cache(), sessionId: OTHER_SESSION, credentials: { clientType: 'web', csrfToken: TOKEN } };
  apiMock.fetchApiAuthSession.mockResolvedValueOnce({ ...login().identity, sessionId: OTHER_SESSION });
  await act(async () => { await value.signOut(); });
  expect(apiMock.logoutApiOwner).toHaveBeenCalledWith({ clientType: 'web', csrfToken: TOKEN }, { baseUrl: BASE });
  expect(value.status).toBe('login'); expect(stored).toBeNull();
});
test('a browser change queued during logout cannot immediately reopen the app after logout', async () => {
  await restore(); const pending = deferred<void>(); apiMock.logoutApiOwner.mockReturnValueOnce(pending.promise);
  await act(async () => { void value.signOut(); }); await storageEvent();
  const checks = apiMock.fetchApiSetupStatus.mock.calls.length;
  await act(async () => { pending.resolve(); });
  expect(value.status).toBe('login'); expect(apiMock.fetchApiSetupStatus).toHaveBeenCalledTimes(checks);
});
test('logout does nothing if there is no session', async () => {
  await mount(); await act(async () => { await value.signOut(); }); expect(apiMock.logoutApiOwner).not.toHaveBeenCalled();
});
test('a protected 401 clears the matching session and returns to login', async () => {
  await restore(); await act(async () => { rejection!({ baseUrl: BASE, sessionId: SESSION }); });
  expect(value.status).toBe('login'); expect(stored).toBeNull(); expect(value.noticeMessage).toContain('session has ended');
});
test.each([{ baseUrl: BASE, sessionId: OTHER_SESSION }, { baseUrl: 'https://other.example.test', sessionId: SESSION }])
('ignores a rejection for another session or server %#', async event => {
  await restore(); await act(async () => { rejection!(event); }); expect(value.status).toBe('authenticated');
});
test('the absolute deadline returns the idle app to login', async () => {
  await restore(); await act(async () => { await jest.advanceTimersByTimeAsync(8 * 60 * 60 * 1000); });
  expect(value.status).toBe('login'); expect(value.identity).toBeNull(); expect(stored).toBeNull();
});
test('other-tab changes trigger session verification rather than trusting changed storage', async () => {
  await restore(); const reads = apiMock.fetchApiAuthSession.mock.calls.length;
  await storageEvent(); expect(apiMock.fetchApiAuthSession).toHaveBeenCalledTimes(reads + 1);
  expect(value.status).toBe('authenticated');
});
test('another tab clearing the login moves this tab to login', async () => {
  await restore(); stored = null; await storageEvent(null);
  expect(value.status).toBe('login'); expect(value.identity).toBeNull();
});
test('unrelated storage events do not refresh authentication', async () => {
  await restore(); const reads = apiMock.fetchApiSetupStatus.mock.calls.length;
  await storageEvent('some-other-preference'); await storageEvent(null, {} as Storage);
  expect(apiMock.fetchApiSetupStatus).toHaveBeenCalledTimes(reads);
});
test('changing server configuration does not reuse the previous instance identity', async () => {
  await restore(); stored = null; address = 'https://another.example.test'; await render();
  expect(value.status).toBe('login'); expect(value.identity).toBeNull();
  expect(apiMock.fetchApiSetupStatus).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: address }));
});
test('an old startup response cannot reopen a changed instance', async () => {
  const pending = deferred<api.AuthSetupStatus>(); apiMock.fetchApiSetupStatus.mockReturnValueOnce(pending.promise);
  await mount(); address = 'https://another.example.test'; await render();
  await act(async () => { pending.resolve({ ownerExists: false, setupReady: true }); });
  expect(value.status).toBe('login'); expect(value.setupReady).toBe(false);
});
test('unmount cancels the in-progress auth request and removes subscriptions', async () => {
  const pending = deferred<api.AuthSetupStatus>(); apiMock.fetchApiSetupStatus.mockReturnValueOnce(pending.promise);
  await mount(); const signal = apiMock.fetchApiSetupStatus.mock.calls[0][0]!.signal!;
  await act(async () => { root!.unmount(); }); root = undefined;
  expect(signal.aborted).toBe(true); expect(unsubscribe).toHaveBeenCalledTimes(1); expect(events.size).toBe(0);
  await act(async () => { pending.resolve({ ownerExists: true, setupReady: false }); });
  expect(storageMock.loadAuthSession).not.toHaveBeenCalled();
});
test('a late login response after unmount cannot persist or install a session', async () => {
  await mount(); const pending = deferred<api.AuthLoginResult>(); apiMock.loginApiOwner.mockReturnValueOnce(pending.promise);
  await act(async () => { void value.signIn(INPUT); });
  await act(async () => { root!.unmount(); }); root = undefined;
  transportMock.configureApiSession.mockClear();
  await act(async () => { pending.resolve(login()); });
  expect(storageMock.saveAuthSession).not.toHaveBeenCalled(); expect(transportMock.configureApiSession).not.toHaveBeenCalled();
});
