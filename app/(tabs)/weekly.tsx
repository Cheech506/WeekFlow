import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import {
  formatDateKey,
  getLocalDateKey,
  getWeekDays,
  isDateKeyOverdue,
} from '@/lib/dateUtils';

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

export default function WeeklyScreen() {
  const [weekOffset, setWeekOffset] = useState(0);

  const {
    completeTask,
    deleteTask,
    scheduleTask,
    moveTaskToInbox,
    getActiveTasksByDate,
  } = useTasks();

  const { goals } = useGoals();
  const todayDateKey = getLocalDateKey(new Date());

  /*
   * Week navigation is based on real Monday-through-Sunday date ranges.
   * This lets users inspect next week's tasks before that week begins.
   */
  const weekDays = useMemo(
    () => getWeekDays(new Date(), weekOffset),
    [weekOffset]
  );

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
