/** Storage isolation and failure handling. No real keychain, browser, or API. */
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(), getItemAsync: jest.fn(),
  setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthLoginResult } from '../lib/api/authApi';
import {
    AuthSessionStorageError, clearAuthSession, loadAuthSession, saveAuthSession,
} from '../lib/authSessionStorage';

const BASE = 'https://weekflow.example.test';
const OPTIONS = { baseUrl: BASE };
const NOW = Date.parse('2026-11-08T12:00:00Z');
const EXPIRES = '2026-11-08T20:00:00Z';
const SESSION = 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18';
const TOKEN = 'a'.repeat(43), CSRF = 'b'.repeat(43);
const platform = Platform as { OS: string };
const originalPlatform = platform.OS;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
let webData: Map<string, string>;
let nativeData: Map<string, string>;
let storage: { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock };

function browser(address = BASE) {
  platform.OS = 'web';
  Object.defineProperty(globalThis, 'window', { configurable: true,
    value: { location: new URL(address), localStorage: storage } });
}
function login(native = false): AuthLoginResult {
  return { identity: { sessionId: SESSION, accountId: 1, username: 'corey',
    clientType: native ? 'native' : 'web', expiresAt: EXPIRES },
    credentials: native ? { clientType: 'native', token: TOKEN } : { clientType: 'web', csrfToken: CSRF } };
}
function envelope(native = false) {
  const result = login(native);
  return { version: 1, origin: BASE, sessionId: SESSION, expiresAt: EXPIRES, credentials: result.credentials };
}
function key(origin = BASE) {
  return `weekflow.auth.v1.${Array.from(origin, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  webData = new Map(); nativeData = new Map();
  storage = {
    getItem: jest.fn((name: string) => webData.get(name) ?? null),
    setItem: jest.fn((name: string, value: string) => { webData.set(name, value); }),
    removeItem: jest.fn((name: string) => { webData.delete(name); }),
  };
  browser(); process.env.EXPO_PUBLIC_API_BASE_URL = BASE;
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async name => nativeData.get(name) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value) => { nativeData.set(name, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async name => { nativeData.delete(name); });
});
afterEach(() => {
  jest.restoreAllMocks(); platform.OS = originalPlatform;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl;
});

test('web persists only the CSRF credential and session reference, not the owner or a session token', async () => {
  await saveAuthSession(login(), OPTIONS);
  expect(JSON.parse(webData.get(key())!)).toEqual(envelope());
  expect(webData.get(key())).not.toContain('corey');
  expect(webData.get(key())).not.toContain('password');
  expect(JSON.parse(webData.get(key())!).credentials).not.toHaveProperty('token');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
test('restores web login material without asserting that the user is authenticated', async () => {
  await saveAuthSession(login(), OPTIONS);
  await expect(loadAuthSession(OPTIONS)).resolves.toEqual({ sessionId: SESSION, expiresAt: EXPIRES, credentials: login().credentials });
});
test('uses the configured server address by default', async () => {
  await saveAuthSession(login());
  expect(webData.has(key())).toBe(true);
});
test('canonicalizes hostname case, default port, spaces, and trailing slash to one scope', async () => {
  await saveAuthSession(login(), { baseUrl: '  https://WEEKFLOW.example.test:443/  ' });
  await expect(loadAuthSession(OPTIONS)).resolves.toMatchObject({ sessionId: SESSION });
  expect(webData.size).toBe(1);
});
test.each(['ios', 'android'])('uses SecureStore for %s, never browser storage', async os => {
  platform.OS = os; Reflect.deleteProperty(globalThis, 'window');
  await saveAuthSession(login(true), OPTIONS);
  expect(nativeData.get(key())).toBe(JSON.stringify(envelope(true)));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(key(), expect.any(String), {
    keychainService: 'weekflow.auth.sessions.v1', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  });
  expect(storage.setItem).not.toHaveBeenCalled();
  await expect(loadAuthSession(OPTIONS)).resolves.toMatchObject({ credentials: { clientType: 'native', token: TOKEN } });
  await clearAuthSession(OPTIONS);
  expect(nativeData.size).toBe(0);
  expect(storage.removeItem).not.toHaveBeenCalled();
});
test('never changes unrelated browser data while saving or clearing a session', async () => {
  webData.set('weekflow.other-setting', 'keep');
  await saveAuthSession(login(), OPTIONS); await clearAuthSession(OPTIONS);
  expect(webData).toEqual(new Map([['weekflow.other-setting', 'keep']]));
});
test('native credentials for another server are isolated and cannot be loaded under this server', async () => {
  platform.OS = 'ios';
  const other = { baseUrl: 'https://another.example.test' };
  await saveAuthSession(login(true), OPTIONS); await saveAuthSession(login(true), other);
  expect(nativeData.size).toBe(2);
  await clearAuthSession(other);
  await expect(loadAuthSession(OPTIONS)).resolves.not.toBeNull();
  await expect(loadAuthSession(other)).resolves.toBeNull();
});
test('different HTTPS ports have different native storage keys', async () => {
  platform.OS = 'android';
  await saveAuthSession(login(true), OPTIONS);
  await expect(loadAuthSession({ baseUrl: `${BASE}:8443` })).resolves.toBeNull();
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith(key(`${BASE}:8443`), expect.any(Object));
});
test('SecureStore keys use only supported characters', async () => {
  platform.OS = 'ios'; await saveAuthSession(login(true), { baseUrl: 'https://[::1]:8443' });
  expect(jest.mocked(SecureStore.setItemAsync).mock.calls[0][0]).toMatch(/^[A-Za-z0-9._-]+$/);
});
test('a missing entry returns null without trying to remove anything', async () => {
  await expect(loadAuthSession(OPTIONS)).resolves.toBeNull();
  expect(storage.removeItem).not.toHaveBeenCalled();
});
test('a malformed stored value is removed instead of becoming authenticated state', async () => {
  webData.set(key(), 'not-json');
  await expect(loadAuthSession(OPTIONS)).resolves.toBeNull();
  expect(webData.has(key())).toBe(false);
});
test.each([
  { version: 2 }, { origin: 'https://another.example.test' }, { sessionId: 'bad' },
  { expiresAt: '2026-11-08T11:59:59Z' }, { expiresAt: '2026-11-08T12:00:00Z' },
  { expiresAt: '2026-11-09T12:00:00' }, { expiresAt: '2027-02-30T12:00:00Z' },
  { credentials: { clientType: 'native', token: TOKEN } },
  { credentials: { clientType: 'web', csrfToken: 'bad' } },
  { credentials: { clientType: 'web', csrfToken: CSRF, token: TOKEN } },
  { password: 'never-restore-a-password' },
])('discards incompatible, expired, or excessive stored fields %#', async changes => {
  webData.set(key(), JSON.stringify({ ...envelope(), ...changes }));
  await expect(loadAuthSession(OPTIONS)).resolves.toBeNull();
  expect(storage.removeItem).toHaveBeenCalledWith(key());
});
test.each([null, [], {}, false, 123])('discards non-session JSON %#', async value => {
  webData.set(key(), JSON.stringify(value));
  await expect(loadAuthSession(OPTIONS)).resolves.toBeNull();
  expect(webData.has(key())).toBe(false);
});
test('discards oversized values before attempting JSON parsing', async () => {
  webData.set(key(), 'x'.repeat(2049));
  const parse = jest.spyOn(JSON, 'parse');
  await expect(loadAuthSession(OPTIONS)).resolves.toBeNull();
  expect(parse).not.toHaveBeenCalled();
  expect(webData.has(key())).toBe(false);
});
test('clears an invalid native record from SecureStore', async () => {
  platform.OS = 'ios'; nativeData.set(key(), JSON.stringify(envelope()));
  await expect(loadAuthSession(OPTIONS)).resolves.toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(key(), expect.any(Object));
});
test.each(['http://localhost:8000', 'https://user:password@weekflow.example.test', `${BASE}/api`,
  `${BASE}?x=1`, `${BASE}#x`, `${BASE}?`, `${BASE}#`, '', 'not-a-url',
])('rejects unsuitable server addresses before touching storage %#', async baseUrl => {
  await expect(loadAuthSession({ baseUrl })).rejects.toMatchObject({ code: 'configuration' });
  await expect(saveAuthSession(login(), { baseUrl })).rejects.toMatchObject({ code: 'configuration' });
  await expect(clearAuthSession({ baseUrl })).rejects.toMatchObject({ code: 'configuration' });
  expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled(); expect(SecureStore.isAvailableAsync).not.toHaveBeenCalled();
});
test.each(['http://localhost:8081', 'https://other.example.test', `${BASE}:8443`])('requires a matching HTTPS browser origin %#', async address => {
  browser(address);
  await expect(loadAuthSession(OPTIONS)).rejects.toMatchObject({ code: 'configuration' });
  expect(storage.getItem).not.toHaveBeenCalled();
});
test('missing browser location fails closed', async () => {
  Reflect.deleteProperty(globalThis, 'window');
  await expect(loadAuthSession(OPTIONS)).rejects.toMatchObject({ code: 'configuration' });
});
test('unsupported platforms do not fall back to unprotected storage', async () => {
  platform.OS = 'windows';
  await expect(saveAuthSession(login(true), OPTIONS)).rejects.toMatchObject({ code: 'unavailable' });
  expect(storage.setItem).not.toHaveBeenCalled(); expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
test('a denied browser storage getter produces a controlled error', async () => {
  Object.defineProperty(window, 'localStorage', { get() { throw new Error(TOKEN); } });
  await expect(loadAuthSession(OPTIONS)).rejects.toMatchObject({ code: 'unavailable' });
  await expect(loadAuthSession(OPTIONS)).rejects.not.toThrow(TOKEN);
});
test.each(['read', 'write', 'clear'] as const)('redacts browser %s failures', async operation => {
  const fail = () => { throw new Error(TOKEN); };
  if (operation === 'read') storage.getItem.mockImplementation(fail);
  if (operation === 'write') storage.setItem.mockImplementation(fail);
  if (operation === 'clear') storage.removeItem.mockImplementation(fail);
  const action = () => operation === 'read' ? loadAuthSession(OPTIONS)
    : operation === 'write' ? saveAuthSession(login(), OPTIONS) : clearAuthSession(OPTIONS);
  await expect(action()).rejects.toMatchObject({ name: 'AuthSessionStorageError', code: operation });
  await expect(action()).rejects.not.toThrow(TOKEN);
});
test.each(['read', 'write', 'clear'] as const)('redacts native %s failures', async operation => {
  platform.OS = 'ios';
  if (operation === 'read') jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error(TOKEN));
  if (operation === 'write') jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error(TOKEN));
  if (operation === 'clear') jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(new Error(TOKEN));
  const action = () => operation === 'read' ? loadAuthSession(OPTIONS)
    : operation === 'write' ? saveAuthSession(login(true), OPTIONS) : clearAuthSession(OPTIONS);
  await expect(action()).rejects.toMatchObject({ code: operation });
  await expect(action()).rejects.not.toThrow(TOKEN);
});
test.each([false, 'throw'])('missing native secure storage fails without a plain-storage fallback %#', async result => {
  platform.OS = 'ios';
  if (result === false) jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
  else jest.mocked(SecureStore.isAvailableAsync).mockRejectedValue(new Error(TOKEN));
  await expect(loadAuthSession(OPTIONS)).rejects.toMatchObject({ code: 'unavailable' });
  expect(storage.getItem).not.toHaveBeenCalled(); expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});
