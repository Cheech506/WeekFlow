import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import {
  createDefaultGoalDateRange,
  getGoalDateKey,
  validateGoalDateRange,
} from '@/lib/goalUtils';

function formatGoalDate(value: string) {
  const date = new Date(value);

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

/**
 * Calculates a whole-number percentage while safely handling
 * goals that do not have any linked tasks yet.
 */
function calculateProgressPercentage(
  completedCount: number,
  totalCount: number
) {
  if (totalCount === 0) {
    return 0;
  }

  return Math.round((completedCount / totalCount) * 100);
}

/**
 * React Native expects percentage widths in a specific format.
 * This helper also prevents values below 0 or above 100.
 */
function getProgressWidth(percentage: number): `${number}%` {
  const safePercentage = Math.min(
    100,
    Math.max(0, percentage)
  );

  return `${safePercentage}%`;
}

function getGoalDateFeedback(
  startDateKey: string,
  endDateKey: string
) {
  try {
    const range = validateGoalDateRange(
      startDateKey,
      endDateKey
    );

    return {
      error: null,
      recommendation: range.recommendation,
      durationDays: range.durationDays,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'The goal dates are invalid.',
      recommendation: null,
      durationDays: null,
    };
  }
}

export default function TwelveWeekGoalsScreen() {
  const { width } = useWindowDimensions();

  const isDesktop = width >= 1100;
  const isWideDesktop = width >= 1450;
  const goalColumnCount = isWideDesktop ? 3 : isDesktop ? 2 : 1;
  const goalGridGap = 14;
  const pageHorizontalPadding = 40;
  const availableGoalWidth = Math.max(
    width - pageHorizontalPadding,
    280
  );
  const goalCardWidth =
    goalColumnCount === 1
      ? availableGoalWidth
      : (availableGoalWidth -
          goalGridGap * (goalColumnCount - 1)) /
        goalColumnCount;

  const initialGoalDates = createDefaultGoalDateRange();
  const [goalText, setGoalText] = useState('');
  const [goalStartDate, setGoalStartDate] = useState(
    initialGoalDates.startDateKey
  );
  const [goalEndDate, setGoalEndDate] = useState(
    initialGoalDates.endDateKey
  );
  const [goalFormMessage, setGoalFormMessage] = useState('');
  const [editingGoalId, setEditingGoalId] = useState<
    number | null
  >(null);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editMessage, setEditMessage] = useState('');

  const {
    goals,
    isLoading,
    addGoal,
    editGoalDates,
    toggleGoal,
    deleteGoal,
  } = useGoals();

  const { tasks } = useTasks();

  const activeGoals = goals.filter((goal) => !goal.completed);
  const addGoalDateFeedback = getGoalDateFeedback(
    goalStartDate,
    goalEndDate
  );
  const editGoalDateFeedback = getGoalDateFeedback(
    editStartDate,
    editEndDate
  );

  const completedGoalCount = goals.filter(
    (goal) => goal.completed
  ).length;

  /*
   * These totals summarize every task that is connected to a goal.
   * Tasks without a goal are not included in goal progress.
   */
  const allLinkedTasks = tasks.filter(
    (task) => task.goalId !== null
  );

  const completedLinkedTaskCount = allLinkedTasks.filter(
    (task) => task.completed
  ).length;

  const activeLinkedTaskCount =
    allLinkedTasks.length - completedLinkedTaskCount;

  const overallTaskProgress = calculateProgressPercentage(
    completedLinkedTaskCount,
    allLinkedTasks.length
  );

  async function handleAddGoal() {
    if (!goalText.trim()) {
      setGoalFormMessage('Enter a goal title first.');
      return;
    }

    if (addGoalDateFeedback.error) {
      setGoalFormMessage(addGoalDateFeedback.error);
      return;
    }

    try {
      await addGoal(
        goalText,
        goalStartDate,
        goalEndDate
      );

      const nextDefaultDates = createDefaultGoalDateRange();

      setGoalText('');
      setGoalStartDate(nextDefaultDates.startDateKey);
      setGoalEndDate(nextDefaultDates.endDateKey);
      setGoalFormMessage('');
    } catch (error) {
      setGoalFormMessage(
        error instanceof Error
          ? error.message
          : 'The goal could not be added.'
      );
    }
  }

  function startEditingGoalDates(goalId: number) {
    const goal = goals.find((item) => item.id === goalId);
    if (!goal) return;

    setEditingGoalId(goalId);
    setEditStartDate(getGoalDateKey(goal.startDate));
    setEditEndDate(getGoalDateKey(goal.endDate));
    setEditMessage('');
  }

  function cancelEditingGoalDates() {
    setEditingGoalId(null);
    setEditStartDate('');
    setEditEndDate('');
    setEditMessage('');
  }

  async function handleSaveGoalDates(goalId: number) {
    if (editGoalDateFeedback.error) {
      setEditMessage(editGoalDateFeedback.error);
      return;
    }

    try {
      await editGoalDates(
        goalId,
        editStartDate,
        editEndDate
      );
      cancelEditingGoalDates();
    } catch (error) {
      setEditMessage(
        error instanceof Error
          ? error.message
          : 'The goal dates could not be updated.'
      );
    }
  }

  async function handleCompleteGoal(goalId: number) {
    if (editingGoalId === goalId) {
      cancelEditingGoalDates();
    }

    await toggleGoal(goalId);
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[
        styles.content,
        isDesktop && styles.contentDesktop,
      ]}
    >
      <View
        style={[
          styles.header,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
        <Text style={styles.title}>12 Week Goals</Text>

        <Text style={styles.subtitle}>
          Pick the bigger goals you want to make progress on
          over the next 3 months.
        </Text>
      </View>

      <View
        style={[
          styles.overviewCard,
          isDesktop && styles.overviewDesktop,
        ]}
      >
        <Text style={styles.overviewTitle}>
          12 Week Overview
        </Text>

        <Text style={styles.overviewSubtitle}>
          Your goal status and linked-task progress.
        </Text>

        <View style={styles.overviewStatsGrid}>
          <View style={styles.overviewStatBox}>
            <Text style={styles.overviewStatNumber}>
              {completedGoalCount}
            </Text>

            <Text style={styles.overviewStatLabel}>
              Goals Completed
            </Text>
          </View>

          <View style={styles.overviewStatBox}>
            <Text style={styles.overviewStatNumber}>
              {completedLinkedTaskCount}
            </Text>

            <Text style={styles.overviewStatLabel}>
              Linked Tasks Done
            </Text>
          </View>

          <View style={styles.overviewStatBox}>
            <Text style={styles.overviewStatNumber}>
              {activeLinkedTaskCount}
            </Text>

            <Text style={styles.overviewStatLabel}>
              Tasks Remaining
            </Text>
          </View>

          <View style={styles.overviewStatBox}>
            <Text style={styles.overviewStatNumber}>
              {overallTaskProgress}%
            </Text>

            <Text style={styles.overviewStatLabel}>
              Task Progress
            </Text>
          </View>
        </View>

        <View style={styles.overallProgressSection}>
          <View style={styles.progressHeaderRow}>
            <Text style={styles.progressLabel}>
              Overall linked-task progress
            </Text>

            <Text style={styles.progressPercentage}>
              {overallTaskProgress}%
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.overallProgressFill,
                {
                  width: getProgressWidth(
                    overallTaskProgress
                  ),
                },
              ]}
            />
          </View>

          <Text style={styles.progressExplanation}>
            {completedLinkedTaskCount} of {allLinkedTasks.length}{' '}
            linked tasks completed
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.addCard,
          isDesktop && styles.addCardDesktop,
        ]}
      >
        <TextInput
          style={styles.input}
          placeholder="Add a goal..."
          value={goalText}
          onChangeText={(value) => {
            setGoalText(value);
            setGoalFormMessage('');
          }}
          returnKeyType="next"
        />

        <View style={styles.dateInputRow}>
          <View style={styles.dateInputGroup}>
            <Text style={styles.dateInputLabel}>Start date</Text>
            <TextInput
              style={styles.dateInput}
              placeholder="YYYY-MM-DD"
              value={goalStartDate}
              onChangeText={(value) => {
                setGoalStartDate(value);
                setGoalFormMessage('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.dateInputGroup}>
            <Text style={styles.dateInputLabel}>End date</Text>
            <TextInput
              style={styles.dateInput}
              placeholder="YYYY-MM-DD"
              value={goalEndDate}
              onChangeText={(value) => {
                setGoalEndDate(value);
                setGoalFormMessage('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleAddGoal}
              returnKeyType="done"
            />
          </View>
        </View>

        {goalFormMessage || addGoalDateFeedback.error ? (
          <Text style={styles.dateErrorText}>
            {goalFormMessage || addGoalDateFeedback.error}
          </Text>
        ) : addGoalDateFeedback.recommendation ? (
          <Text style={styles.dateRecommendationText}>
            {addGoalDateFeedback.recommendation}
          </Text>
        ) : (
          <Text style={styles.dateSuccessText}>
            Recommended 12–13 week goal range.
          </Text>
        )}

        <Pressable
          style={styles.addButton}
          onPress={handleAddGoal}
        >
          <Text style={styles.addButtonText}>
            Add Goal
          </Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.goalList,
          isDesktop && styles.goalGrid,
          { gap: goalGridGap },
        ]}
      >
        {isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              Loading goals...
            </Text>
          </View>
        ) : activeGoals.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No active goals
            </Text>

            <Text style={styles.emptyText}>
              Add a goal or reopen a completed goal from History.
            </Text>
          </View>
        ) : (
          activeGoals.map((goal) => {
            /*
             * Goal progress is calculated from tasks linked
             * through the task's goalId field.
             */
            const linkedTasks = tasks.filter(
              (task) => task.goalId === goal.id
            );

            const completedLinkedTasks = linkedTasks.filter(
              (task) => task.completed
            ).length;

            const activeLinkedTasks =
              linkedTasks.length - completedLinkedTasks;

            const goalTaskProgress =
              calculateProgressPercentage(
                completedLinkedTasks,
                linkedTasks.length
              );

            return (
              <View
                key={goal.id}
                style={[
                  styles.goalCard,
                  isDesktop && { width: goalCardWidth },
                ]}
              >
                <View style={styles.goalHeaderRow}>
                  <View style={styles.goalMain}>
                    <Text style={styles.checkbox}>⬜</Text>

                    <View style={styles.goalTextWrap}>
                      <Text style={styles.goalTitle}>
                        {goal.title}
                      </Text>

                      <Text style={styles.goalMeta}>
                        {formatGoalDate(goal.startDate)} →{' '}
                        {formatGoalDate(goal.endDate)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.goalActions}>
                    <Pressable
                      style={styles.editButton}
                      onPress={() =>
                        startEditingGoalDates(goal.id)
                      }
                    >
                      <Text style={styles.editButtonText}>
                        Edit Dates
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.completeButton}
                      onPress={() =>
                        handleCompleteGoal(goal.id)
                      }
                    >
                      <Text style={styles.completeButtonText}>
                        Mark Complete
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.deleteButton}
                      onPress={() => deleteGoal(goal.id)}
                    >
                      <Text style={styles.deleteButtonText}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {editingGoalId === goal.id ? (
                  <View style={styles.editDatesCard}>
                    <Text style={styles.editDatesTitle}>
                      Edit Goal Dates
                    </Text>

                    <View style={styles.dateInputRow}>
                      <View style={styles.dateInputGroup}>
                        <Text style={styles.dateInputLabel}>
                          Start date
                        </Text>
                        <TextInput
                          style={styles.dateInput}
                          value={editStartDate}
                          onChangeText={(value) => {
                            setEditStartDate(value);
                            setEditMessage('');
                          }}
                          placeholder="YYYY-MM-DD"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>

                      <View style={styles.dateInputGroup}>
                        <Text style={styles.dateInputLabel}>
                          End date
                        </Text>
                        <TextInput
                          style={styles.dateInput}
                          value={editEndDate}
                          onChangeText={(value) => {
                            setEditEndDate(value);
                            setEditMessage('');
                          }}
                          placeholder="YYYY-MM-DD"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                    </View>

                    {editMessage || editGoalDateFeedback.error ? (
                      <Text style={styles.dateErrorText}>
                        {editMessage || editGoalDateFeedback.error}
                      </Text>
                    ) : editGoalDateFeedback.recommendation ? (
                      <Text style={styles.dateRecommendationText}>
                        {editGoalDateFeedback.recommendation}
                      </Text>
                    ) : (
                      <Text style={styles.dateSuccessText}>
                        Recommended 12–13 week goal range.
                      </Text>
                    )}

                    <View style={styles.editDatesActions}>
                      <Pressable
                        style={styles.cancelButton}
                        onPress={cancelEditingGoalDates}
                      >
                        <Text style={styles.cancelButtonText}>
                          Cancel
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.saveDatesButton}
                        onPress={() =>
                          handleSaveGoalDates(goal.id)
                        }
                      >
                        <Text style={styles.saveDatesButtonText}>
                          Save Dates
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                <View style={styles.goalProgressSection}>
                  <View style={styles.progressHeaderRow}>
                    <Text style={styles.goalProgressTitle}>
                      Linked Task Progress
                    </Text>

                    <Text style={styles.goalProgressPercentage}>
                      {goalTaskProgress}%
                    </Text>
                  </View>

                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.goalProgressFill,
                        {
                          width: getProgressWidth(
                            goalTaskProgress
                          ),
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.goalStatsRow}>
                    <View style={styles.goalStat}>
                      <Text style={styles.goalStatNumber}>
                        {completedLinkedTasks}
                      </Text>

                      <Text style={styles.goalStatLabel}>
                        Done
                      </Text>
                    </View>

                    <View style={styles.goalStat}>
                      <Text style={styles.goalStatNumber}>
                        {activeLinkedTasks}
                      </Text>

                      <Text style={styles.goalStatLabel}>
                        Remaining
                      </Text>
                    </View>

                    <View style={styles.goalStat}>
                      <Text style={styles.goalStatNumber}>
                        {linkedTasks.length}
                      </Text>

                      <Text style={styles.goalStatLabel}>
                        Total
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.goalProgressNote}>
                    The goal checkbox is controlled manually.
                    Task progress is calculated from linked tasks.
                  </Text>
                </View>

                <View style={styles.linkedTasksSection}>
                  <Text style={styles.linkedTasksTitle}>
                    Linked Tasks ({completedLinkedTasks} of{' '}
                    {linkedTasks.length} done)
                  </Text>

                  {linkedTasks.length === 0 ? (
                    <View style={styles.noLinkedTasksCard}>
                      <Text style={styles.noLinkedTasksText}>
                        No tasks are linked to this goal yet.
                        Create or edit a task in Inbox to link it.
                      </Text>
                    </View>
                  ) : (
                    linkedTasks.map((task) => (
                      <View
                        key={task.id}
                        style={styles.linkedTaskCard}
                      >
                        <View style={styles.linkedTaskTopRow}>
                          <Text
                            style={[
                              styles.linkedTaskTitle,
                              task.completed &&
                                styles.linkedTaskCompleted,
                            ]}
                          >
                            {task.completed ? '✅' : '⬜'}{' '}
                            {task.title}
                          </Text>

                          <Text style={styles.linkedTaskBadge}>
                            {task.completed
                              ? 'Done'
                              : task.day}
                          </Text>
                        </View>

                        <Text style={styles.linkedTaskMeta}>
                          Priority:{' '}
                          {getPriorityLabel(task.priority)}
                        </Text>

                        {task.notes ? (
                          <Text style={styles.linkedTaskNotes}>
                            {task.notes}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  contentDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: 16,
  },
  fullWidthPanel: { width: '100%' },
  overviewDesktop: {
    width: '66%',
    alignSelf: 'stretch',
  },
  addCardDesktop: {
    width: '32%',
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    lineHeight: 22,
  },
  overviewCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#eef6ff',
    marginBottom: 18,
  },
  overviewTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  overviewSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
  },
  overviewStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  overviewStatBox: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 135,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'white',
  },
  overviewStatNumber: {
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
  },
  overviewStatLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  overallProgressSection: {
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'transparent',
  },
  progressLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
  },
  progressPercentage: {
    fontSize: 14,
    fontWeight: '900',
    color: '#2563eb',
  },
  progressTrack: {
    height: 12,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    overflow: 'hidden',
  },
  overallProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  progressExplanation: {
    marginTop: 7,
    fontSize: 12,
    color: '#6b7280',
  },
  addCard: {
    gap: 10,
    marginBottom: 24,
  },
  dateInputRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  dateInputGroup: {
    flex: 1,
    minWidth: 140,
    backgroundColor: 'transparent',
  },
  dateInputLabel: {
    marginBottom: 5,
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    backgroundColor: 'white',
  },
  dateErrorText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#b91c1c',
  },
  dateRecommendationText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#9a3412',
  },
  dateSuccessText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#166534',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: 'white',
  },
  addButton: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  goalList: {
    gap: 12,
    width: '100%',
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  goalCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    gap: 14,
  },
  goalHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    gap: 12,
  },
  goalMain: {
    flex: 1,
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  checkbox: {
    fontSize: 24,
    marginRight: 12,
  },
  goalTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  goalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    backgroundColor: 'transparent',
  },
  goalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  goalCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  goalMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
  },
  editDatesCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
    gap: 10,
  },
  editDatesTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  editDatesActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    backgroundColor: 'transparent',
  },
  editButton: {
    backgroundColor: '#e0e7ff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  editButtonText: {
    color: '#3730a3',
    fontWeight: '800',
  },
  completeButton: {
    backgroundColor: '#15803d',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  completeButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  cancelButton: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  cancelButtonText: {
    color: '#374151',
    fontWeight: '800',
  },
  saveDatesButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  saveDatesButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  goalProgressSection: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f3ff',
  },
  goalProgressTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  goalProgressPercentage: {
    fontSize: 15,
    fontWeight: '900',
    color: '#7c3aed',
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#7c3aed',
  },
  goalStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  goalStat: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  goalStatNumber: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  goalStatLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
  },
  goalProgressNote: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
    color: '#6b7280',
  },
  linkedTasksSection: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
    backgroundColor: 'transparent',
  },
  linkedTasksTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  linkedTaskCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  linkedTaskTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'transparent',
  },
  linkedTaskTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  linkedTaskCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  linkedTaskBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
    backgroundColor: '#dbeafe',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  linkedTaskMeta: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b7280',
  },
  linkedTaskNotes: {
    marginTop: 6,
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  noLinkedTasksCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  noLinkedTasksText: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  deleteButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  deleteButtonText: {
    color: 'white',
    fontWeight: '700',
  },
  emptyCard: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
    color: '#111827',
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
  },
});