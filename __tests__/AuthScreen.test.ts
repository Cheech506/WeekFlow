/** Form behavior only: no real server, account, database, or session storage. */
jest.mock('react-native', () => ({
  ActivityIndicator: 'Spinner', KeyboardAvoidingView: 'Keyboard', ScrollView: 'Scroll',
  Pressable: 'Button', Text: 'Text', TextInput: 'Input', View: 'View',
  Platform: { OS: 'web' }, StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeArea' }));
jest.mock('@/components/useColorScheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

import { useColorScheme } from '@/components/useColorScheme';
import { ApiError } from '@/lib/api/apiClient';
import React, { act } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';
import { AuthScreen, type AuthScreenProps } from '../components/AuthScreen';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let screen: AuthScreenProps;
const PASSWORD = '  My exact password!  ';
const CODE = 'a'.repeat(43);

function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function control(label: string): any {
  const node = root!.container.queryAll(node => node.props.accessibilityLabel === label)[0];
  if (!node) throw new Error(`Missing test control: ${label}`);
  return node.props;
}
function text() { return JSON.stringify(root!.container.toJSON()); }
async function render() {
  await act(async () => { root!.render(React.createElement(AuthScreen, screen)); });
}
async function mount() { root = createRoot(); await render(); }
async function enter(label: string, value: string) {
  await act(async () => { control(label).onChangeText(value); });
}
async function press(label: string) {
  await act(async () => { control(label).onPress(); });
}
async function fill(creating = false) {
  await enter('Username', '  COREY  ');
  await enter('Password', PASSWORD);
  if (creating) {
    await enter('Confirm password', PASSWORD);
    await enter('Setup code', ` ${CODE} `);
  }
}
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useColorScheme).mockReturnValue('light');
  (Platform as { OS: string }).OS = 'web';
  screen = { status: 'login', onRetry: jest.fn(async () => undefined),
    onLogin: jest.fn(async () => undefined), onCreateOwner: jest.fn(async () => undefined) };
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test('checking state shows progress without mounting credential fields or sending requests', async () => {
  screen.status = 'checking'; await mount();
  expect(text()).toContain('Checking your account');
  expect(nodes('Spinner')).toHaveLength(1);
  expect(nodes('Input')).toHaveLength(0);
  expect(nodes('Button')).toHaveLength(0);
  expect(screen.onRetry).not.toHaveBeenCalled();
  expect(screen.onLogin).not.toHaveBeenCalled();
  expect(screen.onCreateOwner).not.toHaveBeenCalled();
});
test('login shows username and password but not the setup or confirmation fields', async () => {
  await mount();
  expect(nodes('Input')).toHaveLength(2);
  expect(control('Username').autoComplete).toBe('username');
  expect(control('Password').secureTextEntry).toBe(true);
  expect(control('Password').autoComplete).toBe('current-password');
  expect(text()).not.toContain('Setup code');
});
test('setup waits for server readiness without displaying an unusable form', async () => {
  screen.status = 'setup'; await mount();
  expect(nodes('Input')).toHaveLength(0);
  expect(text()).toContain('one-time setup code');
  await press('Check setup again');
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
  expect(screen.onCreateOwner).not.toHaveBeenCalled();
});
test('ready setup presents the owner form with new-password autofill hints', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount();
  expect(nodes('Input')).toHaveLength(4);
  expect(control('Setup code').secureTextEntry).toBe(true);
  expect(control('Setup code').autoComplete).toBe('off');
  expect(control('Password').autoComplete).toBe('new-password');
  expect(control('Confirm password').secureTextEntry).toBe(true);
  expect(text()).toContain('15–128');
});
test('login submits a snapshot with the exact password and then clears the secret field', async () => {
  await mount(); await fill(); await press('Sign in');
  expect(screen.onLogin).toHaveBeenCalledWith({ username: 'COREY', password: PASSWORD });
  expect(screen.onLogin).toHaveBeenCalledTimes(1);
  expect(screen.onCreateOwner).not.toHaveBeenCalled();
  expect(control('Password').value).toBe('');
  expect(control('Username').value).toBe('  COREY  ');
});
test('owner setup passes the trimmed code and exact password without including confirmation', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount(); await fill(true); await press('Create account');
  expect(screen.onCreateOwner).toHaveBeenCalledWith({ username: 'COREY', password: PASSWORD, setupCode: CODE });
  expect(screen.onLogin).not.toHaveBeenCalled();
  for (const label of ['Password', 'Confirm password', 'Setup code']) expect(control(label).value).toBe('');
});
test.each([['', PASSWORD], ['corey', '']])('requires both login fields %#', async (username, password) => {
  await mount(); await enter('Username', username); await enter('Password', password); await press('Sign in');
  expect(text()).toContain('Enter your username and password.');
  expect(screen.onLogin).not.toHaveBeenCalled();
});
test('setup requires the one-time code', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount();
  await enter('Username', 'corey'); await enter('Password', PASSWORD); await enter('Confirm password', PASSWORD);
  await press('Create account');
  expect(text()).toContain('Enter the one-time setup code.');
  expect(screen.onCreateOwner).not.toHaveBeenCalled();
});
test('password confirmation compares the exact text, including spaces', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount(); await fill(true);
  await enter('Confirm password', PASSWORD.trim()); await press('Create account');
  expect(text()).toContain('The passwords do not match.');
  expect(screen.onCreateOwner).not.toHaveBeenCalled();
  expect(control('Password').value).toBe(PASSWORD);
});
test('show-password control has checkbox semantics and never exposes the setup code', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount();
  expect(control('Show passwords').accessibilityRole).toBe('checkbox');
  await press('Show passwords');
  expect(control('Password').secureTextEntry).toBe(false);
  expect(control('Confirm password').secureTextEntry).toBe(false);
  expect(control('Setup code').secureTextEntry).toBe(true);
  expect(control('Show passwords').accessibilityState.checked).toBe(true);
  await press('Show passwords');
  expect(control('Password').secureTextEntry).toBe(true);
});
test('blocks repeated taps synchronously while a login is pending', async () => {
  const pending = deferred(); jest.mocked(screen.onLogin).mockReturnValueOnce(pending.promise);
  await mount(); await fill();
  await act(async () => { const submit = control('Sign in').onPress; submit(); submit(); });
  expect(screen.onLogin).toHaveBeenCalledTimes(1);
  expect(control('Sign in').disabled).toBe(true);
  expect(control('Username').editable).toBe(false);
  expect(control('Show passwords').disabled).toBe(true);
  expect(text()).toContain('Signing in');
  await act(async () => { pending.resolve(); });
  expect(control('Sign in').disabled).toBe(false);
});
test('the password keyboard action submits login', async () => {
  await mount(); await fill();
  await act(async () => { control('Password').onSubmitEditing(); });
  expect(screen.onLogin).toHaveBeenCalledTimes(1);
});
test('the confirmation keyboard action submits setup', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount(); await fill(true);
  expect(control('Password').onSubmitEditing).toBeUndefined();
  await act(async () => { control('Confirm password').onSubmitEditing(); });
  expect(screen.onCreateOwner).toHaveBeenCalledTimes(1);
});
test('an external pending action disables login and ignores stale tap handlers', async () => {
  await mount(); await fill(); screen.isSubmitting = true; await render(); await press('Sign in');
  expect(screen.onLogin).not.toHaveBeenCalled();
  expect(control('Sign in').disabled).toBe(true);
  expect(control('Password').editable).toBe(false);
});
test('renders a controlled API error but clears the submitted secret fields', async () => {
  jest.mocked(screen.onLogin).mockRejectedValueOnce(new ApiError('Username or password is incorrect.', { kind: 'http', status: 401 }));
  await mount(); await fill(); await press('Sign in');
  expect(text()).toContain('Username or password is incorrect.');
  expect(control('Password').value).toBe('');
  expect(control('Sign in').disabled).toBe(false);
});
test('does not expose an unexpected exception message or retry automatically', async () => {
  const secret = 'do-not-render-this-secret';
  jest.mocked(screen.onLogin).mockRejectedValueOnce(new Error(secret));
  await mount(); await fill(); await press('Sign in');
  expect(text()).not.toContain(secret);
  expect(text()).toContain('That request could not be completed.');
  expect(screen.onLogin).toHaveBeenCalledTimes(1);
});
test('changing from setup to login clears all secret fields and resets password visibility', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount(); await fill(true); await press('Show passwords');
  screen.status = 'login'; screen.suggestedUsername = 'corey'; await render();
  expect(control('Username').value).toBe('corey');
  expect(control('Password').value).toBe('');
  expect(control('Password').secureTextEntry).toBe(true);
  expect(nodes('Input')).toHaveLength(2);
});
test('losing setup readiness clears hidden credentials before the form can reopen', async () => {
  screen.status = 'setup'; screen.setupReady = true; await mount(); await fill(true);
  screen.setupReady = false; await render();
  expect(nodes('Input')).toHaveLength(0);
  screen.setupReady = true; await render();
  for (const label of ['Password', 'Confirm password', 'Setup code']) expect(control(label).value).toBe('');
});
test('a late failure from the previous screen cannot overwrite the new state', async () => {
  const pending = deferred(); jest.mocked(screen.onCreateOwner).mockReturnValueOnce(pending.promise);
  screen.status = 'setup'; screen.setupReady = true; await mount(); await fill(true); await press('Create account');
  screen.status = 'login'; screen.noticeMessage = 'Account created. Sign in to continue.'; await render();
  await act(async () => { pending.reject(new ApiError('Old setup error', { kind: 'http', status: 409 })); });
  expect(text()).not.toContain('Old setup error');
  expect(text()).toContain('Account created. Sign in to continue.');
  expect(control('Sign in').disabled).toBe(false);
});
test('retry button blocks overlapping checks', async () => {
  const pending = deferred(); jest.mocked(screen.onRetry).mockReturnValueOnce(pending.promise);
  screen.status = 'error'; screen.errorMessage = 'Connection unavailable.'; await mount();
  await act(async () => { const retry = control('Try again').onPress; retry(); retry(); });
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
  expect(control('Try again').disabled).toBe(true);
  expect(text()).toContain('Connection unavailable.');
  await act(async () => { pending.resolve(); });
});
test('a retry error stays visible and does not trigger repeated checks', async () => {
  screen.status = 'error'; jest.mocked(screen.onRetry).mockRejectedValueOnce(new ApiError('Check the HTTPS address.', { kind: 'configuration' }));
  await mount(); await press('Try again');
  expect(text()).toContain('Check the HTTPS address.');
  expect(screen.onRetry).toHaveBeenCalledTimes(1);
  expect(control('Try again').disabled).toBe(false);
});
test('switching screens clears an old validation message', async () => {
  await mount(); await press('Sign in');
  expect(text()).toContain('Enter your username and password.');
  screen.status = 'setup'; screen.setupReady = true; await render();
  expect(text()).not.toContain('Enter your username and password.');
});
test('dark appearance uses the existing color scheme', async () => {
  jest.mocked(useColorScheme).mockReturnValue('dark'); await mount();
  expect(JSON.stringify(nodes('SafeArea')[0].props.style)).toContain('#111827');
});
test('iOS enables keyboard avoidance', async () => {
  (Platform as { OS: string }).OS = 'ios'; await mount();
  expect(nodes('Keyboard')[0].props.behavior).toBe('padding');
});

