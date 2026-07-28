import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useTasks } from '@/context/TaskContext';
import {
  deleteGoalMilestoneById,
  getGoalMilestones,
  insertGoalMilestone,
  updateGoalMilestone,
  updateGoalMilestoneCompletion,
  type GoalMilestone,
} from '@/lib/goalMilestoneStorage';
import {
  deleteGoalById,
  getGoals,
  insertGoal,
  updateGoalCompletion,
  updateGoalDetails,
  type GoalPlanningDetails,
  type StoredGoal,
} from '@/lib/goalStorage';

export type Goal = StoredGoal;

type GoalContextValue = {
  goals: Goal[];
  milestones: GoalMilestone[];
  isLoading: boolean;
  refreshGoals: () => Promise<void>;
  addGoal: (
    title: string,
    startDateKey?: string,
    endDateKey?: string,
    reward?: string | null,
    planningDetails?: GoalPlanningDetails
  ) => Promise<void>;
  editGoal: (
    id: number,
    title: string,
    startDateKey: string,
    endDateKey: string,
    reward?: string | null,
    planningDetails?: GoalPlanningDetails
  ) => Promise<void>;
  toggleGoal: (id: number) => Promise<void>;
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

export function GoalProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [milestones, setMilestones] = useState<GoalMilestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { refreshTasks } = useTasks();

  const refreshGoals = useCallback(async () => {
    setIsLoading(true);

    try {
      /*
       * Goals and milestones are separate relational records, but they are
       * refreshed together so every goal card renders a consistent snapshot.
       */
      const [storedGoals, storedMilestones] = await Promise.all([
        getGoals(),
        getGoalMilestones(),
      ]);

      setGoals(storedGoals);
      setMilestones(storedMilestones);
    } catch (error) {
      console.error('Failed to load goals:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshGoals();
  }, [refreshGoals]);

  const addGoal = useCallback(
    async (
      title: string,
      startDateKey?: string,
      endDateKey?: string,
      reward?: string | null,
      planningDetails?: GoalPlanningDetails
    ) => {
      if (!title.trim()) return;

      try {
        const newGoal = await insertGoal(
          title,
          startDateKey,
          endDateKey,
          reward,
          planningDetails
        );
        setGoals((currentGoals) => [newGoal, ...currentGoals]);
      } catch (error) {
        console.error('Failed to add goal:', error);
        throw error;
      }
    },
    []
  );

  const editGoal = useCallback(
    async (
      id: number,
      title: string,
      startDateKey: string,
      endDateKey: string,
      reward?: string | null,
      planningDetails?: GoalPlanningDetails
    ) => {
      try {
        const updatedGoal = await updateGoalDetails(
          id,
          title,
          startDateKey,
          endDateKey,
          reward,
          planningDetails
        );

        setGoals((currentGoals) =>
          currentGoals.map((goal) =>
            goal.id === id
              ? {
                  ...goal,
                  ...updatedGoal,
                }
              : goal
          )
        );
      } catch (error) {
        console.error('Failed to update goal:', error);
        throw error;
      }
    },
    []
  );

  const toggleGoal = useCallback(
    async (id: number) => {
      const goal = goals.find((item) => item.id === id);
      if (!goal) return;

      const nextCompleted = !goal.completed;

      try {
        const completedAt = await updateGoalCompletion(id, nextCompleted);

        setGoals((currentGoals) =>
          currentGoals.map((item) =>
            item.id === id
              ? {
                  ...item,
                  completed: nextCompleted,
                  completedAt,
                }
              : item
          )
        );
      } catch (error) {
        console.error('Failed to toggle goal:', error);
        throw error;
      }
    },
    [goals]
  );

  const deleteGoal = useCallback(
    async (id: number) => {
      try {
        await deleteGoalById(id);

        setGoals((currentGoals) =>
          currentGoals.filter((goal) => goal.id !== id)
        );
        setMilestones((currentMilestones) =>
          currentMilestones.filter((milestone) => milestone.goalId !== id)
        );

        // Reload task and recurring-rule state so deleted goal links disappear
        // immediately from every screen without requiring an app restart.
        await refreshTasks();
      } catch (error) {
        console.error('Failed to delete goal:', error);
        throw error;
      }
    },
    [refreshTasks]
  );

  const addMilestone = useCallback(
    async (
      goalId: number,
      title: string,
      targetDate?: string | null,
      notes?: string | null
    ) => {
      try {
        const milestone = await insertGoalMilestone(
          goalId,
          title,
          targetDate,
          notes
        );
        setMilestones((current) => [...current, milestone]);
      } catch (error) {
        console.error('Failed to add milestone:', error);
        throw error;
      }
    },
    []
  );

  const editMilestone = useCallback(
    async (
      id: number,
      title: string,
      targetDate?: string | null,
      notes?: string | null
    ) => {
      try {
        const updated = await updateGoalMilestone(
          id,
          title,
          targetDate,
          notes
        );
        setMilestones((current) =>
          current.map((milestone) =>
            milestone.id === id
              ? { ...milestone, ...updated }
              : milestone
          )
        );
      } catch (error) {
        console.error('Failed to edit milestone:', error);
        throw error;
      }
    },
    []
  );

  const toggleMilestone = useCallback(
    async (id: number) => {
      const milestone = milestones.find((item) => item.id === id);
      if (!milestone) return;

      const completed = !milestone.completed;

      try {
        const completedAt = await updateGoalMilestoneCompletion(
          id,
          completed
        );
        setMilestones((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, completed, completedAt }
              : item
          )
        );
      } catch (error) {
        console.error('Failed to toggle milestone:', error);
        throw error;
      }
    },
    [milestones]
  );

  const deleteMilestone = useCallback(async (id: number) => {
    try {
      await deleteGoalMilestoneById(id);
      setMilestones((current) =>
        current.filter((milestone) => milestone.id !== id)
      );
    } catch (error) {
      console.error('Failed to delete milestone:', error);
      throw error;
    }
  }, []);

  const value = useMemo(
    () => ({
      goals,
      milestones,
      isLoading,
      refreshGoals,
      addGoal,
      editGoal,
      toggleGoal,
      deleteGoal,
      addMilestone,
      editMilestone,
      toggleMilestone,
      deleteMilestone,
    }),
    [
      goals,
      milestones,
      isLoading,
      refreshGoals,
      addGoal,
      editGoal,
      toggleGoal,
      deleteGoal,
      addMilestone,
      editMilestone,
      toggleMilestone,
      deleteMilestone,
    ]
  );

  return <GoalContext.Provider value={value}>{children}</GoalContext.Provider>;
}

export function useGoals() {
  const context = useContext(GoalContext);

  if (!context) {
    throw new Error('useGoals must be used inside GoalProvider');
  }

  return context;
}
