import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch } from 'react-native';

import { ScreenIntro } from '@/components/ScreenIntro';
import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCelebrations } from '@/context/CelebrationContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import { ApiError } from '@/lib/api/apiClient';
import { exportApiBackup } from '@/lib/api/backupExportApi';
import { refreshApiBackup, type BackupRefreshResult } from '@/lib/api/backupMigrationApi';
import {
  inspectWeekFlowBackupJson, type BackupCounts, type PickedWeekFlowBackup, type WeekFlowBackup,
} from '@/lib/backupValidation';

type StatusMessage = { tone: 'success' | 'error'; text: string };
type DataMetric = { label: string; value: number; detail: string };
type BackupPhase = 'idle' | 'choosing' | 'exporting' | 'importing' | 'reloading';

const BACKUP_COLLECTIONS: ReadonlyArray<readonly [keyof BackupCounts, string]> = [
  ['tasks', 'Tasks'], ['goals', 'Goals'], ['goalMilestones', 'Goal milestones'],
  ['brainDumps', 'Brain Dumps'], ['taskTemplates', 'Task templates'],
  ['recurringRules', 'Recurring schedules'], ['recurringExceptions', 'Recurring exceptions'],
  ['planningCycles', 'Planning cycles'], ['weeklyReviews', 'Weekly reviews'],
  ['weeklyCommitments', 'Weekly commitments'], ['weeklyTaskDecisions', 'Weekly task decisions'],
  ['cycleReviews', 'Cycle reviews'], ['cycleGoalOutcomes', 'Cycle goal outcomes'],
];

async function pickJsonBackup(): Promise<PickedWeekFlowBackup | null> {
  const selection = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'], copyToCacheDirectory: true, multiple: false,
  });
  if (selection.canceled) return null;
  const asset = selection.assets[0];
  if (!asset) throw new Error('No file was selected. Choose a WeekFlow JSON backup.');
  const limit = 25 * 1024 * 1024;
  if (typeof asset.size === 'number' && asset.size > limit) {
    throw new Error('The selected backup is larger than 25 MB. Choose a smaller WeekFlow JSON backup.');
  }
  let json: string;
  if (Platform.OS === 'web' && asset.file) {
    json = await asset.file.text();
  } else {
    const { File } = await import('expo-file-system');
    json = await new File(asset.uri).text();
  }
  if (json.length > limit) throw new Error('The selected backup is too large to import.');
  const inspected = inspectWeekFlowBackupJson(json);
  return { fileName: asset.name, backup: inspected.backup, preview: inspected.preview };
}

