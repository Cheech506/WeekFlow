import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useCycle } from '@/context/CycleContext';
import type { Task } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import {
  addDays,
  getLocalDateKey,
  getStartOfWeek,
  parseLocalDateKey,
} from '@/lib/dateUtils';

type TaskCardActionsMenuProps = {
  task: Task;
  weekStart?: string;
  commitmentDisabled?: boolean;
  compact?: boolean;
  showMoveToToday?: boolean;
  onMoveToToday?: () => Promise<void> | void;
  onReschedule: () => void;
  onMoveToInbox: () => Promise<void> | void;
  onComplete: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
};

export function TaskCardActionsMenu({
  task,
  weekStart,
  commitmentDisabled = false,
  compact = false,
  showMoveToToday = false,
  onMoveToToday,
  onReschedule,
  onMoveToInbox,
  onComplete,
  onDelete,
}: TaskCardActionsMenuProps) {
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isAddingCommitment, setIsAddingCommitment] = useState(false);
  const [isRemovingCommitment, setIsRemovingCommitment] = useState(false);
  const [confirmationMode, setConfirmationMode] = useState<
    'removeCommitment' | 'deleteTask' | null
  >(null);
  const { cycles } = useCycle();
  const {
    commitments,
    addTaskCommitment,
    deleteCommitment,
  } = useWeeklyReviews();

  const resolvedWeekStart =
    weekStart ?? getLocalDateKey(getStartOfWeek(new Date()));
  const weekEnd = useMemo(() => {
    const parsedWeekStart = parseLocalDateKey(resolvedWeekStart);
    return parsedWeekStart
      ? getLocalDateKey(addDays(parsedWeekStart, 6))
      : resolvedWeekStart;
  }, [resolvedWeekStart]);
  const selectedCycle = cycles.find(
    (cycle) =>
      cycle.startDate <= weekEnd && cycle.endDate >= resolvedWeekStart
  );
  const linkedCommitment = commitments.find(
    (commitment) =>
      commitment.weekStart === resolvedWeekStart &&
      commitment.taskId === task.id
  );

  async function runTaskAction(
    action: () => Promise<void> | void,
    errorTitle: string,
    closeMenu = true
  ) {
    if (isWorking) return;

    setIsWorking(true);
    try {
      await action();
      if (closeMenu) setIsMenuVisible(false);
    } catch (error) {
      Alert.alert(
        errorTitle,
        error instanceof Error
          ? error.message
          : 'WeekFlow could not update that task.'
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleAddCommitment() {
    if (commitmentDisabled || isAddingCommitment || linkedCommitment) return;

    setIsAddingCommitment(true);
    try {
      await addTaskCommitment(
        resolvedWeekStart,
        selectedCycle?.id ?? null,
        task.id
      );
      setIsMenuVisible(false);
    } catch (error) {
      Alert.alert(
        'Could Not Add Commitment',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not make that task a weekly commitment.'
      );
    } finally {
      setIsAddingCommitment(false);
    }
  }

  async function handleConfirmRemoveCommitment() {
    if (!linkedCommitment || isRemovingCommitment) return;

    setIsRemovingCommitment(true);
    try {
      // Removing the commitment only deletes the weekly link. The underlying
      // task remains scheduled, incomplete, and otherwise unchanged.
      await deleteCommitment(linkedCommitment.id);
      setConfirmationMode(null);
      setIsMenuVisible(false);
    } catch (error) {
      Alert.alert(
        'Could Not Remove Commitment',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not remove that weekly commitment.'
      );
    } finally {
      setIsRemovingCommitment(false);
    }
  }

  async function handleConfirmDeleteTask() {
    await runTaskAction(onDelete, 'Could Not Delete Task');
    setConfirmationMode(null);
  }

  function closeMenu() {
    setConfirmationMode(null);
    setIsMenuVisible(false);
  }

  return (
    <>
      <View style={styles.compactActions}>
        {linkedCommitment ? (
          <Text
            style={styles.commitmentBadge}
            numberOfLines={1}
          >
            ★ Weekly Commitment
          </Text>
        ) : null}

        <View style={styles.compactButtonRow}>
          <Pressable
            style={[
              styles.doneButton,
              compact && styles.doneButtonCompact,
              isWorking && styles.buttonDisabled,
            ]}
            disabled={isWorking}
            onPress={() =>
              void runTaskAction(
                onComplete,
                'Could Not Complete Task',
                false
              )
            }
            accessibilityRole="button"
            accessibilityLabel={`Complete ${task.title}`}
          >
            <Text style={styles.doneButtonText}>
              {isWorking ? 'Working…' : 'Done'}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.moreButton,
              compact && styles.moreButtonCompact,
            ]}
            onPress={() => setIsMenuVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${task.title}`}
          >
            <Text style={styles.moreButtonText}>•••</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={isMenuVisible}
        transparent
        animationType="slide"
        onRequestClose={closeMenu}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdrop}
            onPress={closeMenu}
            accessibilityRole="button"
            accessibilityLabel="Close task actions"
          />

          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetTitle}>Task Actions</Text>
            <Text style={styles.sheetTaskTitle} numberOfLines={2}>
              {task.title}
            </Text>

            {confirmationMode ? (
              <View style={styles.confirmationCard}>
                <Text style={styles.confirmationTitle}>
                  {confirmationMode === 'removeCommitment'
                    ? 'Remove this weekly commitment?'
                    : 'Delete this task?'}
                </Text>
                <Text style={styles.confirmationText}>
                  {confirmationMode === 'removeCommitment'
                    ? 'The task itself will remain exactly where it is.'
                    : 'This permanently deletes the task and cannot be undone.'}
                </Text>

                <View style={styles.confirmationButtons}>
                  <Pressable
                    style={styles.confirmCancelButton}
                    onPress={() => setConfirmationMode(null)}
                  >
                    <Text style={styles.confirmCancelText}>Cancel</Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.confirmRemoveButton,
                      confirmationMode === 'deleteTask' &&
                        styles.confirmDeleteButton,
                    ]}
                    disabled={isRemovingCommitment || isWorking}
                    onPress={() => {
                      if (confirmationMode === 'removeCommitment') {
                        void handleConfirmRemoveCommitment();
                      } else {
                        void handleConfirmDeleteTask();
                      }
                    }}
                  >
                    <Text style={styles.confirmRemoveText}>
                      {confirmationMode === 'removeCommitment'
                        ? isRemovingCommitment
                          ? 'Removing…'
                          : 'Confirm Remove'
                        : isWorking
                          ? 'Deleting…'
                          : 'Confirm Delete'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {showMoveToToday && onMoveToToday ? (
                  <Pressable
                    style={[styles.menuAction, styles.todayAction]}
                    onPress={() =>
                      void runTaskAction(
                        onMoveToToday,
                        'Could Not Move Task'
                      )
                    }
                  >
                    <Text style={styles.menuActionText}>Move to Today</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={[styles.menuAction, styles.rescheduleAction]}
                  onPress={() => {
                    setIsMenuVisible(false);
                    onReschedule();
                  }}
                >
                  <Text style={styles.menuActionText}>Reschedule</Text>
                </Pressable>

                <Pressable
                  style={[styles.menuAction, styles.inboxAction]}
                  onPress={() =>
                    void runTaskAction(
                      onMoveToInbox,
                      'Could Not Return Task to Inbox'
                    )
                  }
                >
                  <Text style={styles.menuActionText}>Back to Inbox</Text>
                </Pressable>

                {linkedCommitment ? (
                  <Pressable
                    style={[styles.menuAction, styles.commitmentAction]}
                    onPress={() => setConfirmationMode('removeCommitment')}
                  >
                    <Text style={styles.commitmentActionText}>
                      Remove Weekly Commitment
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[
                      styles.menuAction,
                      styles.commitmentAction,
                      commitmentDisabled && styles.menuActionDisabled,
                    ]}
                    disabled={commitmentDisabled || isAddingCommitment}
                    onPress={() => void handleAddCommitment()}
                  >
                    <Text style={styles.commitmentActionText}>
                      {commitmentDisabled
                        ? 'Commitments Locked for Past Week'
                        : isAddingCommitment
                          ? 'Adding Commitment…'
                          : 'Make Weekly Commitment'}
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  style={[styles.menuAction, styles.deleteAction]}
                  onPress={() => setConfirmationMode('deleteTask')}
                >
                  <Text style={styles.menuActionText}>Delete Task</Text>
                </Pressable>
              </>
            )}

            <Pressable style={styles.cancelButton} onPress={closeMenu}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  compactActions: {
    gap: 7,
    backgroundColor: 'transparent',
  },
  commitmentBadge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#ede9fe',
    color: '#6d28d9',
    fontSize: 11,
    fontWeight: '900',
  },
  compactButtonRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'transparent',
  },
  doneButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#16a34a',
  },
  doneButtonCompact: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  doneButtonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
  },
  moreButton: {
    width: 52,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  moreButtonCompact: {
    width: 44,
    minHeight: 36,
  },
  moreButtonText: {
    color: '#334155',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  buttonDisabled: { opacity: 0.65 },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  sheet: {
    maxHeight: '88%',
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 24,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: 'white',
    gap: 10,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    marginBottom: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  sheetTaskTitle: {
    marginBottom: 4,
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  menuAction: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  todayAction: { backgroundColor: '#f97316' },
  rescheduleAction: { backgroundColor: '#7c3aed' },
  inboxAction: { backgroundColor: '#2563eb' },
  commitmentAction: {
    borderWidth: 1,
    borderColor: '#8b5cf6',
    backgroundColor: '#f5f3ff',
  },
  deleteAction: { backgroundColor: '#dc2626' },
  menuActionDisabled: { opacity: 0.55 },
  menuActionText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
  },
  commitmentActionText: {
    color: '#6d28d9',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  confirmationCard: {
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
  },
  confirmationTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#4c1d95',
  },
  confirmationText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
    color: '#6b7280',
  },
  confirmationButtons: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  confirmCancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: 'white',
  },
  confirmCancelText: {
    color: '#334155',
    fontWeight: '800',
  },
  confirmRemoveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#7c3aed',
  },
  confirmDeleteButton: {
    backgroundColor: '#dc2626',
  },
  confirmRemoveText: {
    color: 'white',
    fontWeight: '900',
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  cancelButtonText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
});
