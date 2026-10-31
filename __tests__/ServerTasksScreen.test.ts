jest.mock('react-native', () => ({
  Pressable: 'Button', ScrollView: 'ScrollView', StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/lib/api/taskApi', () => ({ fetchApiTasks: jest.fn() }));
jest.mock('@/lib/api/backupMigrationApi', () => { throw new Error('Connection check must not load migration writes'); });
jest.mock('@/lib/api/taskMigrationApi', () => { throw new Error('Connection check must not load migration previews'); });
jest.mock('@/lib/backupStorage', () => { throw new Error('Connection check must not load SQLite backups'); });
import ServerTasksScreen from '@/app/server-tasks';
import { fetchApiTasks, type ApiTask } from '@/lib/api/taskApi';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const fetchTasks = jest.mocked(fetchApiTasks);
const task: ApiTask = {
  id: 41, sourceTaskId: null, sourceGoalId: null, sourceRecurringRuleId: null,
  title: 'Server task', notes: null, priority: 0, goalId: null, recurringRuleId: null,
  recurrenceOccurrenceDate: null, day: 'Inbox', dueDate: null, completed: false,
  completedAt: null, createdAt: '2026-10-25T12:00:00Z',
};
let root: ReturnType<typeof createRoot> | undefined;
function button(): any { return root!.container.queryAll(node => node.type === 'Button')[0].props; }
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(ServerTasksScreen)); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { jest.resetAllMocks(); fetchTasks.mockResolvedValue([task]); });
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test('does not request anything until the check button is pressed', async () => {
  await mount();
  expect(fetchTasks).not.toHaveBeenCalled();
  expect(text()).toContain('does not import or change your data');
});

test('uses the shared Task API and shows a successful read', async () => {
  await mount();
  await act(async () => { button().onPress(); });
  expect(fetchTasks).toHaveBeenCalledTimes(1);
  expect(fetchTasks).toHaveBeenCalledWith({}, { signal: expect.any(AbortSignal) });
  expect(text()).toContain('Server connection successful');
  expect(text()).toContain('Server task');
  expect(text()).toContain('Inbox');
});

test('a successful empty response shows zero tasks instead of a connection failure', async () => {
  fetchTasks.mockResolvedValueOnce([]);
  await mount();
  await act(async () => { button().onPress(); });
  expect(text()).toContain('Server connection successful');
  expect(text()).toContain('The server returned no tasks');
});

test('only displays the first twenty tasks while retaining the full total', async () => {
  fetchTasks.mockResolvedValueOnce(Array.from({ length: 25 }, (_, index) => ({ ...task, id: index + 1, title: `Task ${index + 1}` })));
  await mount();
  await act(async () => { button().onPress(); });
  expect(text()).toContain('Task 20');
  expect(text()).not.toContain('Task 21');
  const summary = root!.container.queryAll(node => node.type === 'Text').map(node => node.children.join('')).join('\n');
  expect(summary).toContain('Showing 20 of 25 saved tasks');
});

test('a failed read exposes its error without claiming the server is empty', async () => {
  fetchTasks.mockRejectedValueOnce(new Error('Server unavailable'));
  await mount();
  await act(async () => { button().onPress(); });
  expect(text()).toContain('Server unavailable');
  expect(text()).not.toContain('The server returned no tasks');
  expect(fetchTasks).toHaveBeenCalledTimes(1);
});

test('a later failed check retains the last successful list and labels it clearly', async () => {
  await mount();
  await act(async () => { button().onPress(); });
  fetchTasks.mockRejectedValueOnce(new Error('Connection lost'));
  await act(async () => { button().onPress(); });
  expect(text()).toContain('Server task');
  expect(text()).toContain('last successful check');
  expect(text()).toContain('Connection lost');
  expect(text()).not.toContain('Server connection successful');
});

test('rapid duplicate taps make one read while the request is pending', async () => {
  const pending = deferred<ApiTask[]>();
  fetchTasks.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const press = button().onPress;
    press(); press();
    await Promise.resolve();
    expect(fetchTasks).toHaveBeenCalledTimes(1);
  });
  expect(button().disabled).toBe(true);
  await act(async () => { pending.resolve([task]); });
  expect(button().disabled).toBe(false);
});

test('leaving the screen aborts its pending read', async () => {
  const pending = deferred<ApiTask[]>();
  fetchTasks.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { button().onPress(); });
  const signal = fetchTasks.mock.calls[0][1]!.signal!;
  expect(signal.aborted).toBe(false);
  await act(async () => { root!.unmount(); });
  root = undefined;
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve([task]); });
});
