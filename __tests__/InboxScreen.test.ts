// The project transformer does not hoist mocks: keep them above imports.
jest.mock('react-native', () => ({
  Pressable: 'Button', ScrollView: 'ScrollView', TextInput: 'Input',
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 1200, height: 900 }),
}));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/components/ActiveTaskFilters', () => ({ ActiveTaskFilters: 'Filters' }));
jest.mock('@/components/InboxOverviewCard', () => ({ __esModule: true, default: 'Overview' }));
jest.mock('@/components/TaskDatePicker', () => ({ TaskDatePicker: 'DatePicker' }));
jest.mock('@/components/TaskWeeklyCommitmentButton', () => ({ TaskWeeklyCommitmentButton: 'CommitmentButton' }));
jest.mock('@/components/EmptyStateCard', () => ({ EmptyStateCard: 'Empty' }));
jest.mock('@/components/ScreenIntro', () => ({ ScreenIntro: 'Intro' }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: jest.fn() }));
jest.mock('@/lib/taskStorage', () => { throw new Error('Inbox must use the API-backed task provider'); });
jest.mock('@/lib/brainDumpStorage', () => { throw new Error('Inbox must use the API-backed note provider'); });
import InboxScreen from '@/app/(tabs)/inbox';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { getLocalDateKey } from '@/lib/dateUtils';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const addTask = jest.fn();
const scheduleTask = jest.fn();
const completeTask = jest.fn();
const deleteTask = jest.fn();
const moveTaskToInbox = jest.fn();
const toggleRecurringRule = jest.fn();
const deleteRecurringRule = jest.fn();
const addNote = jest.fn();
const convertNote = jest.fn();
const archiveNote = jest.fn();
const deleteNote = jest.fn();
let taskDueDate: string | null;