async function saveJsonBackup(backup: WeekFlowBackup): Promise<string> {
  const stamp = new Date(backup.exportedAt).toISOString().replace(/[:.]/g, '-');
  const fileName = `weekflow-backup-${stamp}.json`;
  const json = JSON.stringify(backup, null, 2);
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('File downloads are unavailable in this browser. Try another browser or the phone app.');
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    let link: HTMLAnchorElement | null = null;
    try {
      link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
    } finally {
      try { link?.remove(); } finally {
        // Give the browser time to start reading the download before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
    return `JSON download requested: ${fileName}`;
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import('expo-file-system'), import('expo-sharing'),
  ]);
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('File sharing is unavailable on this device. Export from the web version of WeekFlow.');
  }
  const file = new File(Paths.cache, fileName);
  try {
    file.create({ overwrite: true });
    file.write(json);
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Export WeekFlow JSON backup', mimeType: 'application/json', UTI: 'public.json',
    });
    // The native API also resolves when the user dismisses the share sheet.
    return 'Export share sheet closed. A copy is kept only if you saved or shared it.';
  } finally {
    try { if (file.exists) file.delete(); } catch { /* Cache cleanup must not change the export result. */ }
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function SettingsScreen() {
  const taskData = useTasks();
  const goalData = useGoals();
  const cycleData = useCycle();
  const noteData = useBrainDumps();
  const weeklyData = useWeeklyReviews();
  const reportData = useCycleReviews();
  const { celebrationsEnabled, isLoadingCelebrationPreference, setCelebrationsEnabled } = useCelebrations();
  const { tasks, recurringRules, taskTemplates, refreshTasks } = taskData;
  const { goals, milestones, refreshGoals } = goalData;
  const { cycles, refreshCycles } = cycleData;
  const { brainDumps, refreshBrainDumps } = noteData;
  const { reviews: weeklyReviews, commitments: weeklyCommitments,
    taskDecisions: weeklyTaskDecisions, refreshWeeklyReviews } = weeklyData;
  const { cycleReviews, goalOutcomes, refreshCycleReviews } = reportData;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<StatusMessage | null>(null);
  const [isSavingPreference, setIsSavingPreference] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState<StatusMessage | null>(null);
  const [backupPhase, setBackupPhase] = useState<BackupPhase>('idle');
  const [backupMessage, setBackupMessage] = useState<StatusMessage | null>(null);
  const [pickedBackup, setPickedBackup] = useState<PickedWeekFlowBackup | null>(null);
  const [importResult, setImportResult] = useState<BackupRefreshResult | null>(null);
  const [uncertainImport, setUncertainImport] = useState<'unchecked' | 'checked' | null>(null);
  const backupInProgressRef = useRef(false);
  const pickedBackupRef = useRef<PickedWeekFlowBackup | null>(null);
  const uncertainImportRef = useRef(false);
  const refreshInProgressRef = useRef(false);
  const preferenceInProgressRef = useRef(false);
  const mountedRef = useRef(false);
  const providersBusy = [taskData, goalData, cycleData, noteData, weeklyData, reportData]
    .some(provider => provider.isLoading || provider.isSaving);
  const busy = isRefreshing || providersBusy || backupPhase !== 'idle';
  const dark = useColorScheme() === 'dark';
  const cardColor = { backgroundColor: dark ? '#1f2937' : '#eff6ff', borderColor: dark ? '#374151' : '#dbeafe' };
  const mutedColor = { color: dark ? '#d1d5db' : '#4b5563' };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reloadServerData = useCallback(async () => {
    const refreshes = [refreshTasks, refreshGoals, refreshBrainDumps,
      refreshCycles, refreshWeeklyReviews, refreshCycleReviews];
    // Wait for every provider, even when another provider rejects first.
    // Task refresh also performs normal missing-occurrence generation.
    const results = await Promise.allSettled(refreshes.map(refresh => Promise.resolve().then(refresh)));
    return results.every(result => result.status === 'fulfilled');
  }, [refreshTasks, refreshGoals, refreshBrainDumps, refreshCycles, refreshWeeklyReviews, refreshCycleReviews]);

  const refreshSettingsData = useCallback(async () => {
    if (refreshInProgressRef.current || backupInProgressRef.current || providersBusy || !mountedRef.current) return;
    refreshInProgressRef.current = true;
    setIsRefreshing(true);
    setRefreshMessage(null);
    try {
      const refreshed = await reloadServerData();
      if (mountedRef.current) {
        setRefreshMessage(refreshed
          ? { tone: 'success', text: 'WeekFlow data refreshed from the server.' }
          : { tone: 'error', text: 'Some data could not be refreshed. Check the connection and refresh again.' });
        if (uncertainImportRef.current) {
          setUncertainImport(refreshed ? 'checked' : 'unchecked');
          setBackupMessage(refreshed
            ? { tone: 'success', text: 'Server data reloaded. Check the current records before deciding whether to import again. The earlier import was not repeated.' }
            : { tone: 'error', text: 'Some server data could not reload. The earlier import result is still uncertain.' });
        }
      }
    } finally {
      refreshInProgressRef.current = false;
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [providersBusy, reloadServerData]);

  function backupActionBlocked() {
    return backupInProgressRef.current || refreshInProgressRef.current || providersBusy || !mountedRef.current;
  }

  async function handleExportJson() {
    if (backupActionBlocked()) return;
    backupInProgressRef.current = true;
    setBackupPhase('exporting');
    setBackupMessage(null);
    setImportResult(null);
    try {
      // Request the complete PostgreSQL snapshot, not the currently cached UI arrays.
      const backup = await exportApiBackup();
      if (!mountedRef.current) return;
      const message = await saveJsonBackup(backup);
      if (mountedRef.current) setBackupMessage({ tone: 'success', text: message });
    } catch (error) {
      if (mountedRef.current) setBackupMessage({ tone: 'error', text:
        error instanceof Error ? error.message : 'The JSON export could not be completed.' });
    } finally {
      backupInProgressRef.current = false;
      if (mountedRef.current) setBackupPhase('idle');
    }
  }

  async function handleChooseJson() {
    if (backupActionBlocked() || uncertainImportRef.current) return;
    backupInProgressRef.current = true;
    setBackupPhase('choosing');
    setBackupMessage(null);
    setImportResult(null);
    pickedBackupRef.current = null;
    setPickedBackup(null);
    try {
      const selected = await pickJsonBackup();
      if (mountedRef.current) {
        pickedBackupRef.current = selected;
        setPickedBackup(selected);
      }
    } catch (error) {
      if (mountedRef.current) setBackupMessage({ tone: 'error', text:
        error instanceof Error ? error.message : 'The JSON backup could not be read.' });
    } finally {
      backupInProgressRef.current = false;
      if (mountedRef.current) setBackupPhase('idle');
    }
  }

  async function handleConfirmImport(expected: PickedWeekFlowBackup) {
    const selected = pickedBackupRef.current;
    if (backupActionBlocked() || uncertainImportRef.current || !selected || selected !== expected) return;
    backupInProgressRef.current = true;
    setBackupPhase('importing');
    setBackupMessage(null);
    setImportResult(null);
    let acknowledged = false;
    try {
      // Only this explicit confirmation sends the selected file to PostgreSQL.
      const result = await refreshApiBackup(selected.backup);
      acknowledged = true;
      pickedBackupRef.current = null;
      if (mountedRef.current) {
        setPickedBackup(null);
        setImportResult(result);
        setBackupPhase('reloading');
      }
      const refreshed = await reloadServerData();
      if (mountedRef.current) setBackupMessage(refreshed
        ? { tone: 'success', text: 'JSON import completed. WeekFlow data was reloaded from PostgreSQL.' }
        : { tone: 'error', text: 'The JSON import completed, but some screens could not reload. Use Refresh to reload the screens; do not repeat the import for that.' });
    } catch (error) {
      if (!mountedRef.current) return;
      if (acknowledged) {
        setBackupMessage({ tone: 'error', text: 'The JSON import completed, but the screens could not reload. Use Refresh; do not repeat the import for that.' });
      } else if (!(error instanceof ApiError) || error.mutationMayHaveSucceeded) {
        uncertainImportRef.current = true;
        setUncertainImport('unchecked');
        pickedBackupRef.current = null;
        setPickedBackup(null);
        setBackupMessage({ tone: 'error', text: 'The import result could not be confirmed. PostgreSQL may already have saved it. Nothing will be sent again automatically.' });
      } else {
        setBackupMessage({ tone: 'error', text: error.message });
      }
    } finally {
      backupInProgressRef.current = false;
      if (mountedRef.current) setBackupPhase('idle');
    }
  }

  function cancelSelectedBackup() {
    if (backupActionBlocked() || uncertainImportRef.current) return;
    pickedBackupRef.current = null;
    setPickedBackup(null);
    setBackupMessage(null);
  }

  function acknowledgeServerCheck() {
    if (backupActionBlocked() || uncertainImport !== 'checked') return;
    uncertainImportRef.current = false;
    setUncertainImport(null);
    setBackupMessage(null);
  }

  const metrics = useMemo<DataMetric[]>(() => {
    const completedTasks = tasks.filter((task) => task.completed).length;
    const completedGoals = goals.filter((goal) => goal.completed).length;

    const completedMilestones = milestones.filter(
      (milestone) => milestone.completed
    ).length;

    const archivedBrainDumps = brainDumps.filter(
      (brainDump) => brainDump.archived
    ).length;

    const activeRecurringRules = recurringRules.filter(
      (rule) => rule.active
    ).length;

    const activeCycles = cycles.filter((cycle) => cycle.active).length;

    return [
      {
        label: 'Tasks',
        value: tasks.length,
        detail: pluralize(completedTasks, 'completed task'),
      },
      {
        label: 'Goals',
        value: goals.length,
        detail: pluralize(completedGoals, 'completed goal'),
      },
      {
        label: 'Milestones',
        value: milestones.length,
        detail: pluralize(completedMilestones, 'completed milestone'),
      },
      {
        label: 'Brain Dumps',
        value: brainDumps.length,
        detail: pluralize(archivedBrainDumps, 'archived note'),
      },
      {
        label: 'Templates',
        value: taskTemplates.length,
        detail: 'Reusable task setups',
      },
      {
        label: 'Recurring',
        value: recurringRules.length,
        detail: pluralize(activeRecurringRules, 'active schedule'),
      },
      {
        label: 'Planning Cycles',
        value: cycles.length,
        detail:
          activeCycles === 1
            ? '1 current cycle'
            : `${activeCycles} current cycles`,
      },
      {
        label: 'Weekly Reviews',
        value: weeklyReviews.length,
        detail: 'Saved guided reflections',
      },
      {
        label: 'Commitments',
        value: weeklyCommitments.length,
        detail: pluralize(
          weeklyCommitments.filter((item) => item.completed).length,
          'completed commitment'
        ),
      },
      {
        label: 'Task Decisions',
        value: weeklyTaskDecisions.length,
        detail: 'Saved unfinished-task decisions',
      },
      {
        label: 'Cycle Reports',
        value: cycleReviews.length,
        detail: pluralize(goalOutcomes.length, 'saved goal outcome'),
      },
    ];
  }, [
    brainDumps,
    cycles,
    goals,
    milestones,
    recurringRules,
    taskTemplates,
    tasks,
    weeklyCommitments,
    weeklyReviews,
    weeklyTaskDecisions,
    cycleReviews,
    goalOutcomes,
  ]);

  async function handleCelebrationToggle(enabled: boolean) {
    if (preferenceInProgressRef.current || isLoadingCelebrationPreference || !mountedRef.current) return;
    preferenceInProgressRef.current = true;
    setIsSavingPreference(true);
    setPreferenceMessage(null);
    try {
      // Preferences remain device-local; productivity data comes from the API.
      await setCelebrationsEnabled(enabled);
      if (mountedRef.current) setPreferenceMessage({
        tone: 'success', text: enabled ? 'Completion celebrations are on.' : 'Completion celebrations are off.',
      });
    } catch {
      if (mountedRef.current) setPreferenceMessage({
        tone: 'error', text: 'WeekFlow could not save that completion-feedback setting.',
      });
    } finally {
      preferenceInProgressRef.current = false;
      if (mountedRef.current) setIsSavingPreference(false);
    }
  }

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const expoSdk = Constants.expoConfig?.sdkVersion ?? 'Not reported';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
      <ScreenIntro title="Settings" subtitle="Manage your WeekFlow data and preferences." />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Server connection</Text>
        <Text style={[styles.description, mutedColor]}>
          Your tasks, goals, schedules, and reviews are saved on your connected WeekFlow server.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/server-tasks' as Href)}
          style={styles.button}>
          <Text style={styles.buttonText}>Check server connection</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.sectionTitle}>Data at a Glance</Text>
            <Text style={[styles.description, mutedColor]}>The latest server data loaded in WeekFlow.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh WeekFlow data counts"
            accessibilityState={{ disabled: busy }} disabled={busy}
            onPress={() => { void refreshSettingsData(); }} style={[styles.button, busy && styles.disabled]}>
            <Text style={styles.buttonText}>{isRefreshing ? 'Refreshing…' : providersBusy ? 'Please wait…' : 'Refresh'}</Text>
          </Pressable>
        </View>
        <View style={styles.metricGrid}>
          {metrics.map(metric => (
            <View key={metric.label} style={[styles.metricCard, cardColor]}>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={[styles.description, mutedColor]}>{metric.detail}</Text>
            </View>
          ))}
        </View>
        {refreshMessage ? (
          <Text accessibilityLiveRegion="polite" style={refreshMessage.tone === 'error' ? styles.error : styles.success}>
            {refreshMessage.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Completion Feedback</Text>
        <View style={[styles.preferenceCard, cardColor]}>
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>Completion Celebrations</Text>
            <Text style={[styles.description, mutedColor]}>
              Show success feedback after completing tasks, goals, and cycles.
              WeekFlow follows your device&apos;s Reduce Motion preference.
            </Text>
          </View>
          <Switch accessibilityLabel="Completion celebrations" value={celebrationsEnabled}
            disabled={isLoadingCelebrationPreference || isSavingPreference}
            onValueChange={enabled => { void handleCelebrationToggle(enabled); }} />
        </View>
        {preferenceMessage ? (
          <Text accessibilityLiveRegion="polite" style={preferenceMessage.tone === 'error' ? styles.error : styles.success}>
            {preferenceMessage.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backups</Text>
        <Text style={[styles.description, mutedColor]}>
          Export the current server data to a JSON file, or import a WeekFlow JSON backup
          into this instance. Export downloads a file on web or opens the share sheet on your phone.
        </Text>
        <View style={styles.backupActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Export WeekFlow JSON backup"
            accessibilityState={{ disabled: busy }} disabled={busy}
            onPress={() => { void handleExportJson(); }} style={[styles.button, busy && styles.disabled]}>
            <Text style={styles.buttonText}>{backupPhase === 'exporting' ? 'Exporting…' : 'Export JSON'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Import WeekFlow JSON backup"
            accessibilityState={{ disabled: busy || uncertainImport !== null }} disabled={busy || uncertainImport !== null}
            onPress={() => { void handleChooseJson(); }} style={[styles.button, (busy || uncertainImport !== null) && styles.disabled]}>
            <Text style={styles.buttonText}>{backupPhase === 'choosing' ? 'Reading file…' : 'Import JSON'}</Text>
          </Pressable>
        </View>

        {pickedBackup && (
          <View style={[styles.backupCard, cardColor]}>
            <Text style={styles.preferenceTitle}>Confirm JSON import</Text>
            <Text style={styles.preferenceTitle}>{pickedBackup.fileName}</Text>
            <Text style={[styles.description, mutedColor]}>Exported: {new Date(pickedBackup.preview.exportedAt).toLocaleString()}</Text>
            <Text style={[styles.description, mutedColor]}>App version: {pickedBackup.preview.appVersion}</Text>
            <Text style={styles.preferenceTitle}>
              Records in file: {BACKUP_COLLECTIONS.reduce((sum, [key]) => sum + pickedBackup.preview.counts[key], 0)}
            </Text>
            <View style={styles.backupCountGrid}>
              {BACKUP_COLLECTIONS.map(([key, label]) => (
                <Text key={key} style={styles.backupCount}>{label}: {pickedBackup.preview.counts[key]}</Text>
              ))}
            </View>
            {pickedBackup.preview.sourceVersion !== pickedBackup.preview.currentVersion && (
              <Text style={[styles.description, mutedColor]}>
                Backup format {pickedBackup.preview.sourceVersion} was converted to format {pickedBackup.preview.currentVersion} for import.
              </Text>
            )}
            {pickedBackup.preview.repairs.orphanedGoalLinks > 0 && (
              <Text style={[styles.description, { color: dark ? '#fbbf24' : '#92400e' }]}>
                Missing goal links removed while reading this file: {pickedBackup.preview.repairs.orphanedGoalLinks}.
                Affected records will be imported without those missing links.
              </Text>
            )}
            <Text style={[styles.description, { color: dark ? '#fbbf24' : '#92400e' }]}>
              Matching server records will use this file’s values, including completion status.
              An older file can overwrite newer changes. Existing PostgreSQL IDs stay the same;
              records absent from this file are kept. Choosing the file has not imported anything.
            </Text>
            <View style={styles.backupActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Confirm JSON import to PostgreSQL"
                disabled={busy} onPress={() => { void handleConfirmImport(pickedBackup); }}
                style={[styles.button, styles.importButton, busy && styles.disabled]}>
                <Text style={styles.importButtonText}>{backupPhase === 'importing' ? 'Importing…' : 'Confirm import and update'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel selected JSON backup"
                disabled={busy} onPress={cancelSelectedBackup} style={[styles.button, busy && styles.disabled]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}

        {backupPhase === 'reloading' && <Text style={mutedColor}>Reloading server data…</Text>}
        {backupMessage && (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
            style={backupMessage.tone === 'error' ? styles.error : styles.success}>{backupMessage.text}</Text>
        )}
        {importResult && (
          <View style={[styles.backupCard, cardColor]}>
            <Text style={styles.preferenceTitle}>PostgreSQL import completed</Text>
            <Text>Records checked: {importResult.total_records}</Text>
            <Text>Created: {importResult.created_count}</Text>
            <Text>Updated: {importResult.updated_count}</Text>
            <Text>Unchanged: {importResult.already_imported_count}</Text>
            <Text style={[styles.description, mutedColor]}>The JSON file was not changed. Existing PostgreSQL IDs were preserved.</Text>
          </View>
        )}
        {uncertainImport !== null && (
          <View style={[styles.backupCard, cardColor]}>
            <Text style={[styles.description, { color: dark ? '#fbbf24' : '#92400e' }]}>
              The previous import result is uncertain. Reload and check the server records
              before deciding whether another import is needed. Reloading does not repeat
              the earlier import or prove whether it finished.
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Reload server data after uncertain JSON import"
              disabled={busy} onPress={() => { void refreshSettingsData(); }} style={[styles.button, busy && styles.disabled]}>
              <Text style={styles.buttonText}>Reload server data</Text>
            </Pressable>
            {uncertainImport === 'checked' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Acknowledge checking server data"
                disabled={busy} onPress={acknowledgeServerCheck} style={[styles.button, busy && styles.disabled]}>
                <Text style={styles.buttonText}>I checked the server data</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About WeekFlow</Text>
        <View style={[styles.infoCard, cardColor]}>
          <View style={styles.infoRow}><Text>App version</Text><Text>{appVersion}</Text></View>
          <View style={styles.infoRow}><Text>Expo SDK</Text><Text>{expoSdk}</Text></View>
          <View style={styles.infoRow}><Text>Data storage</Text><Text>PostgreSQL</Text></View>
        </View>
        <Text style={[styles.description, mutedColor]}>
          WeekFlow currently requires a server connection to load and save your data.
          Completion-feedback preferences are stored on this device.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { width: '100%', maxWidth: 1100, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 28 },
  section: { gap: 12, backgroundColor: 'transparent' },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  description: { fontSize: 14, lineHeight: 21 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, backgroundColor: 'transparent' },
  headerText: { flex: 1, gap: 6, backgroundColor: 'transparent' },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#2563eb', borderRadius: 10,
    paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#eff6ff' },
  buttonText: { color: '#1d4ed8', fontWeight: '800' },
  disabled: { opacity: 0.5 },
  backupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, backgroundColor: 'transparent' },
  backupCard: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 14 },
  backupCountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  backupCount: { flexBasis: 210, flexGrow: 1 },
  importButton: { backgroundColor: '#b45309', borderColor: '#b45309' },
  importButtonText: { color: '#ffffff', fontWeight: '800' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, backgroundColor: 'transparent' },
  metricCard: { flexGrow: 1, flexBasis: 180, borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  metricLabel: { fontSize: 15, fontWeight: '700' },
  metricValue: { fontSize: 34, fontWeight: '800' },
  preferenceCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderWidth: 1, borderRadius: 14 },
  preferenceCopy: { flex: 1, gap: 8, backgroundColor: 'transparent' },
  preferenceTitle: { fontSize: 16, fontWeight: '700' },
  infoCard: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, backgroundColor: 'transparent' },
  success: { color: '#047857', fontWeight: '600' },
  error: { color: '#b91c1c', fontWeight: '600' },
});
