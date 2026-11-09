/** Authenticated transport tests. All HTTP requests and session values are simulated. */
import {
    apiRequest, configureApiSession, subscribeToApiSessionRejection,
    type ApiAuthenticatedSession,
} from '../lib/api/apiClient';

const BASE = 'https://weekflow.example.test';
const PATH = '/api/v1/tasks';
const SESSION = 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18';
const SECOND = '63a424ed-a3f5-4fc1-b3fe-0825dac39a83';
const TOKEN = 'a'.repeat(43), CSRF = 'b'.repeat(43);
const NOW = Date.parse('2026-11-08T12:00:00Z');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
let fetchSpy: jest.SpyInstance;
let unsubscribe: (() => void) | undefined;
const decode = (value: unknown) => value;

function session(native = true): ApiAuthenticatedSession {
  return { baseUrl: BASE, sessionId: SESSION, expiresAt: '2026-11-08T20:00:00Z',
    credentials: native ? { clientType: 'native', token: TOKEN } : { clientType: 'web', csrfToken: CSRF } };
}
function browser(address = BASE) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: new URL(address) } });
}
function respond(status = 200, payload: unknown = []) {
  fetchSpy.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(payload), { status }));
}
function request(index = 0) { return fetchSpy.mock.calls[index][1] as RequestInit; }
function waitForAbort(signal: AbortSignal) {
  return new Promise<Response>((_yes, no) => { signal.addEventListener('abort', () => no(new Error('aborted')), { once: true }); });
}
beforeEach(() => {
  configureApiSession(null);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  browser(); process.env.EXPO_PUBLIC_API_BASE_URL = BASE;
  fetchSpy = jest.spyOn(global, 'fetch'); respond();
});
afterEach(() => {
  unsubscribe?.(); unsubscribe = undefined;
  configureApiSession(null); jest.restoreAllMocks();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl;
});

