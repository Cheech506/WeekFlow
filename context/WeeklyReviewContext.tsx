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

import { useTasks } from '@/context/TaskContext';
import {
  createApiWeeklyCommitment,
  deleteApiWeeklyCommitment,
  fetchApiWeeklyCommitment,
  fetchApiWeeklyCommitments,
  updateApiWeeklyCommitment,
  type ApiWeeklyCommitment,
} from '@/lib/api/weeklyCommitmentApi';
import {
  createApiWeeklyReview,
  fetchApiWeeklyReviews,
  updateApiWeeklyReview,
  type ApiWeeklyReview,
} from '@/lib/api/weeklyReviewApi';
import {
  applyApiWeeklyTaskDecision,
  deleteApiWeeklyTaskDecision,
  fetchApiWeeklyTaskDecisions,
  type ApiWeeklyTaskDecision,
  type ApplyApiWeeklyTaskDecisionInput,
} from '@/lib/api/weeklyTaskDecisionApi';
import type { WeeklyReviewSnapshot } from '@/lib/weeklyReview';
import type {
  StoredWeeklyReview,
  WeeklyCommitment,
  WeeklyReviewReflectionInput,
  WeeklyTaskDecision,
  WeeklyTaskDecisionAction,
} from '@/lib/weeklyReviewStorage';

export type {
  StoredWeeklyReview,
  WeeklyCommitment,
  WeeklyReviewReflectionInput,
  WeeklyTaskDecision,
  WeeklyTaskDecisionAction
};

// Retain the screen's input shape during integration. The API always needs the
// live task ID, including for deletion; it reads title/recurrence history itself.
type TaskDecisionInput = {
  weekStart: string;
  taskId: number | null;
  taskTitle: string;
  originalDueDate: string;
  action: WeeklyTaskDecisionAction;
  resolvedDueDate?: string | null;
  recurringRuleId?: number | null;
  recurrenceOccurrenceDate?: string | null;
};

type WeeklyReviewContextValue = {
  reviews: ApiWeeklyReview[];
  commitments: ApiWeeklyCommitment[];
  taskDecisions: ApiWeeklyTaskDecision[];
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refreshWeeklyReviews: () => Promise<void>;
  saveReview: (
    weekStart: string,
    cycleId: number | null,
    reflection: WeeklyReviewReflectionInput,
    snapshot: WeeklyReviewSnapshot
  ) => Promise<void>;
  addCommitment: (weekStart: string, cycleId: number | null, title: string) => Promise<void>;
  addTaskCommitment: (weekStart: string, cycleId: number | null, taskId: number) => Promise<void>;
  toggleCommitment: (id: number) => Promise<void>;
  deleteCommitment: (id: number) => Promise<void>;
  recordTaskDecision: (input: TaskDecisionInput) => Promise<void>;
  deleteTaskDecision: (id: number) => Promise<void>;
};

const WeeklyReviewContext = createContext<WeeklyReviewContextValue | null>(null);

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('The weekly review request failed.');
}

function decisionRequest(input: TaskDecisionInput): ApplyApiWeeklyTaskDecisionInput {
  if (input.taskId === null) {
    throw new Error('A weekly decision needs the existing task ID, including when deleting it.');
  }
  const common = {
    weekStart: input.weekStart,
    taskId: input.taskId,
    originalDueDate: input.originalDueDate,
  };
  if (input.action === 'reschedule') {
    if (typeof input.resolvedDueDate !== 'string') {
      throw new Error('Choose a date for the rescheduled task.');
    }
    return { ...common, action: 'reschedule', resolvedDueDate: input.resolvedDueDate };
  }
  if (input.action === 'nextWeek') {
    return { ...common, action: 'nextWeek', resolvedDueDate: input.resolvedDueDate ?? null };
  }
  if (input.resolvedDueDate != null) {
    throw new Error('This weekly decision cannot include a new scheduled date.');
  }
  return { ...common, action: input.action, resolvedDueDate: null };
}

