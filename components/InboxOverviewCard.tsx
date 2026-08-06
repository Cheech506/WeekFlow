import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import type {
  InboxOverviewSnapshot,
  InboxQuickFilter,
} from '@/lib/inboxOverviewUtils';

type InboxOverviewCardProps = {
  snapshot: InboxOverviewSnapshot;
  activeFilter: InboxQuickFilter | null;
  brainDumpCount: number;
  templateCount: number;
  onSelectFilter: (filter: InboxQuickFilter) => void;
};

type Metric = {
  filter: InboxQuickFilter;
  label: string;
  value: number;
  helper: string;
  accent: 'purple' | 'blue' | 'orange' | 'teal' | 'green';
};

export default function InboxOverviewCard({
  snapshot,
  activeFilter,
  brainDumpCount,
  templateCount,
  onSelectFilter,
}: InboxOverviewCardProps) {
  const metrics: Metric[] = [
    {
      filter: 'unscheduled',
      label: 'Unscheduled',
      value: snapshot.unscheduledTasks,
      helper: 'Still in Inbox',
      accent: 'purple',
    },
    {
      filter: 'today',
      label: 'Today',
      value: snapshot.scheduledToday,
      helper: 'Scheduled today',
      accent: 'blue',
    },
    {
      filter: 'overdue',
      label: 'Overdue',
      value: snapshot.overdueTasks,
      helper: 'Needs a decision',
      accent: 'orange',
    },
    {
      filter: 'recurring',
      label: 'Recurring',
      value: snapshot.activeRecurringSchedules,
      helper: 'Active schedules',
      accent: 'teal',
    },
    {
      filter: 'goalLinked',
      label: 'Goal Linked',
      value: snapshot.goalLinkedTasks,
      helper: 'Active goal tasks',
      accent: 'green',
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Inbox Overview</Text>
          <Text style={styles.summary}>
            {snapshot.totalActiveTasks} active task
            {snapshot.totalActiveTasks === 1 ? '' : 's'} • {brainDumpCount}{' '}
            brain dump{brainDumpCount === 1 ? '' : 's'} • {templateCount}{' '}
            template{templateCount === 1 ? '' : 's'}
          </Text>
        </View>

        <Pressable
          style={[
            styles.allButton,
            activeFilter === 'all' && styles.allButtonSelected,
          ]}
          onPress={() => onSelectFilter('all')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeFilter === 'all' }}
        >
          <Text
            style={[
              styles.allButtonText,
              activeFilter === 'all' && styles.allButtonTextSelected,
            ]}
          >
            View All
          </Text>
        </Pressable>
      </View>

      <View style={styles.metricGrid}>
        {metrics.map((metric) => {
          const selected = activeFilter === metric.filter;

          return (
            <Pressable
              key={metric.filter}
              style={[
                styles.metric,
                styles[`${metric.accent}Metric`],
                selected && styles.metricSelected,
              ]}
              onPress={() => onSelectFilter(metric.filter)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${metric.label}: ${metric.value}. Filter tasks by ${metric.label.toLowerCase()}.`}
            >
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricHelper}>{metric.helper}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.helpText}>
        Tap a number to jump directly to that task view. Detailed search and
        filters stay available below.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#f5f3ff',
    marginBottom: 18,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'transparent',
  },
  headerText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  summary: {
    marginTop: 4,
    color: '#4b5563',
    lineHeight: 19,
  },
  allButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8b5cf6',
    backgroundColor: '#ffffff',
  },
  allButtonSelected: {
    backgroundColor: '#7c3aed',
  },
  allButtonText: {
    color: '#6d28d9',
    fontWeight: '900',
    fontSize: 12,
  },
  allButtonTextSelected: {
    color: '#ffffff',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  metric: {
    flexGrow: 1,
    flexBasis: 132,
    minWidth: 132,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: '#ffffff',
  },
  metricSelected: {
    borderWidth: 2,
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  purpleMetric: { borderColor: '#c4b5fd' },
  blueMetric: { borderColor: '#93c5fd' },
  orangeMetric: { borderColor: '#fdba74' },
  tealMetric: { borderColor: '#5eead4' },
  greenMetric: { borderColor: '#86efac' },
  metricValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '900',
    color: '#374151',
  },
  metricHelper: {
    marginTop: 2,
    fontSize: 11,
    color: '#6b7280',
  },
  helpText: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
});
