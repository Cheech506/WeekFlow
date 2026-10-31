jest.mock('react-native', () => ({
  Pressable: 'Button', TextInput: 'Input',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/lib/goalMilestoneStorage', () => { throw new Error('Milestones must use the API-backed context'); });
import { makeGoalMilestone } from '@/__tests__/testFactories';
import GoalMilestoneManager from '@/components/GoalMilestoneManager';
import { useGoals } from '@/context/GoalContext';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
const add = jest.fn();
const edit = jest.fn();
const toggle = jest.fn();
const remove = jest.fn();
function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
function childText(child: any): string {
  if (child === null || child === undefined || typeof child === 'boolean') return '';
  if (Array.isArray(child)) return child.map(childText).join('');
  if (typeof child === 'object') return childText(child.props?.children);
  return String(child);
}
function button(label: string): any {
  const node = nodes('Button').find(node => node.props.accessibilityLabel === label || childText(node.props.children).trim() === label);
  if (!node) throw new Error(`Missing button ${label}`);
  return node.props;
}
function input(label: string): any {
  return nodes('Input').find(node => node.props.accessibilityLabel === label)!.props;
}
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(GoalMilestoneManager, { goalId: 61 })); });
  await act(async () => { nodes('Button')[0].props.onPress(); });
}
async function press(label: string) { await act(async () => { button(label).onPress(); }); }
async function type(label: string, value: string) {
  await act(async () => { input(label).onChangeText(value); });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  for (const action of [add, edit, toggle, remove]) action.mockResolvedValue(undefined);
  jest.mocked(useGoals).mockReturnValue({
    milestones: [
      makeGoalMilestone({ id: 91, goalId: 61, title: 'First checkpoint', notes: 'Keep these notes' }),
      makeGoalMilestone({ id: 92, goalId: 62, title: 'Another goal checkpoint' }),
    ],
    addMilestone: add, editMilestone: edit, toggleMilestone: toggle, deleteMilestone: remove,
  } as unknown as ReturnType<typeof useGoals>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
});

test('shows only milestones belonging to this goal', async () => {
  await mount();
  expect(text()).toContain('First checkpoint');
  expect(text()).not.toContain('Another goal checkpoint');
});

test('adding a milestone sends the native goal ID and submitted fields', async () => {
  await mount();
  await type('New milestone title', 'Second checkpoint');
  await type('New milestone target date', '2026-11-02');
  await type('New milestone notes', 'Finish this part');
  await press('Add Milestone');
  expect(add).toHaveBeenCalledWith(61, 'Second checkpoint', '2026-11-02', 'Finish this part');
  expect(input('New milestone title').value).toBe('');
  expect(input('New milestone target date').value).toBe('');
  expect(input('New milestone notes').value).toBe('');
});

test('failed creation preserves the form and original API error', async () => {
  add.mockRejectedValueOnce(new Error('Request timed out; it may have saved.'));
  await mount(); await type('New milestone title', 'Keep this draft'); await press('Add Milestone');
  expect(input('New milestone title').value).toBe('Keep this draft');
  expect(text()).toContain('Request timed out; it may have saved.');
  expect(add).toHaveBeenCalledTimes(1);
});

test('pending creation blocks duplicate taps and keeps the form from changing during the write', async () => {
  const pending = deferred(); add.mockReturnValueOnce(pending.promise);
  await mount(); await type('New milestone title', 'One checkpoint');
  await act(async () => { const tap = button('Add Milestone').onPress; tap(); tap(); });
  expect(add).toHaveBeenCalledTimes(1);
  expect(button('Add Milestone').disabled).toBe(true);
  expect(input('New milestone title').editable).toBe(false);
  await act(async () => { pending.resolve(); });
  expect(input('New milestone title').editable).toBe(true);
});

test('completion uses the native milestone ID', async () => {
  await mount(); await press('Complete milestone: First checkpoint');
  expect(toggle).toHaveBeenCalledWith(91);
  expect(toggle).toHaveBeenCalledTimes(1);
});

test('completion failure displays the error and leaves the milestone visible', async () => {
  toggle.mockRejectedValueOnce(new Error('Cannot change completion'));
  await mount(); await press('Complete milestone: First checkpoint');
  expect(text()).toContain('Cannot change completion');
  expect(text()).toContain('First checkpoint');
  expect(toggle).toHaveBeenCalledTimes(1);
});

test('a pending completion blocks both repeated toggles and deletion of the same milestone', async () => {
  const pending = deferred(); toggle.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const tap = button('Complete milestone: First checkpoint').onPress;
    const deleteTap = button('Delete milestone: First checkpoint').onPress;
    tap(); tap(); deleteTap();
  });
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  expect(button('Delete milestone: First checkpoint').disabled).toBe(true);
  expect(button('Edit').disabled).toBe(true);
  await act(async () => { pending.resolve(); });
});

test('deletion uses the native milestone ID', async () => {
  await mount(); await press('Delete milestone: First checkpoint');
  expect(remove).toHaveBeenCalledWith(91);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('failed deletion displays the error and retains the milestone', async () => {
  remove.mockRejectedValueOnce(new Error('Cannot delete milestone'));
  await mount(); await press('Delete milestone: First checkpoint');
  expect(text()).toContain('Cannot delete milestone');
  expect(text()).toContain('First checkpoint');
  expect(remove).toHaveBeenCalledTimes(1);
});

test('editing sends the milestone ID and closes the form only after success', async () => {
  await mount(); await press('Edit');
  await type('Edit milestone title', 'Updated checkpoint');
  await type('Edit milestone target date', '2026-11-03');
  await type('Edit milestone notes', 'Updated notes');
  await press('Save');
  expect(edit).toHaveBeenCalledWith(91, 'Updated checkpoint', '2026-11-03', 'Updated notes');
  expect(nodes('Input').some(node => node.props.accessibilityLabel === 'Edit milestone title')).toBe(false);
});

test('failed editing keeps the edited fields available', async () => {
  edit.mockRejectedValueOnce(new Error('Cannot update milestone'));
  await mount(); await press('Edit'); await type('Edit milestone title', 'Keep my edit'); await press('Save');
  expect(input('Edit milestone title').value).toBe('Keep my edit');
  expect(text()).toContain('Cannot update milestone');
  expect(edit).toHaveBeenCalledTimes(1);
});

test('pending editing blocks duplicate saves and cancellation', async () => {
  const pending = deferred(); edit.mockReturnValueOnce(pending.promise);
  await mount(); await press('Edit');
  await act(async () => { const tap = button('Save').onPress; tap(); tap(); });
  expect(edit).toHaveBeenCalledTimes(1);
  expect(button('Cancel').disabled).toBe(true);
  expect(input('Edit milestone title').editable).toBe(false);
  await act(async () => { pending.resolve(); });
});

test('non-Error completion rejection shows the fallback message', async () => {
  toggle.mockRejectedValueOnce('Unexpected rejection');
  await mount(); await press('Complete milestone: First checkpoint');
  expect(text()).toContain('The milestone completion could not be changed.');
});

test('a pending action may finish after unmount without an additional write', async () => {
  const pending = deferred(); remove.mockReturnValueOnce(pending.promise);
  await mount(); await press('Delete milestone: First checkpoint');
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.resolve(); });
  expect(remove).toHaveBeenCalledTimes(1);
});
