jest.mock('react-native', () => ({
  Platform: { OS: 'web' }, Pressable: 'Button', ScrollView: 'ScrollView', Switch: 'Switch',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0', sdkVersion: '58.0.0' } } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/Themed', () => ({ Text: 'Text', View: 'View' }));
jest.mock('@/components/ScreenIntro', () => ({ ScreenIntro: () => null }));
jest.mock('@/components/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/context/TaskContext', () => ({ useTasks: jest.fn() }));
jest.mock('@/context/GoalContext', () => ({ useGoals: jest.fn() }));
jest.mock('@/context/CycleContext', () => ({ useCycle: jest.fn() }));
jest.mock('@/context/BrainDumpContext', () => ({ useBrainDumps: jest.fn() }));
jest.mock('@/context/WeeklyReviewContext', () => ({ useWeeklyReviews: jest.fn() }));
jest.mock('@/context/CycleReviewContext', () => ({ useCycleReviews: jest.fn() }));
jest.mock('@/context/CelebrationContext', () => ({ useCelebrations: jest.fn() }));
jest.mock('@/lib/backupStorage', () => { throw new Error('Settings must not read or replace SQLite backups'); });
jest.mock('@/lib/appMetadataStorage', () => { throw new Error('Settings must not label old device backup activity as server activity'); });
jest.mock('@/lib/taskMigrationInventory', () => { throw new Error('API tasks must not be labeled as a SQLite migration inventory'); });
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: 'cache:///weekflow' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/lib/api/backupExportApi', () => ({ exportApiBackup: jest.fn() }));
jest.mock('@/lib/api/backupMigrationApi', () => ({ refreshApiBackup: jest.fn() }));
import SettingsScreen from '@/app/settings';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCelebrations } from '@/context/CelebrationContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import { router } from 'expo-router';
import React, { act } from 'react';
import { createRoot } from 'test-renderer';

import { makeTask } from '@/__tests__/testFactories';
import { ApiError } from '@/lib/api/apiClient';
import { exportApiBackup } from '@/lib/api/backupExportApi';
import { refreshApiBackup, type BackupImportCounts, type BackupRefreshResult } from '@/lib/api/backupMigrationApi';
import type { WeekFlowBackup } from '@/lib/backupValidation';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let refreshes: Array<jest.Mock<Promise<void>, []>>;
const setCelebrationsEnabled = jest.fn<Promise<void>, [boolean]>();
let root: ReturnType<typeof createRoot> | undefined;
let busy = false;
const EXPORT = 'Export WeekFlow JSON backup';
const IMPORT = 'Import WeekFlow JSON backup';
const CONFIRM = 'Confirm JSON import to PostgreSQL';
const CANCEL = 'Cancel selected JSON backup';
const RELOAD = 'Reload server data after uncertain JSON import';
const CHECKED = 'Acknowledge checking server data';
let previousDocument: PropertyDescriptor | undefined;
let anchor: { href: string; download: string; style: { display?: string }; click: jest.Mock; remove: jest.Mock };
let readFile: jest.Mock<Promise<string>, []>;
let nativeFile: { uri: string; exists: boolean; text: jest.Mock; create: jest.Mock; write: jest.Mock; delete: jest.Mock };
let objectUrl: jest.SpyInstance;

function backup(): WeekFlowBackup {
  return { format: 'weekflow-backup', version: 12, exportedAt: '2026-10-29T12:00:00.000Z',
    metadata: { appVersion: '0.1.0', dataModelVersion: 1 }, data: {
      tasks: [makeTask({ id: 101, title: 'Current server task' })], goals: [], goalMilestones: [],
      brainDumps: [], taskTemplates: [], recurringRules: [], recurringExceptions: [],
      planningCycles: [], weeklyReviews: [], weeklyCommitments: [], weeklyTaskDecisions: [],
      cycleReviews: [], cycleGoalOutcomes: [],
    } };
}
function counts(tasks = 0): BackupImportCounts {
  return { tasks, goals: 0, goal_milestones: 0, brain_dumps: 0, task_templates: 0,
    recurring_rules: 0, recurring_exceptions: 0, planning_cycles: 0,
    weekly_reviews: 0, weekly_commitments: 0, weekly_task_decisions: 0,
    cycle_reviews: 0, cycle_goal_outcomes: 0 };
}
function importResult(): BackupRefreshResult {
  return { format: 'weekflow-backup', version: 12, exported_at: '2026-10-29T12:00:00Z',
    app_version: '0.1.0', data_model_version: 1, total_records: 1,
    created_count: 1, updated_count: 0, already_imported_count: 0,
    created_counts: counts(1), updated_counts: counts(), already_imported_counts: counts(),
    validation_passed: true, import_completed: true, refresh_completed: true, database_changed: true };
}
function selectedFile(size = 1000): DocumentPicker.DocumentPickerSuccessResult {
  return { canceled: false, assets: [{ name: 'weekflow.json', uri: 'file:///weekflow.json', size, lastModified: 0,
    file: { text: readFile } as unknown as globalThis.File }] };
}
async function press(label: string) { await act(async () => { button(label).onPress(); }); }
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function button(label: string): any {
  return root!.container.queryAll(node => node.type === 'Button' && node.props.accessibilityLabel === label)[0].props;
}
function refreshButton() { return button('Refresh WeekFlow data counts'); }
function toggle(): any { return root!.container.queryAll(node => node.type === 'Switch')[0].props; }
function text() { return JSON.stringify(root!.container.toJSON()); }
async function mount() {
  root = createRoot();
  await act(async () => { root!.render(React.createElement(SettingsScreen)); });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  Object.assign(Platform, { OS: 'web' });
  readFile = jest.fn(async () => JSON.stringify(backup()));
  anchor = { href: '', download: '', style: {}, click: jest.fn(), remove: jest.fn() };
  previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: jest.fn(() => anchor), body: { appendChild: jest.fn() },
  } });
  objectUrl = jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:weekflow');
  jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  nativeFile = { uri: 'cache:///export.json', exists: true, text: readFile,
    create: jest.fn(), write: jest.fn(), delete: jest.fn() };
  jest.mocked(File).mockImplementation(() => nativeFile as unknown as File);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(selectedFile());
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  jest.mocked(exportApiBackup).mockResolvedValue(backup());
  jest.mocked(refreshApiBackup).mockResolvedValue(importResult());
  busy = false;
  refreshes = Array.from({ length: 6 }, () => jest.fn(async () => undefined));
  const ready = { isLoading: false, isSaving: false, error: null };
  jest.mocked(useTasks).mockImplementation(() => ({ ...ready, isSaving: busy,
    tasks: [{ id: 41, completed: true }, { id: 42, completed: false }], recurringRules: [{ id: 51, active: true }],
    taskTemplates: [], refreshTasks: refreshes[0],
  } as unknown as ReturnType<typeof useTasks>));
  jest.mocked(useGoals).mockReturnValue({ ...ready, goals: [{ id: 61, completed: false }],
    milestones: [], refreshGoals: refreshes[1] } as unknown as ReturnType<typeof useGoals>);
  jest.mocked(useCycle).mockReturnValue({ ...ready, cycles: [{ id: 71, active: true }],
    refreshCycles: refreshes[2] } as unknown as ReturnType<typeof useCycle>);
  jest.mocked(useBrainDumps).mockReturnValue({ ...ready, brainDumps: [{ id: 81, archived: true }],
    refreshBrainDumps: refreshes[3] } as unknown as ReturnType<typeof useBrainDumps>);
  jest.mocked(useWeeklyReviews).mockReturnValue({ ...ready, reviews: [], commitments: [], taskDecisions: [{ id: 91 }],
    refreshWeeklyReviews: refreshes[4] } as unknown as ReturnType<typeof useWeeklyReviews>);
  jest.mocked(useCycleReviews).mockReturnValue({ ...ready, cycleReviews: [], goalOutcomes: [],
    refreshCycleReviews: refreshes[5] } as unknown as ReturnType<typeof useCycleReviews>);
  setCelebrationsEnabled.mockResolvedValue(undefined);
  jest.mocked(useCelebrations).mockReturnValue({ celebrationsEnabled: true, isLoadingCelebrationPreference: false,
    setCelebrationsEnabled } as unknown as ReturnType<typeof useCelebrations>);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  await jest.runOnlyPendingTimersAsync();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

