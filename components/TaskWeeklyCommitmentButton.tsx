import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/Themed';
import { useCycle } from '@/context/CycleContext';
import type { Task } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import {
  addDays,
  getLocalDateKey,
  getStartOfWeek,
  parseLocalDateKey,
} from '@/lib/dateUtils';

type TaskWeeklyCommitmentButtonProps = {
  task: Task;
  weekStart?: string;
  disabled?: boolean;
  compact?: boolean;
};

export function TaskWeeklyCommitmentButton({
  task,
  weekStart,
  disabled = false,
  compact = false,
}: TaskWeeklyCommitmentButtonProps) {
  const [isAdding, setIsAdding] = useState(false);
  const { cycles } = useCycle();
  const { commitments, addTaskCommitment } = useWeeklyReviews();
  const resolvedWeekStart =
    weekStart ?? getLocalDateKey(getStartOfWeek(new Date()));
  const weekEnd = useMemo(() => {
    const parsedWeekStart = parseLocalDateKey(resolvedWeekStart);
    return parsedWeekStart
      ? getLocalDateKey(addDays(parsedWeekStart, 6))
      : resolvedWeekStart;
  }, [resolvedWeekStart]);
  const selectedCycle = cycles.find(
    (cycle) =>
      cycle.startDate <= weekEnd && cycle.endDate >= resolvedWeekStart
  );
  const isLinked = commitments.some(
    (commitment) =>
      commitment.weekStart === resolvedWeekStart &&
      commitment.taskId === task.id
  );

  async function handlePress() {
    if (disabled || isLinked || isAdding) return;

    setIsAdding(true);
    try {
      await addTaskCommitment(
        resolvedWeekStart,
        selectedCycle?.id ?? null,
        task.id
      );
    } catch (error) {
      Alert.alert(
        'Could Not Add Commitment',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not make that task a weekly commitment.'
      );
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <Pressable
      style={[
        styles.button,
        compact && styles.buttonCompact,
        isLinked && styles.buttonLinked,
        (disabled || isAdding) && styles.buttonDisabled,
      ]}
      disabled={disabled || isLinked || isAdding}
      onPress={() => void handlePress()}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || isLinked || isAdding }}
      accessibilityLabel={
        isLinked
          ? `${task.title} is already a weekly commitment`
          : `Make ${task.title} a weekly commitment`
      }
    >
      <Text
        style={[
          styles.buttonText,
          isLinked && styles.buttonTextLinked,
          compact && styles.buttonTextCompact,
        ]}
      >
        {isLinked
          ? 'Commitment'
          : isAdding
            ? 'Adding...'
            : compact
              ? 'Commit'
              : 'Make Commitment'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
  },
  buttonCompact: {
    minHeight: 34,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  buttonLinked: {
    borderWidth: 1,
    borderColor: '#8b5cf6',
    backgroundColor: '#ede9fe',
  },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: 'white', fontSize: 12, fontWeight: '900' },
  buttonTextCompact: { fontSize: 11 },
  buttonTextLinked: { color: '#6d28d9' },
});
