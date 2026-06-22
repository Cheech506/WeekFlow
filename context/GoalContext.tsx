import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  deleteGoalById,
  getGoals,
  insertGoal,
  updateGoalCompletion,
  type StoredGoal,
} from '@/lib/goalStorage';

export type Goal = StoredGoal;

type GoalContextValue = {
  goals: Goal[];
  isLoading: boolean;
  refreshGoals: () => Promise<void>;
  addGoal: (title: string) => Promise<void>;
  toggleGoal: (id: number) => Promise<void>;
  deleteGoal: (id: number) => Promise<void>;
};

const GoalContext = createContext<GoalContextValue | null>(null);

export function GoalProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshGoals = useCallback(async () => {
    setIsLoading(true);

    try {
      const storedGoals = await getGoals();
      setGoals(storedGoals);
    } catch (error) {
      console.error('Failed to load goals:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshGoals();
  }, [refreshGoals]);

  const addGoal = useCallback(async (title: string) => {
    if (!title.trim()) return;

    try {
      const newGoal = await insertGoal(title);
      setGoals((currentGoals) => [newGoal, ...currentGoals]);
    } catch (error) {
      console.error('Failed to add goal:', error);
    }
  }, []);

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
      }
    },
    [goals]
  );

  const deleteGoal = useCallback(async (id: number) => {
    try {
      await deleteGoalById(id);

      setGoals((currentGoals) =>
        currentGoals.filter((goal) => goal.id !== id)
      );
    } catch (error) {
      console.error('Failed to delete goal:', error);
    }
  }, []);

  const value = useMemo(
    () => ({
      goals,
      isLoading,
      refreshGoals,
      addGoal,
      toggleGoal,
      deleteGoal,
    }),
    [
      goals,
      isLoading,
      refreshGoals,
      addGoal,
      toggleGoal,
      deleteGoal,
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
