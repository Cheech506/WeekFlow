import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import HistoryFilters from '@/components/HistoryFilters';
import PastCycleFolder from '@/components/PastCycleFolder';
import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { getPlanningCycleDisplayName } from '@/lib/cycleIdentityUtils';
import {
  brainDumpMatchesHistoryFilters,
  createDefaultHistoryFilters,
  getTaskHistoryCycleId,
  goalMatchesHistoryFilters,
  resolveHistoryDateRange,
  taskMatchesHistoryFilters,
  timestampMatchesHistoryRange,
  type HistoryFilterState,
} from '@/lib/historyFilters';
import {
  formatDateKey,
  getLocalDateKey,
  getStartOfWeek,
  startOfLocalDay,
} from '@/lib/dateUtils';
import {
  calculateGoalAnalytics,
  hasGoalCompletionReflection,
  resolveGoalCompletionSnapshot,
} from '@/lib/goalReviewUtils';

type HistoryGroupKey =
  | 'today'
  | 'thisWeek'
  | 'earlierThisMonth'
  | 'older';

type HistoryGroupDefinition = {
  key: HistoryGroupKey;
  title: string;
};

const historyGroups: HistoryGroupDefinition[] = [
  {
    key: 'today',
    title: 'Today',
  },
  {
    key: 'thisWeek',
    title: 'This Week',
  },
  {
    key: 'earlierThisMonth',
    title: 'Earlier This Month',
  },
  {
    key: 'older',
    title: 'Older',
  },
];

function formatCompletedDate(value: string | null) {
  if (!value) {
    return 'Completed date unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Completed date unknown';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatArchivedDate(value: string | null) {
  if (!value) {
    return 'Archived date unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Archived date unknown';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatGoalDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Date unknown';
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getGoalDurationDays(
  startDate: string,
  completedAt: string | null
) {
  const start = new Date(startDate);
  const end = completedAt ? new Date(completedAt) : null;

  if (
    Number.isNaN(start.getTime()) ||
    !end ||
    Number.isNaN(end.getTime())
  ) {
    return null;
  }

  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  ).getTime();
  const endDay = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate()
  ).getTime();

  return Math.max(1, Math.floor((endDay - startDay) / 86_400_000) + 1);
}

function calculateProgressPercentage(
  completedCount: number,
  totalCount: number
) {
  if (totalCount === 0) {
    return 0;
  }

  return Math.round((completedCount / totalCount) * 100);
}

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

/**
 * Places a saved timestamp into one of the History date groups.
 *
 * WeekFlow uses Monday as the beginning of the week, matching
 * the Weekly screen and the progress calculations.
 */
function getHistoryGroup(
  timestamp: string | null,
  currentDate: Date = new Date()
): HistoryGroupKey {
  if (!timestamp) {
    return 'older';
  }

  const itemDate = new Date(timestamp);

  if (Number.isNaN(itemDate.getTime())) {
    return 'older';
  }

  const itemDay = startOfLocalDay(itemDate);
  const today = startOfLocalDay(currentDate);

  const itemDateKey = getLocalDateKey(itemDay);
  const todayDateKey = getLocalDateKey(today);

  if (itemDateKey === todayDateKey) {
    return 'today';
  }

  const weekStart = getStartOfWeek(today);

  if (itemDay >= weekStart && itemDay < today) {
    return 'thisWeek';
  }

  const monthStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  if (itemDay >= monthStart) {
    return 'earlierThisMonth';
  }

  return 'older';
}

/**
 * Groups items without changing their current sort order.
 *
 * Completed tasks and archived brain dumps are sorted newest
 * first before they are sent into this function.
 */
function groupHistoryItems<T>(
  items: T[],
  getTimestamp: (item: T) => string | null
): Record<HistoryGroupKey, T[]> {
  const groupedItems: Record<HistoryGroupKey, T[]> = {
    today: [],
    thisWeek: [],
    earlierThisMonth: [],
    older: [],
  };

  items.forEach((item) => {
    const group = getHistoryGroup(getTimestamp(item));
    groupedItems[group].push(item);
  });

  return groupedItems;
}

function HistoryDetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.historyDetailField}>
      <Text style={styles.historyDetailLabel}>{label}</Text>
      <Text style={styles.historyDetailText}>{value}</Text>
    </View>
  );
}

