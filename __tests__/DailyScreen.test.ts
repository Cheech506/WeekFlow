jest.mock('react-native', () => ({
  Pressable: 'Button', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 1200, height: 900 }),
}));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/components/ActiveTaskFilters', () => ({ ActiveTaskFilters: 'Filters' }));
jest.mock('@/components/TaskCardActionsMenu', () => ({ TaskCardActionsMenu: 'TaskActions' }));
jest.mock('@/components/TaskDatePicker', () => ({ TaskDatePicker: 'DatePicker' }));
jest.mock('@/components/EmptyStateCard', () => ({ EmptyStateCard: 'Empty' }));
jest.mock('@/components/ScreenIntro', () => ({ ScreenIntro: 'Intro' }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: jest.fn() }));
import DailyScreen from '@/app/(tabs)/daily';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { getLocalDateKey } from '@/lib/dateUtils';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const archive = jest.fn<Promise<void>, [number]>();
const schedule = jest.fn<Promise<void>, [number, string]>();
let notes: Array<{ id: number; body: string; createdAt: string }>;
function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function archiveButton(): any { return nodes('Button').find(node => node.props.accessibilityLabel === 'Archive note: Remember this')!.props; }
function picker(): any { return nodes('DatePicker')[0].props; }
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(DailyScreen)); });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  notes = [{ id: 73, body: 'Remember this', createdAt: '2026-10-26T10:00:00Z' }];
  archive.mockResolvedValue(undefined);
  schedule.mockResolvedValue(undefined);
  const task = { id: 41, title: 'Server task', completed: false, completedAt: null,
    createdAt: '2026-10-26T10:00:00Z', dueDate: getLocalDateKey(new Date()), day: 'Monday',
    notes: null, priority: 1, goalId: null, recurringRuleId: null, recurrenceOccurrenceDate: null };
  jest.mocked(useTasks).mockReturnValue({ tasks: [task], scheduleTask: schedule,
    completeTask: jest.fn(), deleteTask: jest.fn(), moveTaskToInbox: jest.fn(),
    getActiveTasksByDate: () => [task], getOverdueTasks: () => [],
  } as unknown as ReturnType<typeof useTasks>);
  jest.mocked(useGoals).mockReturnValue({ goals: [] } as unknown as ReturnType<typeof useGoals>);
  jest.mocked(useBrainDumps).mockReturnValue({ getActiveBrainDumps: () => notes,
    archiveBrainDump: archive } as unknown as ReturnType<typeof useBrainDumps>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test('archives the selected note using its native server ID', async () => {
  await mount();
  await act(async () => { archiveButton().onPress(); });
  expect(archive).toHaveBeenCalledTimes(1);
  expect(archive).toHaveBeenCalledWith(73);
  expect(nodes('Text').some(node => node.props.accessibilityRole === 'alert')).toBe(false);
});

test('shows an API failure while retaining the note and does not retry the write', async () => {
  archive.mockRejectedValueOnce(new Error('Connection lost; check the server before retrying.'));
  await mount();
  await act(async () => { archiveButton().onPress(); });
  expect(text()).toContain('Connection lost; check the server before retrying.');
  expect(text()).toContain('Remember this');
  expect(archiveButton().disabled).toBe(false);
  expect(archive).toHaveBeenCalledTimes(1);
});

test('handles a non-Error rejection with a readable fallback', async () => {
  archive.mockRejectedValueOnce('Unexpected rejection');
  await mount();
  await act(async () => { archiveButton().onPress(); });
  expect(text()).toContain('The note could not be archived.');
});

test('blocks rapid duplicate taps and disables archive buttons while saving', async () => {
  const pending = deferred();
  archive.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { const press = archiveButton().onPress; press(); press(); });
  expect(archive).toHaveBeenCalledTimes(1);
  expect(archiveButton().disabled).toBe(true);
  expect(text()).toContain('Archiving…');
  await act(async () => { pending.resolve(); });
  expect(archiveButton().disabled).toBe(false);
});

test('a later explicit archive action clears an earlier error', async () => {
  archive.mockRejectedValueOnce(new Error('Server unavailable'));
  await mount();
  await act(async () => { archiveButton().onPress(); });
  expect(text()).toContain('Server unavailable');
  await act(async () => { archiveButton().onPress(); });
  expect(text()).not.toContain('Server unavailable');
  expect(archive).toHaveBeenCalledTimes(2);
});

test('successful scheduling closes the picker after the API action finishes', async () => {
  await mount();
  await act(async () => { nodes('TaskActions')[0].props.onReschedule(); });
  expect(picker().visible).toBe(true);
  await act(async () => { await picker().onSelectDate('2026-11-01'); });
  expect(schedule).toHaveBeenCalledWith(41, '2026-11-01');
  expect(picker().visible).toBe(false);
});

test('scheduling failure leaves the picker open and reaches its existing error handler', async () => {
  const failure = new Error('Could not schedule task');
  schedule.mockRejectedValueOnce(failure);
  await mount();
  await act(async () => { nodes('TaskActions')[0].props.onReschedule(); });
  await act(async () => { await expect(picker().onSelectDate('2026-11-01')).rejects.toBe(failure); });
  expect(picker().visible).toBe(true);
  expect(schedule).toHaveBeenCalledTimes(1);
});

test('a pending archive can finish after the screen unmounts without another write', async () => {
  const pending = deferred();
  archive.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { archiveButton().onPress(); });
  await act(async () => { root!.unmount(); });
  root = undefined;
  await act(async () => { pending.resolve(); });
  expect(archive).toHaveBeenCalledTimes(1);
});
