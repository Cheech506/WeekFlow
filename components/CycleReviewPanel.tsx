import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';

import CycleIdentityFields from '@/components/CycleIdentityFields';
import CycleReportSummary from '@/components/CycleReportSummary';
import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import {
  calculateCycleReviewSnapshot,
  getCycleGoalOutcomeLabel,
  getDefaultNextCycleStartDate,
  MAX_CYCLE_REVIEW_RESPONSE_LENGTH,
  MAX_FIRST_WEEK_COMMITMENT_LENGTH,
  MAX_FIRST_WEEK_COMMITMENTS,
  type CycleGoalOutcomeAction,
  type CycleGoalOutcomeInput,
} from '@/lib/cycleReviewUtils';
import { createPlanningCycleRange } from '@/lib/cycleUtils';
import { formatDateKey } from '@/lib/dateUtils';
import type { PlanningCycle } from '@/lib/cycleStorage';
import type { StoredGoal } from '@/lib/goalStorage';

const REFLECTION_FIELDS = [
  ['biggestAccomplishment', 'Biggest accomplishment'],
  ['biggestChallenge', 'Biggest challenge'],
  ['whatWorkedWell', 'What worked well?'],
  ['whatChangeNextCycle', 'What should change next cycle?'],
  ['whatStopDoing', 'What should you stop doing?'],
  ['whatContinueDoing', 'What should you continue doing?'],
  ['whatLearned', 'What did you learn?'],
] as const;

type ReflectionState = Record<
  (typeof REFLECTION_FIELDS)[number][0],
  string
>;

type OutcomeState = Record<
  number,
  {
    action: CycleGoalOutcomeAction;
    replacementTitle: string;
  }
>;