test.each(['GET', 'POST', 'PATCH', 'DELETE'] as const)('native %s sends bearer credentials and omits cookies', async method => {
  configureApiSession(session());
  await apiRequest(PATH, decode, { method });
  expect(request().headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}` });
  expect(request().credentials).toBe('omit'); expect(request().redirect).toBe('error');
});
test('browser GET relies on the cookie and does not send CSRF or bearer credentials', async () => {
  configureApiSession(session(false)); await apiRequest(PATH, decode);
  expect(request().headers).toEqual({ Accept: 'application/json' });
  expect(request().credentials).toBe('same-origin');
});
test.each(['POST', 'PATCH', 'DELETE'] as const)('browser %s adds CSRF without exposing the session cookie', async method => {
  configureApiSession(session(false)); await apiRequest(PATH, decode, { method });
  expect(request().headers).toEqual({ Accept: 'application/json', 'X-CSRF-Token': CSRF });
  expect(request().headers).not.toHaveProperty('Cookie');
  expect(request().credentials).toBe('same-origin');
});
test('a JSON mutation preserves its body and revision headers alongside automatic authentication', async () => {
  configureApiSession(session());
  await apiRequest(PATH, decode, { method: 'POST', body: { title: 'Study' }, headers: { 'If-Match': 'revision-1' } });
  expect(request().body).toBe('{"title":"Study"}');
  expect(request().headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`, 'If-Match': 'revision-1' });
});
test.each(['Authorization', 'authorization', 'Cookie', 'cookie', 'X-CSRF-Token', 'x-csrf-token'])(
  'callers cannot override configured credential header %s', async name => {
    configureApiSession(session());
    await expect(apiRequest(PATH, decode, { headers: { [name]: 'injected' } })).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchSpy).not.toHaveBeenCalled();
  }
);
test.each(['https://other.example.test', 'http://weekflow.example.test', `${BASE}:8443`])(
  'never sends the configured credentials to another origin %#', async baseUrl => {
    configureApiSession(session());
    await expect(apiRequest(PATH, decode, { baseUrl })).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchSpy).not.toHaveBeenCalled();
  }
);
test('normalizes dot segments before classifying a protected route', async () => {
  configureApiSession(session());
  await apiRequest('/api/v1/auth/../tasks', decode);
  expect(request().headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test.each(['/api/v1/auth/setup/status', '/api/v1/auth/setup', '/api/v1/auth/web/login', '/api/v1/auth/native/login'])
('does not inject an old feature session into auth route %s', async path => {
  configureApiSession(session()); await apiRequest(path, decode, { method: 'POST' });
  expect(request().headers).not.toHaveProperty('Authorization');
  expect(request().headers).not.toHaveProperty('X-CSRF-Token');
});
test('native login requests explicitly omit browser cookies', async () => {
  await apiRequest('/api/v1/auth/native/login', decode, { method: 'POST', body: { username: 'corey', password: 'synthetic' } });
  expect(request().credentials).toBe('omit'); expect(request().redirect).toBe('error');
});
test('auth session/logout requests preserve explicit credentials supplied by authApi', async () => {
  configureApiSession(session());
  await apiRequest('/api/v1/auth/logout', decode, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  expect(request().headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${TOKEN}` });
  expect(request().credentials).toBe('omit');
});
test('a failed password login does not invalidate the already configured feature session', async () => {
  configureApiSession(session()); const listener = jest.fn(); unsubscribe = subscribeToApiSessionRejection(listener);
  respond(401, { detail: 'Wrong password.' });
  await expect(apiRequest('/api/v1/auth/native/login', decode, { method: 'POST' })).rejects.toMatchObject({ status: 401 });
  expect(listener).not.toHaveBeenCalled();
  respond(); await apiRequest(PATH, decode);
  expect(request(1).headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test('a protected 401 clears the current transport session and notifies without returning credentials', async () => {
  configureApiSession(session()); const listener = jest.fn(); unsubscribe = subscribeToApiSessionRejection(listener);
  respond(401, { detail: 'The login session is unavailable or no longer valid.' });
  await expect(apiRequest(PATH, decode, { method: 'POST' })).rejects.toMatchObject({ kind: 'http', status: 401, mutationMayHaveSucceeded: false });
  expect(listener).toHaveBeenCalledWith({ baseUrl: BASE, sessionId: SESSION });
  expect(listener).toHaveBeenCalledTimes(1);
  respond(); await apiRequest(PATH, decode);
  expect(request(1).headers).not.toHaveProperty('Authorization');
});
test.each([403, 409, 422, 429, 500, 503])('HTTP %s does not automatically log out the user', async status => {
  configureApiSession(session()); const listener = jest.fn(); unsubscribe = subscribeToApiSessionRejection(listener);
  respond(status, { detail: 'A controlled error.' });
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ kind: 'http', status });
  expect(listener).not.toHaveBeenCalled();
  respond(); await apiRequest(PATH, decode);
  expect(request(1).headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test('network failure does not erase an otherwise valid login or retry a mutation', async () => {
  configureApiSession(session()); const listener = jest.fn(); unsubscribe = subscribeToApiSessionRejection(listener);
  fetchSpy.mockRejectedValueOnce(new Error('network'));
  await expect(apiRequest(PATH, decode, { method: 'POST' })).rejects.toMatchObject({ kind: 'network', mutationMayHaveSucceeded: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1); expect(listener).not.toHaveBeenCalled();
  await apiRequest(PATH, decode);
  expect(request(1).headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test('an expired local deadline notifies the provider without sending a protected request', async () => {
  configureApiSession(session()); const listener = jest.fn(); unsubscribe = subscribeToApiSessionRejection(listener);
  jest.mocked(Date.now).mockReturnValue(Date.parse(session().expiresAt));
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ kind: 'http', status: 401, mutationMayHaveSucceeded: false });
  expect(listener).toHaveBeenCalledWith({ baseUrl: BASE, sessionId: SESSION });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test('unsubscribed listeners do not receive events', async () => {
  configureApiSession(session()); const listener = jest.fn(); const stop = subscribeToApiSessionRejection(listener); stop();
  respond(401);
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ status: 401 });
  expect(listener).not.toHaveBeenCalled();
});
test('an exception in a UI listener cannot hide the HTTP error', async () => {
  configureApiSession(session()); unsubscribe = subscribeToApiSessionRejection(() => { throw new Error('listener failure'); });
  respond(401);
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ kind: 'http', status: 401 });
});
test('clearing a session cancels a pending protected write and marks its result uncertain', async () => {
  configureApiSession(session());
  fetchSpy.mockImplementation((_url: string, options: RequestInit) => waitForAbort(options.signal!));
  const result = apiRequest(PATH, decode, { method: 'POST' });
  configureApiSession(null);
  await expect(result).rejects.toMatchObject({ kind: 'cancelled', mutationMayHaveSucceeded: true });
});
test('switching sessions cancels an older read and uses the replacement credentials for the next request', async () => {
  configureApiSession(session());
  fetchSpy.mockImplementationOnce((_url: string, options: RequestInit) => waitForAbort(options.signal!));
  const result = apiRequest(PATH, decode);
  configureApiSession({ ...session(), sessionId: SECOND, credentials: { clientType: 'native', token: CSRF } });
  await expect(result).rejects.toMatchObject({ kind: 'cancelled' });
  await apiRequest(PATH, decode);
  expect(request(1).headers).toHaveProperty('Authorization', `Bearer ${CSRF}`);
});
test('a rejected current session cancels other concurrent old-session requests', async () => {
  configureApiSession(session());
  fetchSpy.mockImplementationOnce((_url: string, options: RequestInit) => waitForAbort(options.signal!));
  const pending = apiRequest(PATH, decode, { method: 'POST' });
  const cancelled = expect(pending).rejects.toMatchObject({ kind: 'cancelled', mutationMayHaveSucceeded: true });
  respond(401);
  await expect(apiRequest('/api/v1/goals', decode)).rejects.toMatchObject({ kind: 'http', status: 401 });
  await cancelled;
});
test('a slow response from a replaced session cannot invalidate the replacement', async () => {
  configureApiSession(session()); let complete!: (value: Response) => void;
  fetchSpy.mockImplementationOnce(() => new Promise<Response>(yes => { complete = yes; }));
  const old = apiRequest(PATH, decode);
  configureApiSession({ ...session(), sessionId: SECOND });
  const listener = jest.fn(); unsubscribe = subscribeToApiSessionRejection(listener);
  complete(new Response('{}', { status: 401 }));
  await expect(old).rejects.toMatchObject({ kind: 'cancelled' });
  expect(listener).not.toHaveBeenCalled();
  await apiRequest(PATH, decode);
  expect(request(1).headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test('configuration snapshots credentials instead of retaining caller-owned mutable objects', async () => {
  const value = session(); configureApiSession(value);
  value.baseUrl = 'https://other.example.test'; value.sessionId = SECOND;
  if (value.credentials.clientType === 'native') value.credentials.token = CSRF;
  await apiRequest(PATH, decode);
  expect(request().headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test.each([
  { baseUrl: 'http://localhost:8000' }, { baseUrl: `${BASE}/api` }, { baseUrl: `${BASE}?` },
  { sessionId: 'invalid' }, { expiresAt: 'invalid' }, { expiresAt: '2026-11-08T11:59:00Z' },
  { credentials: { clientType: 'native', token: 'invalid' } },
  { credentials: { clientType: 'web', csrfToken: CSRF, token: TOKEN } },
])('rejects invalid session configuration without erasing a valid existing session %#', async changes => {
  configureApiSession(session());
  expect(() => configureApiSession({ ...session(), ...changes } as ApiAuthenticatedSession)).toThrow();
  await apiRequest(PATH, decode);
  expect(request().headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
});
test('configuring a browser session requires its shared HTTPS origin', () => {
  browser('http://localhost:8081');
  expect(() => configureApiSession(session(false))).toThrow('same HTTPS address');
});
test('browser provenance is rechecked before each protected request', async () => {
  configureApiSession(session(false)); browser('https://other.example.test');
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each(['/api/v1/auth/native/login', '/api/v1/auth/setup/status'])('authentication route %s requires HTTPS', async path => {
  await expect(apiRequest(path, decode, { baseUrl: 'http://localhost:8000' })).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each(['Authorization', 'X-CSRF-Token', 'Cookie'])('explicit %s credentials cannot be sent over HTTP', async name => {
  await expect(apiRequest(PATH, decode, { baseUrl: 'http://localhost:8000', headers: { [name]: TOKEN } })).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each(['/api/v1/tasks\\other', '/api/v1/tasks\r\nother', '/api/v1/tasks\tother'])('rejects ambiguous control/backslash paths %#', async path => {
  await expect(apiRequest(path, decode)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
test.each(['https://other.example.test/api/v1/tasks', 'not-a-url'])('rejects an unexpected response address %#', async url => {
  configureApiSession(session());
  const response = new Response('[]'); Object.defineProperty(response, 'url', { value: url });
  fetchSpy.mockResolvedValue(response);
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ kind: 'invalid-response' });
});
test('rejects a response marked as redirected, even if its final origin matches', async () => {
  configureApiSession(session());
  const response = new Response('[]'); Object.defineProperty(response, 'redirected', { value: true });
  fetchSpy.mockResolvedValue(response);
  await expect(apiRequest(PATH, decode)).rejects.toMatchObject({ kind: 'invalid-response' });
});
test('clearing the in-memory transport session does not contact the server or persist anything', () => {
  configureApiSession(session()); configureApiSession(null);
  expect(fetchSpy).not.toHaveBeenCalled();
});
