import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';

type Goal = {
  id: number;
  title: string;
  completed: boolean;
};

export default function TwelveWeekGoalsScreen() {
  const [goalText, setGoalText] = useState('');
  const [goals, setGoals] = useState<Goal[]>([
    { id: 1, title: 'Build first version of task app', completed: false },
    { id: 2, title: 'Create weekly planning screen', completed: false },
    { id: 3, title: 'Add completed task history', completed: false },
  ]);

  function addGoal() {
    if (!goalText.trim()) return;

    const newGoal: Goal = {
      id: Date.now(),
      title: goalText.trim(),
      completed: false,
    };

    setGoals([newGoal, ...goals]);
    setGoalText('');
  }

  function toggleGoal(id: number) {
    setGoals(
      goals.map((goal) =>
        goal.id === id ? { ...goal, completed: !goal.completed } : goal
      )
    );
  }

  const completedCount = goals.filter((goal) => goal.completed).length;

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
          onSubmitEditing={addGoal}
          returnKeyType="done"
        />

        <Pressable style={styles.addButton} onPress={addGoal}>
          <Text style={styles.addButtonText}>Add Goal</Text>
        </Pressable>
      </View>

      <View style={styles.goalList}>
        {goals.map((goal) => (
          <Pressable
            key={goal.id}
            style={styles.goalCard}
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
              <Text style={styles.goalMeta}>Tap to mark complete</Text>
            </View>
          </Pressable>
        ))}
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
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  checkbox: {
    fontSize: 24,
    marginRight: 12,
  },
  goalTextWrap: {
    flex: 1,
  },
  goalTitle: {
    fontSize: 17,
    fontWeight: '600',
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
});