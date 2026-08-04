import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import type { PlanningCycle } from '@/lib/cycleStorage';
import { formatDateKey } from '@/lib/dateUtils';
import type { StoredGoal } from '@/lib/goalStorage';

export default function PastCycleFolder({
  cycle,
  cycleLabel,
  goals,
}: {
  cycle: PlanningCycle;
  cycleLabel: string;
  goals: StoredGoal[];
}) {
  const [expanded, setExpanded] = useState(false);
  const completedGoals = goals.filter((goal) => goal.completed).length;
  const unfinishedGoals = goals.length - completedGoals;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.header}
        onPress={() => setExpanded((current) => !current)}
      >
        <View style={styles.headerText}>
          <Text style={styles.title}>{cycleLabel}</Text>
          <Text style={styles.dates}>
            {formatDateKey(cycle.startDate)} → {formatDateKey(cycle.endDate)}
          </Text>
          <Text style={styles.summary}>
            {completedGoals} completed • {unfinishedGoals} unfinished
          </Text>
        </View>

        <Text style={styles.action}>{expanded ? 'Hide' : 'Open'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.details}>
          {cycle.primaryFocus ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Primary Focus</Text>
              <Text style={styles.detailText}>{cycle.primaryFocus}</Text>
            </View>
          ) : null}

          {cycle.theme ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Theme</Text>
              <Text style={styles.detailText}>{cycle.theme}</Text>
            </View>
          ) : null}

          {goals.length === 0 ? (
            <Text style={styles.emptyText}>
              No goals were assigned to this cycle.
            </Text>
          ) : (
            goals.map((goal) => (
              <View key={goal.id} style={styles.goalRow}>
                <Text style={styles.goalStatus}>
                  {goal.completed ? '✓' : '○'}
                </Text>
                <View style={styles.goalTextWrap}>
                  <Text style={styles.goalTitle}>{goal.title}</Text>
                  <Text style={styles.goalMeta}>
                    {goal.completed ? 'Completed' : 'Unfinished'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#d8dde6',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  header: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  dates: {
    marginTop: 4,
    color: '#596579',
  },
  summary: {
    marginTop: 6,
    color: '#334155',
    fontWeight: '600',
  },
  action: {
    color: '#2563eb',
    fontWeight: '800',
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    padding: 18,
    gap: 14,
    backgroundColor: '#f8fafc',
  },
  detailSection: {
    backgroundColor: 'transparent',
  },
  detailLabel: {
    color: '#6d28d9',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  detailText: {
    marginTop: 4,
    color: '#1f2937',
  },
  emptyText: {
    color: '#64748b',
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  goalStatus: {
    fontSize: 18,
    color: '#2563eb',
  },
  goalTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  goalTitle: {
    fontWeight: '700',
    color: '#111827',
  },
  goalMeta: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 13,
  },
});
