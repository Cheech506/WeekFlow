/** Startup ordering only: storage and authenticated transport are simulated. */
jest.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }));
jest.mock('@/lib/serverAddressStorage', () => ({
  ...jest.requireActual('@/lib/serverAddressStorage'),
  loadServerAddress: jest.fn(), saveServerAddress: jest.fn(), clearServerAddress: jest.fn(),
}));
jest.mock('@/lib/api/apiClient', () => ({ configureApiSession: jest.fn() }));
jest.mock('@/components/ServerAddressScreen', () => ({
  ServerAddressScreen: (props: unknown) => require('react').createElement('AddressScreen', props),
}));

import { configureNativeApiBaseUrl, resolveApiBaseUrl } from '@/lib/api/apiBaseUrl';
import { configureApiSession } from '@/lib/api/apiClient';
import * as storage from '@/lib/serverAddressStorage';
import React, { act, useEffect } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';
import { ServerAddressBoundary, useServerAddress } from '../components/ServerAddressBoundary';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const BASE = 'https://selected.example.test:9443';
const platform = Platform as { OS: string };
const originalPlatform = platform.OS;
const originalEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let root: ReturnType<typeof createRoot> | undefined;
let value: ReturnType<typeof useServerAddress>;
let mounted: jest.Mock;
let removed: jest.Mock;

function Probe() {
  value = useServerAddress();
  useEffect(() => { mounted(resolveApiBaseUrl()); return () => { removed(); }; }, []);
  return React.createElement('AuthTree');
}
function nodes(type: string) { return root!.container.queryAll(n => n.type === type); }
function form(): any { return nodes('AddressScreen')[0].props; }
async function mount(strict = false) {
  root = createRoot();
  const tree = React.createElement(ServerAddressBoundary, { children: React.createElement(Probe) });
  await act(async () => { root!.render(strict ? React.createElement(React.StrictMode, null, tree) : tree); });
}
async function select(address = BASE) {
  await act(async () => { await form().onContinue(address); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  platform.OS = 'ios';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://compiled.example.test';
  configureNativeApiBaseUrl(undefined);
  mounted = jest.fn(); removed = jest.fn(); value = null;
  jest.mocked(storage.loadServerAddress).mockResolvedValue(null);
  jest.mocked(storage.saveServerAddress).mockResolvedValue(undefined);
  jest.mocked(storage.clearServerAddress).mockResolvedValue(undefined);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); }); root = undefined;
  configureNativeApiBaseUrl(undefined);
  platform.OS = originalPlatform;
  if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = originalEnv;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test.each(['ios', 'android'])('the saved %s address is installed before authentication mounts', async os => {
  platform.OS = os;
  jest.mocked(storage.loadServerAddress).mockResolvedValue(BASE);
  await mount();
  expect(mounted).toHaveBeenCalledWith(BASE);
  expect(nodes('AuthTree')).toHaveLength(1);
  expect(nodes('AddressScreen')).toHaveLength(0);
  expect(value!.address).toBe(BASE);
});

test('authentication cannot mount while the address is still loading', async () => {
  const pending = deferred<string | null>();
  jest.mocked(storage.loadServerAddress).mockReturnValueOnce(pending.promise);
  await mount();
  expect(form().isLoading).toBe(true);
  expect(mounted).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(BASE); });
  expect(mounted).toHaveBeenCalledWith(BASE);
});

test('a missing saved server shows a suggestion without automatically using configuration', async () => {
  await mount();
  expect(form().initialAddress).toBe('https://compiled.example.test');
  expect(form().isLoading).toBe(false);
  expect(mounted).not.toHaveBeenCalled();
  expect(storage.saveServerAddress).not.toHaveBeenCalled();
});

test('invalid development configuration is not suggested or automatically used', async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://insecure.example.test/api';
  await mount();
  expect(form().initialAddress).toBe('');
  expect(mounted).not.toHaveBeenCalled();
});

test('a selected address is normalized and saved before authentication mounts', async () => {
  const pending = deferred<void>();
  jest.mocked(storage.saveServerAddress).mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { void form().onContinue(' https://SELECTED.example.test:9443/ '); });
  expect(storage.saveServerAddress).toHaveBeenCalledWith(BASE);
  expect(form().isSubmitting).toBe(true);
  expect(mounted).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); });
  expect(mounted).toHaveBeenCalledWith(BASE);
});

test('invalid input cannot be saved even if a caller bypasses the form validation', async () => {
  await mount(); await select('http://insecure.example.test');
  expect(storage.saveServerAddress).not.toHaveBeenCalled();
  expect(mounted).not.toHaveBeenCalled();
  expect(form().errorMessage).toContain('Enter a complete HTTPS');
});

test('failed persistence keeps authentication closed and supports another selection', async () => {
  jest.mocked(storage.saveServerAddress).mockRejectedValueOnce(new storage.ServerAddressStorageError('write'));
  await mount(); await select();
  expect(mounted).not.toHaveBeenCalled();
  expect(form().errorMessage).toContain('could not be saved');
  expect(form().isSubmitting).toBe(false);
  await select();
  expect(mounted).toHaveBeenCalledWith(BASE);
});