test('shows API-backed metrics and accurate storage without executing legacy backup code', async () => {
  await mount();
  expect(text()).toContain('PostgreSQL');
  expect(text()).toContain('Task Decisions');
  expect(text()).toContain('1 completed task');
  expect(text()).not.toContain('All SQLite Tasks');
  expect(text()).not.toContain('Replace Data from Backup');
  expect(text()).toContain('Export JSON');
  expect(text()).toContain('Import JSON');
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
});

test('connection button navigates to the read-only server check', async () => {
  await mount();
  const connect = root!.container.queryAll(node => node.type === 'Button')
    .find(node => node.props.accessibilityLabel !== 'Refresh WeekFlow data counts');
  await act(async () => { connect!.props.onPress(); });
  expect(router.push).toHaveBeenCalledWith('/server-tasks');
});

test('refresh calls all six providers and reports successful completion', async () => {
  await mount();
  await act(async () => { refreshButton().onPress(); });
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  expect(text()).toContain('WeekFlow data refreshed from the server');
});

test('a failed refresh still calls every provider and does not claim the database was unchanged', async () => {
  refreshes[0].mockRejectedValueOnce(new Error('Read failed'));
  await mount();
  await act(async () => { refreshButton().onPress(); });
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  expect(text()).toContain('Some data could not be refreshed');
  expect(text()).not.toContain('stored data was not changed');
});

