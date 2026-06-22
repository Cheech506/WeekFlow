import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import {
  formatDateKey,
  getLocalDateKey,
  getWeekDays,
  isDateKeyOverdue,
} from '@/lib/dateUtils';
import { calculateProgressStats } from '@/lib/progressStats';
import { calculateWeeklyReview } from '@/lib/weeklyReview';

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

export default function WeeklyScreen() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [isReviewExpanded, setIsReviewExpanded] = useState(true);

  const {
    tasks,
    completeTask,
    deleteTask,
    scheduleTask,
    moveTaskToInbox,
    getActiveTasksByDate,
  } = useTasks();

  const { goals } = useGoals();
  const { brainDumps } = useBrainDumps();
  const todayDateKey = getLocalDateKey(new Date());

  /*
   * Week navigation is based on real Monday-through-Sunday date ranges.
   * This lets users inspect next week's tasks before that week begins.
   */
  const weekDays = useMemo(
    () => getWeekDays(new Date(), weekOffset),
    [weekOffset]
  );

  const weeklyReview = useMemo(
    () =>
      calculateWeeklyReview(
        tasks,
        goals,
        brainDumps,
        new Date(),
        weekOffset
      ),
    [tasks, goals, brainDumps, weekOffset]
  );

  /*
   * Streaks describe the user's current overall consistency, so they are
   * displayed only while reviewing the current week.
   */
  const currentProgressStats = useMemo(
    () => calculateProgressStats(tasks),
    [tasks]
  );

  /*
   * The current week starts expanded. Previous and future weeks start
   * collapsed so the task schedule remains the main focus.
   */
  useEffect(() => {
    setIsReviewExpanded(weekOffset === 0);
  }, [weekOffset]);

  const firstDate = weekDays[0].dateKey;
  const lastDate = weekDays[6].dateKey;
  const weekLabel = `${formatDateKey(firstDate, {
    month: 'short',
    day: 'numeric',
  })} – ${formatDateKey(lastDate, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  const reviewGoalCount =
    weeklyReview.status === 'future'
      ? weeklyReview.scheduledGoalCount
      : weeklyReview.goalsProgressedCount;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Weekly Tasks</Text>
        <Text style={styles.subtitle}>
          View scheduled tasks by their real calendar dates.
        </Text>
      </View>

      <View style={styles.weekNavigationCard}>
        <Text style={styles.weekLabel}>{weekLabel}</Text>

        <View style={styles.weekNavigationRow}>
          <Pressable
            style={styles.navigationButton}
            onPress={() => setWeekOffset((current) => current - 1)}
          >
            <Text style={styles.navigationButtonText}>Previous</Text>
          </Pressable>

          <Pressable
            style={[
              styles.navigationButton,
              weekOffset === 0 && styles.navigationButtonSelected,
            ]}
            onPress={() => setWeekOffset(0)}
          >
            <Text
              style={[
                styles.navigationButtonText,
                weekOffset === 0 && styles.navigationButtonTextSelected,
              ]}
            >
              This Week
            </Text>
          </Pressable>

          <Pressable
            style={styles.navigationButton}
            onPress={() => setWeekOffset((current) => current + 1)}
          >
            <Text style={styles.navigationButtonText}>Next</Text>
          </Pressable>
        </View>
      </View>

      <View
        style={[
          styles.reviewCard,
          weeklyReview.status === 'past' && styles.pastReviewCard,
          weeklyReview.status === 'future' && styles.futureReviewCard,
        ]}
      >
        <Pressable
          style={styles.reviewHeader}
          onPress={() =>
            setIsReviewExpanded((current) => !current)
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: isReviewExpanded }}
          accessibilityLabel={`${weeklyReview.title}. ${
            isReviewExpanded ? 'Collapse' : 'Expand'
          } weekly summary.`}
        >
          <View style={styles.reviewHeaderText}>
            <Text style={styles.reviewTitle}>
              {weeklyReview.title}
            </Text>

            <Text style={styles.reviewCollapsedSummary}>
              {weeklyReview.collapsedSummary}
            </Text>
          </View>

          <Text style={styles.reviewChevron}>
            {isReviewExpanded ? '▼' : '▶'}
          </Text>
        </Pressable>

        {isReviewExpanded ? (
          <View style={styles.reviewBody}>
            <View style={styles.summaryList}>
              {weeklyReview.summaryLines.map((line, index) => (
                <Text
                  key={`${line}-${index}`}
                  style={styles.summaryLine}
                >
                  • {line}
                </Text>
              ))}
            </View>

            <View style={styles.reviewMetrics}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {weeklyReview.status === 'future'
                    ? weeklyReview.unfinishedCount
                    : weeklyReview.completedCount}
                </Text>
                <Text style={styles.metricLabel}>
                  {weeklyReview.status === 'future'
                    ? 'Scheduled'
                    : 'Completed'}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {weeklyReview.unfinishedCount}
                </Text>
                <Text style={styles.metricLabel}>
                  {weeklyReview.status === 'future'
                    ? 'Planned'
                    : 'Remaining'}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {weeklyReview.status === 'future'
                    ? reviewGoalCount
                    : `${weeklyReview.completionRate}%`}
                </Text>
                <Text style={styles.metricLabel}>
                  {weeklyReview.status === 'future'
                    ? 'Linked Goals'
                    : 'Completion'}
                </Text>
              </View>

              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>
                  {reviewGoalCount}
                </Text>
                <Text style={styles.metricLabel}>
                  {weeklyReview.status === 'future'
                    ? 'Goals'
                    : 'Goals Progressed'}
                </Text>
              </View>
            </View>

            {weeklyReview.status === 'current' ? (
              <View style={styles.streakRow}>
                <View style={styles.streakBadge}>
                  <Text style={styles.streakIcon}>🔥</Text>
                  <View style={styles.transparentView}>
                    <Text style={styles.streakValue}>
                      {currentProgressStats.currentStreak}
                    </Text>
                    <Text style={styles.streakLabel}>
                      Current Streak
                    </Text>
                  </View>
                </View>

                <View style={styles.streakBadge}>
                  <Text style={styles.streakIcon}>🏆</Text>
                  <View style={styles.transparentView}>
                    <Text style={styles.streakValue}>
                      {currentProgressStats.longestStreak}
                    </Text>
                    <Text style={styles.streakLabel}>
                      Longest Streak
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.weekList}>
        {weekDays.map((calendarDay) => {
          const dayTasks = getActiveTasksByDate(calendarDay.dateKey);

          return (
            <View
              key={calendarDay.dateKey}
              style={[
                styles.daySection,
                calendarDay.isToday && styles.todaySection,
              ]}
            >
              <View style={styles.dayHeaderRow}>
                <View style={styles.transparentView}>
                  <Text style={styles.dayTitle}>{calendarDay.dayName}</Text>
                  <Text style={styles.dayDate}>
                    {formatDateKey(calendarDay.dateKey, {
                      month: 'long',
                      day: 'numeric',
                    })}
                  </Text>
                </View>

                {calendarDay.isToday ? (
                  <Text style={styles.todayBadge}>Today</Text>
                ) : null}
              </View>

              {dayTasks.length === 0 ? (
                <Text style={styles.emptyDayText}>Nothing scheduled.</Text>
              ) : (
                <View style={styles.taskList}>
                  {dayTasks.map((task) => {
                    const linkedGoal = goals.find(
                      (goal) => goal.id === task.goalId
                    );
                    const isOverdue = isDateKeyOverdue(task.dueDate);

                    return (
                      <View
                        key={task.id}
                        style={[
                          styles.taskCard,
                          isOverdue && styles.overdueTaskCard,
                        ]}
                      >
                        <View style={styles.taskTextWrap}>
                          <View style={styles.taskTitleRow}>
                            <Text style={styles.taskTitle}>{task.title}</Text>

                            {isOverdue ? (
                              <Text style={styles.overdueBadge}>Overdue</Text>
                            ) : null}
                          </View>

                          <Text
                            style={[
                              styles.taskMeta,
                              isOverdue && styles.overdueText,
                            ]}
                          >
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
                          {isOverdue ? (
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
                          ) : null}

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
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 18 },
  title: { fontSize: 34, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 16, opacity: 0.7, lineHeight: 22 },
  weekNavigationCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    marginBottom: 18,
  },
  weekLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  weekNavigationRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  navigationButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  navigationButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  navigationButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563eb',
  },
  navigationButtonTextSelected: { color: 'white' },
  reviewCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    marginBottom: 18,
    overflow: 'hidden',
  },
  pastReviewCard: {
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  futureReviewCard: {
    borderColor: '#ddd6fe',
    backgroundColor: '#f5f3ff',
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    backgroundColor: 'transparent',
  },
  reviewHeaderText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  reviewTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 3,
  },
  reviewCollapsedSummary: {
    fontSize: 13,
    color: '#4b5563',
  },
  reviewChevron: {
    fontSize: 18,
    fontWeight: '900',
    color: '#2563eb',
  },
  reviewBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: 'transparent',
  },
  summaryList: {
    gap: 7,
    marginBottom: 14,
    backgroundColor: 'transparent',
  },
  summaryLine: {
    fontSize: 14,
    lineHeight: 20,
    color: '#374151',
  },
  reviewMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  metricCard: {
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    textAlign: 'center',
  },
  streakRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  streakBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  streakIcon: {
    fontSize: 24,
  },
  streakValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  streakLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '700',
  },
  weekList: { gap: 18 },
  daySection: {
    backgroundColor: 'white',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  todaySection: { borderWidth: 3, borderColor: '#2563eb' },
  dayHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'transparent',
  },
  transparentView: { backgroundColor: 'transparent' },
  dayTitle: { fontSize: 24, fontWeight: '800', color: '#111827' },
  dayDate: { marginTop: 2, fontSize: 14, color: '#6b7280' },
  todayBadge: {
    color: '#2563eb',
    backgroundColor: '#dbeafe',
    fontWeight: '800',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  emptyDayText: { fontSize: 15, color: '#6b7280' },
  taskList: { gap: 10 },
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
  overdueTaskCard: {
    borderColor: '#f87171',
    backgroundColor: '#fef2f2',
  },
  taskTextWrap: { flex: 1, backgroundColor: 'transparent' },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  taskTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
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
  taskMeta: { marginTop: 4, fontSize: 13, color: '#6b7280' },
  overdueText: { color: '#b91c1c', fontWeight: '800' },
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
});
