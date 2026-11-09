/** Authentication HTTP contracts. These tests never create a real account. */
import { Platform } from 'react-native';
import {
    createApiOwner, fetchApiAuthSession, fetchApiSetupStatus, loginApiOwner,
    logoutApiOwner, type AuthCredentials, type AuthLoginInput, type AuthOwnerSetupInput,
} from '../lib/api/authApi';

const BASE = 'https://weekflow.example.test';
const OPTIONS = { baseUrl: BASE };
const TOKEN = 'a'.repeat(43);
const CSRF = 'b'.repeat(43);
const INPUT = { username: '  COREY  ', password: '  My exact password!  ' };
const platform = Platform as { OS: string };
const originalPlatform = platform.OS;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
let fetchSpy: jest.SpyInstance;

function identity(changes: Record<string, unknown> = {}) {
  return { session_id: 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18', account_id: 1,
    username: 'corey', client_type: 'web', expires_at: '2026-11-08T20:00:00+00:00', ...changes };
}
function browser(address = `${BASE}/settings`) {
  platform.OS = 'web';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: new URL(address) } });
}
function respond(value: unknown, status = 200) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(value), { status }));
}
function request() { return fetchSpy.mock.calls[0][1] as RequestInit; }
function body() { return JSON.parse(request().body as string); }
function nativeCredentials(): AuthCredentials { return { clientType: 'native', token: TOKEN }; }
function webCredentials(): AuthCredentials { return { clientType: 'web', csrfToken: CSRF }; }