test('double taps cannot overlap pending refresh requests', async () => {
  const pending = deferred();
  refreshes[0].mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const press = refreshButton().onPress;
    press(); press();
    await Promise.resolve();
    for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  });
  expect(refreshButton().disabled).toBe(true);
  await act(async () => { pending.resolve(); });
  expect(refreshButton().disabled).toBe(false);
});

test('refresh waits for outstanding providers even after another one failed', async () => {
  const pending = deferred();
  refreshes[0].mockRejectedValueOnce(new Error('Failed'));
  refreshes[1].mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => { refreshButton().onPress(); });
  expect(refreshButton().disabled).toBe(true);
  expect(text()).not.toContain('Some data could not be refreshed');
  await act(async () => { pending.resolve(); });
  expect(text()).toContain('Some data could not be refreshed');
});

test('refresh cannot run while a provider has a pending save', async () => {
  busy = true;
  await mount();
  expect(refreshButton().disabled).toBe(true);
  await act(async () => { refreshButton().onPress(); });
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
});

test('celebration toggle retains its device preference action', async () => {
  await mount();
  await act(async () => { toggle().onValueChange(false); });
  expect(setCelebrationsEnabled).toHaveBeenCalledWith(false);
  expect(text()).toContain('Completion celebrations are off');
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
});

test('a rejected preference change displays the failure', async () => {
  setCelebrationsEnabled.mockRejectedValueOnce(new Error('Device write failed'));
  await mount();
  await act(async () => { toggle().onValueChange(false); });
  expect(text()).toContain('could not save that completion-feedback setting');
});

test('duplicate preference taps cannot create overlapping device writes', async () => {
  const pending = deferred();
  setCelebrationsEnabled.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => {
    const change = toggle().onValueChange;
    change(false); change(false);
    await Promise.resolve();
    expect(setCelebrationsEnabled).toHaveBeenCalledTimes(1);
  });
  expect(toggle().disabled).toBe(true);
  await act(async () => { pending.resolve(); });
  expect(toggle().disabled).toBe(false);
});

test('opening Settings never starts an export, import, or file picker', async () => {
  await mount();
  expect(exportApiBackup).not.toHaveBeenCalled();
  expect(refreshApiBackup).not.toHaveBeenCalled();
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
});

