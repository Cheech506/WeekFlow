import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import {
  MAX_GOAL_REFLECTION_LENGTH,
  normalizeGoalCompletionReflection,
  type GoalAnalytics,
  type GoalCompletionReflection,
} from '@/lib/goalReviewUtils';

export default function GoalCompletionPanel({
  goalTitle,
  analytics,
  initialReflection,
  onCancel,
  onComplete,
}: {
  goalTitle: string;
  analytics: GoalAnalytics;
  initialReflection: GoalCompletionReflection;
  onCancel: () => void;
  onComplete: (reflection: GoalCompletionReflection) => Promise<void>;
}) {
  const [whatHelped, setWhatHelped] = useState(
    initialReflection.whatHelped ?? ''
  );
  const [hardestPart, setHardestPart] = useState(
    initialReflection.hardestPart ?? ''
  );
  const [learned, setLearned] = useState(initialReflection.learned ?? '');
  const [doDifferently, setDoDifferently] = useState(
    initialReflection.doDifferently ?? ''
  );
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleComplete() {
    try {
      const reflection = normalizeGoalCompletionReflection({
        whatHelped,
        hardestPart,
        learned,
        doDifferently,
      });

      setIsSaving(true);
      setMessage('');
      await onComplete(reflection);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The goal could not be completed.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Complete “{goalTitle}”</Text>
      <Text style={styles.subtitle}>
        Reflection is optional. Your current result will be saved with the goal.
      </Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>
            {analytics.taskCompleted}/{analytics.taskTotal}
          </Text>
          <Text style={styles.summaryLabel}>Linked Tasks</Text>
        </View>

        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>
            {analytics.milestoneCompleted}/{analytics.milestoneTotal}
          </Text>
          <Text style={styles.summaryLabel}>Milestones</Text>
        </View>
      </View>

      <ReflectionField
        label="What helped you succeed?"
        placeholder="The routines, decisions, or support that helped..."
        value={whatHelped}
        onChangeText={setWhatHelped}
      />

      <ReflectionField
        label="What was the hardest part?"
        placeholder="The biggest challenge or obstacle..."
        value={hardestPart}
        onChangeText={setHardestPart}
      />

      <ReflectionField
        label="What did you learn?"
        placeholder="Skills, lessons, or discoveries from this goal..."
        value={learned}
        onChangeText={setLearned}
      />

      <ReflectionField
        label="What would you do differently next time?"
        placeholder="Changes you would make on a future goal..."
        value={doDifferently}
        onChangeText={setDoDifferently}
      />

      {message ? <Text style={styles.errorText}>{message}</Text> : null}

      <View style={styles.actions}>
        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>

        <Pressable
          style={[styles.completeButton, isSaving && styles.disabledButton]}
          onPress={handleComplete}
          disabled={isSaving}
        >
          <Text style={styles.completeButtonText}>
            {isSaving ? 'Completing...' : 'Complete Goal'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ReflectionField({
  label,
  placeholder,
  value,
  onChangeText,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline
        maxLength={MAX_GOAL_REFLECTION_LENGTH}
        textAlignVertical="top"
      />
      <Text style={styles.characterCount}>
        {value.length}/{MAX_GOAL_REFLECTION_LENGTH}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    gap: 11,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    color: '#14532d',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: '#3f6212',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  summaryItem: {
    flex: 1,
    minWidth: 120,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#dcfce7',
  },
  summaryValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#166534',
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#3f6212',
  },
  field: { backgroundColor: 'transparent' },
  label: {
    marginBottom: 5,
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
  },
  input: {
    minHeight: 78,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 11,
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: 'white',
  },
  characterCount: {
    marginTop: 4,
    textAlign: 'right',
    fontSize: 10,
    color: '#6b7280',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#b91c1c',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  cancelButton: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#e5e7eb',
  },
  cancelButtonText: {
    fontWeight: '800',
    color: '#374151',
  },
  completeButton: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#15803d',
  },
  completeButtonText: {
    fontWeight: '800',
    color: 'white',
  },
  disabledButton: { opacity: 0.6 },
});
