jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 800, height: 1000 }),
}));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/components/ActiveTaskFilters', () => ({ ActiveTaskFilters: () => null }));
jest.mock('@/components/ScreenIntro', () => ({ ScreenIntro: () => null }));
jest.mock('@/components/GuidedWeeklyReviewCard', () => ({ GuidedWeeklyReviewCard: () => null }));
jest.mock('@/components/WeeklyCommitmentsCard', () => ({ WeeklyCommitmentsCard: () => null }));
jest.mock('@/components/UnfinishedTaskDecisionsCard', () => ({
  UnfinishedTaskDecisionsCard: (props: Record<string, unknown>) => React.createElement('Decisions', props),
}));
jest.mock('@/components/TaskDatePicker', () => ({
  TaskDatePicker: (props: Record<string, unknown>) => React.createElement('Picker', props),
}));
jest.mock('@/components/TaskCardActionsMenu', () => ({
  TaskCardActionsMenu: (props: Record<string, unknown>) => React.createElement('TaskMenu', props),
}));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/WeeklyReviewContext', () => ({ useWeeklyReviews: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: () => ({ brainDumps: [] }) }));
jest.mock('@/context/GoalContext', () => ({ useGoals: () => ({ goals: [] }) }));
jest.mock('@/context/CycleContext', () => ({ useCycle: () => ({ cycles: [] }) }));

import WeeklyScreen from '@/app/(tabs)/weekly';
import { useTasks, type Task } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import { getWeekDays } from '@/lib/dateUtils';
import React, { act } from 'react';
import { Alert } from 'react-native';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scheduleTask = jest.fn<Promise<void>, [number, string]>();
const deleteTask = jest.fn<Promise<void>, [number]>();
const moveTaskToInbox = jest.fn<Promise<void>, [number]>();
const recordTaskDecision = jest.fn<Promise<void>, [Record<string, unknown>]>();
let root: ReturnType<typeof createRoot> | undefined;
let task: Task;
let originalWeek: string;
function props(type: string): any { return root!.container.queryAll(node => node.type === type)[0].props; }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(WeeklyScreen)); });
}
beforeEach(() => {
  jest.resetAllMocks();
  originalWeek = getWeekDays(new Date(), 0)[0].dateKey;
  task = {
    id: 41, title: 'Study', day: 'Monday', dueDate: originalWeek, notes: null,
    priority: 1, goalId: null, completed: false, completedAt: null,
    createdAt: '2026-10-01T12:00:00Z', recurringRuleId: 51,
    recurrenceOccurrenceDate: '2026-10-01',
  };
  scheduleTask.mockResolvedValue(undefined);
  deleteTask.mockResolvedValue(undefined);
  moveTaskToInbox.mockResolvedValue(undefined);
  recordTaskDecision.mockResolvedValue(undefined);
  jest.mocked(useTasks).mockReturnValue({
    tasks: [task], completeTask: jest.fn(), deleteTask, scheduleTask, moveTaskToInbox,
    getActiveTasksByDate: (date: string) => date === task.dueDate ? [task] : [],
  } as unknown as ReturnType<typeof useTasks>);
  jest.mocked(useWeeklyReviews).mockReturnValue({
    reviews: [], commitments: [], taskDecisions: [], saveReview: jest.fn(),
    addCommitment: jest.fn(), addTaskCommitment: jest.fn(), toggleCommitment: jest.fn(),
    deleteCommitment: jest.fn(), recordTaskDecision, deleteTaskDecision: jest.fn(),
  } as unknown as ReturnType<typeof useWeeklyReviews>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test.each(['nextWeek', 'inbox', 'keep', 'delete'] as const)('decision %s sends one action with the live ID and no separate task write', async (action) => {
  await mount();
  await act(async () => { await props('Decisions').onDecision(task, action); });
  expect(recordTaskDecision).toHaveBeenCalledTimes(1);
  expect(recordTaskDecision).toHaveBeenCalledWith({
    weekStart: originalWeek, taskId: 41, taskTitle: 'Study', originalDueDate: originalWeek,
    action, resolvedDueDate: null, recurringRuleId: 51, recurrenceOccurrenceDate: '2026-10-01',
  });
  expect(scheduleTask).not.toHaveBeenCalled();
  expect(deleteTask).not.toHaveBeenCalled();
  expect(moveTaskToInbox).not.toHaveBeenCalled();
});

test('weekly Choose Date sends only the reschedule decision and closes after success', async () => {
  await mount();
  await act(async () => { props('Decisions').onChooseDate(task); });
  expect(props('Picker').visible).toBe(true);
  await act(async () => { await props('Picker').onSelectDate('2027-01-01'); });
  expect(recordTaskDecision).toHaveBeenCalledWith(expect.objectContaining({
    weekStart: originalWeek, taskId: 41, originalDueDate: originalWeek,
    action: 'reschedule', resolvedDueDate: '2027-01-01',
  }));
  expect(scheduleTask).not.toHaveBeenCalled();
  expect(props('Picker').visible).toBe(false);
});

test('a picker opened for one week retains that review week after navigation', async () => {
  await mount();
  await act(async () => { props('Decisions').onChooseDate(task); });
  const nextButton = root!.container.queryAll(node => node.type === 'Pressable').find(node =>
    node.props.children?.props?.children === 'Next');
  expect(nextButton).toBeDefined();
  await act(async () => { nextButton!.props.onPress(); });
  await act(async () => { await props('Picker').onSelectDate('2027-01-01'); });
  expect(recordTaskDecision).toHaveBeenCalledWith(expect.objectContaining({ weekStart: originalWeek }));
});

test('ordinary task-card rescheduling uses the Task API without weekly decision history', async () => {
  await mount();
  await act(async () => { props('TaskMenu').onReschedule(); });
  await act(async () => { await props('Picker').onSelectDate('2027-01-01'); });
  expect(scheduleTask).toHaveBeenCalledWith(41, '2027-01-01');
  expect(recordTaskDecision).not.toHaveBeenCalled();
});

test('ordinary task-card deletion keeps its existing task action', async () => {
  await mount();
  await act(async () => { await props('TaskMenu').onDelete(); });
  expect(deleteTask).toHaveBeenCalledWith(41);
  expect(recordTaskDecision).not.toHaveBeenCalled();
});

test('a failed decision shows the error without a fallback task write', async () => {
  await mount();
  recordTaskDecision.mockRejectedValueOnce(new Error('No changes saved'));
  await act(async () => { await props('Decisions').onDecision(task, 'delete'); });
  expect(Alert.alert).toHaveBeenCalledWith('Could Not Apply Decision', 'No changes saved');
  expect(deleteTask).not.toHaveBeenCalled();
  expect(recordTaskDecision).toHaveBeenCalledTimes(1);
});

test('a failed weekly reschedule keeps the picker open and does not separately move the task', async () => {
  await mount();
  await act(async () => { props('Decisions').onChooseDate(task); });
  recordTaskDecision.mockRejectedValueOnce(new Error('Server unavailable'));
  await act(async () => { await props('Picker').onSelectDate('2027-01-01'); });
  expect(props('Picker').visible).toBe(true);
  expect(scheduleTask).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Could Not Schedule Task', 'Server unavailable');
});

test('an unscheduled task cannot receive a weekly decision', async () => {
  await mount();
  await act(async () => { await props('Decisions').onDecision({ ...task, dueDate: null }, 'keep'); });
  expect(recordTaskDecision).not.toHaveBeenCalled();
});