test('web export downloads the server snapshot rather than cached screen data', async () => {
  await mount(); await press(EXPORT);
  expect(exportApiBackup).toHaveBeenCalledTimes(1);
  const blob = objectUrl.mock.calls[0][0] as Blob;
  const document = JSON.parse(await blob.text());
  expect(document.data.tasks[0].id).toBe(101);
  expect(document.data.tasks[0].title).toBe('Current server task');
  expect(anchor.download).toMatch(/^weekflow-backup-.*\.json$/);
  expect(anchor.click).toHaveBeenCalledTimes(1);
  expect(anchor.remove).toHaveBeenCalledTimes(1);
  expect(text()).toContain('JSON download requested');
  expect(refreshApiBackup).not.toHaveBeenCalled();
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:weekflow');
});

test('web download failure displays an error and still releases the object URL', async () => {
  anchor.click.mockImplementation(() => { throw new Error('Download blocked'); });
  await mount(); await press(EXPORT);
  expect(text()).toContain('Download blocked');
  expect(anchor.remove).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:weekflow');
});

test('an API export failure does not create a file or automatically retry', async () => {
  jest.mocked(exportApiBackup).mockRejectedValue(new ApiError('Export unavailable', { kind: 'http', status: 503 }));
  await mount(); await press(EXPORT);
  expect(text()).toContain('Export unavailable');
  expect(exportApiBackup).toHaveBeenCalledTimes(1);
  expect(objectUrl).not.toHaveBeenCalled();
});

test('phone export writes JSON to a temporary file and opens the share sheet', async () => {
  Object.assign(Platform, { OS: 'ios' });
  await mount(); await press(EXPORT);
  expect(nativeFile.create).toHaveBeenCalledWith({ overwrite: true });
  expect(JSON.parse(nativeFile.write.mock.calls[0][0])).toEqual(backup());
  expect(Sharing.shareAsync).toHaveBeenCalledWith(nativeFile.uri, expect.objectContaining({ mimeType: 'application/json' }));
  expect(nativeFile.delete).toHaveBeenCalledTimes(1);
  expect(objectUrl).not.toHaveBeenCalled();
  expect(text()).toContain('A copy is kept only if you saved or shared it');
});

test('unavailable phone sharing reports the problem before writing a cache file', async () => {
  Object.assign(Platform, { OS: 'ios' });
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await mount(); await press(EXPORT);
  expect(text()).toContain('File sharing is unavailable');
  expect(nativeFile.write).not.toHaveBeenCalled();
});

test('phone sharing failure displays the error and cleans the temporary file', async () => {
  Object.assign(Platform, { OS: 'ios' });
  jest.mocked(Sharing.shareAsync).mockRejectedValue(new Error('Sharing failed'));
  await mount(); await press(EXPORT);
  expect(text()).toContain('Sharing failed');
  expect(nativeFile.delete).toHaveBeenCalled();
});

test('duplicate export taps cannot overlap, and a refresh cannot start during export', async () => {
  const request = pending<WeekFlowBackup>();
  jest.mocked(exportApiBackup).mockReturnValue(request.promise);
  await mount();
  await act(async () => {
    const exportPress = button(EXPORT).onPress;
    const refreshPress = refreshButton().onPress;
    exportPress(); exportPress(); refreshPress();
  });
  expect(exportApiBackup).toHaveBeenCalledTimes(1);
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
  expect(button(IMPORT).disabled).toBe(true);
  await act(async () => { request.resolve(backup()); });
});

test('provider saves prevent both backup actions', async () => {
  busy = true; await mount(); await press(EXPORT); await press(IMPORT);
  expect(button(EXPORT).disabled).toBe(true);
  expect(button(IMPORT).disabled).toBe(true);
  expect(exportApiBackup).not.toHaveBeenCalled();
  expect(DocumentPicker.getDocumentAsync).not.toHaveBeenCalled();
});

