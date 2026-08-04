import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
} from 'react-native';

import CycleIdentityFields from '@/components/CycleIdentityFields';
import GoalAnalyticsCard from '@/components/GoalAnalyticsCard';
import GoalCompletionPanel from '@/components/GoalCompletionPanel';
import GoalMilestoneManager from '@/components/GoalMilestoneManager';
import PastCycleFolder from '@/components/PastCycleFolder';
import { Text, View } from '@/components/Themed';
import { useCycle } from '@/context/CycleContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import {
  createDefaultGoalDateRange,
  getGoalDateKey,
  validateGoalDateRange,
} from '@/lib/goalUtils';
import {
  MAX_GOAL_NOTES_LENGTH,
  MAX_GOAL_PURPOSE_LENGTH,
  MAX_GOAL_SUCCESS_DEFINITION_LENGTH,
} from '@/lib/goalPlanningUtils';
import { MAX_GOAL_REWARD_LENGTH } from '@/lib/goalRewardUtils';
import {
  calculateGoalAnalytics,
  type GoalCompletionReflection,
} from '@/lib/goalReviewUtils';
import {
  formatDateKey,
  getLocalDateKey,
} from '@/lib/dateUtils';
import {
  getPlanningCycleDisplayName,
} from '@/lib/cycleIdentityUtils';
import {
  createPlanningCycleRange,
  getNextPlanningCycleStartDate,
  getPlanningCycleProgress,
  getTimestampDateKey,
  isDateKeyWithinCycle,
} from '@/lib/cycleUtils';

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
  const [showGoalPlanningFields, setShowGoalPlanningFields] = useState(false);
  const [goalPurpose, setGoalPurpose] = useState('');
  const [goalSuccessDefinition, setGoalSuccessDefinition] = useState('');
  const [goalNotes, setGoalNotes] = useState('');
  const [goalReward, setGoalReward] = useState('');
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
  const [editGoalTitle, setEditGoalTitle] = useState('');
  const [editGoalPurpose, setEditGoalPurpose] = useState('');
  const [editGoalSuccessDefinition, setEditGoalSuccessDefinition] = useState('');
  const [editGoalNotes, setEditGoalNotes] = useState('');
  const [editGoalReward, setEditGoalReward] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [completingGoalId, setCompletingGoalId] = useState<
    number | null
  >(null);

  const [cycleStartDate, setCycleStartDate] = useState(
    getLocalDateKey(new Date())
  );
  const [cycleName, setCycleName] = useState('');
  const [cyclePrimaryFocus, setCyclePrimaryFocus] = useState('');
  const [cycleTheme, setCycleTheme] = useState('');
  const [cycleMessage, setCycleMessage] = useState('');
  const [isEditingCycle, setIsEditingCycle] = useState(false);

  /*
   * Each goal keeps its own local expanded/collapsed state.
   * This is intentionally UI-only state, so opening the linked-task
   * list never writes to SQLite or changes the goal itself.
   */
  const [expandedLinkedTaskGoals, setExpandedLinkedTaskGoals] =
    useState<Record<number, boolean>>({});

  const {
    cycles,
    currentCycle,
    isLoading: isCycleLoading,
    startCycle,
    editCurrentCycle,
  } = useCycle();

  const {
    goals,
    milestones,
    isLoading,
    addGoal,
    editGoal,
    completeGoal,
    deleteGoal,
    refreshGoals,
  } = useGoals();

  const { tasks } = useTasks();

  const cycleProgress = currentCycle
    ? getPlanningCycleProgress(
        currentCycle.startDate,
        currentCycle.endDate
      )
    : null;

  let cycleRangePreview: {
    startDate: string;
    endDate: string;
  } | null = null;
  let cycleDateError = '';

  try {
    cycleRangePreview = createPlanningCycleRange(
      cycleStartDate
    );
  } catch (error) {
    cycleDateError =
      error instanceof Error
        ? error.message
        : 'The cycle start date is invalid.';
  }

  useEffect(() => {
    if (!currentCycle || !cycleProgress) return;

    const suggestedStart =
      cycleProgress.state === 'complete'
        ? getNextPlanningCycleStartDate(
            currentCycle.endDate
          )
        : currentCycle.startDate;

    setCycleStartDate(suggestedStart);

    if (cycleProgress.state === 'complete') {
      setCycleName('');
      setCyclePrimaryFocus('');
      setCycleTheme('');
    } else {
      setCycleName(currentCycle.name ?? '');
      setCyclePrimaryFocus(currentCycle.primaryFocus ?? '');
      setCycleTheme(currentCycle.theme ?? '');
    }

    setCycleMessage('');
    setIsEditingCycle(false);
  }, [
    currentCycle?.id,
    currentCycle?.startDate,
    currentCycle?.endDate,
    currentCycle?.name,
    currentCycle?.primaryFocus,
    currentCycle?.theme,
    cycleProgress?.state,
  ]);

  const activeGoals = goals.filter((goal) => !goal.completed);
  const addGoalDateFeedback = getGoalDateFeedback(
    goalStartDate,
    goalEndDate
  );
  const editGoalDateFeedback = getGoalDateFeedback(
    editStartDate,
    editEndDate
  );

  const cycleGoals = currentCycle
    ? goals.filter((goal) => goal.cycleId === currentCycle.id)
    : [];
  const activeGoalsForDisplay = currentCycle
    ? activeGoals.filter((goal) => goal.cycleId === currentCycle.id)
    : activeGoals.filter((goal) => goal.cycleId === null);
  const chronologicalCycles = [...cycles].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );
  const historicalCycles = cycles.filter((cycle) => !cycle.active);
  const currentCycleNumber = currentCycle
    ? Math.max(
        1,
        chronologicalCycles.findIndex(
          (cycle) => cycle.id === currentCycle.id
        ) + 1
      )
    : cycles.length + 1;
  const currentCycleLabel = currentCycle
    ? getPlanningCycleDisplayName(
        currentCycle.name,
        currentCycleNumber
      )
    : '';

  const completedGoalsThisCycle = currentCycle
    ? goals.filter(
        (goal) =>
          goal.cycleId === currentCycle.id && goal.completed
      ).length
    : 0;

  const completedTasksThisCycle = currentCycle
    ? tasks.filter((task) =>
        isDateKeyWithinCycle(
          getTimestampDateKey(task.completedAt),
          currentCycle.startDate,
          currentCycle.endDate
        )
      ).length
    : 0;

  const activeCycleGoalCount = cycleGoals.filter(
    (goal) => !goal.completed
  ).length;

  const cycleGoalIds = new Set(
    cycleGoals.map((goal) => goal.id)
  );

  /*
   * Goal progress inside the cycle only includes tasks linked to goals
   * that belong to the current planning cycle. This keeps the goal-progress
   * percentage separate from the broader count of every task completed
   * during the cycle.
   */
  const cycleLinkedTasks = currentCycle
    ? tasks.filter(
        (task) =>
          task.goalId !== null &&
          cycleGoalIds.has(task.goalId)
      )
    : [];

  const completedCycleLinkedTaskCount = cycleLinkedTasks.filter(
    (task) => task.completed
  ).length;

  const activeCycleLinkedTaskCount =
    cycleLinkedTasks.length - completedCycleLinkedTaskCount;

  const cycleLinkedTaskProgress = calculateProgressPercentage(
    completedCycleLinkedTaskCount,
    cycleLinkedTasks.length
  );

  const unfinishedCycleTaskCount = currentCycle
    ? tasks.filter((task) => {
        if (task.completed) return false;

        const isLinkedToCycleGoal =
          task.goalId !== null &&
          cycleGoalIds.has(task.goalId);
        const isDueInsideCycle = isDateKeyWithinCycle(
          task.dueDate,
          currentCycle.startDate,
          currentCycle.endDate
        );

        return isLinkedToCycleGoal || isDueInsideCycle;
      }).length
    : 0;

  const cycleStatusLabel = !cycleProgress
    ? ''
    : cycleProgress.state === 'upcoming'
      ? `Starts in ${cycleProgress.daysUntilStart} days`
      : cycleProgress.state === 'complete'
        ? 'Cycle Complete'
        : `Week ${cycleProgress.weekNumber} of 12`;

  async function handleStartPlanningCycle() {
    if (cycleDateError || !cycleRangePreview) {
      setCycleMessage(
        cycleDateError ||
          'Enter a valid cycle start date.'
      );
      return;
    }

    try {
      await startCycle(cycleStartDate, {
        name: cycleName,
        primaryFocus: cyclePrimaryFocus,
        theme: cycleTheme,
      });

      /*
       * Starting the first cycle can claim legacy goals that were created
       * before cycle folders existed. Refresh goal state immediately so those
       * goals appear in the new folder without requiring an app restart.
       */
      await refreshGoals();
      setCycleMessage('');
      setIsEditingCycle(false);
    } catch (error) {
      setCycleMessage(
        error instanceof Error
          ? error.message
          : 'The planning cycle could not be started.'
      );
    }
  }

  function beginEditingCycle() {
    if (!currentCycle) return;

    setCycleStartDate(currentCycle.startDate);
    setCycleName(currentCycle.name ?? '');
    setCyclePrimaryFocus(currentCycle.primaryFocus ?? '');
    setCycleTheme(currentCycle.theme ?? '');
    setCycleMessage('');
    setIsEditingCycle(true);
  }

  function cancelEditingCycle() {
    if (currentCycle) {
      setCycleStartDate(currentCycle.startDate);
      setCycleName(currentCycle.name ?? '');
      setCyclePrimaryFocus(currentCycle.primaryFocus ?? '');
      setCycleTheme(currentCycle.theme ?? '');
    }

    setCycleMessage('');
    setIsEditingCycle(false);
  }

  async function handleSaveCycle() {
    if (cycleDateError || !cycleRangePreview) {
      setCycleMessage(
        cycleDateError ||
          'Enter a valid cycle start date.'
      );
      return;
    }

    try {
      await editCurrentCycle(cycleStartDate, {
        name: cycleName,
        primaryFocus: cyclePrimaryFocus,
        theme: cycleTheme,
      });
      setCycleMessage('');
      setIsEditingCycle(false);
    } catch (error) {
      setCycleMessage(
        error instanceof Error
          ? error.message
          : 'The planning cycle could not be updated.'
      );
    }
  }

  function toggleLinkedTasks(goalId: number) {
    setExpandedLinkedTaskGoals((current) => ({
      ...current,
      [goalId]: !current[goalId],
    }));
  }

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
        goalEndDate,
        goalReward,
        {
          purpose: goalPurpose,
          successDefinition: goalSuccessDefinition,
          notes: goalNotes,
        },
        currentCycle?.id ?? null
      );

      const nextDefaultDates = createDefaultGoalDateRange();

      setGoalText('');
      setGoalPurpose('');
      setGoalSuccessDefinition('');
      setGoalNotes('');
      setShowGoalPlanningFields(false);
      setGoalReward('');
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

  function startEditingGoal(goalId: number) {
    const goal = goals.find((item) => item.id === goalId);
    if (!goal) return;

    setEditingGoalId(goalId);
    setEditGoalTitle(goal.title);
    setEditGoalPurpose(goal.purpose ?? '');
    setEditGoalSuccessDefinition(goal.successDefinition ?? '');
    setEditGoalNotes(goal.notes ?? '');
    setEditGoalReward(goal.reward ?? '');
    setEditStartDate(getGoalDateKey(goal.startDate));
    setEditEndDate(getGoalDateKey(goal.endDate));
    setEditMessage('');
  }

  function cancelEditingGoal() {
    setEditingGoalId(null);
    setEditGoalTitle('');
    setEditGoalPurpose('');
    setEditGoalSuccessDefinition('');
    setEditGoalNotes('');
    setEditGoalReward('');
    setEditStartDate('');
    setEditEndDate('');
    setEditMessage('');
  }

  async function handleSaveGoal(goalId: number) {
    if (!editGoalTitle.trim()) {
      setEditMessage('Enter a goal title first.');
      return;
    }

    if (editGoalDateFeedback.error) {
      setEditMessage(editGoalDateFeedback.error);
      return;
    }

    try {
      await editGoal(
        goalId,
        editGoalTitle,
        editStartDate,
        editEndDate,
        editGoalReward,
        {
          purpose: editGoalPurpose,
          successDefinition: editGoalSuccessDefinition,
          notes: editGoalNotes,
        }
      );
      cancelEditingGoal();
    } catch (error) {
      setEditMessage(
        error instanceof Error
          ? error.message
          : 'The goal could not be updated.'
      );
    }
  }

  function handleCompleteGoal(goalId: number) {
    if (editingGoalId === goalId) {
      cancelEditingGoal();
    }

    setCompletingGoalId((current) =>
      current === goalId ? null : goalId
    );
  }

  async function handleConfirmGoalCompletion(
    goalId: number,
    reflection: GoalCompletionReflection
  ) {
    await completeGoal(goalId, reflection);
    setCompletingGoalId(null);
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
          styles.cycleCard,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
        {isCycleLoading ? (
          <Text style={styles.cycleLoadingText}>
            Loading your 12-week cycle...
          </Text>
        ) : !currentCycle || !cycleProgress ? (
          <>
            <Text style={styles.cycleTitle}>
              Start Your 12-Week Cycle
            </Text>

            <Text style={styles.cycleSubtitle}>
              Name the 12-week folder, describe its focus, and choose the
              first day. The name, focus, and theme are all optional.
            </Text>

            <CycleIdentityFields
              name={cycleName}
              primaryFocus={cyclePrimaryFocus}
              theme={cycleTheme}
              onNameChange={(value) => {
                setCycleName(value);
                setCycleMessage('');
              }}
              onPrimaryFocusChange={(value) => {
                setCyclePrimaryFocus(value);
                setCycleMessage('');
              }}
              onThemeChange={(value) => {
                setCycleTheme(value);
                setCycleMessage('');
              }}
            />

            <View style={styles.cycleForm}>
              <View style={styles.cycleDateField}>
                <Text style={styles.dateInputLabel}>
                  Cycle start date
                </Text>
                <TextInput
                  style={styles.dateInput}
                  value={cycleStartDate}
                  onChangeText={(value) => {
                    setCycleStartDate(value);
                    setCycleMessage('');
                  }}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.cycleDatePreview}>
                <Text style={styles.cycleDatePreviewLabel}>
                  Calculated end date
                </Text>
                <Text style={styles.cycleDatePreviewValue}>
                  {cycleRangePreview
                    ? formatDateKey(cycleRangePreview.endDate)
                    : 'Enter a valid start date'}
                </Text>
              </View>
            </View>

            {cycleMessage || cycleDateError ? (
              <Text style={styles.dateErrorText}>
                {cycleMessage || cycleDateError}
              </Text>
            ) : (
              <Text style={styles.cycleHelpText}>
                The cycle end date is fixed automatically at twelve
                full weeks.
              </Text>
            )}

            <Pressable
              style={styles.startCycleButton}
              onPress={handleStartPlanningCycle}
            >
              <Text style={styles.startCycleButtonText}>
                Start 12-Week Cycle
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.cycleHeaderRow}>
              <View style={styles.cycleHeaderText}>
                <Text style={styles.cycleTitle}>
                  {currentCycleLabel}
                </Text>

                <Text style={styles.cycleSubtitle}>
                  12-Week Cycle {currentCycleNumber} •{' '}
                  {formatDateKey(currentCycle.startDate)} →{' '}
                  {formatDateKey(currentCycle.endDate)}
                </Text>
              </View>

              <View
                style={[
                  styles.cycleStatusBadge,
                  cycleProgress.state === 'complete' &&
                    styles.cycleStatusComplete,
                  cycleProgress.state === 'upcoming' &&
                    styles.cycleStatusUpcoming,
                ]}
              >
                <Text style={styles.cycleStatusText}>
                  {cycleStatusLabel}
                </Text>
              </View>
            </View>

            {currentCycle.primaryFocus || currentCycle.theme ? (
              <View style={styles.cycleIdentitySummary}>
                {currentCycle.primaryFocus ? (
                  <View style={styles.cycleIdentitySection}>
                    <Text style={styles.cycleIdentityLabel}>
                      Primary Focus
                    </Text>
                    <Text style={styles.cycleIdentityText}>
                      {currentCycle.primaryFocus}
                    </Text>
                  </View>
                ) : null}

                {currentCycle.theme ? (
                  <View style={styles.cycleIdentitySection}>
                    <Text style={styles.cycleIdentityLabel}>Theme</Text>
                    <Text style={styles.cycleIdentityText}>
                      {currentCycle.theme}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.cycleProgressHeader}>
              <Text style={styles.cycleProgressLabel}>
                Calendar progress
              </Text>
              <Text style={styles.cycleProgressValue}>
                {cycleProgress.progressPercentage}%
              </Text>
            </View>

            <View style={styles.cycleProgressTrack}>
              <View
                style={[
                  styles.cycleProgressFill,
                  {
                    width: getProgressWidth(
                      cycleProgress.progressPercentage
                    ),
                  },
                ]}
              />
            </View>

            <View style={styles.cycleStatsGrid}>
              <View style={styles.cycleStatBox}>
                <Text style={styles.cycleStatNumber}>
                  {cycleProgress.state === 'upcoming'
                    ? cycleProgress.daysUntilStart
                    : cycleProgress.daysRemaining}
                </Text>
                <Text style={styles.cycleStatLabel}>
                  {cycleProgress.state === 'upcoming'
                    ? 'Days Until Start'
                    : 'Days Remaining'}
                </Text>
              </View>

              <View style={styles.cycleStatBox}>
                <Text style={styles.cycleStatNumber}>
                  {activeCycleGoalCount}
                </Text>
                <Text style={styles.cycleStatLabel}>
                  Active Goals
                </Text>
              </View>

              <View style={styles.cycleStatBox}>
                <Text style={styles.cycleStatNumber}>
                  {completedGoalsThisCycle}
                </Text>
                <Text style={styles.cycleStatLabel}>
                  Goals Finished
                </Text>
              </View>

              <View style={styles.cycleStatBox}>
                <Text style={styles.cycleStatNumber}>
                  {completedTasksThisCycle}
                </Text>
                <Text style={styles.cycleStatLabel}>
                  Tasks Finished
                </Text>
              </View>
            </View>

            <View style={styles.cycleGoalProgressCard}>
              <View style={styles.cycleGoalProgressHeader}>
                <Text style={styles.cycleGoalProgressTitle}>
                  Goal progress in this cycle
                </Text>
                <Text style={styles.cycleGoalProgressSubtitle}>
                  Tasks linked to goals stored in this planning cycle.
                </Text>
              </View>

              <View style={styles.cycleGoalStatsGrid}>
                <View style={styles.cycleGoalStatBox}>
                  <Text style={styles.cycleGoalStatNumber}>
                    {completedGoalsThisCycle}
                  </Text>
                  <Text style={styles.cycleGoalStatLabel}>
                    Goals Completed
                  </Text>
                </View>

                <View style={styles.cycleGoalStatBox}>
                  <Text style={styles.cycleGoalStatNumber}>
                    {completedCycleLinkedTaskCount}
                  </Text>
                  <Text style={styles.cycleGoalStatLabel}>
                    Linked Tasks Done
                  </Text>
                </View>

                <View style={styles.cycleGoalStatBox}>
                  <Text style={styles.cycleGoalStatNumber}>
                    {activeCycleLinkedTaskCount}
                  </Text>
                  <Text style={styles.cycleGoalStatLabel}>
                    Tasks Remaining
                  </Text>
                </View>

                <View style={styles.cycleGoalStatBox}>
                  <Text style={styles.cycleGoalStatNumber}>
                    {cycleLinkedTaskProgress}%
                  </Text>
                  <Text style={styles.cycleGoalStatLabel}>
                    Task Progress
                  </Text>
                </View>
              </View>

              <View style={styles.cycleLinkedProgressHeader}>
                <Text style={styles.cycleLinkedProgressLabel}>
                  Overall linked-task progress
                </Text>
                <Text style={styles.progressPercentage}>
                  {cycleLinkedTaskProgress}%
                </Text>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.overallProgressFill,
                    {
                      width: getProgressWidth(
                        cycleLinkedTaskProgress
                      ),
                    },
                  ]}
                />
              </View>

              <Text style={styles.cycleLinkedProgressSummary}>
                {completedCycleLinkedTaskCount} of {cycleLinkedTasks.length}{' '}
                linked tasks completed
              </Text>
            </View>

            <Text style={styles.cycleSummaryText}>
              {cycleGoals.length} goals belong to this cycle and{' '}
              {unfinishedCycleTaskCount} tracked tasks remain unfinished.
              Total task completions count everything finished during the
              cycle; goal progress only counts tasks linked to this cycle's goals.
            </Text>

            {cycleProgress.state === 'complete' ? (
              <View style={styles.cycleCompletionCard}>
                <Text style={styles.cycleCompletionTitle}>
                  Cycle complete 🎉
                </Text>
                <Text style={styles.cycleCompletionText}>
                  You finished {completedGoalsThisCycle} goals and{' '}
                  {completedTasksThisCycle} tasks during this cycle.
                  Your {activeCycleGoalCount} active goals and{' '}
                  {unfinishedCycleTaskCount} unfinished tasks stay in
                  WeekFlow automatically, so you can carry them forward or
                  clean them up before starting again.
                </Text>

                <CycleIdentityFields
                  name={cycleName}
                  primaryFocus={cyclePrimaryFocus}
                  theme={cycleTheme}
                  onNameChange={(value) => {
                    setCycleName(value);
                    setCycleMessage('');
                  }}
                  onPrimaryFocusChange={(value) => {
                    setCyclePrimaryFocus(value);
                    setCycleMessage('');
                  }}
                  onThemeChange={(value) => {
                    setCycleTheme(value);
                    setCycleMessage('');
                  }}
                />

                <View style={styles.cycleForm}>
                  <View style={styles.cycleDateField}>
                    <Text style={styles.dateInputLabel}>
                      Next cycle start date
                    </Text>
                    <TextInput
                      style={styles.dateInput}
                      value={cycleStartDate}
                      onChangeText={(value) => {
                        setCycleStartDate(value);
                        setCycleMessage('');
                      }}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.cycleDatePreview}>
                    <Text style={styles.cycleDatePreviewLabel}>
                      Next cycle ends
                    </Text>
                    <Text style={styles.cycleDatePreviewValue}>
                      {cycleRangePreview
                        ? formatDateKey(cycleRangePreview.endDate)
                        : 'Enter a valid start date'}
                    </Text>
                  </View>
                </View>

                {cycleMessage || cycleDateError ? (
                  <Text style={styles.dateErrorText}>
                    {cycleMessage || cycleDateError}
                  </Text>
                ) : null}

                <Pressable
                  style={styles.startCycleButton}
                  onPress={handleStartPlanningCycle}
                >
                  <Text style={styles.startCycleButtonText}>
                    Start Next 12-Week Cycle
                  </Text>
                </Pressable>
              </View>
            ) : isEditingCycle ? (
              <View style={styles.cycleEditCard}>
                <Text style={styles.cycleEditTitle}>
                  Edit Current Cycle
                </Text>

                <CycleIdentityFields
                  name={cycleName}
                  primaryFocus={cyclePrimaryFocus}
                  theme={cycleTheme}
                  onNameChange={(value) => {
                    setCycleName(value);
                    setCycleMessage('');
                  }}
                  onPrimaryFocusChange={(value) => {
                    setCyclePrimaryFocus(value);
                    setCycleMessage('');
                  }}
                  onThemeChange={(value) => {
                    setCycleTheme(value);
                    setCycleMessage('');
                  }}
                />

                <View style={styles.cycleForm}>
                  <View style={styles.cycleDateField}>
                    <Text style={styles.dateInputLabel}>
                      Cycle start date
                    </Text>
                    <TextInput
                      style={styles.dateInput}
                      value={cycleStartDate}
                      onChangeText={(value) => {
                        setCycleStartDate(value);
                        setCycleMessage('');
                      }}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.cycleDatePreview}>
                    <Text style={styles.cycleDatePreviewLabel}>
                      New end date
                    </Text>
                    <Text style={styles.cycleDatePreviewValue}>
                      {cycleRangePreview
                        ? formatDateKey(cycleRangePreview.endDate)
                        : 'Enter a valid start date'}
                    </Text>
                  </View>
                </View>

                {cycleMessage || cycleDateError ? (
                  <Text style={styles.dateErrorText}>
                    {cycleMessage || cycleDateError}
                  </Text>
                ) : null}

                <View style={styles.cycleEditActions}>
                  <Pressable
                    style={styles.cancelButton}
                    onPress={cancelEditingCycle}
                  >
                    <Text style={styles.cancelButtonText}>
                      Cancel
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.saveCycleButton}
                    onPress={handleSaveCycle}
                  >
                    <Text style={styles.saveCycleButtonText}>
                      Save Cycle
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={styles.editCycleButton}
                onPress={beginEditingCycle}
              >
                <Text style={styles.editCycleButtonText}>
                  Edit Cycle
                </Text>
              </Pressable>
            )}
          </>
        )}
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

        <View style={styles.optionalPlanningSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showGoalPlanningFields }}
            style={styles.optionalPlanningToggle}
            onPress={() =>
              setShowGoalPlanningFields((current) => !current)
            }
          >
            <View style={styles.optionalPlanningToggleText}>
              <Text style={styles.optionalPlanningTitle}>
                Planning Details
              </Text>
              <Text style={styles.optionalPlanningSubtitle}>
                Optional purpose, success definition, and notes
              </Text>
            </View>
            <Text style={styles.optionalPlanningAction}>
              {showGoalPlanningFields ? 'Hide' : 'Add'}
            </Text>
          </Pressable>

          {showGoalPlanningFields ? (
            <View style={styles.optionalPlanningFields}>
              <View style={styles.planningInputGroup}>
                <Text style={styles.dateInputLabel}>Purpose</Text>
                <TextInput
                  style={styles.planningInput}
                  placeholder="Why does this goal matter?"
                  value={goalPurpose}
                  onChangeText={(value) => {
                    setGoalPurpose(value);
                    setGoalFormMessage('');
                  }}
                  multiline
                  maxLength={MAX_GOAL_PURPOSE_LENGTH}
                />
              </View>

              <View style={styles.planningInputGroup}>
                <Text style={styles.dateInputLabel}>Success definition</Text>
                <TextInput
                  style={styles.planningInput}
                  placeholder="What specifically counts as completing this goal?"
                  value={goalSuccessDefinition}
                  onChangeText={(value) => {
                    setGoalSuccessDefinition(value);
                    setGoalFormMessage('');
                  }}
                  multiline
                  maxLength={MAX_GOAL_SUCCESS_DEFINITION_LENGTH}
                />
              </View>

              <View style={styles.planningInputGroup}>
                <Text style={styles.dateInputLabel}>Goal notes</Text>
                <TextInput
                  style={styles.goalNotesInput}
                  placeholder="Plans, links, ideas, or other useful details..."
                  value={goalNotes}
                  onChangeText={(value) => {
                    setGoalNotes(value);
                    setGoalFormMessage('');
                  }}
                  multiline
                  maxLength={MAX_GOAL_NOTES_LENGTH}
                />
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.rewardInputGroup}>
          <Text style={styles.dateInputLabel}>Optional reward</Text>
          <TextInput
            style={styles.rewardInput}
            placeholder="Example: Buy a new game"
            value={goalReward}
            onChangeText={(value) => {
              setGoalReward(value);
              setGoalFormMessage('');
            }}
            multiline
            maxLength={MAX_GOAL_REWARD_LENGTH}
          />
          <Text style={styles.rewardHelpText}>
            A personal reward for finishing this goal. Leave it blank if you do
            not want one.
          </Text>
        </View>

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

      <View style={styles.goalFolderHeader}>
        <Text style={styles.goalFolderTitle}>
          {currentCycle
            ? `Goals in ${currentCycleLabel}`
            : 'Goals Waiting for a Cycle'}
        </Text>
        <Text style={styles.goalFolderSubtitle}>
          {currentCycle
            ? 'New goals are stored inside the current 12-week cycle folder.'
            : 'These goals are not assigned yet. Starting your first cycle will place active goals into that folder automatically.'}
        </Text>
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
        ) : activeGoalsForDisplay.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No active goals
            </Text>

            <Text style={styles.emptyText}>
              Add a goal or reopen a completed goal from History.
            </Text>
          </View>
        ) : (
          activeGoalsForDisplay.map((goal) => {
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
            const goalMilestones = milestones.filter(
              (milestone) => milestone.goalId === goal.id
            );
            const goalAnalytics = calculateGoalAnalytics(
              goal,
              linkedTasks,
              goalMilestones
            );

            const areLinkedTasksExpanded =
              expandedLinkedTaskGoals[goal.id] ?? false;

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
                        startEditingGoal(goal.id)
                      }
                    >
                      <Text style={styles.editButtonText}>
                        Edit Goal
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

                {goal.reward ? (
                  <View style={styles.rewardCard}>
                    <Text style={styles.rewardLabel}>🎁 Goal Reward</Text>
                    <Text style={styles.rewardText}>{goal.reward}</Text>
                  </View>
                ) : null}

                {goal.purpose || goal.successDefinition || goal.notes ? (
                  <View style={styles.goalPlanningCard}>
                    {goal.purpose ? (
                      <View style={styles.goalPlanningSection}>
                        <Text style={styles.goalPlanningLabel}>Purpose</Text>
                        <Text style={styles.goalPlanningText}>{goal.purpose}</Text>
                      </View>
                    ) : null}

                    {goal.successDefinition ? (
                      <View style={styles.goalPlanningSection}>
                        <Text style={styles.goalPlanningLabel}>
                          Success Definition
                        </Text>
                        <Text style={styles.goalPlanningText}>
                          {goal.successDefinition}
                        </Text>
                      </View>
                    ) : null}

                    {goal.notes ? (
                      <View style={styles.goalPlanningSection}>
                        <Text style={styles.goalPlanningLabel}>Notes</Text>
                        <Text style={styles.goalPlanningText}>{goal.notes}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {editingGoalId === goal.id ? (
                  <View style={styles.editDatesCard}>
                    <Text style={styles.editDatesTitle}>
                      Edit Goal
                    </Text>

                    <View style={styles.dateInputGroup}>
                      <Text style={styles.dateInputLabel}>
                        Goal title
                      </Text>
                      <TextInput
                        style={styles.editGoalTitleInput}
                        value={editGoalTitle}
                        onChangeText={(value) => {
                          setEditGoalTitle(value);
                          setEditMessage('');
                        }}
                        placeholder="Goal title"
                        returnKeyType="next"
                      />
                    </View>

                    <View style={styles.dateInputGroup}>
                      <Text style={styles.dateInputLabel}>Purpose</Text>
                      <TextInput
                        style={styles.planningInput}
                        value={editGoalPurpose}
                        onChangeText={(value) => {
                          setEditGoalPurpose(value);
                          setEditMessage('');
                        }}
                        placeholder="Why does this goal matter?"
                        multiline
                        maxLength={MAX_GOAL_PURPOSE_LENGTH}
                      />
                    </View>

                    <View style={styles.dateInputGroup}>
                      <Text style={styles.dateInputLabel}>
                        Success definition
                      </Text>
                      <TextInput
                        style={styles.planningInput}
                        value={editGoalSuccessDefinition}
                        onChangeText={(value) => {
                          setEditGoalSuccessDefinition(value);
                          setEditMessage('');
                        }}
                        placeholder="What counts as completing this goal?"
                        multiline
                        maxLength={MAX_GOAL_SUCCESS_DEFINITION_LENGTH}
                      />
                    </View>

                    <View style={styles.dateInputGroup}>
                      <Text style={styles.dateInputLabel}>Goal notes</Text>
                      <TextInput
                        style={styles.goalNotesInput}
                        value={editGoalNotes}
                        onChangeText={(value) => {
                          setEditGoalNotes(value);
                          setEditMessage('');
                        }}
                        placeholder="Plans, links, ideas, or useful details..."
                        multiline
                        maxLength={MAX_GOAL_NOTES_LENGTH}
                      />
                    </View>

                    <View style={styles.dateInputGroup}>
                      <Text style={styles.dateInputLabel}>
                        Optional reward
                      </Text>
                      <TextInput
                        style={styles.editGoalRewardInput}
                        value={editGoalReward}
                        onChangeText={(value) => {
                          setEditGoalReward(value);
                          setEditMessage('');
                        }}
                        placeholder="Example: Buy a new game"
                        multiline
                        maxLength={MAX_GOAL_REWARD_LENGTH}
                      />
                      <Text style={styles.rewardHelpText}>
                        Clear this field to remove the reward.
                      </Text>
                    </View>

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
                        onPress={cancelEditingGoal}
                      >
                        <Text style={styles.cancelButtonText}>
                          Cancel
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.saveDatesButton}
                        onPress={() =>
                          handleSaveGoal(goal.id)
                        }
                      >
                        <Text style={styles.saveDatesButtonText}>
                          Save Goal
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {completingGoalId === goal.id ? (
                  <GoalCompletionPanel
                    goalTitle={goal.title}
                    analytics={goalAnalytics}
                    initialReflection={{
                      whatHelped: goal.completionWhatHelped,
                      hardestPart: goal.completionHardestPart,
                      learned: goal.completionLearned,
                      doDifferently: goal.completionDoDifferently,
                    }}
                    onCancel={() => setCompletingGoalId(null)}
                    onComplete={(reflection) =>
                      handleConfirmGoalCompletion(goal.id, reflection)
                    }
                  />
                ) : null}

                <GoalMilestoneManager goalId={goal.id} />

                <GoalAnalyticsCard analytics={goalAnalytics} />

                <View style={styles.linkedTasksSection}>
                  <Pressable
                    style={styles.linkedTasksHeader}
                    onPress={() => toggleLinkedTasks(goal.id)}
                    accessibilityRole="button"
                    accessibilityState={{
                      expanded: areLinkedTasksExpanded,
                    }}
                    accessibilityLabel={`${
                      areLinkedTasksExpanded ? 'Collapse' : 'Expand'
                    } linked tasks for ${goal.title}`}
                  >
                    <View style={styles.linkedTasksHeaderText}>
                      <Text style={styles.linkedTasksTitle}>
                        Linked Tasks ({linkedTasks.length})
                      </Text>

                      <Text style={styles.linkedTasksSubtitle}>
                        {completedLinkedTasks} of{' '}
                        {linkedTasks.length} done
                      </Text>
                    </View>

                    <Text style={styles.linkedTasksChevron}>
                      {areLinkedTasksExpanded ? '▼' : '▶'}
                    </Text>
                  </Pressable>

                  {areLinkedTasksExpanded ? (
                    <View style={styles.linkedTasksContent}>
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
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      {historicalCycles.length > 0 ? (
        <View style={styles.pastCyclesSection}>
          <Text style={styles.pastCyclesTitle}>Past Cycles</Text>
          <Text style={styles.pastCyclesSubtitle}>
            Open a previous 12-week folder to see the goals that belonged to it.
          </Text>

          <View style={styles.pastCyclesList}>
            {historicalCycles.map((cycle) => {
              const cycleNumber =
                chronologicalCycles.findIndex(
                  (item) => item.id === cycle.id
                ) + 1;

              return (
                <PastCycleFolder
                  key={cycle.id}
                  cycle={cycle}
                  cycleLabel={getPlanningCycleDisplayName(
                    cycle.name,
                    Math.max(1, cycleNumber)
                  )}
                  goals={goals.filter(
                    (goal) => goal.cycleId === cycle.id
                  )}
                />
              );
            })}
          </View>
        </View>
      ) : null}
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
  cycleCard: {
    padding: 18,
    borderRadius: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    gap: 12,
  },
  cycleLoadingText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1e3a8a',
  },
  cycleHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'transparent',
  },
  cycleHeaderText: {
    flex: 1,
    minWidth: 220,
    backgroundColor: 'transparent',
  },
  cycleTitle: {
    fontSize: 21,
    fontWeight: '900',
    color: '#111827',
  },
  cycleSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#4b5563',
  },
  cycleStatusBadge: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
  },
  cycleStatusComplete: {
    backgroundColor: '#dcfce7',
  },
  cycleStatusUpcoming: {
    backgroundColor: '#fef3c7',
  },
  cycleStatusText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#1e3a8a',
  },
  cycleIdentitySummary: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8f7ff',
    gap: 10,
  },
  cycleIdentitySection: {
    backgroundColor: 'transparent',
  },
  cycleIdentityLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#6d28d9',
    textTransform: 'uppercase',
  },
  cycleIdentityText: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: '#1f2937',
  },
  cycleProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  cycleProgressLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
  },
  cycleProgressValue: {
    fontSize: 15,
    fontWeight: '900',
    color: '#2563eb',
  },
  cycleProgressTrack: {
    height: 13,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    overflow: 'hidden',
  },
  cycleProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  cycleStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  cycleStatBox: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 130,
    padding: 13,
    borderRadius: 12,
    backgroundColor: 'white',
  },
  cycleStatNumber: {
    fontSize: 23,
    fontWeight: '900',
    color: '#111827',
  },
  cycleStatLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '800',
    color: '#6b7280',
  },
  cycleSummaryText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4b5563',
  },
  cycleGoalProgressCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8f7ff',
  },
  cycleGoalProgressHeader: {
    flex: 1,
    minWidth: 190,
    backgroundColor: 'transparent',
  },
  cycleGoalProgressTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  cycleGoalProgressSubtitle: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
    color: '#6b7280',
  },
  cycleGoalStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  cycleGoalStatBox: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 135,
    padding: 11,
    borderRadius: 10,
    backgroundColor: 'white',
  },
  cycleGoalStatNumber: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
  },
  cycleGoalStatLabel: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '800',
    color: '#6b7280',
  },
  cycleLinkedProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  cycleLinkedProgressLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    color: '#374151',
  },
  cycleLinkedProgressSummary: {
    marginTop: 7,
    fontSize: 11,
    color: '#6b7280',
  },
  cycleForm: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: 'transparent',
  },
  cycleDateField: {
    flex: 1,
    minWidth: 190,
    backgroundColor: 'transparent',
  },
  cycleDatePreview: {
    flex: 1,
    minWidth: 190,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: 'white',
  },
  cycleDatePreviewLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6b7280',
  },
  cycleDatePreviewValue: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '900',
    color: '#1e3a8a',
  },
  cycleHelpText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#4b5563',
  },
  startCycleButton: {
    alignSelf: 'flex-start',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  startCycleButtonText: {
    color: 'white',
    fontWeight: '900',
  },
  editCycleButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: '#dbeafe',
  },
  editCycleButtonText: {
    color: '#1e40af',
    fontWeight: '900',
  },
  cycleEditCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#f8fbff',
    gap: 10,
  },
  cycleEditTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  cycleEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    backgroundColor: 'transparent',
  },
  saveCycleButton: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  saveCycleButtonText: {
    color: 'white',
    fontWeight: '900',
  },
  cycleCompletionCard: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    gap: 10,
  },
  cycleCompletionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#166534',
  },
  cycleCompletionText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#374151',
  },
  overviewDesktop: {
    width: '66%',
    alignSelf: 'stretch',
  },
  addCardDesktop: {
    width: '100%',
    alignSelf: 'stretch',
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
  optionalPlanningSection: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f8fbff',
  },
  optionalPlanningToggle: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#eff6ff',
  },
  optionalPlanningToggleText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  optionalPlanningTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1e3a8a',
  },
  optionalPlanningSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  optionalPlanningAction: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2563eb',
  },
  optionalPlanningFields: {
    padding: 12,
    gap: 10,
    backgroundColor: 'transparent',
  },
  planningInputGroup: {
    backgroundColor: 'transparent',
  },
  planningInput: {
    minHeight: 74,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    backgroundColor: 'white',
  },
  goalNotesInput: {
    minHeight: 105,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    backgroundColor: 'white',
  },
  rewardInputGroup: {
    backgroundColor: 'transparent',
  },
  rewardInput: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    backgroundColor: 'white',
  },
  rewardHelpText: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 16,
    color: '#6b7280',
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
  goalFolderHeader: {
    width: '100%',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  goalFolderTitle: {
    fontSize: 23,
    fontWeight: '900',
    color: '#111827',
  },
  goalFolderSubtitle: {
    marginTop: 4,
    color: '#64748b',
    lineHeight: 19,
  },
  pastCyclesSection: {
    width: '100%',
    marginTop: 28,
    backgroundColor: 'transparent',
  },
  pastCyclesTitle: {
    fontSize: 23,
    fontWeight: '900',
    color: '#111827',
  },
  pastCyclesSubtitle: {
    marginTop: 4,
    color: '#64748b',
    lineHeight: 19,
  },
  pastCyclesList: {
    marginTop: 12,
    gap: 12,
    backgroundColor: 'transparent',
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
  rewardCard: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fbbf24',
    backgroundColor: '#fffbeb',
    gap: 4,
  },
  rewardLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#92400e',
  },
  rewardText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#78350f',
  },
  editGoalTitleInput: {
    borderWidth: 1,
    borderColor: '#c4b5fd',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: 'white',
  },
  editGoalRewardInput: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    backgroundColor: 'white',
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
  goalPlanningCard: {
    padding: 13,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#faf7ff',
    gap: 10,
  },
  goalPlanningSection: {
    backgroundColor: 'transparent',
  },
  goalPlanningLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#6d28d9',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  goalPlanningText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#374151',
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
    backgroundColor: 'transparent',
  },
  linkedTasksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  linkedTasksHeaderText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  linkedTasksTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  linkedTasksSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  linkedTasksChevron: {
    fontSize: 18,
    fontWeight: '900',
    color: '#7c3aed',
  },
  linkedTasksContent: {
    gap: 8,
    marginTop: 10,
    backgroundColor: 'transparent',
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