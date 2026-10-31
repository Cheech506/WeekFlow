jest.mock('react-native', () => ({
  Pressable: 'Button', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/components/HistoryFilters', () => ({ __esModule: true, default: 'Filters' }));
jest.mock('@/components/PastCycleFolder', () => ({ __esModule: true, default: 'PastCycle' }));
jest.mock('@/components/EmptyStateCard', () => ({ EmptyStateCard: 'Empty' }));
jest.mock('@/components/ScreenIntro', () => ({ ScreenIntro: 'Intro' }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: jest.fn() }));
jest.mock('@/context/CycleContext', () => ({ useCycle: jest.fn() }));
jest.mock('@/context/CycleReviewContext', () => ({ useCycleReviews: jest.fn() }));
jest.mock('@/lib/brainDumpStorage', () => { throw new Error('History must use API-backed note actions'); });
jest.mock('@/lib/goalStorage', () => { throw new Error('History must use API-backed goal actions'); });
import { makeBrainDump, makeGoal } from '@/__tests__/testFactories';
import HistoryScreen from '@/app/(tabs)/history';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const reopen = jest.fn();
const restore = jest.fn();
const remove = jest.fn();
function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function button(label: string): any {
  return nodes('Button').find(node => node.props.accessibilityLabel === label)!.props;
}
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(HistoryScreen)); });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  for (const action of [reopen, restore, remove]) action.mockResolvedValue(undefined);
  jest.mocked(useTasks).mockReturnValue({ tasks: [] } as unknown as ReturnType<typeof useTasks>);
  jest.mocked(useGoals).mockReturnValue({
    goals: [makeGoal({ id: 61, title: 'Finished goal', completed: true, completedAt: '2026-10-25T12:00:00Z' })],
    milestones: [], reopenGoal: reopen,
  } as unknown as ReturnType<typeof useGoals>);
  jest.mocked(useBrainDumps).mockReturnValue({
    getArchivedBrainDumps: () => [makeBrainDump({ id: 73, body: 'Archived note', archived: true, archivedAt: '2026-10-25T12:00:00Z' })],
    restoreBrainDump: restore, deleteBrainDump: remove,
  } as unknown as ReturnType<typeof useBrainDumps>);
  jest.mocked(useCycle).mockReturnValue({ cycles: [] } as unknown as ReturnType<typeof useCycle>);
  jest.mocked(useCycleReviews).mockReturnValue({ cycleReviews: [], goalOutcomes: [] } as unknown as ReturnType<typeof useCycleReviews>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test.each([
  ['Reopen goal: Finished goal', reopen, 61],
  ['Restore note: Archived note', restore, 73],
  ['Delete archived note: Archived note', remove, 73],
])('uses the native server ID for %s', async (label, action, id) => {
  await mount();
  await act(async () => { button(label).onPress(); });
  expect(action).toHaveBeenCalledWith(id);
  expect(action).toHaveBeenCalledTimes(1);
  expect(nodes('Text').some(node => node.props.accessibilityRole === 'alert')).toBe(false);
});

test.each([
  ['Reopen goal: Finished goal', reopen],
  ['Restore note: Archived note', restore],
  ['Delete archived note: Archived note', remove],
])('shows API errors and keeps history visible after %s fails', async (label, action) => {
  action.mockRejectedValueOnce(new Error('The request timed out; it may have saved.'));
  await mount();
  await act(async () => { button(label).onPress(); });
  expect(text()).toContain('The request timed out; it may have saved.');
  expect(text()).toContain('Finished goal');
  expect(text()).toContain('Archived note');
  expect(action).toHaveBeenCalledTimes(1);
  expect(button(label).disabled).toBe(false);
});

test('rapid reopen taps send only one request while the first is pending', async () => {
  const pending = deferred(); reopen.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { const tap = button('Reopen goal: Finished goal').onPress; tap(); tap(); });
  expect(reopen).toHaveBeenCalledTimes(1);
  expect(button('Reopen goal: Finished goal').disabled).toBe(true);
  expect(text()).toContain('Updating history…');
  await act(async () => { pending.resolve(); });
  expect(button('Reopen goal: Finished goal').disabled).toBe(false);
  expect(text()).not.toContain('Updating history…');
});

test('a pending restore blocks a conflicting delete of the same note', async () => {
  const pending = deferred(); restore.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const deleteTap = button('Delete archived note: Archived note').onPress;
    button('Restore note: Archived note').onPress(); deleteTap();
  });
  expect(restore).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  expect(button('Delete archived note: Archived note').disabled).toBe(true);
  await act(async () => { pending.resolve(); });
});

test('a non-Error rejection displays a readable fallback', async () => {
  restore.mockRejectedValueOnce('Unexpected failure');
  await mount();
  await act(async () => { button('Restore note: Archived note').onPress(); });
  expect(text()).toContain('The request could not be completed.');
});

test('an explicit later action clears an earlier error', async () => {
  reopen.mockRejectedValueOnce(new Error('Goal could not be reopened'));
  await mount();
  await act(async () => { button('Reopen goal: Finished goal').onPress(); });
  expect(text()).toContain('Goal could not be reopened');
  await act(async () => { button('Restore note: Archived note').onPress(); });
  expect(text()).not.toContain('Goal could not be reopened');
  expect(reopen).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledTimes(1);
});

test('filter changes preserve search behavior without sending mutations', async () => {
  await mount();
  const filters = nodes('Filters')[0].props;
  await act(async () => { filters.onChange({ ...filters.filters, searchText: 'no matching history' }); });
  expect(nodes('Button').some(node => node.props.accessibilityLabel === 'Reopen goal: Finished goal')).toBe(false);
  expect(nodes('Button').some(node => node.props.accessibilityLabel === 'Restore note: Archived note')).toBe(false);
  expect(nodes('Filters')[0].props.resultSummary).toBe('Showing 0 tasks, 0 goals, 0 cycle reports, and 0 brain dumps');
  for (const action of [reopen, restore, remove]) expect(action).not.toHaveBeenCalled();
});

test('a pending action can finish after unmount without another write', async () => {
  const pending = deferred(); restore.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { button('Restore note: Archived note').onPress(); });
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.resolve(); });
  expect(restore).toHaveBeenCalledTimes(1);
});