test('failure to discard a corrupt entry is reported rather than claiming cleanup succeeded', async () => {
  webData.set(key(), 'bad'); storage.removeItem.mockImplementation(() => { throw new Error(TOKEN); });
  await expect(loadAuthSession(OPTIONS)).rejects.toMatchObject({ code: 'clear' });
});
test.each([
  { identity: { ...login().identity, sessionId: 'bad' } },
  { identity: { ...login().identity, accountId: 2 } },
  { identity: { ...login().identity, username: 'COREY' } },
  { identity: { ...login().identity, expiresAt: '2026-11-08T11:00:00Z' } },
  { identity: { ...login().identity, clientType: 'native' } },
  { credentials: { clientType: 'native', token: TOKEN } },
  { credentials: { clientType: 'web', csrfToken: CSRF, token: TOKEN } },
  { password: 'must-not-save' },
])('rejects malformed or mixed login results without overwriting existing storage %#', async changes => {
  webData.set(key(), 'existing');
  await expect(saveAuthSession({ ...login(), ...changes } as AuthLoginResult, OPTIONS)).rejects.toMatchObject({ code: 'invalid-session' });
  expect(webData.get(key())).toBe('existing'); expect(storage.setItem).not.toHaveBeenCalled();
});
test.each([null, [], {}, { identity: null }])('rejects non-login input safely %#', async value => {
  await expect(saveAuthSession(value as unknown as AuthLoginResult, OPTIONS)).rejects.toBeInstanceOf(AuthSessionStorageError);
  expect(storage.setItem).not.toHaveBeenCalled();
});
test('snapshots login material before an asynchronous save', async () => {
  const result = login(); const pending = saveAuthSession(result, OPTIONS);
  result.identity.sessionId = 'changed';
  if (result.credentials.clientType === 'web') result.credentials.csrfToken = 'changed';
  await pending;
  expect(JSON.parse(webData.get(key())!)).toEqual(envelope());
});
test('captures server scope before waiting instead of following later configuration changes', async () => {
  platform.OS = 'ios'; const pending = saveAuthSession(login(true));
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://other.example.test';
  await pending;
  expect(nativeData.has(key())).toBe(true);
  expect(nativeData.size).toBe(1);
});
test('a queued logout clear waits for a pending native save, preventing token resurrection', async () => {
  platform.OS = 'ios'; const pending = deferred();
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (name, value) => {
    await pending.promise; nativeData.set(name, value);
  });
  const save = saveAuthSession(login(true), OPTIONS);
  const clear = clearAuthSession(OPTIONS);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  pending.resolve(); await Promise.all([save, clear]);
  expect(nativeData.size).toBe(0);
});
test('a failed write does not block a later cleanup operation', async () => {
  platform.OS = 'ios'; nativeData.set(key(), 'old');
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error(TOKEN));
  const save = saveAuthSession(login(true), OPTIONS);
  const clear = clearAuthSession(OPTIONS);
  await expect(save).rejects.toMatchObject({ code: 'write' }); await clear;
  expect(nativeData.size).toBe(0);
});
test('reads wait for a prior native save and return fresh objects', async () => {
  platform.OS = 'ios';
  const save = saveAuthSession(login(true), OPTIONS); const read = loadAuthSession(OPTIONS);
  await save; const first = await read;
  expect(first).not.toBeNull();
  if (first?.credentials.clientType === 'native') first.credentials.token = 'changed';
  expect((await loadAuthSession(OPTIONS))?.credentials).toEqual({ clientType: 'native', token: TOKEN });
});