function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function childText(child: any): string {
  if (child === null || child === undefined || typeof child === 'boolean') return '';
  if (Array.isArray(child)) return child.map(childText).join('');
  if (typeof child === 'object') return childText(child.props?.children);
  return String(child);
}
function button(label: string): any {
  const found = nodes('Button').find(node => childText(node.props.children).trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found.props;
}
function input(placeholder: string): any {
  return nodes('Input').find(node => node.props.placeholder === placeholder)!.props;
}
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(InboxScreen)); });
}
async function press(label: string) { await act(async () => { button(label).onPress(); }); }
async function type(placeholder: string, value: string) {
  await act(async () => { input(placeholder).onChangeText(value); });
}
async function expandSchedules() {
  const header = nodes('Button').find(node => childText(node.props.children).includes('Manage Recurring Tasks'))!;
  await act(async () => { header.props.onPress(); });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  taskDueDate = null;
  for (const mock of [addTask, scheduleTask, completeTask, deleteTask, moveTaskToInbox,
    toggleRecurringRule, deleteRecurringRule, addNote, convertNote, archiveNote, deleteNote]) {
    mock.mockResolvedValue(undefined);
  }
  jest.mocked(useTasks).mockImplementation(() => ({
    tasks: [{ id: 41, title: 'Server task', completed: false, completedAt: null,
      createdAt: '2026-10-26T10:00:00Z', dueDate: taskDueDate, day: 'Inbox',
      notes: null, priority: 1, goalId: null, recurringRuleId: null, recurrenceOccurrenceDate: null }],
    recurringRules: [{ id: 85, title: 'Daily schedule', active: true, startDate: '2026-10-01',
      endDate: null, frequency: 'daily', weekdays: [], notes: null, priority: 0, goalId: null }],
    taskTemplates: [], addTask, scheduleTask, completeTask, deleteTask, moveTaskToInbox,
    toggleRecurringRule, deleteRecurringRule,
  } as unknown as ReturnType<typeof useTasks>));
  jest.mocked(useGoals).mockReturnValue({ goals: [] } as unknown as ReturnType<typeof useGoals>);
  jest.mocked(useBrainDumps).mockReturnValue({
    getActiveBrainDumps: () => [{ id: 73, body: 'Remember this', createdAt: '2026-10-26T10:00:00Z' }],
    addBrainDump: addNote, turnBrainDumpIntoTask: convertNote,
    archiveBrainDump: archiveNote, deleteBrainDump: deleteNote,
  } as unknown as ReturnType<typeof useBrainDumps>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test('adding an ordinary task sends its details to the API-backed provider and clears the form on success', async () => {
  await mount();
  await type('Quick add something...', 'New task');
  await press('Add to Inbox');
  expect(addTask).toHaveBeenCalledWith('New task', 'Inbox', '', 0, null);
  expect(input('Quick add something...').value).toBe('');
});

test('a failed task create retains the draft and displays the original error without retrying', async () => {
  addTask.mockRejectedValueOnce(new Error('Request timed out; it may have saved.'));
  await mount();
  await type('Quick add something...', 'Keep my draft');
  await press('Add to Inbox');
  expect(input('Quick add something...').value).toBe('Keep my draft');
  expect(text()).toContain('Request timed out; it may have saved.');
  expect(addTask).toHaveBeenCalledTimes(1);
});

test('submit-key and button taps cannot create two tasks while the first request is pending', async () => {
  const pending = deferred(); addTask.mockReturnValueOnce(pending.promise);
  await mount(); await type('Quick add something...', 'One task');
  await act(async () => {
    const tap = button('Add to Inbox').onPress;
    input('Quick add something...').onSubmitEditing(); tap();
  });
  expect(addTask).toHaveBeenCalledTimes(1);
  expect(button('Saving…').disabled).toBe(true);
  await act(async () => { pending.resolve(); });
});

test('a failed note create keeps the text available', async () => {
  addNote.mockRejectedValueOnce(new Error('Server unavailable'));
  await mount(); await type('Write anything here...', 'My note');
  await press('Save Brain Dump');
  expect(addNote).toHaveBeenCalledWith('My note');
  expect(input('Write anything here...').value).toBe('My note');
  expect(text()).toContain('Server unavailable');
});

test('successful note creation clears only the submitted draft', async () => {
  await mount(); await type('Write anything here...', 'My note');
  await press('Save Brain Dump');
  expect(input('Write anything here...').value).toBe('');
});

test('a new note draft typed during a pending save is preserved', async () => {
  const pending = deferred(); addNote.mockReturnValueOnce(pending.promise);
  await mount(); await type('Write anything here...', 'First note');
  await press('Save Brain Dump');
  await type('Write anything here...', 'Next note');
  await act(async () => { pending.resolve(); });
  expect(input('Write anything here...').value).toBe('Next note');
  expect(addNote).toHaveBeenCalledTimes(1);
});

test('rapid note-save taps send one create request', async () => {
  const pending = deferred(); addNote.mockReturnValueOnce(pending.promise);
  await mount(); await type('Write anything here...', 'My note');
  await act(async () => { const tap = button('Save Brain Dump').onPress; tap(); tap(); });
  expect(addNote).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); });
});

test.each([
  ['Turn Into Task', convertNote], ['Archive', archiveNote], ['Delete', deleteNote],
])('handles a failed note action: %s', async (label, action) => {
  action.mockRejectedValueOnce(new Error('Note action failed'));
  await mount(); await press(label);
  expect(action).toHaveBeenCalledWith(73);
  expect(text()).toContain('Note action failed');
  expect(text()).toContain('Remember this');
  expect(action).toHaveBeenCalledTimes(1);
});

test('a pending conversion blocks a conflicting archive or delete of the same note', async () => {
  const pending = deferred(); convertNote.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const archive = button('Archive').onPress;
    button('Turn Into Task').onPress(); archive();
  });
  expect(convertNote).toHaveBeenCalledTimes(1);
  expect(archiveNote).not.toHaveBeenCalled();
  expect(button('Archive').disabled).toBe(true);
  await act(async () => { pending.resolve(); });
});

