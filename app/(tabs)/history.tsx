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
  formatDateKey,
  getLocalDateKey,
  getStartOfWeek,
  startOfLocalDay,
} from '@/lib/dateUtils';

type ContentFilter = 'all' | 'tasks' | 'brainDumps';
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

  const { tasks } = useTasks();
  const { goals } = useGoals();

  const {
    getArchivedBrainDumps,
    restoreBrainDump,
    deleteBrainDump,
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
    if (contentFilter === 'brainDumps') {
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

  const filteredBrainDumps = useMemo(() => {
    if (contentFilter === 'tasks') {
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
     * filters are reset when Brain Dumps is selected.
     */
    if (filter === 'brainDumps') {
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

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>

        <Text style={styles.subtitle}>
          Look back at completed tasks and thoughts you cleared
          from your head.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>
          Accomplishments
        </Text>

        <Text style={styles.progressText}>
          {allCompletedTasks.length} completed task
          {allCompletedTasks.length === 1 ? '' : 's'} •{' '}
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
          placeholder="Search tasks, notes, goals, or brain dumps..."
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
            {filteredCompletedTasks.length === 1 ? '' : 's'}{' '}
            and {filteredBrainDumps.length} brain dump
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

      {contentFilter !== 'brainDumps' ? (
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