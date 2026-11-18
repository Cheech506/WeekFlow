jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(), getItemAsync: jest.fn(),
  setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
    clearServerAddress,
    loadServerAddress,
    normalizeServerAddress,
    saveServerAddress,
    ServerAddressStorageError
} from '../lib/serverAddressStorage';

const nativePlatform = Platform as { OS: string };
const originalPlatform = nativePlatform.OS;
const KEY = 'weekflow.server-address.v1';
const BASE = 'https://weekflow.example.test:9443';
const OPTIONS = { keychainService: 'weekflow.server.settings.v1',
  keychainAccessible: 6, requireAuthentication: false };
let values: Map<string, string>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  nativePlatform.OS = 'ios';
  values = new Map();
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async k => values.get(k) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (k, v) => { values.set(k, v); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async k => { values.delete(k); });
});
afterEach(() => { nativePlatform.OS = originalPlatform; });

test.each([
  [' https://WEEKFLOW.example.test:443/ ', 'https://weekflow.example.test'],
  ['https://10.0.0.227:9443', 'https://10.0.0.227:9443'],
  ['https://[::1]:9443/', 'https://[::1]:9443'],
  ['https://weekflow.local', 'https://weekflow.local'],
])('canonicalizes supported address %s', (raw, expected) => {
  expect(normalizeServerAddress(raw)).toBe(expected);
});

test.each([
  '', '   ', null, undefined, 123, {}, [], 'not a url', '10.0.0.227:9443',
  'http://10.0.0.227:9443', 'ftp://example.test', 'https:example.test',
  'https:///example.test', 'https://user:password@example.test',
  BASE + '/api', BASE + '?x=1', BASE + '#x', BASE + '?', BASE + '#',
  'https://exam\tple.test', 'https://exam\nple.test', 'https://example.test:0',
  'https://' + 'a'.repeat(513),
])('rejects unsuitable addresses without exposing them %#', value => {
  expect(() => normalizeServerAddress(value)).toThrow(ServerAddressStorageError);
  try { normalizeServerAddress(value); }
  catch (e) { expect((e as Error).message).not.toContain('password@example'); }
});

test.each(['ios', 'android'])('remembers the server across reads on %s', async os => {
  nativePlatform.OS = os;
  await saveServerAddress(' https://WEEKFLOW.example.test:9443/ ');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY, BASE, OPTIONS);
  await expect(loadServerAddress()).resolves.toBe(BASE);
});

test('an absent selection asks the caller to collect an address', async () => {
  await expect(loadServerAddress()).resolves.toBeNull();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

test('invalid input makes no storage calls or destructive changes', async () => {
  values.set(KEY, BASE);
  await expect(saveServerAddress('http://other.example.test')).rejects.toMatchObject({ code: 'invalid-address' });
  expect(SecureStore.isAvailableAsync).not.toHaveBeenCalled();
  expect(values.get(KEY)).toBe(BASE);
});

test('clears only server selection and preserves separate login records', async () => {
  values.set(KEY, BASE);
  values.set('weekflow.auth.v1.some-server', 'saved-login');
  await clearServerAddress();
  expect(values).toEqual(new Map([['weekflow.auth.v1.some-server', 'saved-login']]));
});

test.each(['not-json-or-a-url', 'http://old.example.test', BASE + '/api'])('discards a corrupt or incompatible selection %#', async saved => {
  values.set(KEY, saved);
  await expect(loadServerAddress()).resolves.toBeNull();
  expect(values.has(KEY)).toBe(false);
});

test('reports failure to remove a bad setting instead of claiming it was removed', async () => {
  values.set(KEY, 'bad');
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(new Error('native-private-details'));
  await expect(loadServerAddress()).rejects.toMatchObject({ code: 'clear' });
  expect(values.get(KEY)).toBe('bad');
});

test.each(['web', 'windows'])('does not use native storage on %s', async os => {
  nativePlatform.OS = os;
  await expect(loadServerAddress()).rejects.toMatchObject({ code: 'unavailable' });
  await expect(saveServerAddress(BASE)).rejects.toMatchObject({ code: 'unavailable' });
  await expect(clearServerAddress()).rejects.toMatchObject({ code: 'unavailable' });
  expect(SecureStore.isAvailableAsync).not.toHaveBeenCalled();
});

test.each([false, 'reject'])('reports unavailable secure storage %#', async result => {
  if (result === false) jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
  else jest.mocked(SecureStore.isAvailableAsync).mockRejectedValue(new Error('native-private-details'));
  await expect(loadServerAddress()).rejects.toMatchObject({ code: 'unavailable' });
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});

test.each(['read', 'write', 'clear'] as const)('redacts native %s failures', async operation => {
  const error = new Error('private-password-or-device-details');
  if (operation === 'read') jest.mocked(SecureStore.getItemAsync).mockRejectedValue(error);
  if (operation === 'write') jest.mocked(SecureStore.setItemAsync).mockRejectedValue(error);
  if (operation === 'clear') jest.mocked(SecureStore.deleteItemAsync).mockRejectedValue(error);
  const action = operation === 'read' ? loadServerAddress : operation === 'write'
    ? () => saveServerAddress(BASE) : clearServerAddress;
  await expect(action()).rejects.toMatchObject({ code: operation });
  await expect(action()).rejects.not.toThrow(error.message);
});

test('a queued clear waits for an earlier save so it cannot be resurrected', async () => {
  const pending = deferred();
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (k, v) => {
    await pending.promise; values.set(k, v);
  });
  const save = saveServerAddress(BASE);
  const clear = clearServerAddress();
  await Promise.resolve(); await Promise.resolve();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  pending.resolve();
  await Promise.all([save, clear]);
  await expect(loadServerAddress()).resolves.toBeNull();
});

test('a read waits for a pending save and sees its value', async () => {
  const pending = deferred();
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (k, v) => {
    await pending.promise; values.set(k, v);
  });
  const save = saveServerAddress(BASE);
  const read = loadServerAddress();
  pending.resolve();
  await save;
  await expect(read).resolves.toBe(BASE);
});

test('a failed save does not poison the queue for a later attempt', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('failed'));
  await expect(saveServerAddress(BASE)).rejects.toMatchObject({ code: 'write' });
  await saveServerAddress('https://other.example.test');
  await expect(loadServerAddress()).resolves.toBe('https://other.example.test');
});
