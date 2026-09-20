import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useTasks } from '@/context/TaskContext';
import {
  fetchServerTasks,
  type ServerTask,
} from '@/lib/taskApi';
import {
  previewTaskMigration,
  type TaskMigrationPreview,
} from '@/lib/taskMigrationApi';

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

  const previewDisabled =
    previewLoading ||
    localTasksLoading ||
    localTasks.length === 0;

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
          Read PostgreSQL tasks and preview how this
          device&apos;s SQLite tasks compare.
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
                    } must be resolved first.`}
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
            Server tasks
          </Text>

          <Text style={styles.sectionText}>
            Read the tasks currently stored in PostgreSQL.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={serverTasksLoading}
            onPress={() => {
              void loadServerTasks();
            }}
            style={[
              styles.secondaryButton,
              serverTasksLoading &&
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