beforeEach(() => {
  browser();
  process.env.EXPO_PUBLIC_API_BASE_URL = BASE;
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => {
  jest.restoreAllMocks();
  platform.OS = originalPlatform;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl;
});

test.each([[false, false], [false, true], [true, false]])('reads setup flags %j/%j without sending credentials', async (owner, ready) => {
  respond({ owner_exists: owner, setup_ready: ready });
  await expect(fetchApiSetupStatus(OPTIONS)).resolves.toEqual({ ownerExists: owner, setupReady: ready });
  expect(fetchSpy).toHaveBeenCalledWith(`${BASE}/api/v1/auth/setup/status`, expect.objectContaining({ method: 'GET' }));
  expect(request()).not.toHaveProperty('body');
  expect(request().headers).not.toHaveProperty('Authorization');
});
test.each([{ owner_exists: true, setup_ready: true }, { owner_exists: 1, setup_ready: false },
  { owner_exists: false }, [], null, { owner_exists: false, setup_ready: true, setup_code: TOKEN },
])('rejects malformed or overexposed setup responses %#', async (value) => {
  respond(value);
  await expect(fetchApiSetupStatus(OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});
test('uses the configured HTTPS API address when no override is supplied', async () => {
  respond({ owner_exists: false, setup_ready: false });
  await fetchApiSetupStatus();
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/setup/status`);
});
test('normalizes the address and leaves request internals under client control', async () => {
  respond({ owner_exists: false, setup_ready: false });
  await fetchApiSetupStatus({ baseUrl: `  ${BASE}/  `, method: 'POST', body: INPUT,
    headers: { Authorization: 'injected' } } as never);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/setup/status`);
  expect(request().method).toBe('GET');
  expect(request()).not.toHaveProperty('body');
  expect(request().headers).not.toHaveProperty('Authorization');
});
test.each(['http://localhost:8000', `${BASE}/api`, `${BASE}/?secret=x`, `${BASE}/#x`, `${BASE}/?`,
  `${BASE}/#`, 'https://user:password@weekflow.example.test', 'not-a-url', '', 'ftp://weekflow.example.test',
])('rejects unsuitable API addresses %# without fetching', async (baseUrl) => {
  await expect(fetchApiSetupStatus({ baseUrl })).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each(['http://localhost:8081', 'https://other.example.test', `${BASE}:8443`, `${BASE}:0`])(
  'requires the browser to share the API HTTPS origin %#', async (address) => {
    browser(address);
    await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchSpy).not.toHaveBeenCalled();
  }
);
test('rejects a web environment without a browser location', async () => {
  Reflect.deleteProperty(globalThis, 'window');
  await expect(fetchApiSetupStatus(OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test('accepts an explicitly specified default HTTPS port as the same origin', async () => {
  browser('https://weekflow.example.test:443/settings');
  respond({ owner_exists: true, setup_ready: false });
  await expect(fetchApiSetupStatus(OPTIONS)).resolves.toMatchObject({ ownerExists: true });
});
test('rejects unsupported platforms', async () => {
  platform.OS = 'windows';
  await expect(fetchApiSetupStatus(OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('creates the owner with the setup code, normalized username, and exact password', async () => {
  respond({ id: 1, username: 'corey' }, 201);
  await expect(createApiOwner({ ...INPUT, setupCode: TOKEN }, OPTIONS)).resolves.toEqual({ id: 1, username: 'corey' });
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/setup`);
  expect(request().method).toBe('POST');
  expect(body()).toEqual({ username: 'corey', password: INPUT.password, setup_code: TOKEN });
  expect(fetchSpy).toHaveBeenCalledTimes(1); // Creating an owner does not implicitly log in.
});
test('snapshots setup input before the form changes while awaiting HTTP', async () => {
  respond({ id: 1, username: 'corey' }, 201);
  const input = { ...INPUT, setupCode: TOKEN };
  const pending = createApiOwner(input, OPTIONS);
  input.username = 'someone-else'; input.password = 'changed'; input.setupCode = CSRF;
  await pending;
  expect(body()).toEqual({ username: 'corey', password: INPUT.password, setup_code: TOKEN });
});
test.each(['short', 'x'.repeat(44), ' '.repeat(43), `${'x'.repeat(42)}!`, null])('rejects malformed setup codes %#', async (setupCode) => {
  await expect(createApiOwner({ ...INPUT, setupCode } as AuthOwnerSetupInput, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each([{ id: 2, username: 'corey' }, { id: 1, username: 'someone-else' },
  { id: 1, username: 'corey', password_hash: 'must-not-be-returned' }, null,
])('rejects incorrect owner confirmation %#', async (value) => {
  respond(value, 201);
  await expect(createApiOwner({ ...INPUT, setupCode: TOKEN }, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});

test('browser login returns only identity and CSRF credentials', async () => {
  respond({ identity: identity(), csrf_token: CSRF });
  const saved = await loginApiOwner(INPUT, OPTIONS);
  expect(saved).toEqual({ identity: { sessionId: identity().session_id, accountId: 1, username: 'corey',
    clientType: 'web', expiresAt: identity().expires_at }, credentials: { clientType: 'web', csrfToken: CSRF } });
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/web/login`);
  expect(body()).toEqual({ username: 'corey', password: INPUT.password });
  expect(saved.credentials).not.toHaveProperty('token');
  expect(request().headers).not.toHaveProperty('Cookie');
  expect(request().headers).not.toHaveProperty('Authorization');
});
test.each(['ios', 'android'])('uses the native login route on %s without accessing browser location', async (os) => {
  platform.OS = os;
  Reflect.deleteProperty(globalThis, 'window');
  respond({ identity: identity({ client_type: 'native' }), token: TOKEN, token_type: 'Bearer' });
  const saved = await loginApiOwner(INPUT, OPTIONS);
  expect(saved.credentials).toEqual({ clientType: 'native', token: TOKEN });
  expect(saved.identity.clientType).toBe('native');
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/native/login`);
  expect(body()).toEqual({ username: 'corey', password: INPUT.password });
  expect(request().headers).not.toHaveProperty('X-CSRF-Token');
});
test.each(['short', 'x'.repeat(129), '\ud800', '\udfff', ' '.repeat(15)])('rejects invalid new passwords %#', async (password) => {
  await expect(createApiOwner({ ...INPUT, password, setupCode: TOKEN }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test('counts Unicode characters as Python does when checking password length', async () => {
  respond({ id: 1, username: 'corey' }, 201);
  const password = '🔒'.repeat(128);
  await createApiOwner({ ...INPUT, password, setupCode: TOKEN }, OPTIONS);
  expect(body().password).toBe(password);
});
test.each(['x', '   '])('allows existing passwords shorter than the new-password minimum %#', async (password) => {
  respond({ identity: identity(), csrf_token: CSRF });
  await loginApiOwner({ username: 'corey', password }, OPTIONS);
  expect(body().password).toBe(password);
});
test.each(['', 'x'.repeat(129), '\ud800'])('rejects invalid login passwords %#', async (password) => {
  await expect(loginApiOwner({ username: 'corey', password }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each(['ab', 'x'.repeat(65), 'co rey', 'Korey', '.corey', 'çorey'])('rejects invalid usernames %#', async (username) => {
  await expect(loginApiOwner({ ...INPUT, username }, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each([null, [], { ...INPUT, account_id: 1 }, { ...INPUT, token: TOKEN }, { username: 123, password: 'x' }])(
  'rejects unexpected login fields and non-object inputs %#', async (input) => {
    await expect(loginApiOwner(input as AuthLoginInput, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchSpy).not.toHaveBeenCalled();
  }
);
test('validation errors do not repeat a supplied secret', async () => {
  const secret = 'secret-to-never-include-in-errors'.repeat(6);
  await expect(loginApiOwner({ username: 'corey', password: secret }, OPTIONS)).rejects.not.toThrow(secret);
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each([
  { identity: identity(), csrf_token: 'bad' },
  { identity: identity({ client_type: 'native' }), csrf_token: CSRF },
  { identity: identity({ username: 'another' }), csrf_token: CSRF },
  { identity: identity(), csrf_token: CSRF, token: TOKEN },
  { identity: identity(), csrf_token: CSRF, password_hash: 'forbidden' },
  null,
])('rejects malformed or credential-leaking browser login response %#', async (value) => {
  respond(value);
  await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});
test.each([
  { identity: identity({ client_type: 'native' }), token: 'bad', token_type: 'Bearer' },
  { identity: identity({ client_type: 'native' }), token: TOKEN, token_type: 'Basic' },
  { identity: identity(), token: TOKEN, token_type: 'Bearer' },
  { identity: identity({ client_type: 'native' }), token: TOKEN, token_type: 'Bearer', csrf_token: CSRF },
])('rejects malformed or mixed native login response %#', async (value) => {
  platform.OS = 'ios'; respond(value);
  await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});

test('browser session checks rely on the HttpOnly cookie and never read it from JavaScript', async () => {
  respond(identity());
  await expect(fetchApiAuthSession(null, OPTIONS)).resolves.toMatchObject({ username: 'corey', clientType: 'web' });
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/session`);
  expect(request().headers).toEqual({ Accept: 'application/json' });
  expect(request()).not.toHaveProperty('body');
});
test('browser identity reads do not send the write-only CSRF header', async () => {
  respond(identity());
  await fetchApiAuthSession(webCredentials(), OPTIONS);
  expect(request().headers).not.toHaveProperty('X-CSRF-Token');
});
test('native session check sends exactly one bearer header', async () => {
  platform.OS = 'android'; respond(identity({ client_type: 'native' }));
  await fetchApiAuthSession(nativeCredentials(), OPTIONS);
  expect(request().headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}` });
});
test.each([
  { session_id: 'not-a-uuid' }, { account_id: 2 }, { username: 'COREY' },
  { client_type: 'native' }, { expires_at: '2026-11-08T20:00:00' },
  { expires_at: '2026-02-30T20:00:00Z' }, { expires_at: '2026-11-08T25:00:00Z' },
  { expires_at: null }, { token_hash: 'forbidden' },
])('rejects invalid session identity %#', async (changes) => {
  respond(identity(changes));
  await expect(fetchApiAuthSession(null, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response' });
});
test('browser logout sends the separate CSRF token and expects no response body', async () => {
  respond(null, 204);
  await expect(logoutApiOwner(webCredentials(), OPTIONS)).resolves.toBeUndefined();
  expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/logout`);
  expect(request().method).toBe('POST');
  expect(request().headers).toEqual({ Accept: 'application/json', 'X-CSRF-Token': CSRF });
  expect(request()).not.toHaveProperty('body');
});
test('native logout sends bearer credentials without CSRF or cookies', async () => {
  platform.OS = 'ios'; respond(null, 204);
  await logoutApiOwner(nativeCredentials(), OPTIONS);
  expect(request().headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}` });
});
test('rejects an unexpected nonempty logout result as an uncertain write', async () => {
  respond({ ok: true });
  await expect(logoutApiOwner(webCredentials(), OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
});
test.each([null, { clientType: 'web', csrfToken: 'bad' }, { clientType: 'native', token: TOKEN },
  { clientType: 'web', csrfToken: CSRF, token: TOKEN },
])('rejects absent, mixed, or wrong-platform browser logout credentials %#', async (value) => {
  await expect(logoutApiOwner(value as AuthCredentials, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each([null, { clientType: 'native', token: 'bad' }, { clientType: 'web', csrfToken: CSRF },
  { clientType: 'native', token: TOKEN, csrfToken: CSRF },
])('rejects absent or invalid native credentials %#', async (value) => {
  platform.OS = 'ios';
  await expect(fetchApiAuthSession(value as AuthCredentials, OPTIONS)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([401, 403, 409, 422, 429, 503])('preserves HTTP %s and makes no automatic login retry', async (status) => {
  respond({ detail: 'A safe backend error.' }, status);
  await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'http', status, message: 'A safe backend error.' });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
test('does not interpret a rejected login as a network outage', async () => {
  respond({ detail: 'Username or password is incorrect.' }, 401);
  await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'http', status: 401, mutationMayHaveSucceeded: false });
});
test('a disconnected login is uncertain and is never blindly repeated', async () => {
  fetchSpy.mockRejectedValue(new TypeError('Network unavailable'));
  await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
test('a pre-cancelled request sends no password', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(loginApiOwner(INPUT, { ...OPTIONS, signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled', mutationMayHaveSucceeded: false });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test('unreadable successful login JSON is rejected without a retry', async () => {
  fetchSpy.mockResolvedValue(new Response('not-json', { status: 200 }));
  await expect(loginApiOwner(INPUT, OPTIONS)).rejects.toMatchObject({ kind: 'invalid-response', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
