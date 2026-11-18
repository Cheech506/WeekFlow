/**
 * Packaged-browser address selection across the real frontend auth modules.
 * HTTP, browser storage, and native storage are simulated. No API or database
 * is contacted. Cookie attributes and server authentication have separate
 * backend tests; real browser/deployment checks are still required.
 */
// Keep mocks above imports: the project transformer does not hoist them.
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(), getItemAsync: jest.fn(),
  setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import React, { act } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';
import { AuthProvider, useAuth, type AuthContextValue } from '../context/AuthContext';
import { apiRequest, configureApiSession } from '../lib/api/apiClient';
import type { AuthLoginResult } from '../lib/api/authApi';
import { saveAuthSession } from '../lib/authSessionStorage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const BASE = 'https://weekflow.example.test';
const OTHER = 'https://another-weekflow.example.test';
const SESSION = 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18';
const EXPIRES = '2026-11-12T20:00:00Z';
const CSRF = 'b'.repeat(43);
const INPUT = { username: 'corey', password: 'This is a test password.' };
const platform = Platform as { OS: string };
const originalPlatform = platform.OS;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAddress = process.env.EXPO_PUBLIC_API_BASE_URL;

let root: ReturnType<typeof createRoot> | undefined;
let auth: AuthContextValue;
let fetchSpy: jest.SpyInstance;
let data: Map<string, string>;
let storage: Storage;
let ownerExists: boolean;
let setupReady: boolean;
let sessionValid: boolean;

function identity() {
  return { session_id: SESSION, account_id: 1, username: 'corey',
    client_type: 'web', expires_at: EXPIRES };
}

function savedLogin(): AuthLoginResult {
  return { identity: { sessionId: SESSION, accountId: 1, username: 'corey',
    clientType: 'web', expiresAt: EXPIRES },
    credentials: { clientType: 'web', csrfToken: CSRF } };
}

function browser(address = `${BASE}/settings`) {
  platform.OS = 'web';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: new URL(address), localStorage: storage,
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  } });
}

function json(value: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), { status });
}

async function server(input: unknown, options: RequestInit = {}): Promise<Response> {
  const path = new URL(String(input)).pathname;
  const method = options.method ?? 'GET';
  if (path === '/api/v1/auth/setup/status' && method === 'GET') {
    return json({ owner_exists: ownerExists, setup_ready: !ownerExists && setupReady });
  }
  if (path === '/api/v1/auth/setup' && method === 'POST') {
    ownerExists = true;
    return json({ id: 1, username: 'corey' }, 201);
  }
  if (path === '/api/v1/auth/web/login' && method === 'POST') {
    sessionValid = true;
    return json({ identity: identity(), csrf_token: CSRF });
  }
  if (path === '/api/v1/auth/session' && method === 'GET') {
    return sessionValid ? json(identity()) : json({ detail: 'Session ended.' }, 401);
  }
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    sessionValid = false;
    return json(null, 204);
  }
  if (path === '/api/v1/tasks') return json(method === 'GET' ? [] : { id: 1 });
  throw new Error('Unexpected request in the simulated WeekFlow server.');
}

function requests(path: string) {
  return fetchSpy.mock.calls.map(call => ({
    url: String(call[0]), options: call[1] as RequestInit,
  })).filter(call => new URL(call.url).pathname === path);
}

function Probe() { auth = useAuth(); return null; }

async function mount(baseUrl?: string) {
  root = createRoot();
  await act(async () => {
    root!.render(React.createElement(AuthProvider, {
      baseUrl, children: React.createElement(Probe),
    }));
  });
}

async function signIn() {
  await mount();
  await act(async () => { await auth.signIn(INPUT); });
  expect(auth.status).toBe('authenticated');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  configureApiSession(null);
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  data = new Map();
  storage = {
    get length() { return data.size; },
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
    clear: () => { data.clear(); },
    key: index => [...data.keys()][index] ?? null,
  };
  ownerExists = true;
  setupReady = false;
  sessionValid = true;
  browser();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(server);
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  configureApiSession(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
  platform.OS = originalPlatform;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalAddress === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalAddress;
});

test('an unconfigured HTTPS browser reaches login using its own origin', async () => {
  await mount();
  expect(auth.status).toBe('login');
  expect(requests('/api/v1/auth/setup/status')[0].url).toBe(`${BASE}/api/v1/auth/setup/status`);
  expect(process.env.EXPO_PUBLIC_API_BASE_URL).toBeUndefined();
});

test('first-owner setup uses the detected origin and then requires sign-in', async () => {
  ownerExists = false;
  setupReady = true;
  await mount();
  expect(auth.status).toBe('setup');
  expect(auth.setupReady).toBe(true);
  await act(async () => { await auth.createOwner({ ...INPUT, setupCode: 'c'.repeat(43) }); });
  expect(auth.status).toBe('login');
  const setup = requests('/api/v1/auth/setup')[0];
  expect(setup.url).toBe(`${BASE}/api/v1/auth/setup`);
  expect(JSON.parse(setup.options.body as string)).toEqual({ ...INPUT, setup_code: 'c'.repeat(43) });
  expect(requests('/api/v1/auth/web/login')).toHaveLength(0);
  expect(data.size).toBe(0);
});

