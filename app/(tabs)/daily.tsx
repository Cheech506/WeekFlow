import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';

import { ActiveTaskFilters } from '@/components/ActiveTaskFilters';
import { TaskDatePicker } from '@/components/TaskDatePicker';
import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import { type Task, useTasks } from '@/context/TaskContext';
import {
  createDefaultActiveTaskFilters,
  filterActiveTasks,
} from '@/lib/activeTaskFilters';
import {
  formatDateKey,
  getLocalDateKey,
} from '@/lib/dateUtils';
import { calculateProgressStats } from '@/lib/progressStats';

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

function formatCreatedDate(value: string) {
  const date = new Date(value);

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DailyScreen() {
  const { width } = useWindowDimensions();
  const [taskFilters, setTaskFilters] = useState(
    createDefaultActiveTaskFilters()
  );
  const [datePickerTask, setDatePickerTask] =
    useState<Task | null>(null);

  const isDesktop = width >= 1100;

  const {
    tasks,
    completeTask,
    deleteTask,
    scheduleTask,
    moveTaskToInbox,
    getActiveTasksByDate,
    getOverdueTasks,
  } = useTasks();

  const { goals } = useGoals();

  const {
    getActiveBrainDumps,
    archiveBrainDump,
  } = useBrainDumps();

  const todayDateKey = getLocalDateKey(new Date());
  const todayLabel = formatDateKey(todayDateKey, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const activeTasks = getActiveTasksByDate(todayDateKey);
  const overdueTasks = getOverdueTasks();
  const filteredActiveTasks = useMemo(
    () => filterActiveTasks(activeTasks, taskFilters),
    [activeTasks, taskFilters]
  );
  const filteredOverdueTasks = useMemo(
    () => filterActiveTasks(overdueTasks, taskFilters),
    [overdueTasks, taskFilters]
  );
  const totalActiveTaskCount = activeTasks.length + overdueTasks.length;
  const filteredActiveTaskCount =
    filteredActiveTasks.length + filteredOverdueTasks.length;

  const activeBrainDumps = getActiveBrainDumps();

  /*
   * Progress calculations remain outside the UI markup so the
   * screen only needs to display the returned statistics.
   */
  const progressStats = calculateProgressStats(tasks);

  async function handleScheduleDate(dateKey: string) {
    if (!datePickerTask) return;

    await scheduleTask(datePickerTask.id, dateKey);
    setDatePickerTask(null);
  }

  return (
    <>
      <TaskDatePicker
        visible={datePickerTask !== null}
        taskTitle={datePickerTask?.title}
        initialDateKey={datePickerTask?.dueDate}
        minimumDateKey={todayDateKey}
        onCancel={() => setDatePickerTask(null)}
        onSelectDate={handleScheduleDate}
      />

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
        <Text style={styles.title}>Daily Tasks</Text>

        <Text style={styles.subtitle}>
          Today is {todayLabel}. Review what needs attention today.
        </Text>
      </View>

      <View
        style={[
          styles.progressCard,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
        <Text style={styles.progressTitle}>
          Today's Progress
        </Text>

        <Text style={styles.progressText}>
          {progressStats.completedToday} completed •{' '}
          {activeTasks.length} task
          {activeTasks.length === 1 ? '' : 's'} left •{' '}
          {overdueTasks.length} overdue •{' '}
          {activeBrainDumps.length} brain dump note
          {activeBrainDumps.length === 1 ? '' : 's'}
        </Text>
      </View>

      <ActiveTaskFilters
        goals={goals}
        filters={taskFilters}
        onChange={setTaskFilters}
        totalCount={totalActiveTaskCount}
        resultCount={filteredActiveTaskCount}
        scheduleChoices={['all', 'overdue', 'today']}
        defaultExpanded={false}
      />

      {filteredOverdueTasks.length > 0 ? (
        <View
          style={[
            styles.overdueSection,
            isDesktop && styles.fullWidthPanel,
          ]}
        >
          <Text style={styles.overdueSectionTitle}>
            Overdue Tasks
          </Text>

          <Text style={styles.overdueSectionSubtitle}>
            These tasks missed their due dates. Move them to today,
            choose a new date, or return them to Inbox.
          </Text>

          <View
            style={[
              styles.overdueList,
              isDesktop && styles.cardGrid,
            ]}
          >
            {filteredOverdueTasks.map((task) => {
              const linkedGoal = goals.find(
                (goal) => goal.id === task.goalId
              );

              return (
                <View
                  key={task.id}
                  style={[
                    styles.overdueCard,
                    isDesktop && styles.halfWidthCard,
                  ]}
                >
                  <View style={styles.overdueTopRow}>
                    <View style={styles.taskTextWrap}>
                      <View style={styles.overdueTitleRow}>
                        <Text style={styles.taskTitle}>{task.title}</Text>
                        <Text style={styles.overdueBadge}>Overdue</Text>
                      </View>

                      <Text style={styles.overdueDueText}>
                        Due:{' '}
                        {task.dueDate
                          ? formatDateKey(task.dueDate)
                          : task.day}
                      </Text>

                      <Text style={styles.taskMeta}>
                        Priority: {getPriorityLabel(task.priority)}
                      </Text>

                      {linkedGoal ? (
                        <Text style={styles.taskMeta}>
                          Goal: {linkedGoal.title}
                        </Text>
                      ) : null}

                      {task.notes ? (
                        <Text style={styles.taskNotes}>{task.notes}</Text>
                      ) : null}
                    </View>

                    <View style={styles.taskActions}>
                      <Pressable
                        style={styles.todayButton}
                        onPress={() =>
                          scheduleTask(task.id, todayDateKey)
                        }
                      >
                        <Text style={styles.actionButtonText}>
                          Move to Today
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.calendarButton}
                        onPress={() => setDatePickerTask(task)}
                      >
                        <Text style={styles.actionButtonText}>
                          Choose Date
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.inboxButton}
                        onPress={() => moveTaskToInbox(task.id)}
                      >
                        <Text style={styles.actionButtonText}>
                          Back to Inbox
                        </Text>
                      </Pressable>

                      <Pressable
                        style={styles.doneButton}
                        onPress={() => completeTask(task.id)}
                      >
                        <Text style={styles.actionButtonText}>Done</Text>
                      </Pressable>

                      <Pressable
                        style={styles.deleteButton}
                        onPress={() => deleteTask(task.id)}
                      >
                        <Text style={styles.actionButtonText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>

                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.streakCard,
          isDesktop && styles.dashboardHalf,
        ]}
      >
        <View style={styles.streakTextWrap}>
          <Text style={styles.streakTitle}>
            Progress & Streaks
          </Text>

          <Text style={styles.streakSubtitle}>
            Complete at least one task each day to continue
            your streak.
          </Text>
        </View>

        <View style={styles.streakBadgesRow}>
          <View style={styles.currentStreakBadge}>
            <Text style={styles.currentStreakNumber}>
              {progressStats.currentStreak}
            </Text>

            <Text style={styles.currentStreakText}>
              current streak 🔥
            </Text>
          </View>

          <View style={styles.longestStreakBadge}>
            <Text style={styles.longestStreakNumber}>
              {progressStats.longestStreak}
            </Text>

            <Text style={styles.longestStreakText}>
              longest streak 🏆
            </Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {progressStats.completedToday}
            </Text>

            <Text style={styles.statLabel}>
              Completed Today
            </Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {progressStats.completedThisWeek}
            </Text>

            <Text style={styles.statLabel}>
              Completed This Week
            </Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {progressStats.weeklyCompletionRate}%
            </Text>

            <Text style={styles.statLabel}>
              Weekly Completion
            </Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {progressStats.bestDay ?? '—'}
            </Text>

            <Text style={styles.statLabel}>
              {progressStats.bestDay
                ? `${progressStats.bestDayCount} completed`
                : 'Best Day'}
            </Text>
          </View>
        </View>

        <Text style={styles.calculationNote}>
          Weekly completion compares tasks completed this week
          with your currently scheduled tasks. Unscheduled Inbox
          tasks are not included.
        </Text>
      </View>

      <View
        style={[
          styles.weekProgressCard,
          isDesktop && styles.dashboardHalf,
        ]}
      >
        <Text style={styles.weekProgressTitle}>
          Seven-Day Progress
        </Text>

        <Text style={styles.weekProgressSubtitle}>
          Each completed day helps continue your streak.
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.weekDaysRow,
            isDesktop && styles.weekDaysRowDesktop,
          ]}
        >
          {progressStats.weeklyDays.map((day) => {
            const hasCompletion = day.completedCount > 0;

            const statusSymbol = hasCompletion
              ? '✓'
              : day.isFuture
                ? '—'
                : '○';

            return (
              <View
                key={day.dateKey}
                style={[
                  styles.weekDayCard,
                  hasCompletion && styles.weekDayCardCompleted,
                  day.isToday && styles.weekDayCardToday,
                ]}
              >
                <Text
                  style={[
                    styles.weekDayName,
                    hasCompletion && styles.weekDayTextCompleted,
                  ]}
                >
                  {day.shortDay}
                </Text>

                <Text
                  style={[
                    styles.weekDayCount,
                    hasCompletion && styles.weekDayTextCompleted,
                  ]}
                >
                  {day.completedCount}
                </Text>

                <Text
                  style={[
                    styles.weekDayStatus,
                    hasCompletion && styles.weekDayTextCompleted,
                  ]}
                >
                  {statusSymbol}
                </Text>

                {day.isToday ? (
                  <Text style={styles.todayLabel}>Today</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.weekLegend}>
          <Text style={styles.weekLegendText}>✓ Completed day</Text>
          <Text style={styles.weekLegendText}>○ No completion</Text>
          <Text style={styles.weekLegendText}>— Future day</Text>
        </View>
      </View>

      <View
        style={[
          styles.section,
          isDesktop && styles.primaryColumn,
        ]}
      >
        <Text style={styles.sectionTitle}>
          Today's Tasks
        </Text>

        <Text style={styles.sectionSubtitle}>
          Tasks scheduled for today's actual calendar date show here.
        </Text>

        <View style={styles.taskList}>
          {activeTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Nothing for today 🎉
              </Text>

              <Text style={styles.emptyText}>
                Schedule a task from Inbox for today's date when
                something needs to be done.
              </Text>
            </View>
          ) : filteredActiveTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No today tasks match these filters
              </Text>

              <Text style={styles.emptyText}>
                Clear or adjust Search & Filters to show more tasks.
              </Text>
            </View>
          ) : (
            filteredActiveTasks.map((task) => {
              const linkedGoal = goals.find(
                (goal) => goal.id === task.goalId
              );

              return (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskTitle}>{task.title}</Text>

                    <Text style={styles.taskMeta}>
                      Due:{' '}
                      {task.dueDate
                        ? formatDateKey(task.dueDate)
                        : task.day}
                    </Text>

                    <Text style={styles.taskMeta}>
                      Priority: {getPriorityLabel(task.priority)}
                    </Text>

                    {linkedGoal ? (
                      <Text style={styles.taskMeta}>
                        Goal: {linkedGoal.title}
                      </Text>
                    ) : null}

                    {task.notes ? (
                      <Text style={styles.taskNotes}>{task.notes}</Text>
                    ) : null}
                  </View>

                  <View style={styles.taskActions}>
                    <Pressable
                      style={styles.calendarButton}
                      onPress={() => setDatePickerTask(task)}
                    >
                      <Text style={styles.actionButtonText}>
                        Reschedule
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.inboxButton}
                      onPress={() => moveTaskToInbox(task.id)}
                    >
                      <Text style={styles.actionButtonText}>
                        Back to Inbox
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.doneButton}
                      onPress={() => completeTask(task.id)}
                    >
                      <Text style={styles.actionButtonText}>Done</Text>
                    </Pressable>

                    <Pressable
                      style={styles.deleteButton}
                      onPress={() => deleteTask(task.id)}
                    >
                      <Text style={styles.actionButtonText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>

      <View
        style={[
          styles.section,
          isDesktop && styles.secondaryColumn,
        ]}
      >
        <Text style={styles.sectionTitle}>
          Brain Dump Notes
        </Text>

        <Text style={styles.sectionSubtitle}>
          Active notes from Inbox. These are not scheduled
          tasks—just stuff you wanted out of your head.
        </Text>

        <View style={styles.brainDumpList}>
          {activeBrainDumps.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No active brain dumps
              </Text>

              <Text style={styles.emptyText}>
                Add brain dump notes from Inbox and they will
                show here too.
              </Text>
            </View>
          ) : (
            activeBrainDumps.map((brainDump) => (
              <View key={brainDump.id} style={styles.brainDumpCard}>
                <View style={styles.brainDumpTextWrap}>
                  <Text style={styles.brainDumpBody}>
                    {brainDump.body}
                  </Text>

                  <Text style={styles.taskMeta}>
                    Saved: {formatCreatedDate(brainDump.createdAt)}
                  </Text>
                </View>

                <Pressable
                  style={styles.archiveButton}
                  onPress={() => archiveBrainDump(brainDump.id)}
                >
                  <Text style={styles.archiveButtonText}>Archive</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  contentDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: 16,
  },
  fullWidthPanel: { width: '100%' },
  dashboardHalf: {
    width: '49%',
    alignSelf: 'stretch',
  },
  primaryColumn: { width: '64%' },
  secondaryColumn: { width: '34%' },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  halfWidthCard: { width: '49%' },
  header: { marginBottom: 20 },
  title: { fontSize: 34, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 16, opacity: 0.7, lineHeight: 22 },
  progressCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ecfdf5',
    marginBottom: 14,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
    color: '#111827',
  },
  progressText: { fontSize: 15, color: '#374151' },
  overdueSection: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#fff1f2',
    marginBottom: 14,
  },
  overdueSectionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#991b1b',
  },
  overdueSectionSubtitle: {
    marginTop: 5,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 19,
    color: '#7f1d1d',
  },
  overdueList: { gap: 12, backgroundColor: 'transparent' },
  overdueCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f87171',
    backgroundColor: 'white',
    gap: 14,
  },
  overdueTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'transparent',
  },
  overdueTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  overdueBadge: {
    fontSize: 11,
    fontWeight: '900',
    color: '#991b1b',
    backgroundColor: '#fee2e2',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  overdueDueText: {
    marginTop: 5,
    fontSize: 13,
    color: '#b91c1c',
    fontWeight: '800',
  },
  streakCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#fff7ed',
    marginBottom: 14,
  },
  streakTextWrap: { backgroundColor: 'transparent' },
  streakTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  streakSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  streakBadgesRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  currentStreakBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#ffedd5',
  },
  currentStreakNumber: {
    fontSize: 30,
    fontWeight: '900',
    color: '#c2410c',
  },
  currentStreakText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9a3412',
  },
  longestStreakBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#fef3c7',
  },
  longestStreakNumber: {
    fontSize: 30,
    fontWeight: '900',
    color: '#b45309',
  },
  longestStreakText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  statBox: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'white',
  },
  statNumber: { fontSize: 22, fontWeight: '900', color: '#111827' },
  statLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  calculationNote: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 17,
    color: '#6b7280',
  },
  weekProgressCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#eff6ff',
    marginBottom: 22,
  },
  weekProgressTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  weekProgressSubtitle: {
    marginTop: 4,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
    color: '#6b7280',
  },
  weekDaysRow: { gap: 10, paddingBottom: 4 },
  weekDaysRowDesktop: {
    minWidth: '100%',
    justifyContent: 'space-between',
  },
  weekDayCard: {
    flexGrow: 1,
    minWidth: 72,
    minHeight: 112,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  weekDayCardCompleted: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
  },
  weekDayCardToday: { borderWidth: 3, borderColor: '#2563eb' },
  weekDayName: { fontSize: 13, fontWeight: '800', color: '#374151' },
  weekDayCount: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
  },
  weekDayStatus: {
    marginTop: 3,
    fontSize: 18,
    fontWeight: '900',
    color: '#9ca3af',
  },
  weekDayTextCompleted: { color: '#166534' },
  todayLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '800',
    color: '#2563eb',
  },
  weekLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  weekLegendText: { fontSize: 11, color: '#6b7280' },
  section: { marginBottom: 26, backgroundColor: 'transparent' },
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
  taskList: { gap: 12 },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    gap: 12,
  },
  taskTextWrap: { flex: 1, backgroundColor: 'transparent' },
  taskTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  taskMeta: { marginTop: 4, fontSize: 13, color: '#6b7280' },
  taskNotes: {
    marginTop: 6,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  taskActions: {
    gap: 8,
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  todayButton: {
    backgroundColor: '#f97316',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  calendarButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  inboxButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  doneButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  deleteButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  actionButtonText: { color: 'white', fontWeight: '700' },
  brainDumpList: { gap: 12 },
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
  brainDumpTextWrap: { flex: 1, backgroundColor: 'transparent' },
  brainDumpBody: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
  },
  archiveButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  archiveButtonText: { color: 'white', fontWeight: '700' },
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
  emptyText: { fontSize: 14, color: '#6b7280' },
});
