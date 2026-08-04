import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  getPlanningCycles,
  startPlanningCycle,
  updatePlanningCycle,
  type PlanningCycle,
} from '@/lib/cycleStorage';
import type { PlanningCycleDetails } from '@/lib/cycleIdentityUtils';

type CycleContextValue = {
  cycles: PlanningCycle[];
  currentCycle: PlanningCycle | null;
  isLoading: boolean;
  refreshCycles: () => Promise<void>;
  startCycle: (
    startDateKey: string,
    details?: PlanningCycleDetails
  ) => Promise<void>;
  editCurrentCycle: (
    startDateKey: string,
    details?: PlanningCycleDetails
  ) => Promise<void>;
};

const CycleContext = createContext<CycleContextValue | null>(null);

export function CycleProvider({ children }: { children: React.ReactNode }) {
  const [cycles, setCycles] = useState<PlanningCycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCycles = useCallback(async () => {
    setIsLoading(true);

    try {
      setCycles(await getPlanningCycles());
    } catch (error) {
      console.error('Failed to load planning cycles:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCycles();
  }, [refreshCycles]);

  const currentCycle = useMemo(
    () => cycles.find((cycle) => cycle.active) ?? null,
    [cycles]
  );

  const startCycle = useCallback(
    async (
      startDateKey: string,
      details: PlanningCycleDetails = {}
    ) => {
      await startPlanningCycle(startDateKey, details);
      await refreshCycles();
    },
    [refreshCycles]
  );

  const editCurrentCycle = useCallback(
    async (
      startDateKey: string,
      details: PlanningCycleDetails = {}
    ) => {
      if (!currentCycle) {
        throw new Error('Start a planning cycle first.');
      }

      await updatePlanningCycle(
        currentCycle.id,
        startDateKey,
        details
      );
      await refreshCycles();
    },
    [currentCycle, refreshCycles]
  );

  const value = useMemo(
    () => ({
      cycles,
      currentCycle,
      isLoading,
      refreshCycles,
      startCycle,
      editCurrentCycle,
    }),
    [
      cycles,
      currentCycle,
      isLoading,
      refreshCycles,
      startCycle,
      editCurrentCycle,
    ]
  );

  return (
    <CycleContext.Provider value={value}>
      {children}
    </CycleContext.Provider>
  );
}

export function useCycle() {
  const context = useContext(CycleContext);

  if (!context) {
    throw new Error('useCycle must be used inside CycleProvider');
  }

  return context;
}
