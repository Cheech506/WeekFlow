import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import CycleReportSummary from '@/components/CycleReportSummary';
import { Text, View } from '@/components/Themed';
import { useCycleReviews } from '@/context/CycleReviewContext';
import {
  getCycleGoalOutcomeLabel,
  normalizeCycleReviewReflection,
} from '@/lib/cycleReviewUtils';
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
  const [reportExpanded, setReportExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const { cycleReviews, goalOutcomes, exportReport } = useCycleReviews();
  const completedGoals = goals.filter((goal) => goal.completed).length;
  const unfinishedGoals = goals.length - completedGoals;
  const review = cycleReviews.find((item) => item.cycleId === cycle.id);
  const outcomes = review
    ? goalOutcomes.filter((item) => item.cycleReviewId === review.id)
    : [];
  const outcomeByGoalId = useMemo(
    () => new Map(outcomes.map((outcome) => [outcome.goalId, outcome])),
    [outcomes]
  );

  async function handleExport() {
    setMessage('');
    try {
      const fileName = await exportReport(cycle.id, cycleLabel);
      setMessage(`Exported ${fileName}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'The cycle report could not be exported.'
      );
    }
  }

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
            goals.map((goal) => {
              const outcome = outcomeByGoalId.get(goal.id);
              return (
                <View key={goal.id} style={styles.goalRow}>
                  <Text style={styles.goalStatus}>
                    {goal.completed ? '✓' : '○'}
                  </Text>
                  <View style={styles.goalTextWrap}>
                    <Text style={styles.goalTitle}>{goal.title}</Text>
                    <Text style={styles.goalMeta}>
                      {goal.completed
                        ? 'Completed'
                        : outcome
                          ? getCycleGoalOutcomeLabel(outcome.action)
                          : 'Unfinished'}
                    </Text>
                    {outcome?.action === 'replace' && outcome.replacementTitle ? (
                      <Text style={styles.replacementText}>
                        Replaced with: {outcome.replacementTitle}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}

          {review ? (
            <View style={styles.reportCard}>
              <Pressable
                style={styles.reportHeader}
                onPress={() => setReportExpanded((current) => !current)}
              >
                <View style={styles.headerText}>
                  <Text style={styles.reportTitle}>Week 13 Cycle Report</Text>
                  <Text style={styles.reportMeta}>
                    {review.finalizedAt ? 'Finalized report' : 'Saved draft'}
                  </Text>
                </View>
                <Text style={styles.action}>
                  {reportExpanded ? 'Hide' : 'View'}
                </Text>
              </Pressable>

              {reportExpanded ? (
                <View style={styles.reportDetails}>
                  <CycleReportSummary
                    snapshot={{
                      goalTotal: review.goalTotal,
                      goalCompleted: review.goalCompleted,
                      taskCompleted: review.taskCompleted,
                      milestoneTotal: review.milestoneTotal,
                      milestoneCompleted: review.milestoneCompleted,
                      weeklyReviewsCompleted: review.weeklyReviewsCompleted,
                      longestStreak: review.longestStreak,
                      bestWeekNumber: review.bestWeekNumber,
                      bestWeekCount: review.bestWeekCount,
                      bestDay: review.bestDay,
                      bestDayCount: review.bestDayCount,
                      highPriorityCompleted: review.highPriorityCompleted,
                      recurringCompleted: review.recurringCompleted,
                      rewardsUnlocked: review.rewardsUnlocked,
                      brainDumpsArchived: review.brainDumpsArchived,
                    }}
                  />

                  {Object.entries(
                    normalizeCycleReviewReflection({
                      biggestAccomplishment: review.biggestAccomplishment,
                      biggestChallenge: review.biggestChallenge,
                      whatWorkedWell: review.whatWorkedWell,
                      whatChangeNextCycle: review.whatChangeNextCycle,
                      whatStopDoing: review.whatStopDoing,
                      whatContinueDoing: review.whatContinueDoing,
                      whatLearned: review.whatLearned,
                    })
                  ).some(([, value]) => Boolean(value)) ? (
                    <View style={styles.reflectionList}>
                      {[
                        ['Biggest accomplishment', review.biggestAccomplishment],
                        ['Biggest challenge', review.biggestChallenge],
                        ['What worked well', review.whatWorkedWell],
                        ['Change next cycle', review.whatChangeNextCycle],
                        ['Stop doing', review.whatStopDoing],
                        ['Continue doing', review.whatContinueDoing],
                        ['What was learned', review.whatLearned],
                      ].map(([label, value]) =>
                        value ? (
                          <View key={label} style={styles.reflectionItem}>
                            <Text style={styles.detailLabel}>{label}</Text>
                            <Text style={styles.detailText}>{value}</Text>
                          </View>
                        ) : null
                      )}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>
                      No written cycle reflection was saved.
                    </Text>
                  )}

                  {review.nextCycleStartDate ? (
                    <View style={styles.nextCyclePlan}>
                      <Text style={styles.nextCycleTitle}>Next-Cycle Plan</Text>
                      <Text style={styles.nextCycleName}>
                        {review.nextCycleName || 'Next 12-Week Cycle'}
                      </Text>
                      <Text style={styles.detailText}>
                        Starts {formatDateKey(review.nextCycleStartDate)}
                      </Text>
                      {review.nextCyclePrimaryFocus ? (
                        <View style={styles.nextCycleDetail}>
                          <Text style={styles.detailLabel}>Primary Focus</Text>
                          <Text style={styles.detailText}>
                            {review.nextCyclePrimaryFocus}
                          </Text>
                        </View>
                      ) : null}
                      {review.nextCycleTheme ? (
                        <View style={styles.nextCycleDetail}>
                          <Text style={styles.detailLabel}>Theme</Text>
                          <Text style={styles.detailText}>
                            {review.nextCycleTheme}
                          </Text>
                        </View>
                      ) : null}
                      {review.nextCycleFirstWeekCommitments.length > 0 ? (
                        <View style={styles.nextCycleDetail}>
                          <Text style={styles.detailLabel}>
                            First-Week Commitments
                          </Text>
                          {review.nextCycleFirstWeekCommitments.map(
                            (commitment, index) => (
                              <Text
                                key={`${review.id}-commitment-${index}`}
                                style={styles.commitmentText}
                              >
                                • {commitment}
                              </Text>
                            )
                          )}
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  <Pressable style={styles.exportButton} onPress={handleExport}>
                    <Text style={styles.exportButtonText}>
                      Export Markdown Report
                    </Text>
                  </Pressable>
                  {message ? <Text style={styles.message}>{message}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.emptyText}>
              No Week 13 report was saved for this cycle.
            </Text>
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
  headerText: { flex: 1, backgroundColor: 'transparent' },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  dates: { marginTop: 4, color: '#596579' },
  summary: { marginTop: 6, color: '#334155', fontWeight: '600' },
  action: { color: '#2563eb', fontWeight: '800' },
  details: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    padding: 18,
    gap: 14,
    backgroundColor: '#f8fafc',
  },
  detailSection: { backgroundColor: 'transparent' },
  detailLabel: {
    color: '#6d28d9',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  detailText: { marginTop: 4, color: '#1f2937' },
  emptyText: { color: '#64748b' },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  goalStatus: { fontSize: 18, color: '#2563eb' },
  goalTextWrap: { flex: 1, backgroundColor: 'transparent' },
  goalTitle: { fontWeight: '700', color: '#111827' },
  goalMeta: { marginTop: 2, color: '#64748b', fontSize: 13 },
  replacementText: { marginTop: 3, color: '#6d28d9', fontSize: 13 },
  reportCard: {
    borderWidth: 1,
    borderColor: '#c4b5fd',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  reportHeader: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#f5f3ff',
  },
  reportTitle: { fontWeight: '900', color: '#4c1d95' },
  reportMeta: { marginTop: 2, color: '#6b7280', fontSize: 12 },
  reportDetails: { padding: 14, gap: 14, backgroundColor: '#ffffff' },
  reflectionList: { gap: 12, backgroundColor: 'transparent' },
  reflectionItem: { backgroundColor: 'transparent' },
  nextCyclePlan: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    gap: 6,
  },
  nextCycleTitle: { color: '#1e3a8a', fontWeight: '900' },
  nextCycleName: { color: '#111827', fontWeight: '900', fontSize: 16 },
  nextCycleDetail: { marginTop: 6, backgroundColor: 'transparent' },
  commitmentText: { marginTop: 4, color: '#334155' },
  exportButton: {
    padding: 12,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7c3aed',
    backgroundColor: '#ffffff',
  },
  exportButtonText: { color: '#6d28d9', fontWeight: '900' },
  message: { color: '#334155', fontWeight: '700' },
});
