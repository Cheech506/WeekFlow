import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useTasks } from '@/context/TaskContext';
import {
  refreshBackupMigration,
  type BackupRefreshResult,
} from '@/lib/backupMigrationApi';
import { buildWeekFlowBackup } from '@/lib/backupStorage';
import {
  fetchServerTasks,
  type ServerTask,
} from '@/lib/taskApi';
import {
  previewTaskMigration,
  type TaskMigrationPreview,
} from '@/lib/taskMigrationApi';

function confirmCompleteRefresh(): Promise<boolean> {
  const message =
    'Add new WeekFlow records and overwrite matching PostgreSQL records ' +
    'with this device’s current SQLite values? This includes task ' +
    'completion, goal links, schedules, and reviews. ' +
    'Existing PostgreSQL IDs stay the same. SQLite data and PostgreSQL ' +
    'records absent from this backup will not be deleted.';

  if (Platform.OS === 'web') {
    return Promise.resolve(
      globalThis.confirm(message)
    );
  }

  return new Promise((resolve) => {
    Alert.alert(
      'Update PostgreSQL from this device?',
      message,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: 'Import and update',
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      }
    );
  });
}

export default function ServerTasksScreen() {
  const {
    tasks: localTasks,
    isLoading: localTasksLoading,
  } = useTasks();

  const [serverTasks, setServerTasks] =
    useState<ServerTask[] | null>(null);
  const [serverTasksLoading, setServerTasksLoading] =
    useState(false);
  const [serverTasksError, setServerTasksError] =
    useState<string | null>(null);

  const [preview, setPreview] =
    useState<TaskMigrationPreview | null>(null);
  const [previewLoading, setPreviewLoading] =
    useState(false);
  const [previewError, setPreviewError] =
    useState<string | null>(null);

  const [backupRefreshResult, setBackupRefreshResult] =
    useState<BackupRefreshResult | null>(null);
  const [backupRefreshLoading, setBackupRefreshLoading] =
    useState(false);
  const [backupRefreshError, setBackupRefreshError] =
    useState<string | null>(null);

  async function loadServerTasks() {
    const baseUrl =
      process.env.EXPO_PUBLIC_API_BASE_URL;

    if (!baseUrl) {
      setServerTasksError(
        'The API address is missing from .env.local.'
      );
      return;
    }

    setServerTasksLoading(true);
    setServerTasksError(null);
    setServerTasks(null);

    try {
      setServerTasks(
        await fetchServerTasks(baseUrl)
      );
    } catch (caught) {
      setServerTasksError(
        caught instanceof Error
          ? caught.message
          : 'Could not load server tasks.'
      );
    } finally {
      setServerTasksLoading(false);
    }
  }

  async function runMigrationPreview() {
    const baseUrl =
      process.env.EXPO_PUBLIC_API_BASE_URL;

    if (!baseUrl) {
      setPreviewError(
        'The API address is missing from .env.local.'
      );
      return;
    }

    if (localTasks.length === 0) {
      setPreviewError(
        'There are no SQLite tasks to preview.'
      );
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);

    try {
      setPreview(
        await previewTaskMigration(
          baseUrl,
          localTasks
        )
      );
    } catch (caught) {
      setPreviewError(
        caught instanceof Error
          ? caught.message
          : 'Could not preview the task migration.'
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  const refreshInProgress = useRef(false);

  async function runCompleteBackupRefresh() {
    if (
      refreshInProgress.current ||
      localTasksLoading ||
      previewLoading ||
      serverTasksLoading
    ) {
      return;
    }

    const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

    if (!baseUrl) {
      setBackupRefreshError(
        'The API address is missing from .env.local.'
      );
      return;
    }

    // Guard both the confirmation and request against repeated taps.
    refreshInProgress.current = true;

    try {
      const confirmed = await confirmCompleteRefresh();

      if (!confirmed) {
        return;
      }

      setBackupRefreshLoading(true);
      setBackupRefreshError(null);
      setBackupRefreshResult(null);

      const backup = await buildWeekFlowBackup();
      const result = await refreshBackupMigration(baseUrl, backup);
      setBackupRefreshResult(result);

      // Earlier comparisons and task lists describe the old server data.
      setPreview(null);
      setPreviewError(null);
      setServerTasks(null);
      setServerTasksError(null);
    } catch (caught) {
      setBackupRefreshError(
        caught instanceof Error
          ? caught.message
          : 'Could not update PostgreSQL from this device.'
      );
    } finally {
      setBackupRefreshLoading(false);
      refreshInProgress.current = false;
    }
  }

  const previewDisabled =
    previewLoading ||
    backupRefreshLoading ||
    localTasksLoading ||
    localTasks.length === 0;

  const backupRefreshDisabled =
    backupRefreshLoading ||
    localTasksLoading ||
    previewLoading ||
    serverTasksLoading;

  return (
    <>
      <Stack.Screen
        options={{ title: 'Task API tools' }}
      />

      <ScrollView
        contentContainerStyle={styles.content}
      >
        <Text style={styles.pageTitle}>
          Task API tools
        </Text>

        <Text style={styles.pageSubtitle}>
          Read PostgreSQL tasks and move this
          device&apos;s SQLite data into PostgreSQL.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Migration preview
          </Text>

          <Text style={styles.sectionText}>
            Compare all {localTasks.length} SQLite tasks
            with PostgreSQL. This preview cannot import,
            update, or delete anything.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Preview PostgreSQL task migration"
            disabled={previewDisabled}
            onPress={() => {
              void runMigrationPreview();
            }}
            style={[
              styles.primaryButton,
              previewDisabled &&
                styles.disabledButton,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {previewLoading
                ? 'Checking...'
                : localTasksLoading
                  ? 'Loading SQLite tasks...'
                  : 'Preview PostgreSQL migration'}
            </Text>
          </Pressable>

          {previewError ? (
            <Text style={styles.errorText}>
              {previewError}
            </Text>
          ) : null}

          {preview ? (
            <View style={styles.previewCard}>
              <Text style={styles.resultTitle}>
                Preview results
              </Text>

              <View style={styles.metricGrid}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Tasks checked
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.received_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Would create
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.would_create_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Already imported
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.already_imported_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Conflicts
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.conflict_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Goal-linked
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.goal_linked_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Recurring
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.recurring_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Completed
                  </Text>
                  <Text style={styles.metricValue}>
                    {preview.completed_count}
                  </Text>
                </View>
              </View>

              <Text
                style={
                  preview.can_import
                    ? styles.successText
                    : styles.warningText
                }
              >
                {preview.can_import
                  ? 'No migration conflicts were detected.'
                  : `${preview.conflict_count} migration conflict${
                      preview.conflict_count === 1
                        ? ''
                        : 's'
                    } were found. Refresh below can replace changed values with this device's values; duplicates and invalid links still require correction.`}
              </Text>

              {preview.conflict_source_task_ids.length >
              0 ? (
                <Text style={styles.sectionText}>
                  Conflicting source IDs:{' '}
                  {preview.conflict_source_task_ids.join(
                    ', '
                  )}
                </Text>
              ) : null}

              <Text style={styles.safetyText}>
                No data was imported.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Import and update PostgreSQL
          </Text>

          <Text style={styles.sectionText}>
            Add new tasks, goals, cycles, schedules, reviews,
            and other WeekFlow records. Overwrite matching
            PostgreSQL records with this device&apos;s current
            SQLite values, including completion status.
            Existing PostgreSQL IDs stay the same.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import and update PostgreSQL from this device"
            disabled={backupRefreshDisabled}
            onPress={() => {
              void runCompleteBackupRefresh();
            }}
            style={[
              styles.importButton,
              backupRefreshDisabled &&
                styles.disabledButton,
            ]}
          >
            <Text style={styles.importButtonText}>
              {backupRefreshLoading
                ? 'Updating PostgreSQL...'
                : 'Import and update from this device'}
            </Text>
          </Pressable>

          {backupRefreshError ? (
            <Text style={styles.errorText}>
              {backupRefreshError}
            </Text>
          ) : null}

          {backupRefreshResult ? (
            <View style={styles.previewCard}>
              <Text style={styles.resultTitle}>
                PostgreSQL update completed
              </Text>

              <View style={styles.metricGrid}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Records checked
                  </Text>
                  <Text style={styles.metricValue}>
                    {backupRefreshResult.total_records}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Created
                  </Text>
                  <Text style={styles.metricValue}>
                    {backupRefreshResult.created_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Updated
                  </Text>
                  <Text style={styles.metricValue}>
                    {backupRefreshResult.updated_count}
                  </Text>
                </View>

                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>
                    Unchanged
                  </Text>
                  <Text style={styles.metricValue}>
                    {
                      backupRefreshResult
                        .already_imported_count
                    }
                  </Text>
                </View>
              </View>

              <Text style={styles.successText}>
                {backupRefreshResult.database_changed
                  ? 'New and changed records were saved to PostgreSQL.'
                  : 'No changes were needed. All backup records already match PostgreSQL.'}
              </Text>

              <Text style={styles.safetyText}>
                SQLite data was not deleted. Existing PostgreSQL IDs were preserved.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Server tasks
          </Text>

          <Text style={styles.sectionText}>
            Read the tasks currently stored in PostgreSQL.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={serverTasksLoading || backupRefreshLoading}
            onPress={() => {
              void loadServerTasks();
            }}
            style={[
              styles.secondaryButton,
              (serverTasksLoading || backupRefreshLoading) &&
                styles.disabledButton,
            ]}
          >
            <Text style={styles.secondaryButtonText}>
              {serverTasksLoading
                ? 'Loading...'
                : 'Read server tasks'}
            </Text>
          </Pressable>

          {serverTasksError ? (
            <Text style={styles.errorText}>
              {serverTasksError}
            </Text>
          ) : null}

          {serverTasks?.length === 0 ? (
            <Text>No server tasks found.</Text>
          ) : null}

          {serverTasks?.map((task) => (
            <View
              key={task.id}
              style={styles.taskCard}
            >
              <Text style={styles.taskTitle}>
                {task.title}
              </Text>
              <Text>
                {task.completed
                  ? 'Completed'
                  : 'Not completed'}
              </Text>
              <Text>
                {task.due_date ?? 'No due date'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 24,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 16,
    lineHeight: 24,
    opacity: 0.72,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  sectionText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.75,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  importButton: {
    alignItems: 'center',
    backgroundColor: '#b45309',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  importButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#2563eb',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.5,
  },
  errorText: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  previewCard: {
    borderColor: '#bfdbfe',
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    borderColor: '#dbeafe',
    borderRadius: 10,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 130,
    padding: 12,
  },
  metricLabel: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  successText: {
    color: '#047857',
    fontWeight: '700',
  },
  warningText: {
    color: '#b45309',
    fontWeight: '700',
  },
  safetyText: {
    fontSize: 16,
    fontWeight: '800',
  },
  taskCard: {
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  taskTitle: {
    fontWeight: '700',
  },
});