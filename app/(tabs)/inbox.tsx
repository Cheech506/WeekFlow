import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
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

function formatCreatedDate(value: string) {
  const date = new Date(value);

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function InboxScreen() {
  const [taskText, setTaskText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [priority, setPriority] = useState(0);
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
  const [brainDumpText, setBrainDumpText] = useState('');

  const {
    addTask,
    completeTask,
    deleteTask,
    moveTaskToDay,
    getInboxTasks,
  } = useTasks();

  const {
    addBrainDump,
    archiveBrainDump,
    deleteBrainDump,
    getActiveBrainDumps,
  } = useBrainDumps();

  const { goals } = useGoals();

  const inboxTasks = getInboxTasks();
  const activeBrainDumps = getActiveBrainDumps();

  async function handleAddTask() {
    await addTask(taskText, 'Inbox', notesText, priority, selectedGoalId);

    setTaskText('');
    setNotesText('');
    setPriority(0);
    setSelectedGoalId(null);
  }

  async function handleAddBrainDump() {
    await addBrainDump(brainDumpText);
    setBrainDumpText('');
  }

  async function handleTurnBrainDumpIntoTask(
    brainDumpId: number,
    brainDumpBody: string
  ) {
    await addTask(brainDumpBody, 'Inbox');
    await deleteBrainDump(brainDumpId);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          Capture tasks, reminders, and random thoughts before they get lost.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Inbox Overview</Text>
        <Text style={styles.progressText}>
          {inboxTasks.length} unscheduled task
          {inboxTasks.length === 1 ? '' : 's'} • {activeBrainDumps.length} brain dump note
          {activeBrainDumps.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Task</Text>
        <Text style={styles.sectionSubtitle}>
          Add something that needs to be scheduled or completed.
        </Text>

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
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Brain Dump Notes</Text>
        <Text style={styles.sectionSubtitle}>
          Write down thoughts, reminders, ideas, or stuff you just need out of your head.
        </Text>

        <View style={styles.brainDumpAddCard}>
          <TextInput
            style={[styles.input, styles.brainDumpInput]}
            placeholder="Write anything here..."
            value={brainDumpText}
            onChangeText={setBrainDumpText}
            multiline
          />

          <Pressable
            style={styles.brainDumpButton}
            onPress={handleAddBrainDump}
          >
            <Text style={styles.brainDumpButtonText}>Save Brain Dump</Text>
          </Pressable>
        </View>

        <View style={styles.brainDumpList}>
          {activeBrainDumps.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No brain dumps yet</Text>
              <Text style={styles.emptyText}>
                Use this area for random thoughts that are not really tasks yet.
              </Text>
            </View>
          ) : (
            activeBrainDumps.map((brainDump) => (
              <View key={brainDump.id} style={styles.brainDumpCard}>
                <View style={styles.brainDumpTextWrap}>
                  <Text style={styles.brainDumpBody}>{brainDump.body}</Text>
                  <Text style={styles.taskMeta}>
                    Saved: {formatCreatedDate(brainDump.createdAt)}
                  </Text>
                </View>

                <View style={styles.taskActions}>
                  <Pressable
                    style={styles.turnIntoTaskButton}
                    onPress={() =>
                      handleTurnBrainDumpIntoTask(
                        brainDump.id,
                        brainDump.body
                      )
                    }
                  >
                    <Text style={styles.turnIntoTaskButtonText}>
                      Turn Into Task
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.archiveButton}
                    onPress={() => archiveBrainDump(brainDump.id)}
                  >
                    <Text style={styles.archiveButtonText}>Archive</Text>
                  </Pressable>

                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => deleteBrainDump(brainDump.id)}
                  >
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Unscheduled Tasks</Text>
        <Text style={styles.sectionSubtitle}>
          These still need to be moved into the week.
        </Text>

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
  section: {
    marginBottom: 26,
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
    lineHeight: 20,
  },
  addCard: {
    gap: 10,
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
  brainDumpAddCard: {
    gap: 10,
    backgroundColor: 'transparent',
  },
  brainDumpInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  brainDumpButton: {
    backgroundColor: '#0f766e',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  brainDumpButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  brainDumpList: {
    gap: 12,
    marginTop: 14,
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
  turnIntoTaskButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  turnIntoTaskButtonText: {
    color: 'white',
    fontWeight: '700',
  },
  archiveButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  archiveButtonText: {
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