test('login, session verification, storage, and protected writes use the same detected origin', async () => {
  await signIn();
  expect(requests('/api/v1/auth/web/login')).toHaveLength(1);
  expect(requests('/api/v1/auth/session')).toHaveLength(1);
  const cached = JSON.parse([...data.values()][0]);
  expect(cached.origin).toBe(BASE);
  expect(cached.credentials).toEqual({ clientType: 'web', csrfToken: CSRF });
  expect(cached).not.toHaveProperty('password');
  expect(cached.credentials).not.toHaveProperty('token');
  await expect(apiRequest('/api/v1/tasks', value => value, {
    method: 'POST', body: { title: 'Packaged browser task' },
  })).resolves.toEqual({ id: 1 });
  const write = requests('/api/v1/tasks')[0];
  expect(write.url).toBe(`${BASE}/api/v1/tasks`);
  expect(write.options.headers).toMatchObject({ 'X-CSRF-Token': CSRF });
  expect(write.options.headers).not.toHaveProperty('Authorization');
  expect(write.options.credentials).toBe('same-origin');
  expect(write.options.redirect).toBe('error');
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

test('a saved browser session is verified against the detected server before authentication', async () => {
  await saveAuthSession(savedLogin());
  await mount();
  expect(auth.status).toBe('authenticated');
  expect(requests('/api/v1/auth/session')[0].url).toBe(`${BASE}/api/v1/auth/session`);
  expect(requests('/api/v1/auth/web/login')).toHaveLength(0);
});

test('a rejected saved session returns to login and clears its local metadata', async () => {
  await saveAuthSession(savedLogin());
  sessionValid = false;
  await mount();
  expect(auth.status).toBe('login');
  expect(data.size).toBe(0);
  expect(requests('/api/v1/auth/web/login')).toHaveLength(0);
});

test('logout uses the detected origin, sends CSRF, and clears the saved login', async () => {
  await signIn();
  await act(async () => { await auth.signOut(); });
  expect(auth.status).toBe('login');
  expect(data.size).toBe(0);
  const logout = requests('/api/v1/auth/logout')[0];
  expect(logout.url).toBe(`${BASE}/api/v1/auth/logout`);
  expect(logout.options.headers).toMatchObject({ 'X-CSRF-Token': CSRF });
  expect(logout.options.credentials).toBe('same-origin');
});

test('HTTP browser startup is rejected before any credentials or requests are sent', async () => {
  browser('http://localhost:8081');
  await mount();
  expect(auth.status).toBe('error');
  expect(auth.errorMessage).toContain('HTTPS');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['ios', 'android'])(
  'an unconfigured %s app cannot use a debugger browser origin', async os => {
    platform.OS = os;
    await mount();
    expect(auth.status).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

test('a configured browser/server mismatch is reported rather than silently replaced', async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = OTHER;
  await mount();
  expect(auth.status).toBe('error');
  expect(auth.errorMessage).toContain('same HTTPS address');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each(['', '   '])('blank configuration %j is not hidden by website fallback', async address => {
  process.env.EXPO_PUBLIC_API_BASE_URL = address;
  await mount();
  expect(auth.status).toBe('error');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('a previously verified session cannot send credentials to a newly detected origin', async () => {
  await signIn();
  const calls = fetchSpy.mock.calls.length;
  browser(OTHER);
  await expect(apiRequest('/api/v1/tasks', value => value)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).toHaveBeenCalledTimes(calls);
});

test('a nondefault HTTPS port is used consistently for requests and saved metadata', async () => {
  const origin = 'https://localhost:9443';
  browser(`${origin}/inbox`);
  await signIn();
  expect(fetchSpy.mock.calls.every(call => new URL(String(call[0])).origin === origin)).toBe(true);
  expect(JSON.parse([...data.values()][0]).origin).toBe(origin);
});

test('an explicit provider address still takes precedence over environment configuration', async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = OTHER;
  await mount(BASE);
  expect(auth.status).toBe('login');
  expect(requests('/api/v1/auth/setup/status')[0].url).toBe(`${BASE}/api/v1/auth/setup/status`);
});

test('another installation does not reuse the first installation\'s saved metadata', async () => {
  await saveAuthSession(savedLogin());
  browser(OTHER);
  await mount();
  expect(auth.status).toBe('login');
  expect(requests('/api/v1/auth/setup/status')[0].url).toBe(`${OTHER}/api/v1/auth/setup/status`);
  expect(requests('/api/v1/auth/session')).toHaveLength(0);
  expect(JSON.parse([...data.values()][0]).origin).toBe(BASE);
});
