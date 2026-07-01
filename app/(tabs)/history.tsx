import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import {
  exportWeekFlowBackup,
  pickWeekFlowBackup,
  replaceWeekFlowData,
  type PickedWeekFlowBackup,
} from '@/lib/backupStorage';
import {
  formatDateKey,
  getLocalDateKey,
  getStartOfWeek,
  startOfLocalDay,
} from '@/lib/dateUtils';

type ContentFilter =
  | 'all'
  | 'tasks'
  | 'goals'
  | 'brainDumps';
type PriorityFilter = 'all' | 0 | 1 | 2;
type GoalFilter = 'all' | 'none' | number;

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

export default function HistoryScreen() {
  const [searchText, setSearchText] = useState('');
  const [contentFilter, setContentFilter] =
    useState<ContentFilter>('all');
  const [priorityFilter, setPriorityFilter] =
    useState<PriorityFilter>('all');
  const [goalFilter, setGoalFilter] =
    useState<GoalFilter>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [pendingImport, setPendingImport] =
    useState<PickedWeekFlowBackup | null>(null);

  const { tasks, refreshTasks } = useTasks();
  const { goals, refreshGoals, toggleGoal } = useGoals();

  const {
    getArchivedBrainDumps,
    restoreBrainDump,
    deleteBrainDump,
    refreshBrainDumps,
  } = useBrainDumps();

  /*
   * A map makes it easier to look up goal names while filtering
   * and rendering task cards.
   */
  const goalsById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal])),
    [goals]
  );

  const archivedBrainDumps = getArchivedBrainDumps();

  const allCompletedTasks = useMemo(() => {
    return tasks
      .filter((task) => task.completed)
      .sort((firstTask, secondTask) => {
        const firstTime = firstTask.completedAt
          ? new Date(firstTask.completedAt).getTime()
          : 0;

        const secondTime = secondTask.completedAt
          ? new Date(secondTask.completedAt).getTime()
          : 0;

        return secondTime - firstTime;
      });
  }, [tasks]);

  const allCompletedGoals = useMemo(() => {
    return goals
      .filter((goal) => goal.completed)
      .sort((firstGoal, secondGoal) => {
        const firstTime = firstGoal.completedAt
          ? new Date(firstGoal.completedAt).getTime()
          : 0;

        const secondTime = secondGoal.completedAt
          ? new Date(secondGoal.completedAt).getTime()
          : 0;

        return secondTime - firstTime;
      });
  }, [goals]);

  const sortedArchivedBrainDumps = useMemo(() => {
    return [...archivedBrainDumps].sort(
      (firstBrainDump, secondBrainDump) => {
        const firstTime = firstBrainDump.archivedAt
          ? new Date(firstBrainDump.archivedAt).getTime()
          : 0;

        const secondTime = secondBrainDump.archivedAt
          ? new Date(secondBrainDump.archivedAt).getTime()
          : 0;

        return secondTime - firstTime;
      }
    );
  }, [archivedBrainDumps]);

  const normalizedSearch = searchText.trim().toLowerCase();

  const filteredCompletedTasks = useMemo(() => {
    if (
      contentFilter === 'brainDumps' ||
      contentFilter === 'goals'
    ) {
      return [];
    }

    return allCompletedTasks.filter((task) => {
      const linkedGoal = task.goalId
        ? goalsById.get(task.goalId)
        : undefined;

      /*
       * Search checks the main pieces of task information instead
       * of only checking the title.
       */
      const matchesSearch =
        normalizedSearch.length === 0 ||
        task.title.toLowerCase().includes(normalizedSearch) ||
        (task.notes ?? '')
          .toLowerCase()
          .includes(normalizedSearch) ||
        (linkedGoal?.title ?? '')
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesPriority =
        priorityFilter === 'all' ||
        task.priority === priorityFilter;

      const matchesGoal =
        goalFilter === 'all' ||
        (goalFilter === 'none'
          ? task.goalId === null
          : task.goalId === goalFilter);

      return matchesSearch && matchesPriority && matchesGoal;
    });
  }, [
    allCompletedTasks,
    contentFilter,
    goalFilter,
    goalsById,
    normalizedSearch,
    priorityFilter,
  ]);

  const filteredCompletedGoals = useMemo(() => {
    if (
      contentFilter === 'tasks' ||
      contentFilter === 'brainDumps'
    ) {
      return [];
    }

    /*
     * Priority and linked-goal filters apply to tasks only. A goal
     * history search remains separate so the filters stay predictable.
     */
    if (
      priorityFilter !== 'all' ||
      goalFilter !== 'all'
    ) {
      return [];
    }

    return allCompletedGoals.filter((goal) => {
      return (
        normalizedSearch.length === 0 ||
        goal.title.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [
    allCompletedGoals,
    contentFilter,
    goalFilter,
    normalizedSearch,
    priorityFilter,
  ]);

  const filteredBrainDumps = useMemo(() => {
    if (
      contentFilter === 'tasks' ||
      contentFilter === 'goals'
    ) {
      return [];
    }

    /*
     * Priority and goal filters are task-specific. When one of
     * those filters is active, History only displays task results.
     */
    if (
      priorityFilter !== 'all' ||
      goalFilter !== 'all'
    ) {
      return [];
    }

    return sortedArchivedBrainDumps.filter((brainDump) => {
      return (
        normalizedSearch.length === 0 ||
        brainDump.body.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [
    contentFilter,
    goalFilter,
    normalizedSearch,
    priorityFilter,
    sortedArchivedBrainDumps,
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

  const hasActiveFilters =
    normalizedSearch.length > 0 ||
    contentFilter !== 'all' ||
    priorityFilter !== 'all' ||
    goalFilter !== 'all';

  function selectContentFilter(filter: ContentFilter) {
    setContentFilter(filter);

    /*
     * Brain dumps do not have priority or goal values, so those
     * filters are reset when Goals or Brain Dumps is selected.
     */
    if (filter === 'brainDumps' || filter === 'goals') {
      setPriorityFilter('all');
      setGoalFilter('all');
    }
  }

  function selectPriorityFilter(filter: PriorityFilter) {
    setPriorityFilter(filter);

    if (filter !== 'all') {
      setContentFilter('tasks');
    }
  }

  function selectGoalFilter(filter: GoalFilter) {
    setGoalFilter(filter);

    if (filter !== 'all') {
      setContentFilter('tasks');
    }
  }

  function clearFilters() {
    setSearchText('');
    setContentFilter('all');
    setPriorityFilter('all');
    setGoalFilter('all');
  }

  async function handleExportBackup() {
    setIsExporting(true);
    setBackupMessage('');

    try {
      const result = await exportWeekFlowBackup();

      setBackupMessage(
        `Exported ${result.counts.tasks} tasks, ` +
          `${result.counts.goals} goals, and ` +
          `${result.counts.brainDumps} brain dumps.`
      );
    } catch (error) {
      console.error('Failed to export WeekFlow backup:', error);

      setBackupMessage(
        error instanceof Error
          ? error.message
          : 'The backup could not be exported.'
      );
    } finally {
      setIsExporting(false);
    }
  }

  async function handleChooseBackup() {
    setBackupMessage('');

    try {
      const pickedBackup = await pickWeekFlowBackup();

      if (pickedBackup) {
        setPendingImport(pickedBackup);
      }
    } catch (error) {
      console.error('Failed to read WeekFlow backup:', error);

      setBackupMessage(
        error instanceof Error
          ? error.message
          : 'The selected backup could not be read.'
      );
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) return;

    setIsImporting(true);
    setBackupMessage('');

    try {
      const counts = await replaceWeekFlowData(
        pendingImport.backup
      );

      /*
       * The database changes immediately, but each context keeps
       * its own in-memory list. Reload all three after import so
       * every tab updates without restarting Expo.
       */
      await Promise.all([
        refreshTasks(),
        refreshGoals(),
        refreshBrainDumps(),
      ]);

      setBackupMessage(
        `Imported ${counts.tasks} tasks, ` +
          `${counts.goals} goals, and ` +
          `${counts.brainDumps} brain dumps.`
      );

      setPendingImport(null);
      clearFilters();
    } catch (error) {
      console.error('Failed to import WeekFlow backup:', error);

      setBackupMessage(
        error instanceof Error
          ? error.message
          : 'The backup could not be imported.'
      );
    } finally {
      setIsImporting(false);
    }
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
          Look back at completed tasks, finished goals, and thoughts
          you cleared from your head.
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
          {archivedBrainDumps.length} archived brain dump
          {archivedBrainDumps.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.filterCard}>
        <Text style={styles.filterTitle}>
          Search and Filter
        </Text>

        <TextInput
          style={styles.searchInput}
          placeholder="Search tasks, completed goals, notes, or brain dumps..."
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />

        <Text style={styles.filterLabel}>
          Show:
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Pressable
            style={[
              styles.filterButton,
              contentFilter === 'all' &&
                styles.filterButtonSelected,
            ]}
            onPress={() => selectContentFilter('all')}
          >
            <Text
              style={[
                styles.filterButtonText,
                contentFilter === 'all' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              All
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.filterButton,
              contentFilter === 'tasks' &&
                styles.filterButtonSelected,
            ]}
            onPress={() => selectContentFilter('tasks')}
          >
            <Text
              style={[
                styles.filterButtonText,
                contentFilter === 'tasks' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              Tasks
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.filterButton,
              contentFilter === 'goals' &&
                styles.filterButtonSelected,
            ]}
            onPress={() => selectContentFilter('goals')}
          >
            <Text
              style={[
                styles.filterButtonText,
                contentFilter === 'goals' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              Goals
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.filterButton,
              contentFilter === 'brainDumps' &&
                styles.filterButtonSelected,
            ]}
            onPress={() =>
              selectContentFilter('brainDumps')
            }
          >
            <Text
              style={[
                styles.filterButtonText,
                contentFilter === 'brainDumps' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              Brain Dumps
            </Text>
          </Pressable>
        </ScrollView>

        <Text style={styles.filterLabel}>
          Priority:
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Pressable
            style={[
              styles.filterButton,
              priorityFilter === 'all' &&
                styles.priorityButtonSelected,
            ]}
            onPress={() => selectPriorityFilter('all')}
          >
            <Text
              style={[
                styles.filterButtonText,
                priorityFilter === 'all' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              All Priorities
            </Text>
          </Pressable>

          {([0, 1, 2] as const).map((priority) => (
            <Pressable
              key={priority}
              style={[
                styles.filterButton,
                priorityFilter === priority &&
                  styles.priorityButtonSelected,
              ]}
              onPress={() =>
                selectPriorityFilter(priority)
              }
            >
              <Text
                style={[
                  styles.filterButtonText,
                  priorityFilter === priority &&
                    styles.filterButtonTextSelected,
                ]}
              >
                {getPriorityLabel(priority)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>
          Goal:
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Pressable
            style={[
              styles.filterButton,
              goalFilter === 'all' &&
                styles.goalButtonSelected,
            ]}
            onPress={() => selectGoalFilter('all')}
          >
            <Text
              style={[
                styles.filterButtonText,
                goalFilter === 'all' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              All Goals
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.filterButton,
              goalFilter === 'none' &&
                styles.goalButtonSelected,
            ]}
            onPress={() => selectGoalFilter('none')}
          >
            <Text
              style={[
                styles.filterButtonText,
                goalFilter === 'none' &&
                  styles.filterButtonTextSelected,
              ]}
            >
              No Goal
            </Text>
          </Pressable>

          {goals.map((goal) => (
            <Pressable
              key={goal.id}
              style={[
                styles.filterButton,
                goalFilter === goal.id &&
                  styles.goalButtonSelected,
              ]}
              onPress={() => selectGoalFilter(goal.id)}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  goalFilter === goal.id &&
                    styles.filterButtonTextSelected,
                ]}
                numberOfLines={1}
              >
                {goal.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.filterSummaryRow}>
          <Text style={styles.filterSummaryText}>
            Showing {filteredCompletedTasks.length} task
            {filteredCompletedTasks.length === 1 ? '' : 's'},{' '}
            {filteredCompletedGoals.length} goal
            {filteredCompletedGoals.length === 1 ? '' : 's'}, and{' '}
            {filteredBrainDumps.length} brain dump
            {filteredBrainDumps.length === 1 ? '' : 's'}
          </Text>

          {hasActiveFilters ? (
            <Pressable
              style={styles.clearButton}
              onPress={clearFilters}
            >
              <Text style={styles.clearButtonText}>
                Clear
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {contentFilter !== 'brainDumps' &&
      contentFilter !== 'goals' ? (
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

      {contentFilter !== 'tasks' &&
      contentFilter !== 'brainDumps' &&
      priorityFilter === 'all' &&
      goalFilter === 'all' ? (
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
                        const completedLinkedTasks =
                          linkedTasks.filter(
                            (task) => task.completed
                          ).length;
                        const progress =
                          calculateProgressPercentage(
                            completedLinkedTasks,
                            linkedTasks.length
                          );

                        return (
                          <View
                            key={goal.id}
                            style={styles.goalHistoryCard}
                          >
                            <View
                              style={styles.goalHistoryHeaderRow}
                            >
                              <View
                                style={styles.goalHistoryTextWrap}
                              >
                                <Text
                                  style={styles.goalHistoryTitle}
                                >
                                  {goal.title}
                                </Text>

                                <Text style={styles.taskMeta}>
                                  Goal dates:{' '}
                                  {formatGoalDate(goal.startDate)} →{' '}
                                  {formatGoalDate(goal.endDate)}
                                </Text>

                                <Text style={styles.taskMeta}>
                                  Linked task progress: {progress}% ({' '}
                                  {completedLinkedTasks} of{' '}
                                  {linkedTasks.length})
                                </Text>

                                <Text style={styles.completedMeta}>
                                  Completed:{' '}
                                  {formatCompletedDate(
                                    goal.completedAt
                                  )}
                                </Text>
                              </View>

                              <Pressable
                                style={styles.restoreButton}
                                onPress={() =>
                                  toggleGoal(goal.id)
                                }
                              >
                                <Text
                                  style={styles.restoreButtonText}
                                >
                                  Reopen
                                </Text>
                              </Pressable>
                            </View>
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

      {contentFilter !== 'tasks' &&
      contentFilter !== 'goals' &&
      priorityFilter === 'all' &&
      goalFilter === 'all' ? (
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

      <View style={styles.backupSection}>
        <Text style={styles.sectionTitle}>Backup and Transfer</Text>

        <Text style={styles.sectionSubtitle}>
          Export all WeekFlow tasks, goals, and brain dumps to one
          JSON file, or replace this device&apos;s data with a saved
          WeekFlow backup.
        </Text>

        <View style={styles.backupCard}>
          <Text style={styles.backupTitle}>Export Backup</Text>

          <Text style={styles.backupText}>
            Web downloads the backup file. The iPhone version opens
            the system share sheet so the file can be saved or sent.
          </Text>

          <Pressable
            style={[
              styles.backupPrimaryButton,
              isExporting && styles.backupButtonDisabled,
            ]}
            onPress={handleExportBackup}
            disabled={isExporting || isImporting}
          >
            <Text style={styles.backupPrimaryButtonText}>
              {isExporting ? 'Exporting...' : 'Export WeekFlow Data'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.backupCard}>
          <Text style={styles.backupTitle}>Import Backup</Text>

          <Text style={styles.backupWarning}>
            Import uses Replace Existing Data. The current tasks,
            goals, and brain dumps on this device will be erased
            only after you select a valid backup and confirm.
          </Text>

          <Pressable
            style={[
              styles.backupSecondaryButton,
              isImporting && styles.backupButtonDisabled,
            ]}
            onPress={handleChooseBackup}
            disabled={isExporting || isImporting}
          >
            <Text style={styles.backupSecondaryButtonText}>
              Choose WeekFlow Backup
            </Text>
          </Pressable>

          {pendingImport ? (
            <View style={styles.importConfirmation}>
              <Text style={styles.importFileName}>
                {pendingImport.fileName}
              </Text>

              <Text style={styles.importCounts}>
                {pendingImport.counts.tasks} tasks •{' '}
                {pendingImport.counts.goals} goals •{' '}
                {pendingImport.counts.brainDumps} brain dumps
              </Text>

              <Text style={styles.importWarningText}>
                Confirming will replace all WeekFlow data currently
                stored on this device.
              </Text>

              <View style={styles.importActions}>
                <Pressable
                  style={styles.cancelImportButton}
                  onPress={() => setPendingImport(null)}
                  disabled={isImporting}
                >
                  <Text style={styles.cancelImportButtonText}>
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.confirmImportButton,
                    isImporting && styles.backupButtonDisabled,
                  ]}
                  onPress={handleConfirmImport}
                  disabled={isImporting}
                >
                  <Text style={styles.confirmImportButtonText}>
                    {isImporting
                      ? 'Importing...'
                      : 'Replace and Import'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {backupMessage ? (
            <Text style={styles.backupMessage}>
              {backupMessage}
            </Text>
          ) : null}
        </View>
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

  backupSection: {
    marginBottom: 28,
    backgroundColor: 'transparent',
  },
  backupCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
    marginBottom: 12,
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
  backupWarning: {
    fontSize: 14,
    color: '#92400e',
    lineHeight: 20,
    marginBottom: 14,
  },
  backupPrimaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 11,
    alignItems: 'center',
  },
  backupPrimaryButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  backupSecondaryButton: {
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 11,
    alignItems: 'center',
  },
  backupSecondaryButtonText: {
    color: '#1d4ed8',
    fontWeight: '800',
  },
  backupButtonDisabled: {
    opacity: 0.55,
  },
  importConfirmation: {
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
  },
  importFileName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  importCounts: {
    fontSize: 13,
    color: '#4b5563',
    marginBottom: 8,
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
  cancelImportButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#9ca3af',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  cancelImportButtonText: {
    color: '#374151',
    fontWeight: '800',
  },
  confirmImportButton: {
    flex: 1,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmImportButtonText: {
    color: 'white',
    fontWeight: '800',
  },
  backupMessage: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
    lineHeight: 18,
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