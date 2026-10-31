import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCelebrations } from '@/context/CelebrationContext';
import { useCycle } from '@/context/CycleContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import {
  fetchApiCycleGoalOutcomes,
  type ApiCycleGoalOutcome,
} from '@/lib/api/cycleGoalOutcomeApi';
import {
  fetchApiCycleReviews,
  finalizeApiCycleReview,
  saveApiCycleReviewDraft,
  type ApiCycleReview,
  type ApiCycleReviewDetail,
} from '@/lib/api/cycleReviewApi';
import { exportCycleReport } from '@/lib/cycleReportExport';
import type { StoredCycleGoalOutcome, StoredCycleReview } from '@/lib/cycleReviewStorage';
import {
  buildCycleReportMarkdown,
  calculateCycleReviewSnapshot,
  type CycleGoalOutcomeInput,
  type CycleReviewReflectionInput,
  type NextCyclePlanInput,
} from '@/lib/cycleReviewUtils';

export type {
  CycleGoalOutcomeInput,
  CycleReviewReflectionInput, NextCyclePlanInput, StoredCycleGoalOutcome, StoredCycleReview
};

type ReviewInput = {
  cycleId: number;
  reflection: CycleReviewReflectionInput;
  nextCycle: NextCyclePlanInput;
  outcomes: CycleGoalOutcomeInput[];
};

type CycleReviewContextValue = {
  cycleReviews: ApiCycleReview[];
  goalOutcomes: ApiCycleGoalOutcome[];
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refreshCycleReviews: () => Promise<void>;
  saveReviewDraft: (input: ReviewInput) => Promise<void>;
  finalizeReview: (input: ReviewInput) => Promise<void>;
  exportReport: (cycleId: number, cycleLabel: string) => Promise<string>;
};

const CycleReviewContext = createContext<CycleReviewContextValue | null>(null);

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('The cycle review request failed.');
}

function captureInput(input: ReviewInput): ReviewInput {
  return {
    cycleId: input.cycleId,
    reflection: { ...input.reflection },
    nextCycle: {
      ...input.nextCycle,
      firstWeekCommitments: [...(input.nextCycle.firstWeekCommitments ?? [])],
    },
    outcomes: input.outcomes.map(outcome => ({ ...outcome })),
  };
}

