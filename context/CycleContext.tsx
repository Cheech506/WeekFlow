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
  updatePlanningCycleStartDate,
  type PlanningCycle,
} from '@/lib/cycleStorage';

type CycleContextValue = {
  cycles: PlanningCycle[];
  currentCycle: PlanningCycle | null;
  isLoading: boolean;
  refreshCycles: () => Promise<void>;
  startCycle: (startDateKey: string) => Promise<void>;
  editCurrentCycle: (
    startDateKey: string
  ) => Promise<void>;
};

const CycleContext = createContext<CycleContextValue | null>(
  null
);

export function CycleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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
    refreshCycles();
  }, [refreshCycles]);

  const currentCycle = useMemo(
    () => cycles.find((cycle) => cycle.active) ?? null,
    [cycles]
  );

  const startCycle = useCallback(
    async (startDateKey: string) => {
      await startPlanningCycle(startDateKey);
      await refreshCycles();
    },
    [refreshCycles]
  );

  const editCurrentCycle = useCallback(
    async (startDateKey: string) => {
      if (!currentCycle) {
        throw new Error('Start a planning cycle first.');
      }

      await updatePlanningCycleStartDate(
        currentCycle.id,
        startDateKey
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
