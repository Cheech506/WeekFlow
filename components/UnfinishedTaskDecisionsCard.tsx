import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { formatDateKey } from '@/lib/dateUtils';
import type { WeeklyReviewStatus } from '@/lib/weeklyReview';
import type {
  WeeklyTaskDecision,
  WeeklyTaskDecisionAction,
} from '@/lib/weeklyReviewStorage';
import type { Task } from '@/lib/taskStorage';

type UnfinishedTaskDecisionsCardProps = {
  status: WeeklyReviewStatus;
  weekLabel: string;
  tasks: Task[];
  decisions: WeeklyTaskDecision[];
  onChooseDate: (task: Task) => void;
  onDecision: (
    task: Task,
    action: Exclude<WeeklyTaskDecisionAction, 'reschedule'>
  ) => Promise<void>;
  onUndoKeep: (decisionId: number) => Promise<void>;
};

export function UnfinishedTaskDecisionsCard({
  status,
  weekLabel,
  tasks,
  decisions,
  onChooseDate,
  onDecision,
  onUndoKeep,
}: UnfinishedTaskDecisionsCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
  }, [weekLabel]);

  if (status === 'future') {
    return null;
  }

  const keepDecisions = decisions.filter(
    (decision) => decision.action === 'keep'
  );
  const decidedTaskIds = new Set(
    decisions
      .map((decision) => decision.taskId)
      .filter((taskId): taskId is number => taskId !== null)
  );
  const unresolvedTasks = tasks.filter(
    (task) => !decidedTaskIds.has(task.id)
  );
  const resolvedCount = decisions.length;
  const pendingCount = unresolvedTasks.length;

  const summary =
    status === 'current'
      ? `${pendingCount} ${pendingCount === 1 ? 'task' : 'tasks'} due through today still need a decision.`
      : `${pendingCount} unfinished ${pendingCount === 1 ? 'task' : 'tasks'} from this completed week still need a decision.`;

  async function handleUndoKeep(decisionId: number) {
    try {
      await onUndoKeep(decisionId);
    } catch (error) {
      Alert.alert(
        'Could Not Undo Decision',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not remove that unfinished-task decision.'
      );
    }
  }

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setIsExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`Unfinished task decisions for ${weekLabel}. ${pendingCount} pending. ${
          isExpanded ? 'Collapse' : 'Expand'
        } section.`}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>Unfinished Task Decisions</Text>
          <Text style={styles.subtitle}>{summary}</Text>
        </View>

        <View style={styles.headerActions}>
          <Text style={styles.pendingBadge}>{pendingCount} pending</Text>
          <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
        </View>
      </Pressable>

      {isExpanded ? (
        <View style={styles.expandedBody}>
          <Text style={styles.explanation}>
            Choose what should happen to unfinished work from {weekLabel}.
            Moving one recurring occurrence changes only that occurrence, not
            the full recurring schedule.
          </Text>

          {resolvedCount > 0 ? (
            <Text style={styles.decisionCount}>
              {resolvedCount}{' '}
              {resolvedCount === 1 ? 'decision' : 'decisions'} recorded for
              this week
            </Text>
          ) : null}

          {unresolvedTasks.length === 0 && keepDecisions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No unfinished scheduled tasks need a decision.
              </Text>
            </View>
          ) : null}

          <View style={styles.list}>
            {unresolvedTasks.map((task) => (
              <View key={task.id} style={styles.taskCard}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskMeta}>
                  Original date:{' '}
                  {task.dueDate ? formatDateKey(task.dueDate) : 'Unscheduled'}
                </Text>
                {task.recurringRuleId !== null ? (
                  <Text style={styles.recurringNote}>
                    Recurring occurrence — the parent schedule will stay
                    unchanged.
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  <DecisionButton
                    label="Next Week"
                    tone="primary"
                    onPress={() => void onDecision(task, 'nextWeek')}
                  />
                  <DecisionButton
                    label="Choose Date"
                    tone="calendar"
                    onPress={() => onChooseDate(task)}
                  />
                  <DecisionButton
                    label="Inbox"
                    tone="inbox"
                    onPress={() => void onDecision(task, 'inbox')}
                  />
                  <DecisionButton
                    label="Keep Date"
                    tone="keep"
                    onPress={() => void onDecision(task, 'keep')}
                  />
                  <DecisionButton
                    label="Delete"
                    tone="danger"
                    onPress={() => void onDecision(task, 'delete')}
                  />
                </View>
              </View>
            ))}

            {keepDecisions.map((decision) => (
              <View key={decision.id} style={styles.keptCard}>
                <View style={styles.keptTextWrap}>
                  <Text style={styles.taskTitle}>{decision.taskTitle}</Text>
                  <Text style={styles.taskMeta}>
                    Kept on {formatDateKey(decision.originalDueDate)}
                  </Text>
                </View>
                <Pressable
                  style={styles.undoButton}
                  onPress={() => void handleUndoKeep(decision.id)}
                >
                  <Text style={styles.undoButtonText}>Undo Decision</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DecisionButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: 'primary' | 'calendar' | 'inbox' | 'keep' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.actionButton,
        tone === 'primary' && styles.primaryButton,
        tone === 'calendar' && styles.calendarButton,
        tone === 'inbox' && styles.inboxButton,
        tone === 'keep' && styles.keepButton,
        tone === 'danger' && styles.dangerButton,
      ]}
      onPress={onPress}
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fdba74',
    backgroundColor: '#fff7ed',
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: { flex: 1, backgroundColor: 'transparent' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  title: { fontSize: 20, fontWeight: '900', color: '#111827' },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: '#4b5563',
  },
  pendingBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#ffedd5',
    color: '#9a3412',
    fontSize: 12,
    fontWeight: '900',
  },
  chevron: { color: '#c2410c', fontSize: 16, fontWeight: '900' },
  expandedBody: { backgroundColor: 'transparent' },
  explanation: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    color: '#4b5563',
  },
  decisionCount: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '800',
    color: '#9a3412',
  },
  emptyCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#fed7aa',
    backgroundColor: '#fffbeb',
  },
  emptyText: { color: '#6b7280', fontSize: 13 },
  list: { marginTop: 14, gap: 10, backgroundColor: 'transparent' },
  taskCard: {
    padding: 13,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#fed7aa',
    backgroundColor: 'white',
  },
  taskTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  taskMeta: { marginTop: 4, fontSize: 12, color: '#6b7280' },
  recurringNote: {
    marginTop: 7,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    color: '#1d4ed8',
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 11,
    backgroundColor: 'transparent',
  },
  actionButton: {
    flexGrow: 1,
    minWidth: 96,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButton: { backgroundColor: '#2563eb' },
  calendarButton: { backgroundColor: '#7c3aed' },
  inboxButton: { backgroundColor: '#0f766e' },
  keepButton: { backgroundColor: '#6b7280' },
  dangerButton: { backgroundColor: '#dc2626' },
  actionButtonText: { color: 'white', fontSize: 12, fontWeight: '900' },
  keptCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  keptTextWrap: { flex: 1, minWidth: 180, backgroundColor: 'transparent' },
  undoButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  undoButtonText: { color: '#374151', fontSize: 12, fontWeight: '800' },
});
