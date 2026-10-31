jest.mock('react-native', () => ({
  ActivityIndicator: 'Spinner', Pressable: 'Button', Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@/components/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/CycleContext', () => ({ useCycle: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: jest.fn() }));
jest.mock('@/context/WeeklyReviewContext', () => ({ useWeeklyReviews: jest.fn() }));
jest.mock('@/context/CycleReviewContext', () => ({ useCycleReviews: jest.fn() }));
import { ApiDataBoundary } from '@/components/ApiDataBoundary';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type Data = { isLoading: boolean; isSaving: boolean; error: Error | null };
let data: Data[];
let refreshes: Array<jest.Mock<Promise<void>, []>>;
let root: ReturnType<typeof createRoot> | undefined;
function props(type: string): any { return root!.container.queryAll(node => node.type === type)[0].props; }
function contains(type: string) { return root!.container.queryAll(node => node.type === type).length > 0; }
function text() { return JSON.stringify(root!.container.toJSON()); }
async function render() {
  await act(async () => { root!.render(React.createElement(ApiDataBoundary, { children: React.createElement('Content') })); });
}
async function mount() { root = createRoot(); await render(); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  data = Array.from({ length: 6 }, () => ({ isLoading: false, isSaving: false, error: null }));
  refreshes = data.map(state => jest.fn(async () => { state.error = null; }));
  jest.mocked(useTasks).mockImplementation(() => ({ ...data[0], refreshTasks: refreshes[0] } as unknown as ReturnType<typeof useTasks>));
  jest.mocked(useGoals).mockImplementation(() => ({ ...data[1], refreshGoals: refreshes[1] } as unknown as ReturnType<typeof useGoals>));
  jest.mocked(useCycle).mockImplementation(() => ({ ...data[2], refreshCycles: refreshes[2] } as unknown as ReturnType<typeof useCycle>));
  jest.mocked(useBrainDumps).mockImplementation(() => ({ ...data[3], refreshBrainDumps: refreshes[3] } as unknown as ReturnType<typeof useBrainDumps>));
  jest.mocked(useWeeklyReviews).mockImplementation(() => ({ ...data[4], refreshWeeklyReviews: refreshes[4] } as unknown as ReturnType<typeof useWeeklyReviews>));
  jest.mocked(useCycleReviews).mockImplementation(() => ({ ...data[5], refreshCycleReviews: refreshes[5] } as unknown as ReturnType<typeof useCycleReviews>));
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test('waits for initial data before rendering the app', async () => {
  data[0].isLoading = true;
  await mount();
  expect(contains('Content')).toBe(false);
  expect(text()).toContain('Loading WeekFlow');
  data[0].isLoading = false;
  await render();
  expect(contains('Content')).toBe(true);
});

test.each([0, 1, 2, 3, 4, 5])('a startup error from provider %s does not appear as an empty account', async index => {
  data[index].error = new Error('Server unavailable');
  await mount();
  expect(contains('Content')).toBe(false);
  expect(text()).toContain('WeekFlow could not load your data');
  expect(text()).toContain('Server unavailable');
  expect(props('Button').disabled).toBe(false);
});

test('successful initial data renders the app without an error or refresh button', async () => {
  await mount();
  expect(contains('Content')).toBe(true);
  expect(contains('Button')).toBe(false);
});

test('later failures preserve the loaded app and display the error', async () => {
  await mount();
  data[0].error = Object.assign(new Error('Connection lost; refresh before submitting again'), { mutationMayHaveSucceeded: true });
  await render();
  expect(contains('Content')).toBe(true);
  expect(text()).toContain('A request needs attention');
  expect(text()).toContain('Connection lost');
  expect(text()).toContain('Refresh to check the saved data');
});

test('manual refresh calls only the six provider refresh methods and recovers startup', async () => {
  data[0].error = new Error('Unavailable');
  await mount();
  await act(async () => { props('Button').onPress(); });
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  expect(contains('Content')).toBe(true);
  expect(contains('Button')).toBe(false);
});

test('repeated refresh taps cannot overlap a pending request', async () => {
  data[0].error = new Error('Unavailable');
  const pending = deferred();
  refreshes[0].mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const press = props('Button').onPress;
    press();
    press();
    await Promise.resolve();
    for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
    pending.resolve();
  });
});

test('refresh stays disabled while another provider is saving', async () => {
  data[0].error = new Error('Unavailable');
  data[1].isSaving = true;
  await mount();
  expect(props('Button').disabled).toBe(true);
  await act(async () => { props('Button').onPress(); });
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
});

test('a failed refresh remains visible and is not automatically repeated', async () => {
  data[0].error = new Error('Unavailable');
  refreshes[0].mockRejectedValueOnce(data[0].error);
  await mount();
  await act(async () => { props('Button').onPress(); });
  expect(contains('Content')).toBe(false);
  expect(props('Button').disabled).toBe(false);
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
});

test('background loading and saving retain the mounted app and show progress', async () => {
  await mount();
  data[0].isLoading = true;
  await render();
  expect(contains('Content')).toBe(true);
  expect(text()).toContain('Refreshing WeekFlow');
  data[0].isLoading = false;
  data[1].isSaving = true;
  await render();
  expect(contains('Content')).toBe(true);
  expect(text()).toContain('Saving changes');
});
