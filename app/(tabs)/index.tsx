import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useGoals } from '@/context/GoalContext';

function formatGoalDate(value: string) {
  const date = new Date(value);

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TwelveWeekGoalsScreen() {
  const [goalText, setGoalText] = useState('');
  const { goals, isLoading, addGoal, toggleGoal, deleteGoal } = useGoals();

  const completedCount = goals.filter((goal) => goal.completed).length;

  async function handleAddGoal() {
    await addGoal(goalText);
    setGoalText('');
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>12 Week Goals</Text>
        <Text style={styles.subtitle}>
          Pick the bigger goals you want to make progress on over the next 3 months.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Progress</Text>
        <Text style={styles.progressText}>
          {completedCount} of {goals.length} goals completed
        </Text>
      </View>

      <View style={styles.addCard}>
        <TextInput
          style={styles.input}
          placeholder="Add a 12 week goal..."
          value={goalText}
          onChangeText={setGoalText}
          onSubmitEditing={handleAddGoal}
          returnKeyType="done"
        />

        <Pressable style={styles.addButton} onPress={handleAddGoal}>
          <Text style={styles.addButtonText}>Add Goal</Text>
        </Pressable>
      </View>

      <View style={styles.goalList}>
        {isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Loading goals...</Text>
          </View>
        ) : goals.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No goals yet</Text>
            <Text style={styles.emptyText}>
              Add a 12 week goal to start planning the bigger picture.
            </Text>
          </View>
        ) : (
          goals.map((goal) => (
            <View key={goal.id} style={styles.goalCard}>
              <Pressable
                style={styles.goalMain}
                onPress={() => toggleGoal(goal.id)}
              >
                <Text style={styles.checkbox}>
                  {goal.completed ? '✅' : '⬜'}
                </Text>

                <View style={styles.goalTextWrap}>
                  <Text
                    style={[
                      styles.goalTitle,
                      goal.completed && styles.goalCompleted,
                    ]}
                  >
                    {goal.title}
                  </Text>

                  <Text style={styles.goalMeta}>
                    {formatGoalDate(goal.startDate)} → {formatGoalDate(goal.endDate)}
                  </Text>

                  <Text style={styles.goalMeta}>
                    Tap to {goal.completed ? 'mark active' : 'mark complete'}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.goalActions}>
                <Pressable
                  style={styles.deleteButton}
                  onPress={() => deleteGoal(goal.id)}
                >
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </Pressable>
              </View>
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
    backgroundColor: '#eef6ff',
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
  goalList: {
    gap: 12,
  },
  goalCard: {
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
  goalMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    fontSize: 24,
    marginRight: 12,
  },
  goalTextWrap: {
    flex: 1,
  },
  goalActions: {
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  goalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  goalCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  goalMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
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