test('completion failure is displayed and retains the task', async () => {
  completeTask.mockRejectedValueOnce(new Error('Cannot complete task'));
  await mount(); await press('Done');
  expect(completeTask).toHaveBeenCalledWith(41);
  expect(text()).toContain('Cannot complete task');
  expect(text()).toContain('Server task');
});

test('task deletion failure is handled separately from note deletion', async () => {
  deleteTask.mockRejectedValueOnce(new Error('Cannot delete task'));
  await mount();
  const taskDelete = nodes('Button').filter(node => childText(node.props.children).trim() === 'Delete')[1];
  await act(async () => { taskDelete.props.onPress(); });
  expect(deleteTask).toHaveBeenCalledWith(41);
  expect(deleteNote).not.toHaveBeenCalled();
  expect(text()).toContain('Cannot delete task');
});

test('quick scheduling failure is displayed without issuing another write', async () => {
  scheduleTask.mockRejectedValueOnce(new Error('Cannot schedule task'));
  await mount();
  const today = nodes('Button').find(node => childText(node.props.children).startsWith('Today'))!;
  await act(async () => { today.props.onPress(); });
  expect(scheduleTask).toHaveBeenCalledWith(41, getLocalDateKey(new Date()));
  expect(scheduleTask).toHaveBeenCalledTimes(1);
  expect(text()).toContain('Cannot schedule task');
});

test('date-picker failure propagates to the existing picker handler and keeps the picker open', async () => {
  scheduleTask.mockRejectedValueOnce(new Error('Cannot schedule task'));
  await mount(); await press('Choose DateAny date');
  const picker = () => nodes('DatePicker')[0].props;
  await act(async () => { await expect(picker().onSelectDate('2026-11-01')).rejects.toThrow('Cannot schedule task'); });
  expect(picker().visible).toBe(true);
});

test('pause failure uses the schedule ID and displays the failure', async () => {
  toggleRecurringRule.mockRejectedValueOnce(new Error('Cannot pause schedule'));
  await mount(); await expandSchedules(); await press('Pause');
  expect(toggleRecurringRule).toHaveBeenCalledWith(85);
  expect(text()).toContain('Cannot pause schedule');
});

test.each([
  ['Stop Schedule Only', 'stopOnly'],
  ['Delete Schedule + Unfinished Tasks', 'deleteUnfinished'],
])('failed schedule removal retains its confirmation choices: %s', async (label, mode) => {
  deleteRecurringRule.mockRejectedValueOnce(new Error('Cannot remove schedule'));
  await mount(); await expandSchedules(); await press('Delete Schedule'); await press(label);
  expect(deleteRecurringRule).toHaveBeenCalledWith(85, mode);
  expect(text()).toContain('Cannot remove schedule');
  expect(text()).toContain('How should this schedule be removed?');
});

test('successful schedule removal closes the confirmation after acknowledgement', async () => {
  await mount(); await expandSchedules(); await press('Delete Schedule'); await press('Stop Schedule Only');
  expect(deleteRecurringRule).toHaveBeenCalledWith(85, 'stopOnly');
  expect(text()).not.toContain('How should this schedule be removed?');
});

test('a pending schedule removal blocks another removal mode and pause', async () => {
  const pending = deferred(); deleteRecurringRule.mockReturnValueOnce(pending.promise);
  await mount(); await expandSchedules(); await press('Delete Schedule');
  await act(async () => {
    const other = button('Delete Schedule + Unfinished Tasks').onPress;
    const pause = button('Pause').onPress;
    button('Stop Schedule Only').onPress(); other(); pause();
  });
  expect(deleteRecurringRule).toHaveBeenCalledTimes(1);
  expect(toggleRecurringRule).not.toHaveBeenCalled();
  expect(button('Pause').disabled).toBe(true);
  await act(async () => { pending.resolve(); });
});

test('a non-Error rejection still displays a readable failure', async () => {
  archiveNote.mockRejectedValueOnce('Unexpected failure');
  await mount(); await press('Archive');
  expect(text()).toContain('The request could not be completed.');
});