test('import selection shows filename and all collection counts without sending the file', async () => {
  await mount(); await press(IMPORT);
  expect(readFile).toHaveBeenCalledTimes(1);
  expect(text()).toContain('weekflow.json');
  expect(text()).toContain('Weekly task decisions');
  expect(text()).toContain('Cycle goal outcomes');
  expect(text()).toContain('An older file can overwrite newer changes');
  expect(button(CONFIRM).disabled).toBe(false);
  expect(refreshApiBackup).not.toHaveBeenCalled();
});

test('canceling the file picker leaves no import confirmation', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
  await mount(); await press(IMPORT);
  expect(text()).not.toContain('Confirm JSON import');
  expect(refreshApiBackup).not.toHaveBeenCalled();
});

test('canceling a selected backup removes confirmation and blocks stale confirmation taps', async () => {
  await mount(); await press(IMPORT);
  const staleConfirm = button(CONFIRM).onPress;
  await press(CANCEL);
  await act(async () => { staleConfirm(); });
  expect(text()).not.toContain('Confirm JSON import');
  expect(refreshApiBackup).not.toHaveBeenCalled();
});

test('a confirmation from an earlier file cannot import a newly selected file', async () => {
  await mount(); await press(IMPORT);
  const previousConfirmation = button(CONFIRM).onPress;
  const replacement = backup(); replacement.data.tasks[0].title = 'A different file';
  readFile.mockResolvedValue(JSON.stringify(replacement));
  await press(IMPORT);
  await act(async () => { previousConfirmation(); });
  expect(refreshApiBackup).not.toHaveBeenCalled();
  await press(CONFIRM);
  expect(refreshApiBackup).toHaveBeenCalledWith(replacement);
});

test('invalid JSON is rejected locally without an API request', async () => {
  readFile.mockResolvedValue('not JSON');
  await mount(); await press(IMPORT);
  expect(root!.container.queryAll(node => node.props.accessibilityRole === 'alert')).toHaveLength(1);
  expect(text()).not.toContain('Confirm JSON import');
  expect(refreshApiBackup).not.toHaveBeenCalled();
});

test('an oversized file is rejected before reading it', async () => {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(selectedFile(26 * 1024 * 1024));
  await mount(); await press(IMPORT);
  expect(text()).toContain('larger than 25 MB');
  expect(readFile).not.toHaveBeenCalled();
});

test('phone import reads the chosen cache file without restoring SQLite', async () => {
  Object.assign(Platform, { OS: 'ios' });
  await mount(); await press(IMPORT);
  expect(File).toHaveBeenCalledWith('file:///weekflow.json');
  expect(text()).toContain('Confirm JSON import');
  expect(refreshApiBackup).not.toHaveBeenCalled();
});

test('a repaired missing goal link is disclosed before import confirmation', async () => {
  const document = backup(); document.data.tasks[0].goalId = 999;
  readFile.mockResolvedValue(JSON.stringify(document));
  await mount(); await press(IMPORT);
  expect(text()).toContain('Missing goal links removed');
  await press(CONFIRM);
  expect(jest.mocked(refreshApiBackup).mock.calls[0][0].data.tasks[0].goalId).toBeNull();
});

test('confirmation sends the selected file once and reloads all six providers', async () => {
  await mount(); await press(IMPORT); await press(CONFIRM);
  expect(refreshApiBackup).toHaveBeenCalledTimes(1);
  expect(refreshApiBackup).toHaveBeenCalledWith(backup());
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  expect(text()).toContain('PostgreSQL import completed');
  expect(text()).toContain('IDs were preserved');
  expect(text()).not.toContain('Confirm JSON import');
});

test('rapid confirmation taps and cancel cannot interrupt or duplicate the import', async () => {
  const request = pending<BackupRefreshResult>();
  jest.mocked(refreshApiBackup).mockReturnValue(request.promise);
  await mount(); await press(IMPORT);
  await act(async () => {
    const confirm = button(CONFIRM).onPress;
    const cancel = button(CANCEL).onPress;
    confirm(); confirm(); cancel();
  });
  expect(refreshApiBackup).toHaveBeenCalledTimes(1);
  expect(button(CANCEL).disabled).toBe(true);
  expect(button(EXPORT).disabled).toBe(true);
  await act(async () => { request.resolve(importResult()); });
});

