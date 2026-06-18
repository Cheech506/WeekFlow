import {
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';

const days = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

export default function WeeklyScreen() {
  const {
    completeTask,
    deleteTask,
    moveTaskToDay,
    getActiveTasksByDay,
  } = useTasks();

  const { goals } = useGoals();

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Weekly Tasks</Text>
        <Text style={styles.subtitle}>
          View what is planned for the week. Add, edit, and schedule tasks from Inbox.
        </Text>
      </View>

      <View style={styles.weekList}>
        {days.map((day) => {
          const dayTasks = getActiveTasksByDay(day);

          return (
            <View key={day} style={styles.daySection}>
              <Text style={styles.dayTitle}>{day}</Text>

              {dayTasks.length === 0 ? (
                <Text style={styles.emptyDayText}>Nothing scheduled.</Text>
              ) : (
                <View style={styles.taskList}>
                  {dayTasks.map((task) => {
                    const linkedGoal = goals.find(
                      (goal) => goal.id === task.goalId
                    );

                    return (
                      <View key={task.id} style={styles.taskCard}>
                        <View style={styles.taskTextWrap}>
                          <Text style={styles.taskTitle}>{task.title}</Text>

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
                            style={styles.inboxButton}
                            onPress={() => moveTaskToDay(task.id, 'Inbox')}
                          >
                            <Text style={styles.inboxButtonText}>
                              Back to Inbox
                            </Text>
                          </Pressable>

                          <Pressable
                            style={styles.doneButton}
                            onPress={() => completeTask(task.id)}
                          >
                            <Text style={styles.doneButtonText}>Done</Text>
                          </Pressable>

                          <Pressable
                            style={styles.deleteButton}
                            onPress={() => deleteTask(task.id)}
                          >
                            <Text style={styles.deleteButtonText}>Delete</Text>
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
  page: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
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
  weekList: {
    gap: 18,
  },
  daySection: {
    backgroundColor: 'white',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  dayTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  emptyDayText: {
    fontSize: 16,
    color: '#6b7280',
  },
  taskList: {
    gap: 10,
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
});