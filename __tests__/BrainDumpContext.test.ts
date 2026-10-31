jest.mock('@/lib/api/brainDumpApi', () => ({
  archiveApiBrainDump: jest.fn(), convertApiBrainDumpToTask: jest.fn(),
  createApiBrainDump: jest.fn(), deleteApiBrainDump: jest.fn(), fetchApiBrainDumps: jest.fn(),
  restoreApiBrainDump: jest.fn(), updateApiBrainDump: jest.fn(),
}));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/lib/brainDumpStorage', () => { throw new Error('The API provider must not load SQLite notes'); });
import { BrainDumpProvider, useBrainDumps } from '@/context/BrainDumpContext';
import { useTasks } from '@/context/TaskContext';
import * as notesApi from '@/lib/api/brainDumpApi';
import type { ApiTask } from '@/lib/api/taskApi';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const api = jest.mocked(notesApi);
const refreshTasks = jest.fn<Promise<void>, []>();
const original: notesApi.ApiBrainDump = {
  id: 11, sourceBrainDumpId: 1781204320011, body: 'An idea', archived: false,
  createdAt: '2026-10-01T12:00:00Z', archivedAt: null,
};
const archived: notesApi.ApiBrainDump = {
  ...original, id: 12, body: 'Older idea', archived: true, archivedAt: '2026-10-02T12:00:00Z',
};
const task: ApiTask = {
  id: 91, sourceTaskId: null, title: 'An idea', day: 'Inbox', dueDate: null,
  notes: null, priority: 0, goalId: null, sourceGoalId: null,
  recurringRuleId: null, sourceRecurringRuleId: null, recurrenceOccurrenceDate: null,
  completed: false, completedAt: null, createdAt: '2026-10-25T12:00:00Z',
};
let value: ReturnType<typeof useBrainDumps>;
let root: ReturnType<typeof createRoot> | undefined;
function Probe() { value = useBrainDumps(); return null; }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(BrainDumpProvider, { children: React.createElement(Probe) })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  api.fetchApiBrainDumps.mockResolvedValue([original, archived]);
  refreshTasks.mockResolvedValue(undefined);
  jest.mocked(useTasks).mockReturnValue({ refreshTasks } as unknown as ReturnType<typeof useTasks>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  jest.restoreAllMocks();
});

test('loads server notes without SQLite and keeps active/archive filters', async () => {
  await mount();
  expect(api.fetchApiBrainDumps).toHaveBeenCalledWith();
  expect(value.brainDumps).toEqual([original, archived]);
  expect(value.getActiveBrainDumps()).toEqual([original]);
  expect(value.getArchivedBrainDumps()).toEqual([archived]);
  expect(value.isLoading).toBe(false);
  expect(value.error).toBeNull();
});

test('startup failure stays visible and loading finishes', async () => {
  const failure = new Error('Server unavailable');
  api.fetchApiBrainDumps.mockRejectedValueOnce(failure);
  await mount();
  expect(value.error).toBe(failure);
  expect(value.brainDumps).toEqual([]);
  expect(value.isLoading).toBe(false);
});

test('failed refresh retains the previous list and a later refresh recovers', async () => {
  await mount();
  api.fetchApiBrainDumps.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.refreshBrainDumps()).rejects.toThrow('Read failed'); });
  expect(value.brainDumps).toEqual([original, archived]);
  await act(async () => { await value.refreshBrainDumps(); });
  expect(value.error).toBeNull();
});

test('creation uses the server identity and timestamps', async () => {
  await mount();
  const created = { ...original, id: 13, sourceBrainDumpId: null, body: 'New idea' };
  api.createApiBrainDump.mockResolvedValue(created);
  await act(async () => { await value.addBrainDump('New idea'); });
  expect(api.createApiBrainDump).toHaveBeenCalledWith({ body: 'New idea' });
  expect(value.brainDumps).toEqual([created, original, archived]);
  expect(api.fetchApiBrainDumps).toHaveBeenCalledTimes(1);
});

test('a blank create form makes no request', async () => {
  await mount();
  await value.addBrainDump('   ');
  expect(api.createApiBrainDump).not.toHaveBeenCalled();
});

test('editing uses the native ID and the complete returned note', async () => {
  await mount();
  const edited = { ...original, body: 'Changed idea' };
  api.updateApiBrainDump.mockResolvedValue(edited);
  await act(async () => { await value.editBrainDump(11, 'Changed idea'); });
  expect(api.updateApiBrainDump).toHaveBeenCalledWith(11, { body: 'Changed idea' });
  expect(value.brainDumps).toEqual([edited, archived]);
});

test('archive uses the backend timestamp; restore keeps identity and clears archive status', async () => {
  await mount();
  const saved = { ...original, archived: true, archivedAt: '2026-10-25T14:00:00Z' };
  api.archiveApiBrainDump.mockResolvedValue(saved);
  api.restoreApiBrainDump.mockResolvedValue(original);
  await act(async () => { await value.archiveBrainDump(11); });
  expect(api.archiveApiBrainDump).toHaveBeenCalledWith(11);
  expect(value.brainDumps[0]).toEqual(saved);
  expect(value.getActiveBrainDumps()).toEqual([]);
  await act(async () => { await value.restoreBrainDump(11); });
  expect(api.restoreApiBrainDump).toHaveBeenCalledWith(11);
  expect(value.brainDumps[0]).toEqual(original);
});

