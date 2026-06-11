import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';

type Task = {
  id: number;
  title: string;
  completed: boolean;
};

export default function DailyScreen() {
  const [taskText, setTaskText] = useState('');

  const [tasks, setTasks] = useState<Task[]>([
    { id: 1, title: 'Example daily task', completed: false },
  ]);

  function addTask() {
    if (!taskText.trim()) return;

    const newTask: Task = {
      id: Date.now(),
      title: taskText.trim(),
      completed: false,
    };

    setTasks([newTask, ...tasks]);
    setTaskText('');
  }

  function completeTask(id: number) {
    setTasks(
      tasks.map((task) =>
        task.id === id ? { ...task, completed: true } : task
      )
    );
  }

  const activeTasks = tasks.filter((task) => !task.completed);
  const completedCount = tasks.filter((task) => task.completed).length;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Daily Tasks</Text>
        <Text style={styles.subtitle}>
          Write down what needs to get done today.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Today&apos;s Progress</Text>
        <Text style={styles.progressText}>
          {completedCount} completed • {activeTasks.length} left
        </Text>
      </View>

      <View style={styles.addCard}>
        <TextInput
          style={styles.input}
          placeholder="Add a task for today..."
          value={taskText}
          onChangeText={setTaskText}
          onSubmitEditing={addTask}
          returnKeyType="done"
        />

        <Pressable style={styles.addButton} onPress={addTask}>
          <Text style={styles.addButtonText}>Add Task</Text>
        </Pressable>
      </View>

      <View style={styles.taskList}>
        {activeTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>All clear ✅</Text>
            <Text style={styles.emptyText}>
              No daily tasks left. Go relax a little.
            </Text>
          </View>
        ) : (
          activeTasks.map((task) => (
            <View key={task.id} style={styles.taskCard}>
              <View style={styles.taskTextWrap}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskMeta}>Daily task</Text>
              </View>

              <Pressable
                style={styles.doneButton}
                onPress={() => completeTask(task.id)}
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
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
    backgroundColor: '#ecfdf5',
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
  addCard: {
    gap: 10,
    marginBottom: 24,
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
    backgroundColor: '#16a34a',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  taskList: {
    gap: 12,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    gap: 12,
  },
  taskTextWrap: {
    flex: 1,
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