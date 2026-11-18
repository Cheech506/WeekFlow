/** Address selection only: these checks never contact a server. */
import { Platform } from 'react-native';
import { configureNativeApiBaseUrl, resolveApiBaseUrl } from '../lib/api/apiBaseUrl';
import { apiRequest, configureApiSession } from '../lib/api/apiClient';
import { fetchApiSetupStatus } from '../lib/api/authApi';

const platform = Platform as { OS: string };
const originalPlatform = platform.OS;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAddress = process.env.EXPO_PUBLIC_API_BASE_URL;

function browser(address: string) {
  platform.OS = 'web';
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: new URL(address) },
  });
}

beforeEach(() => {
  configureNativeApiBaseUrl(undefined);
  configureApiSession(null);
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  browser('https://weekflow.example.test/settings?tab=backups#result');
});

afterEach(() => {
  configureNativeApiBaseUrl(undefined);
  configureApiSession(null);
  jest.restoreAllMocks();
  platform.OS = originalPlatform;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalAddress === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalAddress;
});

test('an explicit address takes precedence over configuration and browser location', () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://configured.example.test';
  expect(resolveApiBaseUrl('https://explicit.example.test')).toBe('https://explicit.example.test');
});

test.each(['web', 'ios', 'android'])(
  'a configured address is retained on %s', os => {
    platform.OS = os;
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://configured.example.test';
    expect(resolveApiBaseUrl()).toBe('https://configured.example.test');
  });

test('a browser without configuration uses the website origin without its page path or query', () => {
  expect(resolveApiBaseUrl()).toBe('https://weekflow.example.test');
});

test('a browser preserves the website HTTPS port', () => {
  browser('https://localhost:8443/history');
  expect(resolveApiBaseUrl()).toBe('https://localhost:8443');
});

test.each(['ios', 'android'])(
  'an unconfigured %s app cannot borrow a browser or debugger address', os => {
    platform.OS = os;
    expect(resolveApiBaseUrl()).toBeUndefined();
  });

test('web rendering without a window returns no address instead of crashing', () => {
  Reflect.deleteProperty(globalThis, 'window');
  expect(resolveApiBaseUrl()).toBeUndefined();
});

test('a window without location returns no address', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  expect(resolveApiBaseUrl()).toBeUndefined();
});

test.each(['', '   ', 'not-a-url'])(
  'invalid configuration %j is passed to existing validators rather than hidden by fallback', value => {
    process.env.EXPO_PUBLIC_API_BASE_URL = value;
    expect(resolveApiBaseUrl()).toBe(value);
  });

test('an explicit blank address is not replaced by a different configured server', () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://configured.example.test';
  expect(resolveApiBaseUrl('')).toBe('');
});

test('the helper selects again after moving to another website origin', () => {
  expect(resolveApiBaseUrl()).toBe('https://weekflow.example.test');
  browser('https://another.example.test:9443/inbox');
  expect(resolveApiBaseUrl()).toBe('https://another.example.test:9443');
});

test('selection does not turn the detected origin into persistent environment configuration', () => {
  resolveApiBaseUrl();
  expect(process.env.EXPO_PUBLIC_API_BASE_URL).toBeUndefined();
});

test('address selection preserves a supplied path for the caller to validate', () => {
  expect(resolveApiBaseUrl('https://example.test/unexpected-path')).toBe('https://example.test/unexpected-path');
});

test.each(['ios', 'android'])('the selected %s server overrides compiled configuration', os => {
  platform.OS = os;
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://old.example.test';
  configureNativeApiBaseUrl('https://selected.example.test:9443');
  expect(resolveApiBaseUrl()).toBe('https://selected.example.test:9443');
  expect(process.env.EXPO_PUBLIC_API_BASE_URL).toBe('https://old.example.test');
});

test('explicit request overrides still take precedence over a mobile selection', () => {
  platform.OS = 'ios';
  configureNativeApiBaseUrl('https://selected.example.test');
  expect(resolveApiBaseUrl('https://explicit.example.test')).toBe('https://explicit.example.test');
  expect(resolveApiBaseUrl('')).toBe('');
});

test('clearing the mobile selection restores configuration without changing it', () => {
  platform.OS = 'ios';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://configured.example.test';
  configureNativeApiBaseUrl('https://selected.example.test');
  configureNativeApiBaseUrl(undefined);
  expect(resolveApiBaseUrl()).toBe('https://configured.example.test');
});

test('clearing a selection without configuration returns no mobile address', () => {
  platform.OS = 'android';
  configureNativeApiBaseUrl('https://selected.example.test');
  configureNativeApiBaseUrl(undefined);
  expect(resolveApiBaseUrl()).toBeUndefined();
});

test('a mobile selection never replaces the website origin', () => {
  configureNativeApiBaseUrl('https://phone-only.example.test');
  expect(resolveApiBaseUrl()).toBe('https://weekflow.example.test');
});

test('a mobile selection never replaces explicit web configuration', () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://configured.example.test';
  configureNativeApiBaseUrl('https://phone-only.example.test');
  expect(resolveApiBaseUrl()).toBe('https://configured.example.test');
});

test('web rendering without a window cannot borrow the mobile selection', () => {
  Reflect.deleteProperty(globalThis, 'window');
  configureNativeApiBaseUrl('https://phone-only.example.test');
  expect(resolveApiBaseUrl()).toBeUndefined();
});

test('mobile selection is checked again for later requests', () => {
  platform.OS = 'ios';
  configureNativeApiBaseUrl('https://first.example.test');
  expect(resolveApiBaseUrl()).toBe('https://first.example.test');
  configureNativeApiBaseUrl('https://second.example.test');
  expect(resolveApiBaseUrl()).toBe('https://second.example.test');
});

test.each(['', 'not-a-url', 'https://example.test/api'])('invalid mobile selection %j is not hidden by fallback', selected => {
  platform.OS = 'ios';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://old.example.test';
  configureNativeApiBaseUrl(selected);
  expect(resolveApiBaseUrl()).toBe(selected);
});

test('selecting an address makes no network request by itself', () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  configureNativeApiBaseUrl('https://selected.example.test');
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('authentication and feature requests both use the selected mobile server', async () => {
  platform.OS = 'ios';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://old.example.test';
  const selected = 'https://selected.example.test:9443';
  configureNativeApiBaseUrl(selected);
  const fetchSpy = jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ owner_exists: true, setup_ready: false }), { status: 200 }))
    .mockResolvedValueOnce(new Response('[]', { status: 200 }));
  await fetchApiSetupStatus();
  configureApiSession({ baseUrl: selected, sessionId: 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    credentials: { clientType: 'native', token: 'a'.repeat(43) } });
  await apiRequest('/api/v1/tasks', value => value);
  expect(fetchSpy.mock.calls[0][0]).toBe(`${selected}/api/v1/auth/setup/status`);
  expect(fetchSpy.mock.calls[1][0]).toBe(`${selected}/api/v1/tasks`);
  expect((fetchSpy.mock.calls[1][1] as RequestInit).headers).toHaveProperty('Authorization', `Bearer ${'a'.repeat(43)}`);
});

test('switching addresses cannot send an existing session token to the new server', async () => {
  platform.OS = 'ios';
  configureNativeApiBaseUrl('https://first.example.test');
  configureApiSession({ baseUrl: 'https://first.example.test', sessionId: 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    credentials: { clientType: 'native', token: 'a'.repeat(43) } });
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  configureNativeApiBaseUrl('https://second.example.test');
  await expect(apiRequest('/api/v1/tasks', value => value)).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