export default function HistoryScreen() {
  const [filters, setFilters] = useState<HistoryFilterState>(
    createDefaultHistoryFilters
  );
  const [expandedGoalReviews, setExpandedGoalReviews] = useState<
    Record<number, boolean>
  >({});

  const { tasks } = useTasks();
  const { goals, milestones, reopenGoal } = useGoals();
  const { cycles } = useCycle();
  const { cycleReviews, goalOutcomes } = useCycleReviews();

  const {
    getArchivedBrainDumps,
    restoreBrainDump,
    deleteBrainDump,
  } = useBrainDumps();

  const goalsById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal])),
    [goals]
  );

  const cycleLabelsById = useMemo(() => {
    const labels = new Map<number, string>();

    cycles.forEach((cycle, index) => {
      labels.set(
        cycle.id,
        getPlanningCycleDisplayName(
          cycle.name,
          Math.max(1, cycles.length - index)
        )
      );
    });

    return labels;
  }, [cycles]);

  const archivedBrainDumps = getArchivedBrainDumps();
  const dateRange = useMemo(
    () => resolveHistoryDateRange(filters),
    [filters.customEndDate, filters.customStartDate, filters.datePreset]
  );

  const historicalCycleReportCount = useMemo(
    () =>
      cycles.filter(
        (cycle) =>
          !cycle.active &&
          cycleReviews.some((review) => review.cycleId === cycle.id)
      ).length,
    [cycleReviews, cycles]
  );

  const allCompletedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.completed)
        .sort(
          (first, second) =>
            new Date(second.completedAt ?? 0).getTime() -
            new Date(first.completedAt ?? 0).getTime()
        ),
    [tasks]
  );

  const allCompletedGoals = useMemo(
    () =>
      goals
        .filter((goal) => goal.completed)
        .sort(
          (first, second) =>
            new Date(second.completedAt ?? 0).getTime() -
            new Date(first.completedAt ?? 0).getTime()
        ),
    [goals]
  );

  const sortedArchivedBrainDumps = useMemo(
    () =>
      [...archivedBrainDumps].sort(
        (first, second) =>
          new Date(second.archivedAt ?? 0).getTime() -
          new Date(first.archivedAt ?? 0).getTime()
      ),
    [archivedBrainDumps]
  );

  const filteredCompletedTasks = useMemo(
    () =>
      allCompletedTasks.filter((task) =>
        taskMatchesHistoryFilters({
          task,
          filters,
          goalsById,
          cycles,
          range: dateRange,
        })
      ),
    [allCompletedTasks, cycles, dateRange, filters, goalsById]
  );

  const filteredCompletedGoals = useMemo(
    () =>
      allCompletedGoals.filter((goal) => {
        const milestoneText = milestones
          .filter((milestone) => milestone.goalId === goal.id)
          .flatMap((milestone) => [milestone.title, milestone.notes])
          .filter((value): value is string => Boolean(value))
          .join(' ');

        return goalMatchesHistoryFilters({
          goal,
          milestonesText: milestoneText,
          filters,
          range: dateRange,
        });
      }),
    [allCompletedGoals, dateRange, filters, milestones]
  );

  const filteredBrainDumps = useMemo(
    () =>
      sortedArchivedBrainDumps.filter((brainDump) =>
        brainDumpMatchesHistoryFilters({
          brainDump,
          filters,
          range: dateRange,
        })
      ),
    [dateRange, filters, sortedArchivedBrainDumps]
  );

  /*
   * Cycle report search includes the cycle identity, Week 13 reflection, goal
   * names, and carry-forward/replacement outcomes so the report is findable by
   * what happened—not only by its title.
   */
  const filteredCycles = useMemo(() => {
    if (filters.content !== 'all' && filters.content !== 'cycles') return [];
    if (
      filters.priority !== 'all' ||
      filters.goal !== 'all' ||
      filters.recurrence !== 'all'
    ) {
      return [];
    }

    const normalizedSearch = filters.searchText.trim().toLowerCase();

    return cycles.filter((cycle) => {
      if (cycle.active) return false;
      if (filters.cycle === 'none') return false;
      if (typeof filters.cycle === 'number' && cycle.id !== filters.cycle) {
        return false;
      }

      const review = cycleReviews.find((item) => item.cycleId === cycle.id);
      if (!review) return false;

      const outcomes = review
        ? goalOutcomes.filter((item) => item.cycleReviewId === review.id)
        : [];
      const cycleGoals = goals.filter((goal) => goal.cycleId === cycle.id);
      const searchableText = [
        cycleLabelsById.get(cycle.id),
        cycle.primaryFocus,
        cycle.theme,
        review?.biggestAccomplishment,
        review?.biggestChallenge,
        review?.whatWorkedWell,
        review?.whatChangeNextCycle,
        review?.whatStopDoing,
        review?.whatContinueDoing,
        review?.whatLearned,
        ...cycleGoals.map((goal) => goal.title),
        ...outcomes.flatMap((outcome) => [
          outcome.goalTitle,
          outcome.replacementTitle,
        ]),
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase();

      if (normalizedSearch && !searchableText.includes(normalizedSearch)) {
        return false;
      }

      return timestampMatchesHistoryRange(
        review?.finalizedAt ?? cycle.completedAt ?? cycle.endDate,
        dateRange
      );
    });
  }, [
    cycleLabelsById,
    cycleReviews,
    cycles,
    dateRange,
    filters,
    goalOutcomes,
    goals,
  ]);

  const groupedCompletedTasks = useMemo(
    () =>
      groupHistoryItems(
        filteredCompletedTasks,
        (task) => task.completedAt
      ),
    [filteredCompletedTasks]
  );

  const groupedCompletedGoals = useMemo(
    () =>
      groupHistoryItems(
        filteredCompletedGoals,
        (goal) => goal.completedAt
      ),
    [filteredCompletedGoals]
  );

  const groupedBrainDumps = useMemo(
    () =>
      groupHistoryItems(
        filteredBrainDumps,
        (brainDump) => brainDump.archivedAt
      ),
    [filteredBrainDumps]
  );

  const resultSummary = `Showing ${filteredCompletedTasks.length} task${
    filteredCompletedTasks.length === 1 ? '' : 's'
  }, ${filteredCompletedGoals.length} goal${
    filteredCompletedGoals.length === 1 ? '' : 's'
  }, ${filteredCycles.length} cycle report${
    filteredCycles.length === 1 ? '' : 's'
  }, and ${filteredBrainDumps.length} brain dump${
    filteredBrainDumps.length === 1 ? '' : 's'
  }`;

  function toggleGoalReview(goalId: number) {
    setExpandedGoalReviews((current) => ({
      ...current,
      [goalId]: !current[goalId],
    }));
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>

        <Text style={styles.subtitle}>
          Look back at completed tasks, finished goals, cycle reports,
          reflections, and thoughts you cleared from your head.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>
          Accomplishments
        </Text>

        <Text style={styles.progressText}>
          {allCompletedTasks.length} completed task
          {allCompletedTasks.length === 1 ? '' : 's'} •{' '}
          {allCompletedGoals.length} completed goal
          {allCompletedGoals.length === 1 ? '' : 's'} •{' '}
          {historicalCycleReportCount} cycle report
          {historicalCycleReportCount === 1 ? '' : 's'} •{' '}
          {archivedBrainDumps.length} archived brain dump
          {archivedBrainDumps.length === 1 ? '' : 's'}
        </Text>
      </View>

      <HistoryFilters
        filters={filters}
        goals={goals}
        cycles={cycles}
        resultSummary={resultSummary}
        dateRangeError={dateRange.error}
        onChange={setFilters}
      />

      {filters.content === 'all' || filters.content === 'tasks' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Completed Tasks
          </Text>

          {filteredCompletedTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No completed tasks found
              </Text>

              <Text style={styles.emptyText}>
                Try changing the search or filters.
              </Text>
            </View>
          ) : (
            <View style={styles.groupList}>
              {historyGroups.map((group) => {
                const groupTasks =
                  groupedCompletedTasks[group.key];

                if (groupTasks.length === 0) {
                  return null;
                }

                return (
                  <View
                    key={group.key}
                    style={styles.historyGroup}
                  >
                    <View style={styles.groupHeaderRow}>
                      <Text style={styles.groupTitle}>
                        {group.title}
                      </Text>

                      <Text style={styles.groupCount}>
                        {groupTasks.length}
                      </Text>
                    </View>

                    <View style={styles.list}>
                      {groupTasks.map((task) => {
                        const linkedGoal = task.goalId
                          ? goalsById.get(task.goalId)
                          : undefined;

                        return (
                          <View
                            key={task.id}
                            style={styles.taskCard}
                          >
                            <Text style={styles.taskTitle}>
                              {task.title}
                            </Text>

                            <Text style={styles.taskMeta}>
                              Due:{' '}
                              {task.dueDate
                                ? formatDateKey(task.dueDate)
                                : task.day}
                            </Text>

                            <Text style={styles.taskMeta}>
                              Priority:{' '}
                              {getPriorityLabel(task.priority)}
                            </Text>

                            {linkedGoal ? (
                              <Text style={styles.taskMeta}>
                                Goal: {linkedGoal.title}
                              </Text>
                            ) : null}

                            {(() => {
                              const cycleId = getTaskHistoryCycleId(
                                task,
                                goalsById,
                                cycles
                              );
                              const cycleLabel =
                                cycleId === null
                                  ? null
                                  : cycleLabelsById.get(cycleId);

                              return cycleLabel ? (
                                <Text style={styles.taskMeta}>
                                  Cycle: {cycleLabel}
                                </Text>
                              ) : null;
                            })()}

                            {task.notes ? (
                              <Text style={styles.taskNotes}>
                                {task.notes}
                              </Text>
                            ) : null}

                            <Text style={styles.completedMeta}>
                              Completed:{' '}
                              {formatCompletedDate(
                                task.completedAt
                              )}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {filters.content === 'all' || filters.content === 'goals' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Completed Goals
          </Text>

          <Text style={styles.sectionSubtitle}>
            Finished goals are removed from the active Goals screen.
            Reopen one here if you want to continue working on it.
          </Text>

          {filteredCompletedGoals.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No completed goals found
              </Text>

              <Text style={styles.emptyText}>
                Try changing the search or complete a goal from the
                Goals screen.
              </Text>
            </View>
          ) : (
            <View style={styles.groupList}>
              {historyGroups.map((group) => {
                const groupGoals =
                  groupedCompletedGoals[group.key];

                if (groupGoals.length === 0) {
                  return null;
                }

                return (
                  <View
                    key={group.key}
                    style={styles.historyGroup}
                  >
                    <View style={styles.groupHeaderRow}>
                      <Text style={styles.groupTitle}>
                        {group.title}
                      </Text>

                      <Text style={styles.groupCount}>
                        {groupGoals.length}
                      </Text>
                    </View>

                    <View style={styles.list}>
                      {groupGoals.map((goal) => {
                        const linkedTasks = tasks.filter(
                          (task) => task.goalId === goal.id
                        );
                        const goalMilestones = milestones.filter(
                          (milestone) => milestone.goalId === goal.id
                        );
                        const liveAnalytics = calculateGoalAnalytics(
                          goal,
                          linkedTasks,
                          goalMilestones
                        );
                        const completionSnapshot =
                          resolveGoalCompletionSnapshot(
                            goal,
                            liveAnalytics
                          );
                        const taskProgress =
                          calculateProgressPercentage(
                            completionSnapshot.taskCompleted,
                            completionSnapshot.taskTotal
                          );
                        const durationDays = getGoalDurationDays(
                          goal.startDate,
                          goal.completedAt
                        );
                        const isExpanded =
                          expandedGoalReviews[goal.id] ?? false;
                        const hasReflection =
                          hasGoalCompletionReflection(goal);
                        const hasPlanningDetails = Boolean(
                          goal.purpose ||
                            goal.successDefinition ||
                            goal.notes
                        );

                        return (
                          <View
                            key={goal.id}
                            style={styles.goalHistoryCard}
                          >
                            <View style={styles.goalHistoryHeaderRow}>
                              <View style={styles.goalHistoryTextWrap}>
                                <Text style={styles.goalHistoryTitle}>
                                  {goal.title}
                                </Text>

                                <Text style={styles.taskMeta}>
                                  Goal dates: {formatGoalDate(goal.startDate)} →{' '}
                                  {formatGoalDate(goal.endDate)}
                                </Text>

                                <Text style={styles.completedMeta}>
                                  Completed: {formatCompletedDate(goal.completedAt)}
                                </Text>

                                {goal.cycleId !== null &&
                                cycleLabelsById.get(goal.cycleId) ? (
                                  <Text style={styles.taskMeta}>
                                    Cycle: {cycleLabelsById.get(goal.cycleId)}
                                  </Text>
                                ) : null}

                                {durationDays !== null ? (
                                  <Text style={styles.taskMeta}>
                                    Duration: {durationDays} day
                                    {durationDays === 1 ? '' : 's'}
                                  </Text>
                                ) : null}
                              </View>

                              <Pressable
                                style={styles.restoreButton}
                                onPress={() => reopenGoal(goal.id)}
                              >
                                <Text style={styles.restoreButtonText}>
                                  Reopen
                                </Text>
                              </Pressable>
                            </View>

                            <View style={styles.goalResultGrid}>
                              <View style={styles.goalResultMetric}>
                                <Text style={styles.goalResultValue}>
                                  {completionSnapshot.taskCompleted}/
                                  {completionSnapshot.taskTotal}
                                </Text>
                                <Text style={styles.goalResultLabel}>
                                  Linked Tasks
                                </Text>
                              </View>

                              <View style={styles.goalResultMetric}>
                                <Text style={styles.goalResultValue}>
                                  {taskProgress}%
                                </Text>
                                <Text style={styles.goalResultLabel}>
                                  Task Progress
                                </Text>
                              </View>

                              <View style={styles.goalResultMetric}>
                                <Text style={styles.goalResultValue}>
                                  {completionSnapshot.milestoneCompleted}/
                                  {completionSnapshot.milestoneTotal}
                                </Text>
                                <Text style={styles.goalResultLabel}>
                                  Milestones
                                </Text>
                              </View>

                              <View style={styles.goalResultMetric}>
                                <Text style={styles.goalResultValue}>
                                  {completionSnapshot.highPriorityCompleted}
                                </Text>
                                <Text style={styles.goalResultLabel}>
                                  High Priority Done
                                </Text>
                              </View>
                            </View>

                            {goal.reward ? (
                              <View style={styles.unlockedRewardCard}>
                                <Text style={styles.unlockedRewardLabel}>
                                  🎉 Reward Unlocked
                                </Text>
                                <Text style={styles.unlockedRewardText}>
                                  {goal.reward}
                                </Text>
                              </View>
                            ) : null}

                            <Pressable
                              style={styles.goalReviewToggle}
                              onPress={() => toggleGoalReview(goal.id)}
                              accessibilityRole="button"
                              accessibilityState={{ expanded: isExpanded }}
                            >
                              <Text style={styles.goalReviewToggleText}>
                                {isExpanded ? 'Hide Goal Review' : 'View Goal Review'}
                              </Text>
                              <Text style={styles.goalReviewChevron}>
                                {isExpanded ? '▼' : '▶'}
                              </Text>
                            </Pressable>

                            {isExpanded ? (
                              <View style={styles.goalReviewDetails}>
                                {hasPlanningDetails ? (
                                  <View style={styles.historyDetailCard}>
                                    <Text style={styles.historyDetailTitle}>
                                      Goal Plan
                                    </Text>

                                    {goal.purpose ? (
                                      <HistoryDetailField
                                        label="Purpose"
                                        value={goal.purpose}
                                      />
                                    ) : null}

                                    {goal.successDefinition ? (
                                      <HistoryDetailField
                                        label="Success Definition"
                                        value={goal.successDefinition}
                                      />
                                    ) : null}

                                    {goal.notes ? (
                                      <HistoryDetailField
                                        label="Notes"
                                        value={goal.notes}
                                      />
                                    ) : null}
                                  </View>
                                ) : null}

                                <View style={styles.historyDetailCard}>
                                  <Text style={styles.historyDetailTitle}>
                                    Milestone Results
                                  </Text>

                                  {goalMilestones.length === 0 ? (
                                    <Text style={styles.historyDetailEmpty}>
                                      No milestones were added to this goal.
                                    </Text>
                                  ) : (
                                    goalMilestones.map((milestone) => (
                                      <View
                                        key={milestone.id}
                                        style={styles.historyMilestoneRow}
                                      >
                                        <Text style={styles.historyMilestoneStatus}>
                                          {milestone.completed ? '✅' : '⬜'}
                                        </Text>
                                        <View style={styles.historyMilestoneText}>
                                          <Text style={styles.historyMilestoneTitle}>
                                            {milestone.title}
                                          </Text>
                                          {milestone.targetDate ? (
                                            <Text style={styles.taskMeta}>
                                              Target: {formatDateKey(milestone.targetDate)}
                                            </Text>
                                          ) : null}
                                          {milestone.notes ? (
                                            <Text style={styles.historyMilestoneNotes}>
                                              {milestone.notes}
                                            </Text>
                                          ) : null}
                                        </View>
                                      </View>
                                    ))
                                  )}
                                </View>

                                {hasReflection ? (
                                  <View style={styles.reflectionCard}>
                                    <Text style={styles.reflectionTitle}>
                                      Final Reflection
                                    </Text>

                                    {goal.completionWhatHelped ? (
                                      <HistoryDetailField
                                        label="What Helped"
                                        value={goal.completionWhatHelped}
                                      />
                                    ) : null}

                                    {goal.completionHardestPart ? (
                                      <HistoryDetailField
                                        label="Hardest Part"
                                        value={goal.completionHardestPart}
                                      />
                                    ) : null}

                                    {goal.completionLearned ? (
                                      <HistoryDetailField
                                        label="What I Learned"
                                        value={goal.completionLearned}
                                      />
                                    ) : null}

                                    {goal.completionDoDifferently ? (
                                      <HistoryDetailField
                                        label="What I Would Do Differently"
                                        value={goal.completionDoDifferently}
                                      />
                                    ) : null}
                                  </View>
                                ) : (
                                  <Text style={styles.historyDetailEmpty}>
                                    No final reflection was saved for this goal.
                                  </Text>
                                )}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {filters.content === 'all' || filters.content === 'cycles' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cycle Reports</Text>
          <Text style={styles.sectionSubtitle}>
            Open a completed cycle to review final results, goal outcomes,
            reflection answers, and the next-cycle plan.
          </Text>

          {filteredCycles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No cycle reports found</Text>
              <Text style={styles.emptyText}>
                Try changing the filters or finalize a Week 13 review.
              </Text>
            </View>
          ) : (
            <View style={styles.cycleReportList}>
              {filteredCycles.map((cycle) => (
                <PastCycleFolder
                  key={cycle.id}
                  cycle={cycle}
                  cycleLabel={
                    cycleLabelsById.get(cycle.id) ?? `Cycle ${cycle.id}`
                  }
                  goals={goals.filter((goal) => goal.cycleId === cycle.id)}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {filters.content === 'all' || filters.content === 'brainDumps' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Archived Brain Dumps
          </Text>

          <Text style={styles.sectionSubtitle}>
            Thoughts and notes you cleared out of Inbox but
            kept for later.
          </Text>

          {filteredBrainDumps.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No archived brain dumps found
              </Text>

              <Text style={styles.emptyText}>
                Try changing the search or archive a brain dump
                from Inbox.
              </Text>
            </View>
          ) : (
            <View style={styles.groupList}>
              {historyGroups.map((group) => {
                const groupBrainDumps =
                  groupedBrainDumps[group.key];

                if (groupBrainDumps.length === 0) {
                  return null;
                }

                return (
                  <View
                    key={group.key}
                    style={styles.historyGroup}
                  >
                    <View style={styles.groupHeaderRow}>
                      <Text style={styles.groupTitle}>
                        {group.title}
                      </Text>

                      <Text style={styles.groupCount}>
                        {groupBrainDumps.length}
                      </Text>
                    </View>

                    <View style={styles.list}>
                      {groupBrainDumps.map((brainDump) => (
                        <View
                          key={brainDump.id}
                          style={styles.brainDumpCard}
                        >
                          <View
                            style={styles.brainDumpTextWrap}
                          >
                            <Text
                              style={styles.brainDumpBody}
                            >
                              {brainDump.body}
                            </Text>

                            <Text style={styles.taskMeta}>
                              Archived:{' '}
                              {formatArchivedDate(
                                brainDump.archivedAt
                              )}
                            </Text>
                          </View>

                          <View
                            style={styles.brainDumpActions}
                          >
                            <Pressable
                              style={styles.restoreButton}
                              onPress={() =>
                                restoreBrainDump(
                                  brainDump.id
                                )
                              }
                            >
                              <Text
                                style={
                                  styles.restoreButtonText
                                }
                              >
                                Restore
                              </Text>
                            </Pressable>

                            <Pressable
                              style={styles.deleteButton}
                              onPress={() =>
                                deleteBrainDump(
                                  brainDump.id
                                )
                              }
                            >
                              <Text
                                style={
                                  styles.deleteButtonText
                                }
                              >
                                Delete
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
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
  progressCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#fff7ed',
    marginBottom: 18,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
    color: '#111827',
  },
  progressText: {
    fontSize: 15,
    color: '#374151',
  },
  filterCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#eff6ff',
    marginBottom: 24,
    gap: 10,
  },
  filterTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#111827',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    backgroundColor: 'white',
  },
  filterLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
  },
  filterRow: {
    gap: 8,
    paddingRight: 8,
  },
  filterButton: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
    maxWidth: 220,
  },
  filterButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  priorityButtonSelected: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  goalButtonSelected: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  filterButtonTextSelected: {
    color: 'white',
  },
  filterSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  filterSummaryText: {
    flex: 1,
    fontSize: 12,
    color: '#6b7280',
  },
  clearButton: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: '#dc2626',
  },
  clearButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  section: {
    marginBottom: 28,
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
    lineHeight: 20,
  },
  groupList: {
    gap: 22,
  },
  historyGroup: {
    backgroundColor: 'transparent',
  },
  groupHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
    backgroundColor: 'transparent',
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#374151',
  },
  groupCount: {
    minWidth: 28,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    color: '#374151',
    fontWeight: '800',
  },
  list: {
    gap: 12,
  },
  taskCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    gap: 4,
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  taskMeta: {
    fontSize: 13,
    color: '#6b7280',
  },
  completedMeta: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  taskNotes: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  goalHistoryCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#faf5ff',
  },
  goalHistoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'transparent',
  },
  goalHistoryTextWrap: {
    flex: 1,
    gap: 4,
    backgroundColor: 'transparent',
  },
  goalHistoryTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  unlockedRewardCard: {
    marginTop: 8,
    padding: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fbbf24',
    backgroundColor: '#fffbeb',
    gap: 3,
  },
  unlockedRewardLabel: {
    fontSize: 12,
    fontWeight: '900',
    color: '#92400e',
  },
  unlockedRewardText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    color: '#78350f',
  },
  goalResultGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  goalResultMetric: {
    flexGrow: 1,
    flexBasis: 120,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#ede9fe',
  },
  goalResultValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#5b21b6',
  },
  goalResultLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#5b21b6',
  },
  goalReviewToggle: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#f5f3ff',
  },
  goalReviewToggleText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: '#5b21b6',
  },
  goalReviewChevron: {
    fontSize: 12,
    fontWeight: '900',
    color: '#7c3aed',
  },
  goalReviewDetails: {
    marginTop: 10,
    gap: 10,
    backgroundColor: 'transparent',
  },
  historyDetailCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: 'white',
    gap: 10,
  },
  historyDetailTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#4c1d95',
  },
  historyDetailField: {
    backgroundColor: 'transparent',
  },
  historyDetailLabel: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: '#6d28d9',
  },
  historyDetailText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    color: '#374151',
  },
  historyDetailEmpty: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6b7280',
  },
  historyMilestoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'transparent',
  },
  historyMilestoneStatus: {
    fontSize: 16,
  },
  historyMilestoneText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  historyMilestoneTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  historyMilestoneNotes: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: '#4b5563',
  },
  reflectionCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    gap: 10,
  },
  reflectionTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#166534',
  },
  brainDumpCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  brainDumpTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  brainDumpBody: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  brainDumpActions: {
    gap: 8,
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  restoreButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  restoreButtonText: {
    color: 'white',
    fontWeight: '700',
  },
  deleteButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  deleteButtonText: {
    color: 'white',
    fontWeight: '700',
  },

  cycleReportList: {
    gap: 14,
    backgroundColor: 'transparent',
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
    lineHeight: 20,
  },
});