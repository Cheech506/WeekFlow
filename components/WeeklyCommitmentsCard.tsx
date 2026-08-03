import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import type { Task } from '@/context/TaskContext';
import { formatDateKey } from '@/lib/dateUtils';
import type { WeeklyReviewStatus } from '@/lib/weeklyReview';
import {
  MAX_WEEKLY_COMMITMENT_TITLE_LENGTH,
  type WeeklyCommitment,
} from '@/lib/weeklyReviewStorage';

type WeeklyCommitmentsCardProps = {
  weekLabel: string;
  status: WeeklyReviewStatus;
  commitments: WeeklyCommitment[];
  tasks: Task[];
  taskOptions: Task[];
  onAdd: (title: string) => Promise<void>;
  onAddTask: (taskId: number) => Promise<void>;
  onToggle: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
};

export function WeeklyCommitmentsCard({
  weekLabel,
  status,
  commitments,
  tasks,
  taskOptions,
  onAdd,
  onAddTask,
  onToggle,
  onDelete,
}: WeeklyCommitmentsCardProps) {
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [addingTaskId, setAddingTaskId] = useState<number | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<number | null>(null);

  useEffect(() => {
    setTitle('');
    setIsTaskPickerOpen(false);
    setAddingTaskId(null);
    setPendingRemovalId(null);
  }, [weekLabel]);

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks]
  );
  const linkedTaskIds = useMemo(
    () =>
      new Set(
        commitments
          .map((commitment) => commitment.taskId)
          .filter((taskId): taskId is number => taskId !== null)
      ),
    [commitments]
  );
  const availableTaskOptions = useMemo(
    () =>
      taskOptions
        .filter((task) => !linkedTaskIds.has(task.id))
        .sort((a, b) => {
          if (a.dueDate === null && b.dueDate !== null) return -1;
          if (a.dueDate !== null && b.dueDate === null) return 1;
          return (a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
            a.title.localeCompare(b.title);
        }),
    [linkedTaskIds, taskOptions]
  );
  const inboxTaskOptions = availableTaskOptions.filter(
    (task) => task.dueDate === null
  );
  const scheduledTaskOptions = availableTaskOptions.filter(
    (task) => task.dueDate !== null
  );
  const completedCount = commitments.filter((commitment) => {
    const linkedTask =
      commitment.taskId === null ? null : taskById.get(commitment.taskId);
    return linkedTask?.completed ?? commitment.completed;
  }).length;
  const canPlanCommitments = status !== 'past';

  async function handleAdd() {
    if (!title.trim() || isSaving) return;

    setIsSaving(true);
    try {
      await onAdd(title);
      setTitle('');
    } catch (error) {
      Alert.alert(
        'Could Not Add Commitment',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not add that commitment.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddTask(taskId: number) {
    if (addingTaskId !== null) return;

    setAddingTaskId(taskId);
    try {
      await onAddTask(taskId);
    } catch (error) {
      Alert.alert(
        'Could Not Add Task',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not make that task a weekly commitment.'
      );
    } finally {
      setAddingTaskId(null);
    }
  }

  async function handleToggle(id: number) {
    try {
      await onToggle(id);
    } catch (error) {
      Alert.alert(
        'Could Not Update Commitment',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not update that commitment.'
      );
    }
  }

  async function handleConfirmedRemoval(id: number) {
    try {
      await onDelete(id);
      setPendingRemovalId(null);
    } catch (error) {
      Alert.alert(
        'Could Not Remove Commitment',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not remove that commitment.'
      );
    }
  }

  function renderTaskOption(task: Task) {
    return (
      <View key={task.id} style={styles.taskOptionRow}>
        <View style={styles.taskOptionTextWrap}>
          <Text style={styles.taskOptionTitle}>{task.title}</Text>
          <Text style={styles.taskOptionMeta}>
            {task.dueDate
              ? `Scheduled ${formatDateKey(task.dueDate)}`
              : 'Unscheduled in Inbox'}
          </Text>
        </View>

        <Pressable
          style={[
            styles.linkTaskButton,
            addingTaskId !== null && styles.disabledButton,
          ]}
          disabled={addingTaskId !== null}
          onPress={() => void handleAddTask(task.id)}
          accessibilityRole="button"
          accessibilityLabel={`Make ${task.title} a weekly commitment`}
        >
          <Text style={styles.linkTaskButtonText}>
            {addingTaskId === task.id ? 'Adding...' : 'Add'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.transparentView}>
          <Text style={styles.title}>Weekly Commitments</Text>
          <Text style={styles.subtitle}>
            Choose a few outcomes that matter most for {weekLabel}.
          </Text>
        </View>

        <Text style={styles.progressBadge}>
          {completedCount} of {commitments.length}
        </Text>
      </View>

      {canPlanCommitments ? (
        <>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Add a weekly commitment..."
              maxLength={MAX_WEEKLY_COMMITMENT_TITLE_LENGTH}
              returnKeyType="done"
              onSubmitEditing={() => void handleAdd()}
            />

            <Pressable
              style={[
                styles.addButton,
                (!title.trim() || isSaving) && styles.disabledButton,
              ]}
              disabled={!title.trim() || isSaving}
              onPress={() => void handleAdd()}
            >
              <Text style={styles.addButtonText}>
                {isSaving ? 'Adding...' : 'Add'}
              </Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.chooseTaskButton}
            onPress={() => setIsTaskPickerOpen((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ expanded: isTaskPickerOpen }}
          >
            <Text style={styles.chooseTaskButtonText}>
              {isTaskPickerOpen ? 'Hide Existing Tasks' : 'Choose Existing Task'}
            </Text>
          </Pressable>

          {isTaskPickerOpen ? (
            <View style={styles.taskPicker}>
              <Text style={styles.taskPickerHelp}>
                Link an Inbox task or a task scheduled during this week. The
                task stays where it is and is not duplicated.
              </Text>

              {availableTaskOptions.length === 0 ? (
                <Text style={styles.noTaskOptionsText}>
                  Every available task is already a commitment for this week.
                </Text>
              ) : (
                <>
                  {inboxTaskOptions.length > 0 ? (
                    <View style={styles.taskOptionSection}>
                      <Text style={styles.taskOptionSectionTitle}>Inbox</Text>
                      {inboxTaskOptions.map(renderTaskOption)}
                    </View>
                  ) : null}

                  {scheduledTaskOptions.length > 0 ? (
                    <View style={styles.taskOptionSection}>
                      <Text style={styles.taskOptionSectionTitle}>
                        Scheduled This Week
                      </Text>
                      {scheduledTaskOptions.map(renderTaskOption)}
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </>
      ) : null}

      {commitments.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {status === 'past'
              ? 'No commitments were recorded for this week.'
              : 'No commitments yet. Keep this list short and meaningful.'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {commitments.map((commitment) => {
            const linkedTask =
              commitment.taskId === null
                ? null
                : taskById.get(commitment.taskId) ?? null;
            const completed = linkedTask?.completed ?? commitment.completed;
            const displayTitle = linkedTask?.title ?? commitment.title;
            const isConfirmingRemoval = pendingRemovalId === commitment.id;

            return (
              <View key={commitment.id} style={styles.commitmentRow}>
                <Pressable
                  style={[
                    styles.checkButton,
                    completed && styles.checkButtonComplete,
                  ]}
                  onPress={() => void handleToggle(commitment.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: completed }}
                  accessibilityLabel={`${displayTitle}. ${
                    completed ? 'Completed' : 'Not completed'
                  }`}
                >
                  <Text style={styles.checkButtonText}>
                    {completed ? '✓' : ''}
                  </Text>
                </Pressable>

                <View style={styles.commitmentTextWrap}>
                  <Text
                    style={[
                      styles.commitmentText,
                      completed && styles.commitmentTextComplete,
                    ]}
                  >
                    {displayTitle}
                  </Text>

                  {commitment.taskId !== null ? (
                    <Text style={styles.linkedTaskMeta}>
                      {linkedTask
                        ? linkedTask.dueDate
                          ? `Task • ${formatDateKey(linkedTask.dueDate)}`
                          : 'Task • Inbox'
                        : 'Linked task was removed • saved commitment kept'}
                    </Text>
                  ) : (
                    <Text style={styles.manualCommitmentMeta}>
                      Manual commitment
                    </Text>
                  )}
                </View>

                {isConfirmingRemoval ? (
                  <View style={styles.removeConfirmation}>
                    <Pressable
                      style={styles.cancelRemoveButton}
                      onPress={() => setPendingRemovalId(null)}
                    >
                      <Text style={styles.cancelRemoveButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={styles.confirmRemoveButton}
                      onPress={() => void handleConfirmedRemoval(commitment.id)}
                    >
                      <Text style={styles.confirmRemoveButtonText}>
                        Confirm Remove
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.removeButton}
                    onPress={() => setPendingRemovalId(commitment.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove commitment ${displayTitle}`}
                  >
                    <Text style={styles.removeButtonText}>Remove</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'transparent',
  },
  transparentView: { flex: 1, backgroundColor: 'transparent' },
  title: { fontSize: 20, fontWeight: '900', color: '#111827' },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#5b6474',
  },
  progressBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#ede9fe',
    color: '#6d28d9',
    fontSize: 12,
    fontWeight: '900',
  },
  addRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  input: {
    flexGrow: 1,
    flexBasis: 260,
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: 'white',
    color: '#111827',
    fontSize: 15,
  },
  addButton: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#7c3aed',
  },
  addButtonText: { color: 'white', fontWeight: '900' },
  disabledButton: { opacity: 0.45 },
  chooseTaskButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7c3aed',
    backgroundColor: 'white',
  },
  chooseTaskButtonText: { color: '#6d28d9', fontWeight: '900' },
  taskPicker: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#faf5ff',
  },
  taskPickerHelp: { fontSize: 13, lineHeight: 18, color: '#5b6474' },
  noTaskOptionsText: { marginTop: 10, fontSize: 13, color: '#6b7280' },
  taskOptionSection: { marginTop: 12, gap: 7, backgroundColor: 'transparent' },
  taskOptionSectionTitle: { fontSize: 13, fontWeight: '900', color: '#4c1d95' },
  taskOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  taskOptionTextWrap: { flex: 1, backgroundColor: 'transparent' },
  taskOptionTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  taskOptionMeta: { marginTop: 2, fontSize: 12, color: '#6b7280' },
  linkTaskButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
  },
  linkTaskButtonText: { color: 'white', fontSize: 12, fontWeight: '900' },
  emptyCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d8b4fe',
    backgroundColor: '#faf5ff',
  },
  emptyText: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  list: { marginTop: 14, gap: 8, backgroundColor: 'transparent' },
  commitmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: 'white',
  },
  checkButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  checkButtonComplete: { backgroundColor: '#7c3aed' },
  checkButtonText: { color: 'white', fontSize: 17, fontWeight: '900' },
  commitmentTextWrap: { flex: 1, minWidth: 170, backgroundColor: 'transparent' },
  commitmentText: { fontSize: 14, color: '#111827' },
  commitmentTextComplete: {
    textDecorationLine: 'line-through',
    color: '#6b7280',
  },
  linkedTaskMeta: { marginTop: 3, fontSize: 12, color: '#2563eb' },
  manualCommitmentMeta: { marginTop: 3, fontSize: 12, color: '#6b7280' },
  removeButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  removeButtonText: { color: '#b91c1c', fontSize: 12, fontWeight: '800' },
  removeConfirmation: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    backgroundColor: 'transparent',
  },
  cancelRemoveButton: {
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9ca3af',
    backgroundColor: 'white',
  },
  cancelRemoveButtonText: { color: '#374151', fontSize: 12, fontWeight: '800' },
  confirmRemoveButton: {
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#dc2626',
  },
  confirmRemoveButtonText: { color: 'white', fontSize: 12, fontWeight: '900' },
});