test('a reload failure keeps the acknowledged import result and never resends the file', async () => {
  refreshes[0].mockRejectedValueOnce(new Error('Tasks unavailable'));
  await mount(); await press(IMPORT); await press(CONFIRM);
  expect(text()).toContain('The JSON import completed, but some screens could not reload');
  expect(text()).toContain('PostgreSQL import completed');
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  await press('Refresh WeekFlow data counts');
  expect(refreshApiBackup).toHaveBeenCalledTimes(1);
});

test('backup controls stay disabled until every post-import provider settles', async () => {
  const request = pending<void>();
  refreshes[0].mockRejectedValueOnce(new Error('One provider failed'));
  refreshes[1].mockReturnValueOnce(request.promise);
  await mount(); await press(IMPORT); await press(CONFIRM);
  expect(button(EXPORT).disabled).toBe(true);
  expect(text()).toContain('Reloading server data');
  expect(text()).not.toContain('some screens could not reload');
  await act(async () => { request.resolve(); });
  expect(button(EXPORT).disabled).toBe(false);
  expect(text()).toContain('some screens could not reload');
});

test('a known conflict displays its explanation without treating the request as offline', async () => {
  jest.mocked(refreshApiBackup).mockRejectedValue(new ApiError('Duplicate recurring occurrence', { kind: 'http', status: 409 }));
  await mount(); await press(IMPORT); await press(CONFIRM);
  expect(text()).toContain('Duplicate recurring occurrence');
  expect(text()).not.toContain('previous import result is uncertain');
  expect(refreshApiBackup).toHaveBeenCalledTimes(1);
  for (const refresh of refreshes) expect(refresh).not.toHaveBeenCalled();
});

test.each(['network', 'timeout', 'invalid-response'] as const)(
  'an uncertain %s import result blocks another file selection', async kind => {
    jest.mocked(refreshApiBackup).mockRejectedValue(new ApiError('Unknown result', { kind, mutationMayHaveSucceeded: true }));
    await mount(); await press(IMPORT); await press(CONFIRM); await press(IMPORT);
    expect(text()).toContain('PostgreSQL may already have saved it');
    expect(button(IMPORT).disabled).toBe(true);
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1);
    expect(refreshApiBackup).toHaveBeenCalledTimes(1);
  }
);

test('uncertain result reconciliation reloads data without replaying the import', async () => {
  jest.mocked(refreshApiBackup).mockRejectedValue(new ApiError('Lost response', { kind: 'network', mutationMayHaveSucceeded: true }));
  await mount(); await press(IMPORT); await press(CONFIRM); await press(RELOAD);
  for (const refresh of refreshes) expect(refresh).toHaveBeenCalledTimes(1);
  expect(refreshApiBackup).toHaveBeenCalledTimes(1);
  expect(button(IMPORT).disabled).toBe(true);
  await press(CHECKED);
  expect(button(IMPORT).disabled).toBe(false);
});

test('a failed uncertain-result reload keeps importing blocked', async () => {
  jest.mocked(refreshApiBackup).mockRejectedValue(new ApiError('Lost response', { kind: 'timeout', mutationMayHaveSucceeded: true }));
  refreshes[0].mockRejectedValue(new Error('Still unavailable'));
  await mount(); await press(IMPORT); await press(CONFIRM); await press(RELOAD);
  expect(text()).toContain('earlier import result is still uncertain');
  expect(button(IMPORT).disabled).toBe(true);
  expect(root!.container.queryAll(node => node.props.accessibilityLabel === CHECKED)).toHaveLength(0);
});

test('an export response arriving after leaving Settings does not launch a download', async () => {
  const request = pending<WeekFlowBackup>();
  jest.mocked(exportApiBackup).mockReturnValue(request.promise);
  await mount(); await press(EXPORT);
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { request.resolve(backup()); });
  expect(objectUrl).not.toHaveBeenCalled();
});
