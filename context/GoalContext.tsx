import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useCelebrations } from '@/context/CelebrationContext';
import { useTasks } from '@/context/TaskContext';
import {
  completeApiGoal,
  createApiGoal,
  deleteApiGoal,
  fetchApiGoals,
  reopenApiGoal,
  updateApiGoal,
  type ApiGoal,
} from '@/lib/api/goalApi';
import {
  createApiGoalMilestone,
  deleteApiGoalMilestone,
  fetchApiGoalMilestones,
  updateApiGoalMilestone,
  type ApiGoalMilestone,
} from '@/lib/api/goalMilestoneApi';
import type { GoalCompletionReflection } from '@/lib/goalReviewUtils';
import type { GoalPlanningDetails, StoredGoal } from '@/lib/goalStorage';
import { createDefaultGoalDateRange } from '@/lib/goalUtils';

// Keep the existing screen contract. API records also retain migration metadata.
export type Goal = StoredGoal;

type GoalContextValue = {
  goals: ApiGoal[];
  milestones: ApiGoalMilestone[];
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refreshGoals: () => Promise<void>;
  addGoal: (
    title: string,
    startDateKey?: string,
    endDateKey?: string,
    reward?: string | null,
    planningDetails?: GoalPlanningDetails,
    cycleId?: number | null
  ) => Promise<void>;
  editGoal: (
    id: number,
    title: string,
    startDateKey: string,
    endDateKey: string,
    reward?: string | null,
    planningDetails?: GoalPlanningDetails
  ) => Promise<void>;
  completeGoal: (id: number, reflection?: GoalCompletionReflection) => Promise<void>;
  reopenGoal: (id: number) => Promise<void>;
  deleteGoal: (id: number) => Promise<void>;
  addMilestone: (
    goalId: number,
    title: string,
    targetDate?: string | null,
    notes?: string | null
  ) => Promise<void>;
  editMilestone: (
    id: number,
    title: string,
    targetDate?: string | null,
    notes?: string | null
  ) => Promise<void>;
  toggleMilestone: (id: number) => Promise<void>;
  deleteMilestone: (id: number) => Promise<void>;
};

const GoalContext = createContext<GoalContextValue | null>(null);

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('The goal request failed.');
}