test.each(['edit', 'archive', 'restore', 'delete'] as const)('failed %s leaves the note unchanged and exposes the error', async (action) => {
  await mount();
  const failure = new Error('Write rejected');
  const method = {
    edit: api.updateApiBrainDump, archive: api.archiveApiBrainDump,
    restore: api.restoreApiBrainDump, delete: api.deleteApiBrainDump,
  }[action];
  method.mockRejectedValueOnce(failure);
  await act(async () => {
    const result = action === 'edit' ? value.editBrainDump(11, 'Changed') :
      action === 'archive' ? value.archiveBrainDump(11) :
      action === 'restore' ? value.restoreBrainDump(11) : value.deleteBrainDump(11);
    await expect(result).rejects.toBe(failure);
  });
  expect(value.brainDumps).toEqual([original, archived]);
  expect(value.error).toBe(failure);
  expect(value.isSaving).toBe(false);
});

test('acknowledged deletion removes only its target note', async () => {
  await mount();
  api.deleteApiBrainDump.mockResolvedValue(undefined);
  await act(async () => { await value.deleteBrainDump(11); });
  expect(api.deleteApiBrainDump).toHaveBeenCalledWith(11);
  expect(value.brainDumps).toEqual([archived]);
});

test('conversion makes one backend action, removes the note, then refreshes task data', async () => {
  await mount();
  api.convertApiBrainDumpToTask.mockResolvedValue(task);
  await act(async () => { await value.turnBrainDumpIntoTask(11); });
  expect(api.convertApiBrainDumpToTask).toHaveBeenCalledWith(11);
  expect(api.convertApiBrainDumpToTask).toHaveBeenCalledTimes(1);
  expect(value.brainDumps).toEqual([archived]);
  expect(refreshTasks).toHaveBeenCalledTimes(1);
});

test('a rejected conversion preserves the note and never refreshes tasks', async () => {
  await mount();
  const failure = new Error('Conversion rejected');
  api.convertApiBrainDumpToTask.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.turnBrainDumpIntoTask(11)).rejects.toBe(failure); });
  expect(value.brainDumps).toEqual([original, archived]);
  expect(refreshTasks).not.toHaveBeenCalled();
});

test('a task refresh failure after conversion keeps the acknowledged note removal and reports the saved change', async () => {
  await mount();
  api.convertApiBrainDumpToTask.mockResolvedValue(task);
  refreshTasks.mockRejectedValueOnce(new Error('Task read failed'));
  await act(async () => { await expect(value.turnBrainDumpIntoTask(11)).rejects.toThrow('The change was saved'); });
  expect(value.brainDumps).toEqual([archived]);
  expect(api.convertApiBrainDumpToTask).toHaveBeenCalledTimes(1);
  expect(value.error?.message).toContain('Refresh the app before submitting again');
});

test('an uncertain conversion preserves the exact error and does not retry', async () => {
  await mount();
  const failure = Object.assign(new Error('Connection lost'), { mutationMayHaveSucceeded: true });
  api.convertApiBrainDumpToTask.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.turnBrainDumpIntoTask(11)).rejects.toBe(failure); });
  expect(value.error).toBe(failure);
  expect(value.brainDumps).toEqual([original, archived]);
  expect(api.convertApiBrainDumpToTask).toHaveBeenCalledTimes(1);
  expect(refreshTasks).not.toHaveBeenCalled();
});

test('duplicate conversion or delete taps on the same note make one write', async () => {
  await mount();
  const pending = deferred<ApiTask>();
  api.convertApiBrainDumpToTask.mockReturnValueOnce(pending.promise);
  await act(async () => {
    const first = value.turnBrainDumpIntoTask(11);
    await expect(value.turnBrainDumpIntoTask(11)).rejects.toThrow('already being saved');
    await expect(value.deleteBrainDump(11)).rejects.toThrow('already being saved');
    pending.resolve(task);
    await first;
  });
  expect(api.convertApiBrainDumpToTask).toHaveBeenCalledTimes(1);
  expect(api.deleteApiBrainDump).not.toHaveBeenCalled();
  expect(value.isSaving).toBe(false);
});

test('writes to separate notes wait their turn and retain both server responses', async () => {
  await mount();
  const pending = deferred<notesApi.ApiBrainDump>();
  api.updateApiBrainDump.mockReturnValueOnce(pending.promise);
  api.restoreApiBrainDump.mockResolvedValue({ ...archived, archived: false, archivedAt: null });
  await act(async () => {
    const first = value.editBrainDump(11, 'Changed');
    const second = value.restoreBrainDump(12);
    await Promise.resolve();
    expect(api.restoreApiBrainDump).not.toHaveBeenCalled();
    pending.resolve({ ...original, body: 'Changed' });
    await Promise.all([first, second]);
  });
  expect(value.brainDumps[0].body).toBe('Changed');
  expect(value.brainDumps[1].archived).toBe(false);
  expect(value.isSaving).toBe(false);
});

test('an older refresh cannot overwrite a later saved edit', async () => {
  await mount();
  const pending = deferred<notesApi.ApiBrainDump[]>();
  api.fetchApiBrainDumps.mockReturnValueOnce(pending.promise);
  api.updateApiBrainDump.mockResolvedValue({ ...original, body: 'Newest' });
  await act(async () => {
    const refresh = value.refreshBrainDumps();
    const edit = value.editBrainDump(11, 'Newest');
    await Promise.resolve();
    expect(api.updateApiBrainDump).not.toHaveBeenCalled();
    pending.resolve([original, archived]);
    await Promise.all([refresh, edit]);
  });
  expect(value.brainDumps[0].body).toBe('Newest');
});
