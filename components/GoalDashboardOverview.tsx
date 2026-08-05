import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import { Text, View } from './Themed';
import type {
  DashboardGoalSummary,
  GoalDashboardSnapshot,
} from '../lib/dashboardUtils';

function getProgressWidth(percentage: number): `${number}%` {
  const safePercentage = Math.min(100, Math.max(0, percentage));
  return `${safePercentage}%`;
}

function getHealthStyle(status: DashboardGoalSummary['healthStatus']) {
  if (status === 'healthy') return styles.healthHealthy;
  if (status === 'needsAttention') return styles.healthAttention;
  return styles.healthNoActivity;
}

function getHealthTextStyle(status: DashboardGoalSummary['healthStatus']) {
  if (status === 'healthy') return styles.healthTextHealthy;
  if (status === 'needsAttention') return styles.healthTextAttention;
  return styles.healthTextNoActivity;
}

type GoalDashboardOverviewProps = {
  snapshot: GoalDashboardSnapshot;
  onOpenDaily: () => void;
  onOpenWeekly: () => void;
};

export default function GoalDashboardOverview({
  snapshot,
  onOpenDaily,
  onOpenWeekly,
}: GoalDashboardOverviewProps) {
  const { width } = useWindowDimensions();
  const useTwoColumns = width >= 900;
  const visibleCommitments = snapshot.commitments.slice(0, 3);

  return (
    <View style={styles.dashboard}>
      <View style={styles.dashboardHeader}>
        <View style={styles.dashboardHeaderText}>
          <Text style={styles.dashboardTitle}>Your Week at a Glance</Text>
          <Text style={styles.dashboardSubtitle}>
            Today, weekly commitments, streaks, and goal health in one place.
          </Text>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <View
          style={[
            styles.summaryCard,
            useTwoColumns && styles.summaryCardHalf,
          ]}
        >
          <View style={styles.summaryHeadingRow}>
            <Text style={styles.summaryTitle}>Today</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Daily"
              onPress={onOpenDaily}
              style={styles.openButton}
            >
              <Text style={styles.openButtonText}>Open Daily</Text>
            </Pressable>
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{snapshot.completedToday}</Text>
              <Text style={styles.metricLabel}>Done Today</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{snapshot.todayRemaining}</Text>
              <Text style={styles.metricLabel}>Scheduled Left</Text>
            </View>
            <View style={styles.metricBox}>
              <Text
                style={[
                  styles.metricValue,
                  snapshot.overdueCount > 0 && styles.metricValueWarning,
                ]}
              >
                {snapshot.overdueCount}
              </Text>
              <Text style={styles.metricLabel}>Overdue</Text>
            </View>
          </View>

          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Today's progress</Text>
            <Text style={styles.progressValue}>
              {snapshot.todayCompletionRate}%
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: getProgressWidth(snapshot.todayCompletionRate) },
              ]}
            />
          </View>
        </View>

        <View
          style={[
            styles.summaryCard,
            useTwoColumns && styles.summaryCardHalf,
          ]}
        >
          <View style={styles.summaryHeadingRow}>
            <Text style={styles.summaryTitle}>Weekly Commitments</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Weekly"
              onPress={onOpenWeekly}
              style={styles.openButton}
            >
              <Text style={styles.openButtonText}>Open Weekly</Text>
            </Pressable>
          </View>

          <Text style={styles.commitmentProgress}>
            {snapshot.commitmentCompleted} of {snapshot.commitmentTotal} complete
          </Text>

          {visibleCommitments.length === 0 ? (
            <Text style={styles.emptyText}>
              No commitments selected for this week yet.
            </Text>
          ) : (
            <View style={styles.commitmentList}>
              {visibleCommitments.map((commitment) => (
                <View key={commitment.id} style={styles.commitmentRow}>
                  <Text style={styles.commitmentCheck}>
                    {commitment.completed ? '✓' : '○'}
                  </Text>
                  <View style={styles.commitmentTextWrap}>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.commitmentTitle,
                        commitment.completed && styles.completedText,
                      ]}
                    >
                      {commitment.title}
                    </Text>
                    {commitment.linkedToTask ? (
                      <Text style={styles.commitmentSource}>Linked task</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}

          {snapshot.commitmentTotal > visibleCommitments.length ? (
            <Text style={styles.moreText}>
              +{snapshot.commitmentTotal - visibleCommitments.length} more in Weekly
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.streakCard}>
        <View style={styles.streakMetric}>
          <Text style={styles.streakValue}>{snapshot.currentStreak}</Text>
          <Text style={styles.streakLabel}>Current Streak</Text>
        </View>
        <View style={styles.streakDivider} />
        <View style={styles.streakMetric}>
          <Text style={styles.streakValue}>{snapshot.longestStreak}</Text>
          <Text style={styles.streakLabel}>Longest Streak</Text>
        </View>
      </View>

      <View style={styles.goalsCard}>
        <View style={styles.goalsHeader}>
          <View style={styles.goalsHeaderText}>
            <Text style={styles.summaryTitle}>Active Goals</Text>
            <Text style={styles.goalsSubtitle}>
              Goals needing attention are shown first. Full details stay below.
            </Text>
          </View>
          <Text style={styles.goalCount}>{snapshot.goals.length}</Text>
        </View>

        {snapshot.goals.length === 0 ? (
          <Text style={styles.emptyText}>
            No active goals are assigned to this cycle yet.
          </Text>
        ) : (
          <View style={styles.goalList}>
            {snapshot.goals.map((goal) => (
              <View key={goal.id} style={styles.goalRow}>
                <View style={styles.goalTopRow}>
                  <View style={styles.goalTitleWrap}>
                    <Text style={styles.goalTitle}>{goal.title}</Text>
                    <Text style={styles.goalMeta}>
                      {goal.taskCompleted} of {goal.taskTotal} linked tasks
                      {goal.milestoneTotal > 0
                        ? ` • ${goal.milestoneCompleted} of ${goal.milestoneTotal} milestones`
                        : ''}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.healthBadge,
                      getHealthStyle(goal.healthStatus),
                    ]}
                  >
                    <Text
                      style={[
                        styles.healthText,
                        getHealthTextStyle(goal.healthStatus),
                      ]}
                    >
                      {goal.healthLabel}
                    </Text>
                  </View>
                </View>

                <View style={styles.goalProgressHeader}>
                  <Text style={styles.goalHealthReason} numberOfLines={2}>
                    {goal.healthReason}
                  </Text>
                  <Text style={styles.goalProgressValue}>
                    {goal.taskProgress}%
                  </Text>
                </View>

                <View style={styles.goalProgressTrack}>
                  <View
                    style={[
                      styles.goalProgressFill,
                      { width: getProgressWidth(goal.taskProgress) },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dashboard: {
    gap: 12,
    backgroundColor: 'transparent',
  },
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  dashboardHeaderText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  dashboardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  dashboardSubtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: '#4b5563',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  summaryCard: {
    width: '100%',
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: 'white',
  },
  summaryCardHalf: {
    flexGrow: 1,
    flexBasis: '47%',
    width: 'auto',
  },
  summaryHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'transparent',
  },
  summaryTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  openButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: '#dbeafe',
  },
  openButtonText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  metricBox: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
  },
  metricValueWarning: {
    color: '#b45309',
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '800',
    color: '#6b7280',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    backgroundColor: 'transparent',
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4b5563',
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2563eb',
  },
  progressTrack: {
    height: 9,
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2563eb',
  },
  commitmentProgress: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '800',
    color: '#6d28d9',
  },
  commitmentList: {
    marginTop: 9,
    gap: 7,
    backgroundColor: 'transparent',
  },
  commitmentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'transparent',
  },
  commitmentCheck: {
    width: 18,
    fontSize: 15,
    fontWeight: '900',
    color: '#7c3aed',
  },
  commitmentTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  commitmentTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: '#1f2937',
  },
  commitmentSource: {
    marginTop: 1,
    fontSize: 9,
    color: '#7c3aed',
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#6b7280',
  },
  emptyText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: '#6b7280',
  },
  moreText: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '800',
    color: '#6d28d9',
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#f5f3ff',
  },
  streakMetric: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'transparent',
  },
  streakValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#6d28d9',
  },
  streakLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#5b21b6',
  },
  streakDivider: {
    width: 1,
    marginVertical: 9,
    backgroundColor: '#ddd6fe',
  },
  goalsCard: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8f7ff',
  },
  goalsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'transparent',
  },
  goalsHeaderText: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  goalsSubtitle: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    color: '#6b7280',
  },
  goalCount: {
    minWidth: 32,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    color: '#5b21b6',
    backgroundColor: '#ede9fe',
  },
  goalList: {
    marginTop: 10,
    gap: 9,
    backgroundColor: 'transparent',
  },
  goalRow: {
    padding: 11,
    borderRadius: 10,
    backgroundColor: 'white',
  },
  goalTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: 'transparent',
  },
  goalTitleWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  goalTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    color: '#111827',
  },
  goalMeta: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 14,
    color: '#6b7280',
  },
  healthBadge: {
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: 999,
  },
  healthHealthy: {
    backgroundColor: '#dcfce7',
  },
  healthAttention: {
    backgroundColor: '#fef3c7',
  },
  healthNoActivity: {
    backgroundColor: '#e5e7eb',
  },
  healthText: {
    fontSize: 9,
    fontWeight: '900',
  },
  healthTextHealthy: {
    color: '#166534',
  },
  healthTextAttention: {
    color: '#92400e',
  },
  healthTextNoActivity: {
    color: '#4b5563',
  },
  goalProgressHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 9,
    backgroundColor: 'transparent',
  },
  goalHealthReason: {
    flex: 1,
    fontSize: 9,
    lineHeight: 13,
    color: '#6b7280',
  },
  goalProgressValue: {
    fontSize: 11,
    fontWeight: '900',
    color: '#7c3aed',
  },
  goalProgressTrack: {
    height: 8,
    marginTop: 5,
    borderRadius: 999,
    backgroundColor: '#ede9fe',
    overflow: 'hidden',
  },
  goalProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#7c3aed',
  },
});
