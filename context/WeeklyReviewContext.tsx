import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useTasks } from '@/context/TaskContext';
import type { WeeklyReviewSnapshot } from '@/lib/weeklyReview';
import {
  deleteWeeklyCommitmentById,
  deleteWeeklyTaskDecisionById,
  getWeeklyCommitments,
  getWeeklyReviews,
  getWeeklyTaskDecisions,
  insertTaskWeeklyCommitment,
  insertWeeklyCommitment,
  recordWeeklyTaskDecision,
  saveWeeklyReview,
  toggleWeeklyCommitmentById,
  type StoredWeeklyReview,
  type WeeklyCommitment,
  type WeeklyReviewReflectionInput,
  type WeeklyTaskDecision,
  type WeeklyTaskDecisionAction,
} from '@/lib/weeklyReviewStorage';

export type {
  StoredWeeklyReview,
  WeeklyCommitment,
  WeeklyReviewReflectionInput,
  WeeklyTaskDecision,
  WeeklyTaskDecisionAction,
};

type WeeklyReviewContextValue = {
  reviews: StoredWeeklyReview[];
  commitments: WeeklyCommitment[];
  taskDecisions: WeeklyTaskDecision[];
  isLoading: boolean;
  refreshWeeklyReviews: () => Promise<void>;
  saveReview: (
    weekStart: string,
    cycleId: number | null,
    reflection: WeeklyReviewReflectionInput,
    snapshot: WeeklyReviewSnapshot
  ) => Promise<void>;
  addCommitment: (
    weekStart: string,
    cycleId: number | null,
    title: string
  ) => Promise<void>;
  addTaskCommitment: (
    weekStart: string,
    cycleId: number | null,
    taskId: number
  ) => Promise<void>;
  toggleCommitment: (id: number) => Promise<void>;
  deleteCommitment: (id: number) => Promise<void>;
  recordTaskDecision: (input: {
    weekStart: string;
    taskId: number | null;
    taskTitle: string;
    originalDueDate: string;
    action: WeeklyTaskDecisionAction;
    resolvedDueDate?: string | null;
    recurringRuleId?: number | null;
    recurrenceOccurrenceDate?: string | null;
  }) => Promise<void>;
  deleteTaskDecision: (id: number) => Promise<void>;
};

const WeeklyReviewContext =
  createContext<WeeklyReviewContextValue | null>(null);

export function WeeklyReviewProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { refreshTasks } = useTasks();
  const [reviews, setReviews] = useState<StoredWeeklyReview[]>([]);
  const [commitments, setCommitments] = useState<WeeklyCommitment[]>([]);
  const [taskDecisions, setTaskDecisions] = useState<WeeklyTaskDecision[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshWeeklyReviews = useCallback(async () => {
    setIsLoading(true);

    try {
      const [loadedReviews, loadedCommitments, loadedDecisions] =
        await Promise.all([
          getWeeklyReviews(),
          getWeeklyCommitments(),
          getWeeklyTaskDecisions(),
        ]);

      setReviews(loadedReviews);
      setCommitments(loadedCommitments);
      setTaskDecisions(loadedDecisions);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWeeklyReviews().catch((error) => {
      console.warn('Failed to load weekly review data:', error);
    });
  }, [refreshWeeklyReviews]);

  const saveReview = useCallback(
    async (
      weekStart: string,
      cycleId: number | null,
      reflection: WeeklyReviewReflectionInput,
      snapshot: WeeklyReviewSnapshot
    ) => {
      await saveWeeklyReview(weekStart, cycleId, reflection, snapshot);
      await refreshWeeklyReviews();
    },
    [refreshWeeklyReviews]
  );

  const addCommitment = useCallback(
    async (
      weekStart: string,
      cycleId: number | null,
      title: string
    ) => {
      await insertWeeklyCommitment(weekStart, cycleId, title);
      await refreshWeeklyReviews();
    },
    [refreshWeeklyReviews]
  );

  const addTaskCommitment = useCallback(
    async (
      weekStart: string,
      cycleId: number | null,
      taskId: number
    ) => {
      await insertTaskWeeklyCommitment(weekStart, cycleId, taskId);
      await refreshWeeklyReviews();
    },
    [refreshWeeklyReviews]
  );

  const toggleCommitment = useCallback(
    async (id: number) => {
      await toggleWeeklyCommitmentById(id);
      await refreshTasks();
      await refreshWeeklyReviews();
    },
    [refreshTasks, refreshWeeklyReviews]
  );

  const deleteCommitment = useCallback(
    async (id: number) => {
      await deleteWeeklyCommitmentById(id);
      await refreshWeeklyReviews();
    },
    [refreshWeeklyReviews]
  );

  const recordTaskDecision = useCallback(
    async (input: Parameters<typeof recordWeeklyTaskDecision>[0]) => {
      await recordWeeklyTaskDecision(input);
      await refreshWeeklyReviews();
    },
    [refreshWeeklyReviews]
  );

  const deleteTaskDecision = useCallback(
    async (id: number) => {
      await deleteWeeklyTaskDecisionById(id);
      await refreshWeeklyReviews();
    },
    [refreshWeeklyReviews]
  );

  const value = useMemo(
    () => ({
      reviews,
      commitments,
      taskDecisions,
      isLoading,
      refreshWeeklyReviews,
      saveReview,
      addCommitment,
      addTaskCommitment,
      toggleCommitment,
      deleteCommitment,
      recordTaskDecision,
      deleteTaskDecision,
    }),
    [
      reviews,
      commitments,
      taskDecisions,
      isLoading,
      refreshWeeklyReviews,
      saveReview,
      addCommitment,
      addTaskCommitment,
      toggleCommitment,
      deleteCommitment,
      recordTaskDecision,
      deleteTaskDecision,
    ]
  );

  return (
    <WeeklyReviewContext.Provider value={value}>
      {children}
    </WeeklyReviewContext.Provider>
  );
}

export function useWeeklyReviews() {
  const context = useContext(WeeklyReviewContext);

  if (!context) {
    throw new Error(
      'useWeeklyReviews must be used inside WeeklyReviewProvider'
    );
  }

  return context;
}
