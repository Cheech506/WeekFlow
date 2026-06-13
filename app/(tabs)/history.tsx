import { ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useTasks } from '@/context/TaskContext';

function formatCompletedDate(value: string | null) {
  if (!value) return 'Completed date unknown';

  const date = new Date(value);

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

export default function HistoryScreen() {
  const { tasks } = useTasks();

  const completedTasks = tasks
    .filter((task) => task.completed)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;

      return bTime - aTime;
    });

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Completed History</Text>
        <Text style={styles.subtitle}>
          Look back at everything you knocked out.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Accomplishments</Text>
        <Text style={styles.progressText}>
          {completedTasks.length} completed task
          {completedTasks.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.list}>
        {completedTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing completed yet</Text>
            <Text style={styles.emptyText}>
              Finish a task from Daily or Weekly and it will show up here.
            </Text>
          </View>
        ) : (
          completedTasks.map((task) => (
            <View key={task.id} style={styles.taskCard}>
                <Text style={styles.taskTitle}>{task.title}</Text>

                <Text style={styles.taskMeta}>Assigned day: {task.day}</Text>

                <Text style={styles.taskMeta}>
                    Priority: {getPriorityLabel(task.priority)}
                </Text>
    
                {task.notes ? (
                    <Text style={styles.taskNotes}>{task.notes}</Text>
                ) : null}

                <Text style={styles.taskMeta}>
                    Completed: {task.completedAt ? new Date(task.completedAt).toLocaleString() : 'Unknown'}
                </Text>
            </View>
          ))
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

  taskNotes: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
});