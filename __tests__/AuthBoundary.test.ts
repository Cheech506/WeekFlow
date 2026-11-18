/** Verify that protected data providers cannot mount before authentication. */
jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/ServerAddressBoundary', () => ({ useServerAddress: jest.fn() }));
jest.mock('@/components/AuthScreen', () => ({
  AuthScreen: jest.fn((props: unknown) => require('react').createElement('AccountScreen', props)),
}));
import { AuthScreen } from '@/components/AuthScreen';
import { useServerAddress } from '@/components/ServerAddressBoundary';
import { useAuth, type AuthContextValue, type AuthStatus } from '@/context/AuthContext';
import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'test-renderer';
import { AuthBoundary } from '../components/AuthBoundary';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let auth: AuthContextValue;
let root: ReturnType<typeof createRoot> | undefined;
let mounts: jest.Mock, cleanups: jest.Mock;
let changePrivateState: (text: string) => void;
const SESSION = 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18';
function identity(sessionId = SESSION) {
  return { sessionId, accountId: 1 as const, username: 'corey', clientType: 'web' as const,
    expiresAt: '2026-11-08T20:00:00Z' };
}
function PrivateApp() {
  const [text, setText] = useState('Fresh private screen');
  changePrivateState = setText;
  useEffect(() => { mounts(); return () => { cleanups(); }; }, []);
  return React.createElement('PrivateApp', { text });
}
function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function screenProps(): any { return nodes('AccountScreen')[0].props; }
async function render() {
  await act(async () => { root!.render(React.createElement(AuthBoundary,
    { children: React.createElement(PrivateApp) })); });
}
async function mount() { root = createRoot(); await render(); }
beforeEach(() => {
  jest.mocked(useServerAddress).mockReturnValue(null);
  jest.clearAllMocks(); mounts = jest.fn(); cleanups = jest.fn();
  auth = { status: 'checking', identity: null, setupReady: false, isSubmitting: false,
    errorMessage: null, noticeMessage: null, suggestedUsername: '',
    refreshAuthentication: jest.fn(async () => undefined), createOwner: jest.fn(async () => undefined),
    signIn: jest.fn(async () => undefined), signOut: jest.fn(async () => undefined) };
  jest.mocked(useAuth).mockImplementation(() => auth);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); }); root = undefined;
});

