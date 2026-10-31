jest.mock('react-native', () => ({
  Pressable: 'Button', ScrollView: 'ScrollView', TextInput: 'Input',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 1200, height: 900 }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/components/CycleIdentityFields', () => ({ __esModule: true, default: 'CycleFields' }));
jest.mock('@/components/FirstCycleOnboarding', () => ({ __esModule: true, default: 'Onboarding' }));
jest.mock('@/components/CycleReviewPanel', () => ({ __esModule: true, default: 'CycleReview' }));
jest.mock('@/components/GoalAnalyticsCard', () => ({ __esModule: true, default: 'Analytics' }));
jest.mock('@/components/GoalCompletionPanel', () => ({ __esModule: true, default: 'Completion' }));
jest.mock('@/components/GoalDashboardOverview', () => ({ __esModule: true, default: 'Dashboard' }));
jest.mock('@/components/GoalMilestoneManager', () => ({ __esModule: true, default: 'Milestones' }));
jest.mock('@/components/PastCycleFolder', () => ({ __esModule: true, default: 'PastCycle' }));
jest.mock('@/components/EmptyStateCard', () => ({ EmptyStateCard: 'Empty' }));
jest.mock('@/components/ScreenIntro', () => ({ ScreenIntro: 'Intro' }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/CycleContext', () => ({ useCycle: jest.fn() }));
jest.mock('@/context/WeeklyReviewContext', () => ({ useWeeklyReviews: jest.fn() }));
import { makeGoal } from '@/__tests__/testFactories';
import GoalsScreen from '@/app/(tabs)/index';
import { useCycle } from '@/context/CycleContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const remove = jest.fn();
const complete = jest.fn();
const start = jest.fn();
const refreshGoals = jest.fn();
function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function deleteButton(): any {
  return nodes('Button').find(node => node.props.accessibilityLabel === 'Delete goal: My goal')!.props;
}
function childText(child: any): string {
  if (child === null || child === undefined || typeof child === 'boolean') return '';
  if (Array.isArray(child)) return child.map(childText).join('');
  if (typeof child === 'object') return childText(child.props?.children);
  return String(child);
}
function button(label: string): any {
  return nodes('Button').find(node => childText(node.props.children).trim() === label)!.props;
}
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(GoalsScreen)); });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  for (const mock of [remove, complete, start, refreshGoals]) mock.mockResolvedValue(undefined);
  jest.mocked(useTasks).mockReturnValue({ tasks: [] } as unknown as ReturnType<typeof useTasks>);
  jest.mocked(useGoals).mockReturnValue({
    goals: [makeGoal({ id: 61, title: 'My goal' })], milestones: [], isLoading: false,
    deleteGoal: remove, completeGoal: complete, refreshGoals,
  } as unknown as ReturnType<typeof useGoals>);
  jest.mocked(useCycle).mockReturnValue({ cycles: [], currentCycle: null, isLoading: false,
    startCycle: start, editCurrentCycle: jest.fn(),
  } as unknown as ReturnType<typeof useCycle>);
  jest.mocked(useWeeklyReviews).mockReturnValue({ commitments: [] } as unknown as ReturnType<typeof useWeeklyReviews>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test('deletes a goal through its API-backed context using the native ID', async () => {
  await mount();
  await act(async () => { deleteButton().onPress(); });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith(61);
  expect(nodes('Text').some(node => node.props.accessibilityRole === 'alert')).toBe(false);
});

test('a failed deletion keeps the goal visible and displays the original API error', async () => {
  remove.mockRejectedValueOnce(new Error('Request timed out; it may have saved.'));
  await mount();
  await act(async () => { deleteButton().onPress(); });
  expect(text()).toContain('Request timed out; it may have saved.');
  expect(text()).toContain('My goal');
  expect(remove).toHaveBeenCalledTimes(1);
  expect(deleteButton().disabled).toBe(false);
});

test('rapid delete taps cannot issue duplicate writes', async () => {
  const pending = deferred(); remove.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { const tap = deleteButton().onPress; tap(); tap(); });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(deleteButton().disabled).toBe(true);
  expect(button('Edit Goal').disabled).toBe(true);
  expect(button('Mark Complete').disabled).toBe(true);
  await act(async () => { pending.resolve(); });
  expect(deleteButton().disabled).toBe(false);
});

test('a non-Error deletion rejection still produces a readable message', async () => {
  remove.mockRejectedValueOnce('Unexpected rejection');
  await mount();
  await act(async () => { deleteButton().onPress(); });
  expect(text()).toContain('The goal could not be deleted.');
});

test('completion sends reflections to the context and closes only after acknowledgement', async () => {
  await mount();
  await act(async () => { button('Mark Complete').onPress(); });
  const reflection = { whatHelped: 'A weekly routine', learned: 'Stay consistent' };
  await act(async () => { await nodes('Completion')[0].props.onComplete(reflection); });
  expect(complete).toHaveBeenCalledWith(61, reflection);
  expect(nodes('Completion')).toHaveLength(0);
});

test('completion failure reaches the existing panel error handler and keeps reflections open', async () => {
  const failure = new Error('Could not save reflections');
  complete.mockRejectedValueOnce(failure);
  await mount();
  await act(async () => { button('Mark Complete').onPress(); });
  await act(async () => {
    await expect(nodes('Completion')[0].props.onComplete({ learned: 'Keep this reflection' })).rejects.toBe(failure);
  });
  expect(nodes('Completion')).toHaveLength(1);
  expect(complete).toHaveBeenCalledTimes(1);
});

test('successful cycle creation refreshes linked goals once', async () => {
  await mount();
  const onboarding = nodes('Onboarding')[0].props;
  await act(async () => { await onboarding.onStartCycle(); });
  expect(start).toHaveBeenCalledTimes(1);
  expect(refreshGoals).toHaveBeenCalledTimes(1);
});

test('a failed follow-up goal refresh explains that the cycle was created without replaying creation', async () => {
  refreshGoals.mockRejectedValueOnce(new Error('Goal read unavailable'));
  await mount();
  await act(async () => { await nodes('Onboarding')[0].props.onStartCycle(); });
  expect(text()).toContain('The planning cycle was created, but goals could not be refreshed.');
  expect(text()).toContain('Goal read unavailable');
  expect(start).toHaveBeenCalledTimes(1);
  expect(refreshGoals).toHaveBeenCalledTimes(1);
});

test('failed cycle creation does not run the follow-up refresh', async () => {
  start.mockRejectedValueOnce(new Error('Cannot create cycle'));
  await mount();
  await act(async () => { await nodes('Onboarding')[0].props.onStartCycle(); });
  expect(nodes('Onboarding')[0].props.message).toBe('Cannot create cycle');
  expect(refreshGoals).not.toHaveBeenCalled();
});

test('a pending deletion can finish after unmount without another write', async () => {
  const pending = deferred(); remove.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { deleteButton().onPress(); });
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.resolve(); });
  expect(remove).toHaveBeenCalledTimes(1);
});
