import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

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

export default function InboxScreen() {
  const [taskText, setTaskText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [priority, setPriority] = useState(0);
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);

  const {
    addTask,
    completeTask,
    deleteTask,
    moveTaskToDay,
    getInboxTasks,
  } = useTasks();

  const { goals } = useGoals();

  const inboxTasks = getInboxTasks();

  async function handleAddTask() {
    await addTask(taskText, 'Inbox', notesText, priority, selectedGoalId);

    setTaskText('');
    setNotesText('');
    setPriority(0);
    setSelectedGoalId(null);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          Brain dump tasks here now. Schedule them into the week later.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Unscheduled Tasks</Text>
        <Text style={styles.progressText}>
          {inboxTasks.length} task{inboxTasks.length === 1 ? '' : 's'} waiting to be scheduled
        </Text>
      </View>

      <View style={styles.addCard}>
        <TextInput
          style={styles.input}
          placeholder="Quick add something..."
          value={taskText}
          onChangeText={setTaskText}
          onSubmitEditing={handleAddTask}
          returnKeyType="done"
        />

        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Add notes... optional"
          value={notesText}
          onChangeText={setNotesText}
          multiline
        />

        <View style={styles.priorityPicker}>
          {[0, 1, 2].map((level) => (
            <Pressable
              key={level}
              style={[
                styles.priorityButton,
                priority === level && styles.priorityButtonSelected,
              ]}
              onPress={() => setPriority(level)}
            >
              <Text
                style={[
                  styles.priorityButtonText,
                  priority === level && styles.priorityButtonTextSelected,
                ]}
              >
                {level === 0 ? 'Low' : level === 1 ? 'Medium' : 'High'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.goalPickerSection}>
          <Text style={styles.goalPickerLabel}>Link to goal:</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.goalPicker}
          >
            <Pressable
              style={[
                styles.goalButton,
                selectedGoalId === null && styles.goalButtonSelected,
              ]}
              onPress={() => setSelectedGoalId(null)}
            >
              <Text
                style={[
                  styles.goalButtonText,
                  selectedGoalId === null && styles.goalButtonTextSelected,
                ]}
              >
                None
              </Text>
            </Pressable>

            {goals.map((goal) => (
              <Pressable
                key={goal.id}
                style={[
                  styles.goalButton,
                  selectedGoalId === goal.id && styles.goalButtonSelected,
                ]}
                onPress={() => setSelectedGoalId(goal.id)}
              >
                <Text
                  style={[
                    styles.goalButtonText,
                    selectedGoalId === goal.id && styles.goalButtonTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  {goal.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <Pressable style={styles.addButton} onPress={handleAddTask}>
          <Text style={styles.addButtonText}>Add to Inbox</Text>
        </Pressable>
      </View>

      <View style={styles.taskList}>
        {inboxTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Inbox is clear ✅</Text>
            <Text style={styles.emptyText}>
              Add quick tasks here when you do not want to schedule them yet.
            </Text>
          </View>
        ) : (
          inboxTasks.map((task) => {
            const linkedGoal = goals.find((goal) => goal.id === task.goalId);

            return (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskTopRow}>
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskTitle}>{task.title}</Text>

                    <Text style={styles.taskMeta}>Unscheduled</Text>

                    <Text style={styles.taskMeta}>
                      Priority: {getPriorityLabel(task.priority)}
                    </Text>

                    {linkedGoal ? (
                      <Text style={styles.taskMeta}>Goal: {linkedGoal.title}</Text>
                    ) : null}

                    {task.notes ? (
                      <Text style={styles.taskNotes}>{task.notes}</Text>
                    ) : null}
                  </View>

                  <View style={styles.taskActions}>
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

                <View style={styles.scheduleSection}>
                  <Text style={styles.scheduleLabel}>Move to:</Text>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.dayPicker}
                  >
                    {days.map((day) => (
                      <Pressable
                        key={day}
                        style={styles.dayButton}
                        onPress={() => moveTaskToDay(task.id, day)}
                      >
                        <Text style={styles.dayButtonText}>{day.slice(0, 3)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>
            );
          })
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
    backgroundColor: '#f5f3ff',
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
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  priorityPicker: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'transparent',
  },
  priorityButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  priorityButtonSelected: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  priorityButtonText: {
    fontWeight: '700',
    color: '#374151',
  },
  priorityButtonTextSelected: {
    color: 'white',
  },
  goalPickerSection: {
    gap: 8,
    backgroundColor: 'transparent',
  },
  goalPickerLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '700',
  },
  goalPicker: {
    gap: 8,
  },
  goalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
    maxWidth: 220,
  },
  goalButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  goalButtonText: {
    fontWeight: '700',
    color: '#374151',
  },
  goalButtonTextSelected: {
    color: 'white',
  },
  addButton: {
    backgroundColor: '#7c3aed',
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
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    gap: 14,
  },
  taskTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
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
  scheduleSection: {
    gap: 8,
    backgroundColor: 'transparent',
  },
  scheduleLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '700',
  },
  dayPicker: {
    gap: 8,
  },
  dayButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  dayButtonText: {
    fontWeight: '700',
    color: '#374151',
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