export default function CycleReviewPanel({
  cycle,
  cycleLabel,
  cycleGoals,
}: {
  cycle: PlanningCycle;
  cycleLabel: string;
  cycleGoals: StoredGoal[];
}) {
  const { goals, milestones } = useGoals();
  const { tasks, recurringRules } = useTasks();
  const { brainDumps } = useBrainDumps();
  const { reviews: weeklyReviews } = useWeeklyReviews();
  const {
    cycleReviews,
    goalOutcomes,
    saveReviewDraft,
    finalizeReview,
    exportReport,
  } = useCycleReviews();

  const existingReview = cycleReviews.find(
    (review) => review.cycleId === cycle.id
  );
  const existingOutcomes = existingReview
    ? goalOutcomes.filter(
        (outcome) => outcome.cycleReviewId === existingReview.id
      )
    : [];

  const [reflection, setReflection] = useState<ReflectionState>({
    biggestAccomplishment: '',
    biggestChallenge: '',
    whatWorkedWell: '',
    whatChangeNextCycle: '',
    whatStopDoing: '',
    whatContinueDoing: '',
    whatLearned: '',
  });
  const [nextCycleName, setNextCycleName] = useState('');
  const [nextCycleFocus, setNextCycleFocus] = useState('');
  const [nextCycleTheme, setNextCycleTheme] = useState('');
  const [nextCycleStart, setNextCycleStart] = useState(
    getDefaultNextCycleStartDate(cycle)
  );
  const [firstWeekCommitments, setFirstWeekCommitments] = useState<string[]>([
    '',
  ]);
  const [outcomes, setOutcomes] = useState<OutcomeState>({});
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [showReflection, setShowReflection] = useState(true);
  const [showGoalDecisions, setShowGoalDecisions] = useState(true);
  const [showNextCycle, setShowNextCycle] = useState(true);

  const unfinishedGoals = cycleGoals.filter((goal) => !goal.completed);
  const activeRecurringRules = recurringRules.filter((rule) => rule.active);
  const liveSnapshot = useMemo(
    () =>
      calculateCycleReviewSnapshot(
        cycle,
        goals,
        milestones,
        tasks,
        weeklyReviews,
        brainDumps
      ),
    [brainDumps, cycle, goals, milestones, tasks, weeklyReviews]
  );
  const displaySnapshot = existingReview
    ? {
        goalTotal: existingReview.goalTotal,
        goalCompleted: existingReview.goalCompleted,
        taskCompleted: existingReview.taskCompleted,
        milestoneTotal: existingReview.milestoneTotal,
        milestoneCompleted: existingReview.milestoneCompleted,
        weeklyReviewsCompleted: existingReview.weeklyReviewsCompleted,
        longestStreak: existingReview.longestStreak,
        bestWeekNumber: existingReview.bestWeekNumber,
        bestWeekCount: existingReview.bestWeekCount,
        bestDay: existingReview.bestDay,
        bestDayCount: existingReview.bestDayCount,
        highPriorityCompleted: existingReview.highPriorityCompleted,
        recurringCompleted: existingReview.recurringCompleted,
        rewardsUnlocked: existingReview.rewardsUnlocked,
        brainDumpsArchived: existingReview.brainDumpsArchived,
      }
    : liveSnapshot;

  useEffect(() => {
    if (!existingReview) return;

    setReflection({
      biggestAccomplishment: existingReview.biggestAccomplishment ?? '',
      biggestChallenge: existingReview.biggestChallenge ?? '',
      whatWorkedWell: existingReview.whatWorkedWell ?? '',
      whatChangeNextCycle: existingReview.whatChangeNextCycle ?? '',
      whatStopDoing: existingReview.whatStopDoing ?? '',
      whatContinueDoing: existingReview.whatContinueDoing ?? '',
      whatLearned: existingReview.whatLearned ?? '',
    });
    setNextCycleName(existingReview.nextCycleName ?? '');
    setNextCycleFocus(existingReview.nextCyclePrimaryFocus ?? '');
    setNextCycleTheme(existingReview.nextCycleTheme ?? '');
    setNextCycleStart(
      existingReview.nextCycleStartDate ?? getDefaultNextCycleStartDate(cycle)
    );
    setFirstWeekCommitments(
      existingReview.nextCycleFirstWeekCommitments.length > 0
        ? existingReview.nextCycleFirstWeekCommitments
        : ['']
    );
    setOutcomes(
      Object.fromEntries(
        existingOutcomes
          .filter((outcome) => outcome.goalId !== null)
          .map((outcome) => [
          outcome.goalId as number,
          {
            action: outcome.action,
            replacementTitle: outcome.replacementTitle ?? '',
          },
        ])
      )
    );
  }, [cycle, existingReview?.id, existingReview?.updatedAt]);

  let nextCycleEnd = '';
  let nextCycleDateError = '';
  try {
    nextCycleEnd = createPlanningCycleRange(nextCycleStart).endDate;
  } catch (error) {
    nextCycleDateError =
      error instanceof Error ? error.message : 'The next cycle date is invalid.';
  }

  const outcomeInputs: CycleGoalOutcomeInput[] = Object.entries(outcomes).map(
    ([goalId, outcome]) => ({
      goalId: Number(goalId),
      action: outcome.action,
      replacementTitle: outcome.replacementTitle,
    })
  );

  function setOutcome(goalId: number, action: CycleGoalOutcomeAction) {
    setOutcomes((current) => ({
      ...current,
      [goalId]: {
        action,
        replacementTitle: current[goalId]?.replacementTitle ?? '',
      },
    }));
    setConfirmFinalize(false);
    setMessage('');
  }

  function buildInput() {
    return {
      cycleId: cycle.id,
      reflection,
      nextCycle: {
        name: nextCycleName,
        primaryFocus: nextCycleFocus,
        theme: nextCycleTheme,
        startDate: nextCycleStart,
        firstWeekCommitments,
      },
      outcomes: outcomeInputs,
    };
  }

  async function handleSaveDraft() {
    setIsSaving(true);
    setMessage('');

    try {
      await saveReviewDraft(buildInput());
      setMessage('Week 13 review progress saved.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'The cycle review could not be saved.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinalize() {
    if (nextCycleDateError) {
      setMessage(nextCycleDateError);
      return;
    }

    if (unfinishedGoals.some((goal) => !outcomes[goal.id])) {
      setMessage('Choose an outcome for every unfinished goal first.');
      return;
    }

    const missingReplacement = unfinishedGoals.find(
      (goal) =>
        outcomes[goal.id]?.action === 'replace' &&
        !outcomes[goal.id]?.replacementTitle.trim()
    );
    if (missingReplacement) {
      setMessage(`Enter a replacement title for “${missingReplacement.title}”.`);
      return;
    }

    if (!confirmFinalize) {
      setConfirmFinalize(true);
      setMessage(
        'Review the choices above, then press Confirm & Start Next Cycle.'
      );
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      await finalizeReview(buildInput());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The cycle could not be finalized.'
      );
      setConfirmFinalize(false);
    } finally {
      setIsSaving(false);
    }
  }

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
      <Text style={styles.eyebrow}>WEEK 13</Text>
      <Text style={styles.title}>Review {cycleLabel}</Text>
      <Text style={styles.subtitle}>
        Look back at the completed twelve weeks, decide what happens to every
        unfinished goal, and deliberately build the next cycle.
      </Text>

      <View style={styles.reportSection}>
        <Text style={styles.sectionTitle}>Cycle Report</Text>
        <CycleReportSummary snapshot={displaySnapshot} />
      </View>

      <Pressable
        style={styles.sectionHeader}
        onPress={() => setShowReflection((current) => !current)}
      >
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Week 13 Reflection</Text>
          <Text style={styles.sectionHint}>All responses are optional.</Text>
        </View>
        <Text style={styles.sectionAction}>{showReflection ? 'Hide' : 'Open'}</Text>
      </Pressable>

      {showReflection ? (
        <View style={styles.formStack}>
          {REFLECTION_FIELDS.map(([key, label]) => (
            <View key={key} style={styles.field}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                multiline
                style={styles.textArea}
                value={reflection[key]}
                onChangeText={(value) => {
                  setReflection((current) => ({ ...current, [key]: value }));
                  setMessage('');
                }}
                maxLength={MAX_CYCLE_REVIEW_RESPONSE_LENGTH}
                placeholder="Optional reflection..."
              />
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        style={styles.sectionHeader}
        onPress={() => setShowGoalDecisions((current) => !current)}
      >
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Unfinished Goal Decisions</Text>
          <Text style={styles.sectionHint}>
            {unfinishedGoals.length} goal{unfinishedGoals.length === 1 ? '' : 's'} need a decision.
          </Text>
        </View>
        <Text style={styles.sectionAction}>{showGoalDecisions ? 'Hide' : 'Open'}</Text>
      </Pressable>

      {showGoalDecisions ? (
        <View style={styles.formStack}>
          {unfinishedGoals.length === 0 ? (
            <Text style={styles.successText}>
              Every goal in this cycle is already completed.
            </Text>
          ) : (
            unfinishedGoals.map((goal) => {
              const selected = outcomes[goal.id];
              return (
                <View key={goal.id} style={styles.goalCard}>
                  <Text style={styles.goalTitle}>{goal.title}</Text>
                  <View style={styles.outcomeButtons}>
                    {(
                      [
                        ['complete', 'Mark Complete'],
                        ['carryForward', 'Carry Forward'],
                        ['archive', 'Archive'],
                        ['replace', 'Replace'],
                      ] as const
                    ).map(([action, label]) => (
                      <Pressable
                        key={action}
                        style={[
                          styles.outcomeButton,
                          selected?.action === action && styles.outcomeButtonSelected,
                        ]}
                        onPress={() => setOutcome(goal.id, action)}
                      >
                        <Text
                          style={[
                            styles.outcomeButtonText,
                            selected?.action === action &&
                              styles.outcomeButtonTextSelected,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {selected ? (
                    <Text style={styles.selectedOutcome}>
                      Selected: {getCycleGoalOutcomeLabel(selected.action)}
                    </Text>
                  ) : null}

                  {selected?.action === 'replace' ? (
                    <TextInput
                      style={styles.singleInput}
                      value={selected.replacementTitle}
                      onChangeText={(value) =>
                        setOutcomes((current) => ({
                          ...current,
                          [goal.id]: {
                            ...current[goal.id],
                            replacementTitle: value,
                          },
                        }))
                      }
                      placeholder="New goal title"
                      maxLength={180}
                    />
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      ) : null}

      <Pressable
        style={styles.sectionHeader}
        onPress={() => setShowNextCycle((current) => !current)}
      >
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Plan the Next Cycle</Text>
          <Text style={styles.sectionHint}>
            Carried and replacement goals will be created inside this folder.
          </Text>
        </View>
        <Text style={styles.sectionAction}>{showNextCycle ? 'Hide' : 'Open'}</Text>
      </Pressable>

      {showNextCycle ? (
        <View style={styles.formStack}>
          <CycleIdentityFields
            name={nextCycleName}
            primaryFocus={nextCycleFocus}
            theme={nextCycleTheme}
            onNameChange={setNextCycleName}
            onPrimaryFocusChange={setNextCycleFocus}
            onThemeChange={setNextCycleTheme}
          />

          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={styles.label}>Next cycle start date</Text>
              <TextInput
                style={styles.singleInput}
                value={nextCycleStart}
                onChangeText={(value) => {
                  setNextCycleStart(value);
                  setConfirmFinalize(false);
                  setMessage('');
                }}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.datePreview}>
              <Text style={styles.datePreviewLabel}>Calculated end date</Text>
              <Text style={styles.datePreviewValue}>
                {nextCycleEnd ? formatDateKey(nextCycleEnd) : 'Invalid date'}
              </Text>
            </View>
          </View>
          {nextCycleDateError ? (
            <Text style={styles.errorText}>{nextCycleDateError}</Text>
          ) : (
            <Text style={styles.sectionHint}>
              The default leaves one full Week 13 between cycles.
            </Text>
          )}

          <View style={styles.subsectionCard}>
            <Text style={styles.subsectionTitle}>First-Week Commitments</Text>
            <Text style={styles.sectionHint}>
              Add up to {MAX_FIRST_WEEK_COMMITMENTS} optional outcomes for the
              first week of the new cycle.
            </Text>

            {firstWeekCommitments.map((commitment, index) => (
              <View key={`commitment-${index}`} style={styles.commitmentRow}>
                <TextInput
                  style={[styles.singleInput, styles.commitmentInput]}
                  value={commitment}
                  onChangeText={(value) => {
                    setFirstWeekCommitments((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? value : item
                      )
                    );
                    setMessage('');
                  }}
                  placeholder={`Commitment ${index + 1}`}
                  maxLength={MAX_FIRST_WEEK_COMMITMENT_LENGTH}
                />
                {firstWeekCommitments.length > 1 ? (
                  <Pressable
                    style={styles.removeSmallButton}
                    onPress={() =>
                      setFirstWeekCommitments((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index)
                      )
                    }
                  >
                    <Text style={styles.removeSmallButtonText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

            {firstWeekCommitments.length < MAX_FIRST_WEEK_COMMITMENTS ? (
              <Pressable
                style={styles.addSmallButton}
                onPress={() =>
                  setFirstWeekCommitments((current) => [...current, ''])
                }
              >
                <Text style={styles.addSmallButtonText}>Add Commitment</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.subsectionCard}>
            <Text style={styles.subsectionTitle}>Recurring Schedule Review</Text>
            <Text style={styles.sectionHint}>
              {activeRecurringRules.length === 0
                ? 'No active recurring schedules will continue into the next cycle.'
                : `${activeRecurringRules.length} active recurring schedule${
                    activeRecurringRules.length === 1 ? '' : 's'
                  } will continue automatically. Manage or pause them from Inbox.`}
            </Text>
            {activeRecurringRules.slice(0, 5).map((rule) => (
              <Text key={rule.id} style={styles.recurringItem}>
                • {rule.title}
              </Text>
            ))}
            {activeRecurringRules.length > 5 ? (
              <Text style={styles.sectionHint}>
                + {activeRecurringRules.length - 5} more active schedules
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          style={styles.secondaryButton}
          disabled={isSaving}
          onPress={handleSaveDraft}
        >
          <Text style={styles.secondaryButtonText}>
            {isSaving ? 'Saving...' : 'Save Review Progress'}
          </Text>
        </Pressable>

        {existingReview ? (
          <Pressable style={styles.secondaryButton} onPress={handleExport}>
            <Text style={styles.secondaryButtonText}>Export Markdown Report</Text>
          </Pressable>
        ) : null}

        <Pressable
          style={[
            styles.primaryButton,
            confirmFinalize && styles.confirmButton,
          ]}
          disabled={isSaving}
          onPress={handleFinalize}
        >
          <Text style={styles.primaryButtonText}>
            {confirmFinalize
              ? 'Confirm & Start Next Cycle'
              : 'Finish Review & Start Next Cycle'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
    gap: 14,
  },
  eyebrow: {
    color: '#6d28d9',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
  },
  title: { fontSize: 24, fontWeight: '900', color: '#111827' },
  subtitle: { color: '#475569', lineHeight: 21 },
  reportSection: { gap: 10, backgroundColor: 'transparent' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#ddd6fe',
    backgroundColor: 'transparent',
  },
  sectionHeaderText: { flex: 1, backgroundColor: 'transparent' },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#1f2937' },
  sectionHint: { marginTop: 3, color: '#64748b', fontSize: 13 },
  sectionAction: { color: '#2563eb', fontWeight: '800' },
  formStack: { gap: 12, backgroundColor: 'transparent' },
  field: { gap: 6, backgroundColor: 'transparent' },
  label: { color: '#334155', fontWeight: '800' },
  textArea: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#ffffff',
    color: '#111827',
    textAlignVertical: 'top',
  },
  goalCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#ffffff',
    gap: 10,
  },
  goalTitle: { fontWeight: '900', color: '#111827', fontSize: 16 },
  outcomeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  outcomeButton: {
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  outcomeButtonSelected: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  outcomeButtonText: { color: '#334155', fontWeight: '800' },
  outcomeButtonTextSelected: { color: '#ffffff' },
  selectedOutcome: { color: '#6d28d9', fontWeight: '700', fontSize: 13 },
  singleInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#ffffff',
    color: '#111827',
  },
  successText: { color: '#15803d', fontWeight: '800' },
  dateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: 'transparent',
  },
  dateField: { flex: 1, minWidth: 220, gap: 6, backgroundColor: 'transparent' },
  datePreview: {
    flex: 1,
    minWidth: 200,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  datePreviewLabel: { color: '#64748b', fontSize: 12, fontWeight: '800' },
  datePreviewValue: { marginTop: 4, color: '#1e3a8a', fontWeight: '900' },
  subsectionCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd6fe',
    backgroundColor: '#ffffff',
    gap: 8,
  },
  subsectionTitle: { color: '#4c1d95', fontWeight: '900' },
  commitmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  commitmentInput: { flex: 1 },
  addSmallButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#ede9fe',
  },
  addSmallButtonText: { color: '#6d28d9', fontWeight: '800' },
  removeSmallButton: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#ffffff',
  },
  removeSmallButtonText: { color: '#b91c1c', fontWeight: '800' },
  recurringItem: { color: '#334155', fontSize: 13 },
  errorText: { color: '#b91c1c', fontWeight: '700' },
  message: { color: '#334155', fontWeight: '700' },
  actions: { gap: 10, backgroundColor: 'transparent' },
  secondaryButton: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7c3aed',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: { color: '#6d28d9', fontWeight: '900' },
  primaryButton: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  confirmButton: { backgroundColor: '#15803d' },
  primaryButtonText: { color: '#ffffff', fontWeight: '900' },
});
