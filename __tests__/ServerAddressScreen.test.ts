/** The address form only: no live server, login, or device storage. */
jest.mock('react-native', () => ({
  ActivityIndicator: 'Spinner', KeyboardAvoidingView: 'Keyboard', ScrollView: 'Scroll',
  Pressable: 'Button', Text: 'Text', TextInput: 'Input', View: 'View',
  Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeArea' }));
jest.mock('@/components/useColorScheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

import { useColorScheme } from '@/components/useColorScheme';
import { ServerAddressStorageError } from '@/lib/serverAddressStorage';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { ServerAddressScreen, type ServerAddressScreenProps } from '../components/ServerAddressScreen';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let props: ServerAddressScreenProps;
function control(label: string): any {
  const node = root!.container.queryAll(n => n.props.accessibilityLabel === label)[0];
  if (!node) throw new Error(`Missing control: ${label}`);
  return node.props;
}
function text() { return JSON.stringify(root!.container.toJSON()); }
async function render() {
  await act(async () => { root!.render(React.createElement(ServerAddressScreen, props)); });
}
async function mount() { root = createRoot(); await render(); }
async function enter(value: string) {
  await act(async () => { control('Server address').onChangeText(value); });
}
async function press(label = 'Continue') {
  await act(async () => { control(label).onPress(); });
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
  props = { onContinue: jest.fn(async () => undefined) };
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test('asks for a server without requesting credentials or automatically submitting', async () => {
  await mount();
  expect(text()).toContain('Choose your server');
  expect(root!.container.queryAll(n => n.type === 'Input')).toHaveLength(1);
  expect(control('Server address').keyboardType).toBe('url');
  expect(control('Server address').autoCapitalize).toBe('none');
  expect(props.onContinue).not.toHaveBeenCalled();
});
test('prefills a suggested address without selecting it automatically', async () => {
  props.initialAddress = 'https://192.168.1.50:9443';
  await mount();
  expect(control('Server address').value).toBe(props.initialAddress);
  expect(props.onContinue).not.toHaveBeenCalled();
});
test('passes the normalized address to the parent exactly once', async () => {
  await mount(); await enter(' https://WEEKFLOW.example.test:443/ '); await press();
  expect(props.onContinue).toHaveBeenCalledTimes(1);
  expect(props.onContinue).toHaveBeenCalledWith('https://weekflow.example.test');
});
test.each(['', '192.168.1.50:9443', 'http://192.168.1.50:9443',
  'https://weekflow.example.test/api', 'https://user:secret@weekflow.example.test'])('rejects an invalid server %#', async address => {
  await mount(); await enter(address); await press();
  expect(props.onContinue).not.toHaveBeenCalled();
  expect(text()).toContain('Enter a complete HTTPS address');
});
test('editing after a validation error clears the local message', async () => {
  await mount(); await press(); await enter('https://weekflow.example.test');
  expect(text()).not.toContain('Enter a complete HTTPS address');
});
test('the keyboard action submits the chosen address', async () => {
  await mount(); await enter('https://weekflow.example.test');
  await act(async () => { control('Server address').onSubmitEditing(); });
  expect(props.onContinue).toHaveBeenCalledWith('https://weekflow.example.test');
});
test('loading saved settings shows progress and no usable form', async () => {
  props.isLoading = true; await mount();
  expect(text()).toContain('Loading your server address');
  expect(root!.container.queryAll(n => n.type === 'Spinner')).toHaveLength(1);
  expect(root!.container.queryAll(n => n.type === 'Input')).toHaveLength(0);
  expect(root!.container.queryAll(n => n.type === 'Button')).toHaveLength(0);
});
test('blocks double taps immediately and disables editing while selecting', async () => {
  const pending = deferred(); jest.mocked(props.onContinue).mockReturnValueOnce(pending.promise);
  await mount(); await enter('https://weekflow.example.test');
  await act(async () => { const submit = control('Continue').onPress; submit(); submit(); });
  expect(props.onContinue).toHaveBeenCalledTimes(1);
  expect(control('Continue').disabled).toBe(true);
  expect(control('Server address').editable).toBe(false);
  expect(text()).toContain('Selecting server');
  await act(async () => { pending.resolve(); });
  expect(control('Continue').disabled).toBe(false);
});
test('respects work already running in the parent', async () => {
  props.initialAddress = 'https://weekflow.example.test'; props.isSubmitting = true;
  await mount(); await press();
  expect(control('Continue').disabled).toBe(true);
  expect(props.onContinue).not.toHaveBeenCalled();
});
test('shows a controlled storage error and allows an explicit retry', async () => {
  jest.mocked(props.onContinue).mockRejectedValueOnce(new ServerAddressStorageError('write'));
  await mount(); await enter('https://weekflow.example.test'); await press();
  expect(text()).toContain('The server address could not be saved');
  expect(control('Continue').disabled).toBe(false);
  await press();
  expect(props.onContinue).toHaveBeenCalledTimes(2);
});
test('does not expose unexpected callback error details', async () => {
  jest.mocked(props.onContinue).mockRejectedValueOnce(new Error('private-native-details'));
  await mount(); await enter('https://weekflow.example.test'); await press();
  expect(text()).toContain('The server address could not be selected');
  expect(text()).not.toContain('private-native-details');
});
test('displays a parent error and offers loading retry only when supplied', async () => {
  props.errorMessage = 'The saved address could not be loaded.';
  props.onRetry = jest.fn(async () => undefined);
  await mount();
  expect(text()).toContain(props.errorMessage);
  await press('Retry loading saved address');
  expect(props.onRetry).toHaveBeenCalledTimes(1);
  expect(props.onContinue).not.toHaveBeenCalled();
});
test('ignores a late rejection after the form is unmounted', async () => {
  const pending = deferred(); jest.mocked(props.onContinue).mockReturnValueOnce(pending.promise);
  await mount(); await enter('https://weekflow.example.test'); await press();
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.reject(new Error('late private details')); });
  expect(props.onContinue).toHaveBeenCalledTimes(1);
});
test('uses readable text colors in dark mode', async () => {
  jest.mocked(useColorScheme).mockReturnValue('dark'); await mount();
  expect(control('Server address').style).toEqual(expect.arrayContaining([
    expect.objectContaining({ color: '#f9fafb', backgroundColor: '#1f2937' }),
  ]));
});