test('a read error stays visible and supports an explicit loading retry', async () => {
  jest.mocked(storage.loadServerAddress).mockRejectedValueOnce(new storage.ServerAddressStorageError('read'));
  await mount();
  expect(form().errorMessage).toContain('could not be read');
  expect(mounted).not.toHaveBeenCalled();
  jest.mocked(storage.loadServerAddress).mockResolvedValueOnce(BASE);
  await act(async () => { await form().onRetry(); });
  expect(mounted).toHaveBeenCalledWith(BASE);
});

test('an unexpected storage exception never appears verbatim on screen', async () => {
  jest.mocked(storage.loadServerAddress).mockRejectedValueOnce(new Error('private-device-details'));
  await mount();
  expect(form().errorMessage).toContain('could not be loaded or saved');
  expect(form().errorMessage).not.toContain('private-device-details');
});

test('a malformed saved value cannot open authentication', async () => {
  jest.mocked(storage.loadServerAddress).mockResolvedValue('http://invalid.example.test');
  await mount();
  expect(mounted).not.toHaveBeenCalled();
  expect(form().errorMessage).toContain('Enter a complete HTTPS');
});

test('repeated selection calls cannot race two saves', async () => {
  const pending = deferred<void>();
  jest.mocked(storage.saveServerAddress).mockReturnValueOnce(pending.promise);
  await mount();
  const handler = form().onContinue;
  await act(async () => { void handler(BASE); void handler('https://other.example.test'); });
  expect(storage.saveServerAddress).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); });
  expect(value!.address).toBe(BASE);
});

test('a stale form callback cannot replace the server after authentication mounts', async () => {
  await mount(); const handler = form().onContinue;
  await select();
  await act(async () => { await handler('https://other.example.test'); });
  expect(storage.saveServerAddress).toHaveBeenCalledTimes(1);
  expect(value!.address).toBe(BASE);
});

test('changing server removes the old tree immediately and cancels its transport session', async () => {
  jest.mocked(storage.loadServerAddress).mockResolvedValue(BASE);
  await mount();
  const pending = deferred<void>();
  jest.mocked(storage.clearServerAddress).mockReturnValueOnce(pending.promise);
  await act(async () => { void value!.changeServer(); });
  expect(removed).toHaveBeenCalledTimes(1);
  expect(nodes('AuthTree')).toHaveLength(0);
  expect(configureApiSession).toHaveBeenLastCalledWith(null);
  expect(form().isSubmitting).toBe(true);
  await act(async () => { pending.resolve(); });
  expect(form().isSubmitting).toBe(false);
  await select('https://second.example.test');
  expect(mounted).toHaveBeenLastCalledWith('https://second.example.test');
});

test('failure to clear the old selection is reported without claiming it was removed', async () => {
  jest.mocked(storage.loadServerAddress).mockResolvedValue(BASE);
  jest.mocked(storage.clearServerAddress).mockRejectedValueOnce(new storage.ServerAddressStorageError('clear'));
  await mount();
  await act(async () => { await value!.changeServer(); });
  expect(nodes('AuthTree')).toHaveLength(0);
  expect(form().errorMessage).toContain('could not be removed');
  expect(form().isSubmitting).toBe(false);
});

test('a change-server callback from an old server cannot clear a later selection', async () => {
  jest.mocked(storage.loadServerAddress).mockResolvedValue(BASE);
  await mount(); const oldChange = value!.changeServer;
  await act(async () => { await oldChange(); });
  await select('https://second.example.test');
  await act(async () => { await oldChange(); });
  expect(storage.clearServerAddress).toHaveBeenCalledTimes(1);
  expect(value!.address).toBe('https://second.example.test');
});

test('late loading results after unmount cannot reinstall a runtime server', async () => {
  const pending = deferred<string | null>();
  jest.mocked(storage.loadServerAddress).mockReturnValueOnce(pending.promise);
  await mount(); await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.resolve(BASE); });
  expect(resolveApiBaseUrl()).toBe('https://compiled.example.test');
  expect(mounted).not.toHaveBeenCalled();
});

test('late saves after unmount cannot mount authentication or reinstall a runtime server', async () => {
  const pending = deferred<void>();
  jest.mocked(storage.saveServerAddress).mockReturnValueOnce(pending.promise);
  await mount(); await act(async () => { void form().onContinue(BASE); });
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.resolve(); });
  expect(resolveApiBaseUrl()).toBe('https://compiled.example.test');
  expect(mounted).not.toHaveBeenCalled();
});

test('Strict Mode effect replay does not leave address loading locked', async () => {
  jest.mocked(storage.loadServerAddress).mockResolvedValue(BASE);
  await mount(true);
  expect(nodes('AuthTree')).toHaveLength(1);
  expect(value!.address).toBe(BASE);
});

test('web bypasses native storage and preserves the website address', async () => {
  platform.OS = 'web'; delete process.env.EXPO_PUBLIC_API_BASE_URL;
  Object.defineProperty(globalThis, 'window', { configurable: true,
    value: { location: new URL('https://browser.example.test/settings') } });
  await mount();
  expect(mounted).toHaveBeenCalledWith('https://browser.example.test');
  expect(storage.loadServerAddress).not.toHaveBeenCalled();
  expect(storage.saveServerAddress).not.toHaveBeenCalled();
  expect(configureApiSession).not.toHaveBeenCalled();
  expect(nodes('AddressScreen')).toHaveLength(0);
  expect(value).toBeNull();
});