export function CycleReviewProvider({ children }: { children: ReactNode }) {
  const [cycleReviews, setCycleReviews] = useState<ApiCycleReview[]>([]);
  const [goalOutcomes, setGoalOutcomes] = useState<ApiCycleGoalOutcome[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { celebrate } = useCelebrations();
  const { cycles, refreshCycles, isLoading: cyclesLoading, isSaving: cyclesSaving, error: cyclesError } = useCycle();
  const { goals, milestones, refreshGoals, isLoading: goalsLoading, isSaving: goalsSaving, error: goalsError } = useGoals();
  const { tasks, isLoading: tasksLoading, isSaving: tasksSaving, error: tasksError } = useTasks();
  const { brainDumps, isLoading: notesLoading, isSaving: notesSaving, error: notesError } = useBrainDumps();
  const { reviews: weeklyReviews, refreshWeeklyReviews,
    isLoading: weeklyLoading, isSaving: weeklySaving, error: weeklyError } = useWeeklyReviews();
  const mountedRef = useRef(false);
  const reviewsRef = useRef<ApiCycleReview[]>([]);
  const outcomesRef = useRef<ApiCycleGoalOutcome[]>([]);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(new Set<number>());
  const celebratedReviewsRef = useRef(new Set<number>());

  const enqueue = useCallback((operation: () => Promise<void>): Promise<void> => {
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const storeReviews = useCallback((records: ApiCycleReview[]) => {
    reviewsRef.current = records;
    if (mountedRef.current) setCycleReviews(records);
  }, []);
  const storeOutcomes = useCallback((records: ApiCycleGoalOutcome[]) => {
    outcomesRef.current = records;
    if (mountedRef.current) setGoalOutcomes(records);
  }, []);

  const putDetail = useCallback((detail: ApiCycleReviewDetail) => {
    const current = reviewsRef.current;
    storeReviews(current.some(review => review.id === detail.review.id)
      ? current.map(review => review.id === detail.review.id ? detail.review : review)
      : [detail.review, ...current]);
    // The complete draft replaces this report's selections, including outcomes=[].
    storeOutcomes([
      ...outcomesRef.current.filter(outcome => outcome.cycleReviewId !== detail.review.id),
      ...detail.outcomes,
    ]);
  }, [storeReviews, storeOutcomes]);

  const readCycleReviewData = useCallback(async () => {
    const [reviews, outcomes] = await Promise.all([
      fetchApiCycleReviews(), fetchApiCycleGoalOutcomes(),
    ]);
    if (mountedRef.current) {
      storeReviews(reviews);
      storeOutcomes(outcomes);
    }
  }, [storeReviews, storeOutcomes]);

  const refreshCycleReviews = useCallback(() => enqueue(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      await readCycleReviewData();
    } catch (cause) {
      const failure = asError(cause);
      if (mountedRef.current) setError(failure);
      throw failure;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }), [enqueue, readCycleReviewData]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshCycleReviews().catch(failure => {
      console.warn('Failed to load cycle review data:', failure);
    });
    return () => { mountedRef.current = false; };
  }, [refreshCycleReviews]);

  const buildSnapshot = useCallback((cycleId: number) => {
    // Never freeze empty or stale analytics because a related provider failed
    // to load, is still loading, or is in the middle of another save.
    if (cyclesLoading || goalsLoading || tasksLoading || notesLoading || weeklyLoading ||
        cyclesSaving || goalsSaving || tasksSaving || notesSaving || weeklySaving ||
        cyclesError || goalsError || tasksError || notesError || weeklyError) {
      throw new Error('Refresh the app and wait for related data to finish loading and saving before saving this review.');
    }
    const cycle = cycles.find(item => item.id === cycleId);
    if (!cycle) throw new Error('The planning cycle could not be found.');
    return calculateCycleReviewSnapshot(cycle, goals, milestones, tasks, weeklyReviews, brainDumps);
  }, [cycles, goals, milestones, tasks, weeklyReviews, brainDumps,
    cyclesLoading, goalsLoading, tasksLoading, notesLoading, weeklyLoading,
    cyclesSaving, goalsSaving, tasksSaving, notesSaving, weeklySaving,
    cyclesError, goalsError, tasksError, notesError, weeklyError]);

  const saveChange = useCallback((cycleId: number, operation: () => Promise<void>): Promise<void> => {
    if (!mountedRef.current) return Promise.reject(new Error('The cycle review provider is not available.'));
    if (pendingWritesRef.current.has(cycleId)) {
      return Promise.reject(new Error('This cycle review is already being saved.'));
    }
    pendingWritesRef.current.add(cycleId);
    setIsSaving(true);
    return enqueue(async () => {
      try {
        if (!mountedRef.current) throw new Error('The cycle review provider is not available.');
        setError(null);
        await operation();
      } catch (cause) {
        const failure = asError(cause);
        if (mountedRef.current) setError(failure);
        throw failure;
      } finally {
        pendingWritesRef.current.delete(cycleId);
        if (mountedRef.current) setIsSaving(pendingWritesRef.current.size > 0);
      }
    });
  }, [enqueue]);

  const saveReviewDraft = useCallback((input: ReviewInput) => {
    const captured = captureInput(input);
    return saveChange(captured.cycleId, async () => {
      const detail = await saveApiCycleReviewDraft({ ...captured, snapshot: buildSnapshot(captured.cycleId) });
      putDetail(detail);
    });
  }, [buildSnapshot, putDetail, saveChange]);

  const finalizeReview = useCallback((input: ReviewInput) => {
    const captured = captureInput(input);
    return saveChange(captured.cycleId, async () => {
      const existing = reviewsRef.current.find(review => review.cycleId === captured.cycleId);
      let reviewId: number;
      if (existing?.finalizedAt) {
        // A manual retry reads the backend's already-finalized result without
        // resaving the draft, rebuilding its snapshot, or creating a successor.
        reviewId = existing.id;
      } else {
        const draft = await saveApiCycleReviewDraft({ ...captured, snapshot: buildSnapshot(captured.cycleId) });
        putDetail(draft);
        reviewId = draft.review.id;
      }

      // No automatic retries. If this fails, the acknowledged draft stays in
      // state and the original API error retains its uncertain-write details.
      const result = await finalizeApiCycleReview(reviewId);
      putDetail(result);
      if (!result.alreadyFinalized && !celebratedReviewsRef.current.has(result.review.id)) {
        celebratedReviewsRef.current.add(result.review.id);
        const completedCycle = cycles.find(cycle => cycle.id === captured.cycleId);
        celebrate('cycle', completedCycle?.name ?? 'Planning cycle');
      }

      // Wait for every refresh to settle before releasing this provider's queue.
      // Do not enqueue refreshCycleReviews inside its own running operation.
      const refreshed = await Promise.allSettled([
        refreshCycles(), refreshGoals(), refreshWeeklyReviews(), readCycleReviewData(),
      ]);
      if (refreshed.some(value => value.status === 'rejected')) {
        throw new Error('The cycle was finalized, but some related data could not be refreshed. ' +
          'Refresh the app before submitting again.');
      }
    });
  }, [buildSnapshot, celebrate, cycles, putDetail, readCycleReviewData,
    refreshCycles, refreshGoals, refreshWeeklyReviews, saveChange]);

  const exportReport = useCallback(
    async (cycleId: number, cycleLabel: string) => {
      const cycle = cycles.find((item) => item.id === cycleId);
      const review = cycleReviews.find((item) => item.cycleId === cycleId);

      if (!cycle || !review) {
        throw new Error('Save the cycle review before exporting its report.');
      }

      const markdown = buildCycleReportMarkdown({
        cycle,
        cycleLabel,
        review: {
          reflection: {
            biggestAccomplishment: review.biggestAccomplishment,
            biggestChallenge: review.biggestChallenge,
            whatWorkedWell: review.whatWorkedWell,
            whatChangeNextCycle: review.whatChangeNextCycle,
            whatStopDoing: review.whatStopDoing,
            whatContinueDoing: review.whatContinueDoing,
            whatLearned: review.whatLearned,
          },
          snapshot: {
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
          },
          finalizedAt: review.finalizedAt,
          nextCycleName: review.nextCycleName,
          nextCyclePrimaryFocus: review.nextCyclePrimaryFocus,
          nextCycleTheme: review.nextCycleTheme,
          nextCycleStartDate: review.nextCycleStartDate,
          firstWeekCommitments: review.nextCycleFirstWeekCommitments,
        },
        goals,
        outcomes: goalOutcomes
          .filter(
            (outcome) =>
              outcome.cycleReviewId === review.id &&
              outcome.goalId !== null
          )
          .map((outcome) => ({
            goalId: outcome.goalId as number,
            action: outcome.action,
            replacementTitle: outcome.replacementTitle,
          })),
        weeklyReviews,
      });

      return exportCycleReport(cycleLabel, markdown);
    }, [cycleReviews, cycles, goalOutcomes, goals, weeklyReviews]
  );


  const value = useMemo(() => ({
    cycleReviews, goalOutcomes, isLoading, isSaving, error,
    refreshCycleReviews, saveReviewDraft, finalizeReview, exportReport,
  }), [cycleReviews, goalOutcomes, isLoading, isSaving, error,
    refreshCycleReviews, saveReviewDraft, finalizeReview, exportReport]);

  return <CycleReviewContext.Provider value={value}>{children}</CycleReviewContext.Provider>;
}

export function useCycleReviews() {
  const context = useContext(CycleReviewContext);
  if (!context) throw new Error('useCycleReviews must be used inside CycleReviewProvider');
  return context;
}
