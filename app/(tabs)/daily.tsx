import {
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { calculateProgressStats } from '@/lib/progressStats';

const dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

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
  const {
    tasks,
    completeTask,
    deleteTask,
    moveTaskToDay,
    getActiveTasksByDay,
  } = useTasks();

  const { goals } = useGoals();

  const {
    getActiveBrainDumps,
    archiveBrainDump,
  } = useBrainDumps();

  const today = dayNames[new Date().getDay()];
  const activeTasks = getActiveTasksByDay(today);
  const activeBrainDumps = getActiveBrainDumps();

  const progressStats = calculateProgressStats(tasks);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Daily Tasks</Text>

        <Text style={styles.subtitle}>
          Today is {today}. Review what needs attention today.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>
          Today&apos;s Progress
        </Text>

        <Text style={styles.progressText}>
          {progressStats.completedToday} completed •{' '}
          {activeTasks.length} task
          {activeTasks.length === 1 ? '' : 's'} left •{' '}
          {activeBrainDumps.length} brain dump note
          {activeBrainDumps.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.streakCard}>
        <View style={styles.streakHeader}>
          <View style={styles.streakTextWrap}>
            <Text style={styles.streakTitle}>
              Progress & Streaks
            </Text>

            <Text style={styles.streakSubtitle}>
              Complete at least one task each day to continue
              your streak.
            </Text>
          </View>

          <View style={styles.streakBadge}>
            <Text style={styles.streakNumber}>
              {progressStats.currentStreak}
            </Text>

            <Text style={styles.streakBadgeText}>
              day streak 🔥
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Today&apos;s Tasks
        </Text>

        <Text style={styles.sectionSubtitle}>
          Tasks moved from Inbox into today show here.
        </Text>

        <View style={styles.taskList}>
          {activeTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Nothing for today 🎉
              </Text>

              <Text style={styles.emptyText}>
                Move a task from Inbox into today when
                something needs to be done.
              </Text>
            </View>
          ) : (
            activeTasks.map((task) => {
              const linkedGoal = goals.find(
                (goal) => goal.id === task.goalId
              );

              return (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskTitle}>
                      {task.title}
                    </Text>

                    <Text style={styles.taskMeta}>
                      Assigned day: {task.day}
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
                  </View>

                  <View style={styles.taskActions}>
                    <Pressable
                      style={styles.inboxButton}
                      onPress={() =>
                        moveTaskToDay(task.id, 'Inbox')
                      }
                    >
                      <Text style={styles.inboxButtonText}>
                        Back to Inbox
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.doneButton}
                      onPress={() => completeTask(task.id)}
                    >
                      <Text style={styles.doneButtonText}>
                        Done
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.deleteButton}
                      onPress={() => deleteTask(task.id)}
                    >
                      <Text style={styles.deleteButtonText}>
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>

      <View style={styles.section}>
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
              <View
                key={brainDump.id}
                style={styles.brainDumpCard}
              >
                <View style={styles.brainDumpTextWrap}>
                  <Text style={styles.brainDumpBody}>
                    {brainDump.body}
                  </Text>

                  <Text style={styles.taskMeta}>
                    Saved:{' '}
                    {formatCreatedDate(
                      brainDump.createdAt
                    )}
                  </Text>
                </View>

                <Pressable
                  style={styles.archiveButton}
                  onPress={() =>
                    archiveBrainDump(brainDump.id)
                  }
                >
                  <Text style={styles.archiveButtonText}>
                    Archive
                  </Text>
                </Pressable>
              </View>
            ))
          )}
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
    backgroundColor: '#ecfdf5',
    marginBottom: 14,
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
  streakCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#fff7ed',
    marginBottom: 22,
  },
  streakHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: 'transparent',
  },
  streakTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  streakTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  streakSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  streakBadge: {
    minWidth: 100,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#ffedd5',
  },
  streakNumber: {
    fontSize: 28,
    fontWeight: '900',
    color: '#c2410c',
  },
  streakBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9a3412',
    textAlign: 'center',
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
  statNumber: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 4,
  },
  statLabel: {
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
  section: {
    marginBottom: 26,
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
  taskList: {
    gap: 12,
  },
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
  taskTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  taskMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
  },
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
  inboxButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  inboxButtonText: {
    color: 'white',
    fontWeight: '700',
  },
  doneButton: {
    backgroundColor: '#16a34a',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  doneButtonText: {
    color: 'white',
    fontWeight: '700',
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
  brainDumpList: {
    gap: 12,
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
  },
  archiveButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  archiveButtonText: {
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