import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
} from 'react-native';

import { ScreenIntro } from '@/components/ScreenIntro';
import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCelebrations } from '@/context/CelebrationContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import {
  getBackupActivity,
  recordBackupExport,
  recordBackupImport,
  type BackupActivity,
} from '@/lib/appMetadataStorage';
import {
  exportWeekFlowBackup,
  getBackupErrorMessage,
  pickWeekFlowBackup,
  replaceWeekFlowData,
  type PickedWeekFlowBackup,
} from '@/lib/backupStorage';
import { BACKUP_VERSION } from '@/lib/backupValidation';

type BackupMessage = {
  tone: 'success' | 'error';
  text: string;
};

type DataMetric = {
  label: string;
  value: number;
  detail: string;
};

const EMPTY_BACKUP_ACTIVITY: BackupActivity = {
  lastExportAt: null,
  lastExportFileName: null,
  lastImportAt: null,
  lastImportFileName: null,
};

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Never on this device';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Date unavailable';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function SettingsScreen() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [backupMessage, setBackupMessage] =
    useState<BackupMessage | null>(null);
  const [pendingImport, setPendingImport] =
    useState<PickedWeekFlowBackup | null>(null);
  const [backupActivity, setBackupActivity] =
    useState<BackupActivity>(EMPTY_BACKUP_ACTIVITY);
  const [isSavingCelebrationPreference, setIsSavingCelebrationPreference] =
    useState(false);
  const [celebrationPreferenceMessage, setCelebrationPreferenceMessage] =
    useState<BackupMessage | null>(null);

  const {
    celebrationsEnabled,
    isLoadingCelebrationPreference,
    setCelebrationsEnabled,
  } = useCelebrations();

  const {
    tasks,
    recurringRules,
    taskTemplates,
    refreshTasks,
  } = useTasks();
  const { goals, milestones, refreshGoals } = useGoals();
  const { cycles, refreshCycles } = useCycle();
  const { brainDumps, refreshBrainDumps } = useBrainDumps();
  const {
    reviews: weeklyReviews,
    commitments: weeklyCommitments,
    refreshWeeklyReviews,
  } = useWeeklyReviews();
  const {
    cycleReviews,
    goalOutcomes,
    refreshCycleReviews,
  } = useCycleReviews();

  const loadBackupActivity = useCallback(async () => {
    setBackupActivity(await getBackupActivity());
  }, []);

  const refreshSettingsData = useCallback(async () => {
    setIsRefreshing(true);
    setBackupMessage(null);

    try {
      /*
       * Reload providers one at a time. Expo SQLite web runs through a worker,
       * and sequential reads avoid hammering that worker with four refreshes
       * immediately after navigation or a database restore.
       */
      await refreshTasks();
      await refreshGoals();
      await refreshBrainDumps();
      await refreshCycles();
      await refreshWeeklyReviews();
      await refreshCycleReviews();
      await loadBackupActivity();
    } catch {
      setBackupMessage({
        tone: 'error',
        text: 'WeekFlow could not refresh the Settings summary. Your stored data was not changed.',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [
    loadBackupActivity,
    refreshBrainDumps,
    refreshCycles,
    refreshGoals,
    refreshTasks,
    refreshWeeklyReviews,
    refreshCycleReviews,
  ]);

  useFocusEffect(
    useCallback(() => {
      /*
       * Shared contexts already keep the counts current. On focus we only load
       * device-specific backup timestamps; a full database refresh remains a
       * deliberate action behind the Refresh button.
       */
      void loadBackupActivity().catch(() => {
        setBackupMessage({
          tone: 'error',
          text: 'WeekFlow could not read the backup activity for this device.',
        });
      });
    }, [loadBackupActivity])
  );

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
    cycleReviews,
    goalOutcomes,
  ]);

  async function handleCelebrationToggle(enabled: boolean) {
    if (isSavingCelebrationPreference) return;

    setIsSavingCelebrationPreference(true);
    setCelebrationPreferenceMessage(null);

    try {
      await setCelebrationsEnabled(enabled);
      setCelebrationPreferenceMessage({
        tone: 'success',
        text: enabled
          ? 'Completion celebrations are on.'
          : 'Completion celebrations are off.',
      });
    } catch {
      setCelebrationPreferenceMessage({
        tone: 'error',
        text: 'WeekFlow could not save that completion-feedback setting.',
      });
    } finally {
      setIsSavingCelebrationPreference(false);
    }
  }

  async function handleExportBackup() {
    setIsExporting(true);
    setBackupMessage(null);

    try {
      const result = await exportWeekFlowBackup();

      /*
       * Activity history is helpful, but it must never turn a successful file
       * export into a reported failure if only the timestamp cannot be saved.
       */
      try {
        await recordBackupExport(
          result.fileName,
          result.preview.exportedAt
        );
        await loadBackupActivity();
      } catch {
        // The exported backup remains valid even if device metadata fails.
      }

      const counts = result.preview.counts;
      setBackupMessage({
        tone: 'success',
        text:
          `Exported ${counts.tasks} tasks, ${counts.goals} goals, ` +
          `${counts.goalMilestones} milestones, ${counts.brainDumps} brain dumps, ${counts.taskTemplates} templates, ` +
          `${counts.recurringRules} recurring schedules, ${counts.planningCycles} planning cycles, ` +
          `${counts.weeklyReviews} weekly reviews, ${counts.weeklyCommitments} commitments, ` +
          `${counts.weeklyTaskDecisions} unfinished-task decisions, ${counts.cycleReviews} cycle reports, and ` +
          `${counts.cycleGoalOutcomes} saved goal outcomes.`,
      });
    } catch (error) {
      setBackupMessage({
        tone: 'error',
        text: getBackupErrorMessage(error, 'export'),
      });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleChooseBackup() {
    setBackupMessage(null);

    try {
      const pickedBackup = await pickWeekFlowBackup();

      if (pickedBackup) {
        setPendingImport(pickedBackup);
      }
    } catch (error) {
      setPendingImport(null);
      setBackupMessage({
        tone: 'error',
        text: getBackupErrorMessage(error, 'choose'),
      });
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) return;

    setIsImporting(true);
    setBackupMessage(null);

    try {
      const counts = await replaceWeekFlowData(pendingImport.backup);

      // Every provider caches its own list, so reload them all after SQLite is
      // replaced. This keeps every tab in sync without restarting WeekFlow.
      await refreshTasks();
      await refreshGoals();
      await refreshBrainDumps();
      await refreshCycles();
      await refreshWeeklyReviews();
      await refreshCycleReviews();

      /*
       * The database replacement is already complete at this point. Device
       * activity metadata is best-effort so a timestamp problem cannot make a
       * successful restore look like it failed.
       */
      try {
        await recordBackupImport(pendingImport.fileName);
        await loadBackupActivity();
      } catch {
        // The imported WeekFlow data remains valid without this timestamp.
      }

      setBackupMessage({
        tone: 'success',
        text:
          `Imported ${counts.tasks} tasks, ${counts.goals} goals, ` +
          `${counts.goalMilestones} milestones, ${counts.brainDumps} brain dumps, ${counts.taskTemplates} templates, ` +
          `${counts.recurringRules} recurring schedules, ${counts.planningCycles} planning cycles, ` +
          `${counts.weeklyReviews} weekly reviews, ${counts.weeklyCommitments} commitments, ` +
          `${counts.weeklyTaskDecisions} unfinished-task decisions, ${counts.cycleReviews} cycle reports, and ` +
          `${counts.cycleGoalOutcomes} saved goal outcomes.`,
      });
      setPendingImport(null);
    } catch (error) {
      setBackupMessage({
        tone: 'error',
        text: getBackupErrorMessage(error, 'restore'),
      });
    } finally {
      setIsImporting(false);
    }
  }

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const expoSdk = Constants.expoConfig?.sdkVersion ?? '54';

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <ScreenIntro
        title="Settings"
        subtitle="Manage WeekFlow data, backups, and development information in one place."
      />

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>Data at a Glance</Text>
            <Text style={styles.sectionSubtitle}>
              A quick inventory of what is stored in this WeekFlow database.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh WeekFlow data counts"
            style={[
              styles.refreshButton,
              isRefreshing && styles.disabledButton,
            ]}
            onPress={refreshSettingsData}
            disabled={isRefreshing}
          >
            <Text style={styles.refreshButtonText}>
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricDetail}>{metric.detail}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Completion Feedback</Text>
        <Text style={styles.sectionSubtitle}>
          Keep finishing work satisfying without turning WeekFlow into a game.
        </Text>

        <View style={styles.preferenceCard}>
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>Completion Celebrations</Text>
            <Text style={styles.preferenceText}>
              Show a short success banner after completing tasks and goals, with
              a larger moment when a 12-week cycle is finalized. WeekFlow also
              follows your device's Reduce Motion preference.
            </Text>
          </View>

          <Switch
            accessibilityLabel="Completion celebrations"
            value={celebrationsEnabled}
            disabled={
              isLoadingCelebrationPreference || isSavingCelebrationPreference
            }
            onValueChange={(enabled) => {
              void handleCelebrationToggle(enabled);
            }}
          />
        </View>

        {celebrationPreferenceMessage ? (
          <Text
            style={[
              styles.preferenceMessage,
              celebrationPreferenceMessage.tone === 'error'
                ? styles.backupMessageError
                : styles.backupMessageSuccess,
            ]}
          >
            {celebrationPreferenceMessage.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup Activity</Text>
        <Text style={styles.sectionSubtitle}>
          These timestamps belong to this device and are not copied into backup
          files.
        </Text>

        <View style={styles.activityGrid}>
          <View style={styles.activityCard}>
            <Text style={styles.activityLabel}>Last successful export</Text>
            <Text style={styles.activityValue}>
              {formatDateTime(backupActivity.lastExportAt)}
            </Text>
            {backupActivity.lastExportFileName ? (
              <Text style={styles.activityFile} numberOfLines={2}>
                {backupActivity.lastExportFileName}
              </Text>
            ) : null}
          </View>

          <View style={styles.activityCard}>
            <Text style={styles.activityLabel}>Last successful import</Text>
            <Text style={styles.activityValue}>
              {formatDateTime(backupActivity.lastImportAt)}
            </Text>
            {backupActivity.lastImportFileName ? (
              <Text style={styles.activityFile} numberOfLines={2}>
                {backupActivity.lastImportFileName}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Backup and Transfer</Text>
        <Text style={styles.sectionSubtitle}>
          Export everything in WeekFlow to one JSON file or restore a validated
          WeekFlow backup.
        </Text>

        <View style={styles.backupCard}>
          <Text style={styles.backupTitle}>Export Backup</Text>
          <Text style={styles.backupText}>
            {Platform.OS === 'web'
              ? 'The web version downloads the backup file to your computer.'
              : 'The phone version opens the system share sheet so you can save or send the backup file.'}
          </Text>

          <Pressable
            accessibilityRole="button"
            style={[
              styles.primaryButton,
              (isExporting || isImporting) && styles.disabledButton,
            ]}
            onPress={handleExportBackup}
            disabled={isExporting || isImporting}
          >
            <Text style={styles.primaryButtonText}>
              {isExporting ? 'Exporting...' : 'Export WeekFlow Data'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Replace Data from Backup</Text>
          <Text style={styles.dangerText}>
            Import replaces the current tasks, goals, templates, recurring
            schedules, brain dumps, planning cycles, weekly reviews,
            commitments, and Week 13 cycle reports only after the selected file
            passes validation and you confirm the replacement.
          </Text>

          <Pressable
            accessibilityRole="button"
            style={[
              styles.secondaryButton,
              (isExporting || isImporting) && styles.disabledButton,
            ]}
            onPress={handleChooseBackup}
            disabled={isExporting || isImporting}
          >
            <Text style={styles.secondaryButtonText}>
              Choose WeekFlow Backup
            </Text>
          </Pressable>

          {pendingImport ? (
            <View style={styles.importConfirmation}>
              <Text style={styles.importFileName}>
                {pendingImport.fileName}
              </Text>
              <Text style={styles.importMetadata}>
                Exported {formatDateTime(pendingImport.preview.exportedAt)} •
                WeekFlow {pendingImport.preview.appVersion}
              </Text>
              <Text style={styles.importCounts}>
                {pendingImport.preview.counts.tasks} tasks •{' '}
                {pendingImport.preview.counts.goals} goals •{' '}
                {pendingImport.preview.counts.goalMilestones} milestones •{' '}
                {pendingImport.preview.counts.brainDumps} brain dumps •{' '}
                {pendingImport.preview.counts.taskTemplates} templates
              </Text>
              <Text style={styles.importCounts}>
                {pendingImport.preview.counts.recurringRules} recurring
                schedules •{' '}
                {pendingImport.preview.counts.recurringExceptions} skipped
                occurrences •{' '}
                {pendingImport.preview.counts.planningCycles} planning cycles
              </Text>
              <Text style={styles.importCounts}>
                {pendingImport.preview.counts.weeklyReviews} weekly reviews •{' '}
                {pendingImport.preview.counts.weeklyCommitments} commitments •{' '}
                {pendingImport.preview.counts.weeklyTaskDecisions}{' '}
                unfinished-task decisions •{' '}
                {pendingImport.preview.counts.cycleReviews} cycle reports •{' '}
                {pendingImport.preview.counts.cycleGoalOutcomes} saved goal outcomes
              </Text>

              {pendingImport.preview.sourceVersion <
              pendingImport.preview.currentVersion ? (
                <Text style={styles.importUpgradeText}>
                  Backup format v{pendingImport.preview.sourceVersion} will be
                  safely upgraded to v{pendingImport.preview.currentVersion}
                  during restore.
                </Text>
              ) : null}

              {pendingImport.preview.repairs.orphanedGoalLinks > 0 ? (
                <Text style={styles.importUpgradeText}>
                  WeekFlow will preserve records with{' '}
                  {pendingImport.preview.repairs.orphanedGoalLinks} deleted goal
                  link
                  {pendingImport.preview.repairs.orphanedGoalLinks === 1
                    ? ''
                    : 's'}{' '}
                  and clear only the missing relationships.
                </Text>
              ) : null}

              <Text style={styles.importWarningText}>
                This backup passed validation. Confirming replaces all WeekFlow
                productivity data currently stored on this device. A failed
                restore rolls back without changing the current data.
              </Text>

              <View style={styles.importActions}>
                <Pressable
                  style={styles.cancelButton}
                  onPress={() => setPendingImport(null)}
                  disabled={isImporting}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.confirmButton,
                    isImporting && styles.disabledButton,
                  ]}
                  onPress={handleConfirmImport}
                  disabled={isImporting}
                >
                  <Text style={styles.confirmButtonText}>
                    {isImporting ? 'Importing...' : 'Replace and Import'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {backupMessage ? (
            <Text
              style={[
                styles.backupMessage,
                backupMessage.tone === 'error'
                  ? styles.backupMessageError
                  : styles.backupMessageSuccess,
              ]}
            >
              {backupMessage.text}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About WeekFlow</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App version</Text>
            <Text style={styles.infoValue}>{appVersion}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expo SDK</Text>
            <Text style={styles.infoValue}>{expoSdk}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Development Node baseline</Text>
            <Text style={styles.infoValue}>22</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Backup format</Text>
            <Text style={styles.infoValue}>v{BACKUP_VERSION}</Text>
          </View>
          <View style={[styles.infoRow, styles.lastInfoRow]}>
            <Text style={styles.infoLabel}>Primary storage</Text>
            <Text style={styles.infoValue}>Local SQLite</Text>
          </View>
        </View>

        <Text style={styles.aboutText}>
          WeekFlow keeps the working database on this device. Use regular
          backups before major upgrades, device changes, or SDK conversions.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    padding: 20,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 28,
    backgroundColor: 'transparent',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: 'transparent',
  },
  sectionHeaderText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 14,
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: '#eff6ff',
  },
  refreshButtonText: {
    color: '#1d4ed8',
    fontWeight: '800',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: 'transparent',
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 145,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
  },
  metricLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 5,
  },
  metricValue: {
    fontSize: 30,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 3,
  },
  metricDetail: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 17,
  },
  preferenceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  preferenceCopy: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  preferenceTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  preferenceText: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
  },
  preferenceMessage: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '700',
  },
  activityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: 'transparent',
  },
  activityCard: {
    flexGrow: 1,
    flexBasis: 280,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  activityLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
    marginBottom: 5,
  },
  activityValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  activityFile: {
    marginTop: 5,
    fontSize: 12,
    color: '#64748b',
  },
  backupCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    marginBottom: 14,
  },
  backupTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  backupText: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
    marginBottom: 14,
  },
  dangerCard: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  dangerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#92400e',
    marginBottom: 6,
  },
  dangerText: {
    fontSize: 14,
    color: '#78350f',
    lineHeight: 20,
    marginBottom: 14,
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 11,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#d97706',
    backgroundColor: 'white',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 11,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#92400e',
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.55,
  },
  importConfirmation: {
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: 'white',
  },
  importFileName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  importMetadata: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 6,
  },
  importCounts: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 6,
  },
  importUpgradeText: {
    fontSize: 13,
    color: '#1d4ed8',
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 10,
  },
  importWarningText: {
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
    marginBottom: 12,
  },
  importActions: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#9ca3af',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  cancelButtonText: {
    color: '#374151',
    fontWeight: '800',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  backupMessage: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  backupMessageSuccess: {
    color: '#166534',
  },
  backupMessageError: {
    color: '#b91c1c',
  },
  infoCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    backgroundColor: 'white',
    paddingHorizontal: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: 'transparent',
  },
  lastInfoRow: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    flex: 1,
    fontSize: 14,
    color: '#4b5563',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  aboutText: {
    marginTop: 12,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
  },
});
