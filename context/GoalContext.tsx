import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

import {
    getGoals,
    insertGoal,
    updateGoalCompletion,
    type StoredGoal,
} from '@/lib/goalStorage';

export type Goal = StoredGoal;

type GoalContextValue = {
  goals: Goal[];
  isLoading: boolean;
  addGoal: (title: string) => Promise<void>;
  toggleGoal: (id: number) => Promise<void>;
};

const GoalContext = createContext<GoalContextValue | null>(null);

export function GoalProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadGoals() {
      try {
        const storedGoals = await getGoals();

        if (mounted) {
          setGoals(storedGoals);
        }
      } catch (error) {
        console.error('Failed to load goals:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadGoals();

    return () => {
      mounted = false;
    };
  }, []);

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

  const value = useMemo(
    () => ({
      goals,
      isLoading,
      addGoal,
      toggleGoal,
    }),
    [goals, isLoading, addGoal, toggleGoal]
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