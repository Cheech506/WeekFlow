import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
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
  const [taskText, setTaskText] = useState('');
  const [selectedDay, setSelectedDay] = useState('Monday');

  const { addTask, completeTask, deleteTask, getActiveTasksByDay } = useTasks();

  function handleAddTask() {
    addTask(taskText, selectedDay);
    setTaskText('');
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Weekly Tasks</Text>
      <Text style={styles.subtitle}>Plan the week. Clear the list. Relax after.</Text>

      <View style={styles.addCard}>
        <TextInput
          style={styles.input}
          placeholder="Add a task for this week..."
          value={taskText}
          onChangeText={setTaskText}
          onSubmitEditing={handleAddTask}
          returnKeyType="done"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayPicker}
        >
          {days.map((day) => (
            <Pressable
              key={day}
              style={[
                styles.dayButton,
                selectedDay === day && styles.dayButtonSelected,
              ]}
              onPress={() => setSelectedDay(day)}
            >
              <Text
                style={[
                  styles.dayButtonText,
                  selectedDay === day && styles.dayButtonTextSelected,
                ]}
              >
                {day.slice(0, 3)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable style={styles.addButton} onPress={handleAddTask}>
          <Text style={styles.addButtonText}>Add to {selectedDay}</Text>
        </Pressable>
      </View>

      {days.map((day) => {
        const dayTasks = getActiveTasksByDay(day);

        return (
          <View key={day} style={styles.daySection}>
            <Text style={styles.dayTitle}>{day}</Text>

            {dayTasks.length === 0 ? (
              <Text style={styles.empty}>Nothing scheduled.</Text>
            ) : (
              dayTasks.map((task) => (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskTextWrap}>
                    <Text style={styles.taskTitle}>{task.title}</Text>

                    <Text style={styles.taskMeta}>
                      Priority: {getPriorityLabel(task.priority)}
                    </Text>

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
              ))
            )}
          </View>
        );
      })}
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
  title: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    marginBottom: 20,
  },
  addCard: {
    gap: 12,
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
  dayPicker: {
    gap: 8,
  },
  dayButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  dayButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  dayButtonText: {
    fontWeight: '700',
    color: '#374151',
  },
  dayButtonTextSelected: {
    color: 'white',
  },
  addButton: {
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  daySection: {
    marginBottom: 24,
  },
  dayTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
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
    marginBottom: 10,
  },
  taskTextWrap: {
  flex: 1,
  },
  taskActions: {
    gap: 8,
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  doneButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#16a34a',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  doneButtonText: {
    color: 'white',
    fontWeight: '700',
  },
  empty: {
    opacity: 0.55,
    fontSize: 14,
  },
  deleteButton: {
  alignSelf: 'flex-start',
  backgroundColor: '#dc2626',
  paddingVertical: 8,
  paddingHorizontal: 14,
  borderRadius: 10,
},
deleteButtonText: {
  color: 'white',
  fontWeight: '700',
},

  taskNotes: {
    marginTop: 6,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },

  taskMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
  },
});