export function GoalProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<ApiGoal[]>([]);
  const [milestones, setMilestones] = useState<ApiGoalMilestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { refreshTasks } = useTasks();
  const { celebrate } = useCelebrations();
  const mountedRef = useRef(false);
  const goalsRef = useRef<ApiGoal[]>([]);
  const milestonesRef = useRef<ApiGoalMilestone[]>([]);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(new Set<string>());

  // Serialize provider operations so an older read cannot replace a saved change.
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const storeGoals = useCallback((records: ApiGoal[]) => {
    goalsRef.current = records;
    if (mountedRef.current) setGoals(records);
  }, []);

  const storeMilestones = useCallback((records: ApiGoalMilestone[]) => {
    milestonesRef.current = records;
    if (mountedRef.current) setMilestones(records);
  }, []);

  const putGoal = useCallback((record: ApiGoal) => {
    const current = goalsRef.current;
    storeGoals(current.some((goal) => goal.id === record.id)
      ? current.map((goal) => goal.id === record.id ? record : goal)
      : [record, ...current]);
  }, [storeGoals]);

  const putMilestone = useCallback((record: ApiGoalMilestone) => {
    const current = milestonesRef.current;
    storeMilestones(current.some((milestone) => milestone.id === record.id)
      ? current.map((milestone) => milestone.id === record.id ? record : milestone)
      : [...current, record]);
  }, [storeMilestones]);

  const refreshGoals = useCallback(() => enqueue(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      // Update neither list until both API requests have succeeded.
      const [loadedGoals, loadedMilestones] = await Promise.all([
        fetchApiGoals(),
        fetchApiGoalMilestones(),
      ]);
      if (mountedRef.current) {
        storeGoals(loadedGoals);
        storeMilestones(loadedMilestones);
      }
    } catch (cause) {
      const failure = asError(cause);
      if (mountedRef.current) setError(failure);
      throw failure;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }), [enqueue, storeGoals, storeMilestones]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshGoals().catch((failure) => {
      console.warn('Failed to load goals and milestones:', failure);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [refreshGoals]);

  const saveChange = useCallback(function saveChange<T>(
    key: string,
    write: () => Promise<T>,
    afterSave: (record: T) => void | Promise<void>
  ): Promise<void> {
    if (!mountedRef.current) {
      return Promise.reject(new Error('The goal provider is not available.'));
    }
    // A second action on the same record is blocked immediately.
    // Changes to different records can wait safely in the operation queue.
    if (pendingWritesRef.current.has(key)) {
      return Promise.reject(new Error('This goal or milestone is already being saved.'));
    }
    pendingWritesRef.current.add(key);
    setIsSaving(true);

    return enqueue(async () => {
      let saved = false;
      try {
        if (!mountedRef.current) {
          throw new Error('The goal provider is not available.');
        }
        setError(null);
        const record = await write();
        saved = true;
        await afterSave(record);
      } catch (cause) {
        const failure = saved
          ? new Error(
              'The change was saved, but a related view could not be refreshed. ' +
              'Refresh the app before submitting again.'
            )
          : asError(cause);
        if (mountedRef.current) setError(failure);
        throw failure;
      } finally {
        pendingWritesRef.current.delete(key);
        if (mountedRef.current) {
          setIsSaving(pendingWritesRef.current.size > 0);
        }
      }
    });
  }, [enqueue]);

  const addGoal = useCallback((
    title: string,
    startDateKey?: string,
    endDateKey?: string,
    reward?: string | null,
    planningDetails: GoalPlanningDetails = {},
    cycleId: number | null = null
  ): Promise<void> => {
    if (!title.trim()) return Promise.resolve();
    const defaults = createDefaultGoalDateRange();
    return saveChange('goal:create', () => createApiGoal({
      title,
      startDate: startDateKey ?? defaults.startDateKey,
      endDate: endDateKey ?? defaults.endDateKey,
      cycleId,
      reward: reward ?? null,
      purpose: planningDetails.purpose ?? null,
      successDefinition: planningDetails.successDefinition ?? null,
      notes: planningDetails.notes ?? null,
    }), putGoal);
  }, [putGoal, saveChange]);

  const editGoal = useCallback((
    id: number,
    title: string,
    startDateKey: string,
    endDateKey: string,
    reward?: string | null,
    planningDetails: GoalPlanningDetails = {}
  ) => saveChange(`goal:${id}`, () => updateApiGoal(id, {
    title,
    startDate: startDateKey,
    endDate: endDateKey,
    reward: reward ?? null,
    purpose: planningDetails.purpose ?? null,
    successDefinition: planningDetails.successDefinition ?? null,
    notes: planningDetails.notes ?? null,
  }), putGoal), [putGoal, saveChange]);

  const completeGoal = useCallback((
    id: number,
    reflection: GoalCompletionReflection = {}
  ): Promise<void> => {
    if (goalsRef.current.find((goal) => goal.id === id)?.completed) {
      return Promise.resolve();
    }
    // The backend computes completion totals from its own task/milestone links.
    return saveChange(`goal:${id}`, () => completeApiGoal(id, reflection), (record) => {
      putGoal(record);
      celebrate('goal', record.title);
    });
  }, [celebrate, putGoal, saveChange]);

  const reopenGoal = useCallback((id: number): Promise<void> => {
    const goal = goalsRef.current.find((record) => record.id === id);
    if (goal && !goal.completed) return Promise.resolve();
    return saveChange(`goal:${id}`, () => reopenApiGoal(id), putGoal);
  }, [putGoal, saveChange]);

  const deleteGoal = useCallback((id: number) => saveChange(
    `goal:${id}`,
    () => deleteApiGoal(id),
    async () => {
      storeGoals(goalsRef.current.filter((goal) => goal.id !== id));
      storeMilestones(milestonesRef.current.filter((milestone) => milestone.goalId !== id));
      // PostgreSQL clears linked task, schedule, and template goal references.
      // TaskContext will reload those records through its API clients too.
      await refreshTasks();
    }
  ), [refreshTasks, saveChange, storeGoals, storeMilestones]);

  const addMilestone = useCallback((
    goalId: number,
    title: string,
    targetDate?: string | null,
    notes?: string | null
  ) => saveChange(`milestone:create:${goalId}`, () => createApiGoalMilestone({
    goalId,
    title,
    targetDate: targetDate ?? null,
    notes: notes ?? null,
  }), putMilestone), [putMilestone, saveChange]);

  const editMilestone = useCallback((
    id: number,
    title: string,
    targetDate?: string | null,
    notes?: string | null
  ) => saveChange(`milestone:${id}`, () => updateApiGoalMilestone(id, {
    title,
    targetDate: targetDate ?? null,
    notes: notes ?? null,
  }), putMilestone), [putMilestone, saveChange]);

  const toggleMilestone = useCallback((id: number) => saveChange(
    `milestone:${id}`,
    async () => {
      const milestone = milestonesRef.current.find((record) => record.id === id);
      if (!milestone) throw new Error('Refresh milestones before changing this record.');
      return updateApiGoalMilestone(id, { completed: !milestone.completed });
    },
    putMilestone
  ), [putMilestone, saveChange]);

  const deleteMilestone = useCallback((id: number) => saveChange(
    `milestone:${id}`,
    () => deleteApiGoalMilestone(id),
    () => storeMilestones(milestonesRef.current.filter((milestone) => milestone.id !== id))
  ), [saveChange, storeMilestones]);

  const value = useMemo(() => ({
    goals, milestones, isLoading, isSaving, error, refreshGoals,
    addGoal, editGoal, completeGoal, reopenGoal, deleteGoal,
    addMilestone, editMilestone, toggleMilestone, deleteMilestone,
  }), [goals, milestones, isLoading, isSaving, error, refreshGoals,
    addGoal, editGoal, completeGoal, reopenGoal, deleteGoal,
    addMilestone, editMilestone, toggleMilestone, deleteMilestone]);

  return <GoalContext.Provider value={value}>{children}</GoalContext.Provider>;
}

export function useGoals() {
  const context = useContext(GoalContext);
  if (!context) {
    throw new Error('useGoals must be used inside GoalProvider');
  }
  return context;
}
