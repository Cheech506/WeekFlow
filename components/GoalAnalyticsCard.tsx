import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import type { GoalAnalytics } from '@/lib/goalReviewUtils';

function formatActivityDate(value: string | null) {
  if (!value) return 'No completed activity yet';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Activity date unavailable';
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getProgressWidth(percentage: number): `${number}%` {
  return `${Math.min(100, Math.max(0, percentage))}%`;
}

export default function GoalAnalyticsCard({
  analytics,
}: {
  analytics: GoalAnalytics;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.healthRow}>
        <View
          style={[
            styles.healthBadge,
            analytics.healthStatus === 'healthy' && styles.healthyBadge,
            analytics.healthStatus === 'needsAttention' &&
              styles.attentionBadge,
            analytics.healthStatus === 'noActivity' && styles.noActivityBadge,
            analytics.healthStatus === 'completed' && styles.completedBadge,
          ]}
        >
          <Text style={styles.healthBadgeText}>{analytics.healthLabel}</Text>
        </View>

        <Text style={styles.healthReason}>{analytics.healthReason}</Text>
      </View>

      <View style={styles.progressHeader}>
        <Text style={styles.progressTitle}>Linked Task Progress</Text>
        <Text style={styles.progressValue}>{analytics.taskProgress}%</Text>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: getProgressWidth(analytics.taskProgress) },
          ]}
        />
      </View>

      <View style={styles.metricsGrid}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{analytics.taskCompleted}</Text>
          <Text style={styles.metricLabel}>Tasks Done</Text>
        </View>

        <View style={styles.metric}>
          <Text style={styles.metricValue}>{analytics.taskRemaining}</Text>
          <Text style={styles.metricLabel}>Tasks Left</Text>
        </View>

        <View style={styles.metric}>
          <Text style={styles.metricValue}>
            {analytics.milestoneCompleted}/{analytics.milestoneTotal}
          </Text>
          <Text style={styles.metricLabel}>Milestones</Text>
        </View>

        <View style={styles.metric}>
          <Text style={styles.metricValue}>
            {analytics.highPriorityCompleted}
          </Text>
          <Text style={styles.metricLabel}>High Priority Done</Text>
        </View>
      </View>

      <Text style={styles.lastActivity}>
        Last goal activity: {formatActivityDate(analytics.lastActivityAt)}
      </Text>

      <Text style={styles.note}>
        Goal completion stays manual. These numbers summarize linked work only.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#f8fbff',
    gap: 10,
  },
  healthRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  healthBadge: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  healthyBadge: { backgroundColor: '#dcfce7' },
  attentionBadge: { backgroundColor: '#fef3c7' },
  noActivityBadge: { backgroundColor: '#e5e7eb' },
  completedBadge: { backgroundColor: '#dbeafe' },
  healthBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111827',
  },
  healthReason: {
    flex: 1,
    minWidth: 180,
    fontSize: 12,
    lineHeight: 17,
    color: '#4b5563',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'transparent',
  },
  progressTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  progressValue: {
    fontSize: 15,
    fontWeight: '900',
    color: '#2563eb',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  metric: {
    flexGrow: 1,
    flexBasis: 120,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
  },
  metricValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#1e3a8a',
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#4b5563',
  },
  lastActivity: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  note: {
    fontSize: 11,
    lineHeight: 16,
    color: '#6b7280',
  },
});
