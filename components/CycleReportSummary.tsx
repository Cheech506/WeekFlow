import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import type { CycleReviewSnapshot } from '@/lib/cycleReviewUtils';

export default function CycleReportSummary({
  snapshot,
}: {
  snapshot: CycleReviewSnapshot;
}) {
  const metrics = [
    {
      label: 'Goals Completed',
      value: `${snapshot.goalCompleted}/${snapshot.goalTotal}`,
    },
    { label: 'Tasks Completed', value: snapshot.taskCompleted },
    {
      label: 'Milestones',
      value: `${snapshot.milestoneCompleted}/${snapshot.milestoneTotal}`,
    },
    { label: 'Weekly Reviews', value: snapshot.weeklyReviewsCompleted },
    { label: 'Longest Streak', value: `${snapshot.longestStreak} days` },
    {
      label: 'Best Week',
      value: snapshot.bestWeekNumber
        ? `Week ${snapshot.bestWeekNumber}`
        : '—',
    },
    {
      label: 'Best Week Tasks',
      value: snapshot.bestWeekCount,
    },
    {
      label: 'Best Weekday',
      value: snapshot.bestDay ?? '—',
    },
    { label: 'High Priority', value: snapshot.highPriorityCompleted },
    { label: 'Recurring Done', value: snapshot.recurringCompleted },
    { label: 'Rewards Unlocked', value: snapshot.rewardsUnlocked },
    { label: 'Brain Dumps Archived', value: snapshot.brainDumpsArchived },
  ];

  return (
    <View style={styles.grid}>
      {metrics.map((metric) => (
        <View key={metric.label} style={styles.metric}>
          <Text style={styles.value}>{metric.value}</Text>
          <Text style={styles.label}>{metric.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  metric: {
    minWidth: 132,
    flexGrow: 1,
    flexBasis: '30%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
  },
  value: {
    color: '#111827',
    fontWeight: '900',
    fontSize: 19,
  },
  label: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
});