export function WeeklyReviewProvider({ children }: { children: ReactNode }) {
  const { refreshTasks } = useTasks();
  const [reviews, setReviews] = useState<ApiWeeklyReview[]>([]);
  const [commitments, setCommitments] = useState<ApiWeeklyCommitment[]>([]);
  const [taskDecisions, setTaskDecisions] = useState<ApiWeeklyTaskDecision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(false);
  const reviewsRef = useRef<ApiWeeklyReview[]>([]);
  const commitmentsRef = useRef<ApiWeeklyCommitment[]>([]);
  const decisionsRef = useRef<ApiWeeklyTaskDecision[]>([]);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(new Set<string>());

  const enqueue = useCallback((operation: () => Promise<void>): Promise<void> => {
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const storeReviews = useCallback((records: ApiWeeklyReview[]) => {
    reviewsRef.current = records;
    if (mountedRef.current) setReviews(records);
  }, []);
  const storeCommitments = useCallback((records: ApiWeeklyCommitment[]) => {
    commitmentsRef.current = records;
    if (mountedRef.current) setCommitments(records);
  }, []);
  const storeDecisions = useCallback((records: ApiWeeklyTaskDecision[]) => {
    decisionsRef.current = records;
    if (mountedRef.current) setTaskDecisions(records);
  }, []);

  const putReview = useCallback((record: ApiWeeklyReview) => {
    const current = reviewsRef.current;
    storeReviews(current.some(row => row.id === record.id)
      ? current.map(row => row.id === record.id ? record : row) : [record, ...current]);
  }, [storeReviews]);
  const putCommitment = useCallback((record: ApiWeeklyCommitment) => {
    const current = commitmentsRef.current;
    storeCommitments(current.some(row => row.id === record.id)
      ? current.map(row => row.id === record.id ? record : row) : [record, ...current]);
  }, [storeCommitments]);
  const putDecision = useCallback((record: ApiWeeklyTaskDecision) => {
    const current = decisionsRef.current;
    storeDecisions(current.some(row => row.id === record.id)
      ? current.map(row => row.id === record.id ? record : row) : [record, ...current]);
  }, [storeDecisions]);

  const readWeeklyData = useCallback(async () => {
    const [loadedReviews, loadedCommitments, loadedDecisions] = await Promise.all([
      fetchApiWeeklyReviews(), fetchApiWeeklyCommitments(), fetchApiWeeklyTaskDecisions(),
    ]);
    // Keep all three last-good lists if any request fails.
    if (mountedRef.current) {
      storeReviews(loadedReviews);
      storeCommitments(loadedCommitments);
      storeDecisions(loadedDecisions);
    }
  }, [storeReviews, storeCommitments, storeDecisions]);

  const refreshWeeklyReviews = useCallback(() => enqueue(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      await readWeeklyData();
    } catch (cause) {
      const failure = asError(cause);
      if (mountedRef.current) setError(failure);
      throw failure;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }), [enqueue, readWeeklyData]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshWeeklyReviews().catch(failure => {
      console.warn('Failed to load weekly review data:', failure);
    });
    return () => { mountedRef.current = false; };
  }, [refreshWeeklyReviews]);

  const saveChange = useCallback(function saveChange<T>(
    key: string,
    write: () => Promise<T>,
    afterSave: (record: T) => void | Promise<void>
  ): Promise<void> {
    if (!mountedRef.current) {
      return Promise.reject(new Error('The weekly review provider is not available.'));
    }
    if (pendingWritesRef.current.has(key)) {
      return Promise.reject(new Error('This weekly record is already being saved.'));
    }
    pendingWritesRef.current.add(key);
    setIsSaving(true);
    return enqueue(async () => {
      let saved = false;
      try {
        if (!mountedRef.current) throw new Error('The weekly review provider is not available.');
        setError(null);
        const record = await write();
        saved = true;
        await afterSave(record);
      } catch (cause) {
        const failure = saved
          ? new Error('The change was saved, but related data could not be refreshed. ' +
              'Refresh the app before submitting again.')
          : asError(cause);
        if (mountedRef.current) setError(failure);
        throw failure;
      } finally {
        pendingWritesRef.current.delete(key);
        if (mountedRef.current) setIsSaving(pendingWritesRef.current.size > 0);
      }
    });
  }, [enqueue]);

  const saveReview = useCallback((
    weekStart: string,
    cycleId: number | null,
    reflection: WeeklyReviewReflectionInput,
    snapshot: WeeklyReviewSnapshot
  ) => {
    // Capture the form before it waits in the queue. Missing optional responses
    // clear their text, matching the existing full reflection editor.
    const responses = {
      cycleId,
      whatWentWell: reflection.whatWentWell ?? null,
      whatCausedProblems: reflection.whatCausedProblems ?? null,
      whatLearned: reflection.whatLearned ?? null,
      whatChangeNextWeek: reflection.whatChangeNextWeek ?? null,
      nextWeekFocus: reflection.nextWeekFocus ?? null,
    };
    const initialSnapshot = { ...snapshot };
    return saveChange(`review:${weekStart}`, () => {
      const existing = reviewsRef.current.find(review => review.weekStart === weekStart);
      // Reflection edits must never replace the first saved analytics snapshot.
      return existing
        ? updateApiWeeklyReview(existing.id, responses)
        : createApiWeeklyReview({ weekStart, ...responses, snapshot: initialSnapshot });
    }, putReview);
  }, [putReview, saveChange]);

  const addCommitment = useCallback((weekStart: string, cycleId: number | null, title: string) =>
    saveChange(`commitment:create:${weekStart}`,
      () => createApiWeeklyCommitment({ weekStart, cycleId, title }), putCommitment),
  [putCommitment, saveChange]);

  const addTaskCommitment = useCallback((weekStart: string, cycleId: number | null, taskId: number) =>
    saveChange(`commitment:task:${weekStart}:${taskId}`,
      () => createApiWeeklyCommitment({ weekStart, cycleId, taskId }), putCommitment),
  [putCommitment, saveChange]);

  const toggleCommitment = useCallback((id: number) =>
    saveChange(`commitment:${id}`, async () => {
      // Linked commitments display a task's live completion state. Read it
      // before choosing the explicit true/false update instead of using a stale
      // commitment snapshot after a task was completed on another screen.
      const current = await fetchApiWeeklyCommitment(id);
      return updateApiWeeklyCommitment(id, { completed: !current.completed });
    }, async record => {
      putCommitment(record);
      if (record.taskId !== null) await refreshTasks();
      await readWeeklyData();
    }),
  [putCommitment, readWeeklyData, refreshTasks, saveChange]);

  const deleteCommitment = useCallback((id: number) =>
    saveChange(`commitment:${id}`, () => deleteApiWeeklyCommitment(id), () => {
      storeCommitments(commitmentsRef.current.filter(record => record.id !== id));
    }),
  [saveChange, storeCommitments]);

  const recordTaskDecision = useCallback((input: TaskDecisionInput) => {
    const captured = { ...input };
    return saveChange(`decision:task:${input.taskId}`, () =>
      applyApiWeeklyTaskDecision(decisionRequest(captured)), async record => {
      putDecision(record);
      // The backend already moves/deletes the task and saves its history in one
      // transaction. Do not call a task write before or after this action.
      await refreshTasks();
      await readWeeklyData();
    });
  }, [putDecision, readWeeklyData, refreshTasks, saveChange]);

  const deleteTaskDecision = useCallback((id: number) =>
    saveChange(`decision:${id}`, () => deleteApiWeeklyTaskDecision(id), () => {
      // Deleting history does not undo its task action or remove a recurring skip.
      storeDecisions(decisionsRef.current.filter(record => record.id !== id));
    }),
  [saveChange, storeDecisions]);

  const value = useMemo(() => ({
    reviews, commitments, taskDecisions, isLoading, isSaving, error, refreshWeeklyReviews,
    saveReview, addCommitment, addTaskCommitment, toggleCommitment, deleteCommitment,
    recordTaskDecision, deleteTaskDecision,
  }), [reviews, commitments, taskDecisions, isLoading, isSaving, error, refreshWeeklyReviews,
    saveReview, addCommitment, addTaskCommitment, toggleCommitment, deleteCommitment,
    recordTaskDecision, deleteTaskDecision]);

  return <WeeklyReviewContext.Provider value={value}>{children}</WeeklyReviewContext.Provider>;
}

export function useWeeklyReviews() {
  const context = useContext(WeeklyReviewContext);
  if (!context) throw new Error('useWeeklyReviews must be used inside WeeklyReviewProvider');
  return context;
}