test('server selection displays the selected address and clears password fields before changing', async () => {
  screen.serverAddress = 'https://selected.example.test:9443';
  screen.onChangeServer = jest.fn(async () => undefined);
  await mount(); await fill(); await press('Change server');
  expect(text()).toContain(screen.serverAddress);
  expect(screen.onChangeServer).toHaveBeenCalledTimes(1);
  expect(control('Password').value).toBe('');
  expect(screen.onLogin).not.toHaveBeenCalled();
});
test('server selection is unavailable while checking or submitting credentials', async () => {
  screen.serverAddress = 'https://selected.example.test';
  screen.onChangeServer = jest.fn(async () => undefined);
  screen.status = 'checking'; await mount();
  expect(nodes('Button').filter(node => node.props.accessibilityLabel === 'Change server')).toHaveLength(0);
  screen.status = 'login'; screen.isSubmitting = true; await render();
  expect(control('Change server').disabled).toBe(true);
  await press('Change server');
  expect(screen.onChangeServer).not.toHaveBeenCalled();
});
test('a failed connection still permits choosing another server', async () => {
  screen.status = 'error';
  screen.serverAddress = 'https://old.example.test';
  screen.onChangeServer = jest.fn(async () => undefined);
  await mount(); await press('Change server');
  expect(screen.onChangeServer).toHaveBeenCalledTimes(1);
  expect(screen.onRetry).not.toHaveBeenCalled();
});
test('unmounting while login is pending ignores its eventual failure', async () => {
  const pending = deferred(); jest.mocked(screen.onLogin).mockReturnValueOnce(pending.promise);
  await mount(); await fill(); await press('Sign in');
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.reject(new Error('late failure')); });
  expect(screen.onLogin).toHaveBeenCalledTimes(1);
});
