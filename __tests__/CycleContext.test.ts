jest.mock('@/lib/api/planningCycleApi', () => ({
  createApiPlanningCycle: jest.fn(),
  fetchApiPlanningCycles: jest.fn(),
  updateApiPlanningCycle: jest.fn(),
}));
import { CycleProvider, useCycle } from '@/context/CycleContext';
import {
    createApiPlanningCycle,
    fetchApiPlanningCycles,
    updateApiPlanningCycle,
} from '@/lib/api/planningCycleApi';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';


Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const fetchCycles = jest.mocked(fetchApiPlanningCycles);
const createCycle = jest.mocked(createApiPlanningCycle);
const updateCycle = jest.mocked(updateApiPlanningCycle);
const original = { id: 21, sourcePlanningCycleId: 1781204320001,
  name: 'Current', primaryFocus: null, theme: null, startDate: '2026-10-01',
  endDate: '2026-12-23', active: true, createdAt: '2026-10-01T12:00:00Z', completedAt: null };
const next = { ...original, id: 31, sourcePlanningCycleId: null, name: 'Next' };
let value: ReturnType<typeof useCycle>;
let root: ReturnType<typeof createRoot>;
function Probe() { value = useCycle(); return null; }
async function mount() {
  root = createRoot();
  await act(async () => { root.render(React.createElement(CycleProvider, { children: React.createElement(Probe) })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  fetchCycles.mockResolvedValue([original]);
});
afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  jest.restoreAllMocks();
});
test('loads cycles through the API with native IDs and derives the current cycle', async () => {
  await mount();
  expect(fetchCycles).toHaveBeenCalledTimes(1);
  expect(value.cycles).toEqual([original]);
  expect(value.currentCycle?.id).toBe(21);
  expect(value.isLoading).toBe(false);
  expect(value.error).toBeNull();
});
test('represents a genuinely empty server list without manufacturing a cycle', async () => {
  fetchCycles.mockResolvedValue([]);
  await mount();
  expect(value.currentCycle).toBeNull();
  expect(value.cycles).toEqual([]);
  expect(value.error).toBeNull();
});
test('records startup errors and clears loading without an unhandled rejection', async () => {
  const failure = new Error('Cannot reach server');
  fetchCycles.mockRejectedValue(failure);
  await mount();
  expect(value.error).toBe(failure);
  expect(value.isLoading).toBe(false);
});
test('preserves the last loaded data if a refresh fails', async () => {
  await mount();
  const failure = new Error('Connection lost');
  fetchCycles.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.refreshCycles()).rejects.toBe(failure); });
  expect(value.cycles).toEqual([original]);
  expect(value.error).toBe(failure);
});
test('a successful refresh clears the earlier error', async () => {
  fetchCycles.mockRejectedValueOnce(new Error('Offline'));
  await mount();
  await act(async () => { await value.refreshCycles(); });
  expect(value.error).toBeNull();
  expect(value.currentCycle?.id).toBe(21);
});
test('starting a cycle reloads the authoritative active and historical records', async () => {
  await mount();
  const closed = { ...original, active: false, completedAt: '2026-10-24T17:00:00Z' };
  createCycle.mockResolvedValue(next);
  fetchCycles.mockResolvedValueOnce([next, closed]);
  await act(async () => { await value.startCycle('2026-10-24', { name: 'Next', theme: 'Calm' }); });
  expect(createCycle).toHaveBeenCalledWith({ startDate: '2026-10-24', name: 'Next', theme: 'Calm' });
  expect(value.cycles).toEqual([next, closed]);
  expect(value.currentCycle?.id).toBe(31);
  expect(value.isSaving).toBe(false);
});
test('editing uses the native PostgreSQL ID rather than the migration source ID', async () => {
  await mount();
  const edited = { ...original, name: 'Edited' };
  updateCycle.mockResolvedValue(edited);
  fetchCycles.mockResolvedValueOnce([edited]);
  await act(async () => { await value.editCurrentCycle('2026-10-01', { name: 'Edited' }); });
  expect(updateCycle).toHaveBeenCalledWith(21, { startDate: '2026-10-01', name: 'Edited' });
  expect(value.currentCycle?.name).toBe('Edited');
});
test('editing without an active cycle makes no write request', async () => {
  fetchCycles.mockResolvedValue([]);
  await mount();
  await expect(value.editCurrentCycle('2026-10-24')).rejects.toThrow('Start a planning cycle first');
  expect(updateCycle).not.toHaveBeenCalled();
});
test('a rejected write preserves the server error and does not retry or refresh', async () => {
  await mount();
  const failure = Object.assign(new Error('Conflict'), { status: 409 });
  createCycle.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.startCycle('2026-10-24')).rejects.toBe(failure); });
  expect(createCycle).toHaveBeenCalledTimes(1);
  expect(fetchCycles).toHaveBeenCalledTimes(1);
  expect(value.error).toBe(failure);
  expect(value.isSaving).toBe(false);
});
test('uncertain write errors preserve their reconciliation metadata', async () => {
  await mount();
  const failure = Object.assign(new Error('Timeout'), { mutationMayHaveSucceeded: true });
  createCycle.mockRejectedValueOnce(failure);
  await act(async () => { await expect(value.startCycle('2026-10-24')).rejects.toBe(failure); });
  expect(value.error).toBe(failure);
  expect(createCycle).toHaveBeenCalledTimes(1);
});
test('a read failure after a confirmed save is identified without retrying the save', async () => {
  await mount();
  createCycle.mockResolvedValue(next);
  fetchCycles.mockRejectedValueOnce(new Error('Read failed'));
  await act(async () => { await expect(value.startCycle('2026-10-24')).rejects.toThrow('The cycle was saved'); });
  expect(createCycle).toHaveBeenCalledTimes(1);
  expect(value.error?.message).toContain('Refresh the cycles');
});
test('duplicate save taps are blocked before React rerenders', async () => {
  await mount();
  const pending = deferred<typeof next>();
  createCycle.mockReturnValueOnce(pending.promise);
  fetchCycles.mockResolvedValueOnce([next]);
  await act(async () => {
    const first = value.startCycle('2026-10-24');
    await expect(value.startCycle('2026-10-24')).rejects.toThrow('already being saved');
    pending.resolve(next);
    await first;
  });
  expect(createCycle).toHaveBeenCalledTimes(1);
  expect(value.isSaving).toBe(false);
});
test('a slow earlier refresh finishes before a cycle write begins', async () => {
  await mount();
  const oldRead = deferred<typeof original[]>();
  fetchCycles.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce([next]);
  createCycle.mockResolvedValue(next);
  await act(async () => {
    const refreshing = value.refreshCycles();
    const saving = value.startCycle('2026-10-24');
    await Promise.resolve();
    expect(createCycle).not.toHaveBeenCalled();
    oldRead.resolve([original]);
    await refreshing;
    await saving;
  });
  expect(value.currentCycle?.id).toBe(31);
});
test('a failed operation does not poison subsequent operations', async () => {
  await mount();
  createCycle.mockRejectedValueOnce(new Error('Rejected')).mockResolvedValueOnce(next);
  await act(async () => { await expect(value.startCycle('2026-10-24')).rejects.toThrow('Rejected'); });
  fetchCycles.mockResolvedValueOnce([next]);
  await act(async () => { await value.startCycle('2026-10-24'); });
  expect(value.currentCycle?.id).toBe(31);
  expect(value.error).toBeNull();
});
