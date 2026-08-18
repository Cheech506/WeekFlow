import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCelebrations } from '@/context/CelebrationContext';
import { useCycle } from '@/context/CycleContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';
import { exportCycleReport } from '@/lib/cycleReportExport';
import {
  getCycleGoalOutcomes,
  getCycleReviews,
  finalizeCycleReviewAndStartNextCycle,
  saveCycleReviewDraft,
  type StoredCycleGoalOutcome,
  type StoredCycleReview,
} from '@/lib/cycleReviewStorage';
import {
  buildCycleReportMarkdown,
  calculateCycleReviewSnapshot,
  normalizeCycleReviewReflection,
  type CycleGoalOutcomeInput,
  type CycleReviewReflectionInput,
  type NextCyclePlanInput,
} from '@/lib/cycleReviewUtils';

export type {
  StoredCycleGoalOutcome,
  StoredCycleReview,
  CycleGoalOutcomeInput,
  CycleReviewReflectionInput,
  NextCyclePlanInput,
};

type CycleReviewContextValue = {
  cycleReviews: StoredCycleReview[];
  goalOutcomes: StoredCycleGoalOutcome[];
  isLoading: boolean;
  refreshCycleReviews: () => Promise<void>;
  saveReviewDraft: (input: {
    cycleId: number;
    reflection: CycleReviewReflectionInput;
    nextCycle: NextCyclePlanInput;
    outcomes: CycleGoalOutcomeInput[];
  }) => Promise<void>;
  finalizeReview: (input: {
    cycleId: number;
    reflection: CycleReviewReflectionInput;
    nextCycle: NextCyclePlanInput;
    outcomes: CycleGoalOutcomeInput[];
  }) => Promise<void>;
  exportReport: (
    cycleId: number,
    cycleLabel: string
  ) => Promise<string>;
};

const CycleReviewContext =
  createContext<CycleReviewContextValue | null>(null);

export function CycleReviewProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [cycleReviews, setCycleReviews] = useState<StoredCycleReview[]>([]);
  const [goalOutcomes, setGoalOutcomes] = useState<
    StoredCycleGoalOutcome[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const { celebrate } = useCelebrations();

  const { cycles, refreshCycles } = useCycle();
  const { goals, milestones, refreshGoals } = useGoals();
  const { tasks } = useTasks();
  const { brainDumps } = useBrainDumps();
  const {
    reviews: weeklyReviews,
    refreshWeeklyReviews,
  } = useWeeklyReviews();

  const refreshCycleReviews = useCallback(async () => {
    setIsLoading(true);

    try {
      const [storedReviews, storedOutcomes] = await Promise.all([
        getCycleReviews(),
        getCycleGoalOutcomes(),
      ]);
      setCycleReviews(storedReviews);
      setGoalOutcomes(storedOutcomes);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCycleReviews().catch((error) => {
      console.warn('Failed to load cycle review data:', error);
    });
  }, [refreshCycleReviews]);

  const buildSnapshot = useCallback(
    (cycleId: number) => {
      const cycle = cycles.find((item) => item.id === cycleId);

      if (!cycle) {
        throw new Error('The planning cycle could not be found.');
      }

      return calculateCycleReviewSnapshot(
        cycle,
        goals,
        milestones,
        tasks,
        weeklyReviews,
        brainDumps
      );
    }, [brainDumps, cycles, goals, milestones, tasks, weeklyReviews]
  );

  const saveReviewDraft = useCallback(
    async (input: {
      cycleId: number;
      reflection: CycleReviewReflectionInput;
      nextCycle: NextCyclePlanInput;
      outcomes: CycleGoalOutcomeInput[];
    }) => {
      await saveCycleReviewDraft({
        ...input,
        snapshot: buildSnapshot(input.cycleId),
      });
      await refreshCycleReviews();
    },
    [buildSnapshot, refreshCycleReviews]
  );

  const finalizeReview = useCallback(
    async (input: {
      cycleId: number;
      reflection: CycleReviewReflectionInput;
      nextCycle: NextCyclePlanInput;
      outcomes: CycleGoalOutcomeInput[];
    }) => {
      const completedCycle = cycles.find((cycle) => cycle.id === input.cycleId);

      await finalizeCycleReviewAndStartNextCycle({
        ...input,
        snapshot: buildSnapshot(input.cycleId),
      });

      await Promise.all([
        refreshCycles(),
        refreshGoals(),
        refreshCycleReviews(),
        refreshWeeklyReviews(),
      ]);

      celebrate('cycle', completedCycle?.name ?? '12-Week Cycle');
    }, [
      buildSnapshot,
      celebrate,
      cycles,
      refreshCycleReviews,
      refreshCycles,
      refreshGoals,
      refreshWeeklyReviews,
    ]
  );

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
          reflection: normalizeCycleReviewReflection({
            biggestAccomplishment: review.biggestAccomplishment,
            biggestChallenge: review.biggestChallenge,
            whatWorkedWell: review.whatWorkedWell,
            whatChangeNextCycle: review.whatChangeNextCycle,
            whatStopDoing: review.whatStopDoing,
            whatContinueDoing: review.whatContinueDoing,
            whatLearned: review.whatLearned,
          }),
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

  const value = useMemo(
    () => ({
      cycleReviews,
      goalOutcomes,
      isLoading,
      refreshCycleReviews,
      saveReviewDraft,
      finalizeReview,
      exportReport,
    }),
    [
      cycleReviews,
      goalOutcomes,
      isLoading,
      refreshCycleReviews,
      saveReviewDraft,
      finalizeReview,
      exportReport,
    ]
  );

  return (
    <CycleReviewContext.Provider value={value}>
      {children}
    </CycleReviewContext.Provider>
  );
}

export function useCycleReviews() {
  const context = useContext(CycleReviewContext);

  if (!context) {
    throw new Error('useCycleReviews must be used inside CycleReviewProvider');
  }

  return context;
}