test.each<AuthStatus>(['checking', 'setup', 'login', 'error'])('%s never mounts protected data or navigation', async status => {
  auth.status = status; await mount();
  expect(nodes('PrivateApp')).toHaveLength(0); expect(mounts).not.toHaveBeenCalled();
  expect(screenProps().status).toBe(status);
});
test('authentication with a verified identity mounts the private app instead of the login screen', async () => {
  auth.status = 'authenticated'; auth.identity = identity(); await mount();
  expect(nodes('PrivateApp')).toHaveLength(1); expect(nodes('AccountScreen')).toHaveLength(0);
  expect(mounts).toHaveBeenCalledTimes(1); expect(AuthScreen).not.toHaveBeenCalled();
});
test('an authenticated status with no identity fails closed and offers a retry', async () => {
  auth.status = 'authenticated'; await mount();
  expect(mounts).not.toHaveBeenCalled(); expect(screenProps().status).toBe('error');
  expect(screenProps().errorMessage).toBe('Your login could not be verified. Please try again.');
  await screenProps().onRetry(); expect(auth.refreshAuthentication).toHaveBeenCalledTimes(1);
});
test('an identity alone cannot bypass a checking/login state', async () => {
  auth.status = 'login'; auth.identity = identity(); await mount();
  expect(mounts).not.toHaveBeenCalled(); expect(screenProps().status).toBe('login');
});
test('setup readiness, safe messages, pending state, and username reach the form', async () => {
  Object.assign(auth, { status: 'setup', setupReady: true, isSubmitting: true,
    errorMessage: 'A safe error.', noticeMessage: 'A safe notice.', suggestedUsername: 'corey' });
  await mount();
  expect(screenProps()).toMatchObject({ status: 'setup', setupReady: true, isSubmitting: true,
    errorMessage: 'A safe error.', noticeMessage: 'A safe notice.', suggestedUsername: 'corey' });
});
test('the form receives only explicitly selected state and actions', async () => {
  Object.assign(auth, { secretToken: 'not-for-the-screen' }); await mount();
  expect(screenProps()).not.toHaveProperty('secretToken'); expect(screenProps()).not.toHaveProperty('identity');
  expect(screenProps()).not.toHaveProperty('signOut');
});
test('login input is passed to the session provider without transformation', async () => {
  auth.status = 'login'; await mount();
  const input = { username: 'COREY', password: '  Exact password!  ' };
  await screenProps().onLogin(input);
  expect(auth.signIn).toHaveBeenCalledWith(input); expect(auth.createOwner).not.toHaveBeenCalled();
});
test('setup input is passed to account creation without performing login', async () => {
  auth.status = 'setup'; auth.setupReady = true; await mount();
  const input = { username: 'corey', password: 'Exact password!', setupCode: 'a'.repeat(43) };
  await screenProps().onCreateOwner(input);
  expect(auth.createOwner).toHaveBeenCalledWith(input); expect(auth.signIn).not.toHaveBeenCalled();
});
test('rendering the boundary does not submit credentials or retry requests automatically', async () => {
  await mount(); await render();
  expect(auth.signIn).not.toHaveBeenCalled(); expect(auth.createOwner).not.toHaveBeenCalled();
  expect(auth.refreshAuthentication).not.toHaveBeenCalled();
});
test('successful login mounts the private app only after the provider changes status', async () => {
  auth.status = 'login'; await mount(); await screenProps().onLogin({ username: 'corey', password: 'synthetic' });
  expect(mounts).not.toHaveBeenCalled();
  auth.status = 'authenticated'; auth.identity = identity(); await render();
  expect(mounts).toHaveBeenCalledTimes(1); expect(nodes('AccountScreen')).toHaveLength(0);
});
test.each<AuthStatus>(['checking', 'login', 'error'])('moving from authenticated to %s unmounts private state', async status => {
  auth.status = 'authenticated'; auth.identity = identity(); await mount();
  auth.status = status; auth.identity = null; await render();
  expect(cleanups).toHaveBeenCalledTimes(1); expect(nodes('PrivateApp')).toHaveLength(0);
  expect(screenProps().status).toBe(status);
});
test('a replacement session remounts the provider/navigation tree and clears private state', async () => {
  auth.status = 'authenticated'; auth.identity = identity(); await mount();
  await act(async () => { changePrivateState('Older unsaved private state'); });
  expect(nodes('PrivateApp')[0].props.text).toBe('Older unsaved private state');
  auth.identity = identity('63a424ed-a3f5-4fc1-b3fe-0825dac39a83'); await render();
  expect(mounts).toHaveBeenCalledTimes(2); expect(cleanups).toHaveBeenCalledTimes(1);
  expect(nodes('PrivateApp')[0].props.text).toBe('Fresh private screen');
});
test('ordinary updates to the same session preserve the private screen tree', async () => {
  auth.status = 'authenticated'; auth.identity = identity(); await mount();
  await act(async () => { changePrivateState('Current unsaved edit'); });
  auth.identity = { ...identity(), expiresAt: '2026-11-08T19:00:00Z' }; await render();
  expect(mounts).toHaveBeenCalledTimes(1); expect(cleanups).not.toHaveBeenCalled();
  expect(nodes('PrivateApp')[0].props.text).toBe('Current unsaved edit');
});

test('mobile login receives the selected server and its change action', async () => {
  const server = { address: 'https://selected.example.test:9443', changeServer: jest.fn(async () => undefined) };
  jest.mocked(useServerAddress).mockReturnValue(server);
  auth.status = 'login'; await mount();
  expect(screenProps().serverAddress).toBe(server.address);
  expect(screenProps().onChangeServer).toBe(server.changeServer);
  await screenProps().onChangeServer();
  expect(server.changeServer).toHaveBeenCalledTimes(1);
  expect(mounts).not.toHaveBeenCalled();
});

test('a failed mobile connection still receives a change-server action', async () => {
  const server = { address: 'https://old.example.test', changeServer: jest.fn(async () => undefined) };
  jest.mocked(useServerAddress).mockReturnValue(server);
  auth.status = 'error'; await mount();
  expect(screenProps().serverAddress).toBe(server.address);
  await screenProps().onChangeServer();
  expect(server.changeServer).toHaveBeenCalledTimes(1);
});

test('web login does not offer a native server selection action', async () => {
  auth.status = 'login'; await mount();
  expect(screenProps().serverAddress).toBeUndefined();
  expect(screenProps().onChangeServer).toBeUndefined();
});

test('an authenticated mobile session shows the private app instead of server controls', async () => {
  const server = { address: 'https://selected.example.test', changeServer: jest.fn(async () => undefined) };
  jest.mocked(useServerAddress).mockReturnValue(server);
  auth.status = 'authenticated'; auth.identity = identity(); await mount();
  expect(nodes('AccountScreen')).toHaveLength(0);
  expect(nodes('PrivateApp')).toHaveLength(1);
  expect(server.changeServer).not.toHaveBeenCalled();
});
