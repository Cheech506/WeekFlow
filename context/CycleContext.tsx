import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  createApiPlanningCycle,
  fetchApiPlanningCycles,
  updateApiPlanningCycle,
  type ApiPlanningCycle,
} from '@/lib/api/planningCycleApi';
import type { PlanningCycleDetails } from '@/lib/cycleIdentityUtils';

type CycleContextValue = {
  cycles: ApiPlanningCycle[];
  currentCycle: ApiPlanningCycle | null;
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
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

function asError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error('The planning-cycle request failed.');
}

export function CycleProvider({ children }: { children: React.ReactNode }) {
  const [cycles, setCycles] = useState<ApiPlanningCycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Finish each read or write before starting the next cycle operation.
  // An older refresh therefore cannot overwrite a newer saved result.
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const loadCycles = useCallback(async () => {
    const loadedCycles = await fetchApiPlanningCycles();
    if (mountedRef.current) {
      setCycles(loadedCycles);
    }
  }, []);

  const refreshCycles = useCallback(() => enqueue(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);

    try {
      await loadCycles();
    } catch (cause) {
      const failure = asError(cause);
      if (mountedRef.current) setError(failure);
      throw failure;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }), [enqueue, loadCycles]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshCycles().catch((failure) => {
      // The error stays in context so the UI can offer a refresh.
      console.warn('Failed to load planning cycles:', failure);
    });

    return () => {
      mountedRef.current = false;
    };
  }, [refreshCycles]);

  const currentCycle = useMemo(
    () => cycles.find((cycle) => cycle.active) ?? null,
    [cycles]
  );

  const saveCycle = useCallback((
    write: () => Promise<ApiPlanningCycle>
  ): Promise<void> => {
    // Block a second tap immediately, before React rerenders the button.
    if (savingRef.current) {
      return Promise.reject(new Error('A planning cycle is already being saved.'));
    }
    if (!mountedRef.current) {
      return Promise.reject(new Error('The planning-cycle provider is not available.'));
    }
    savingRef.current = true;
    setIsSaving(true);

    return enqueue(async () => {
      let saved = false;
      try {
        if (!mountedRef.current) return;
        setError(null);
        await write();
        saved = true;

        // Starting a cycle also closes the previous active cycle on the server.
        // Fetch the full list so history and the current cycle agree.
        await loadCycles();
      } catch (cause) {
        const failure = saved
          ? new Error(
              'The cycle was saved, but the updated list could not be loaded. ' +
              'Refresh the cycles before submitting again.'
            )
          : asError(cause);
        if (mountedRef.current) setError(failure);
        throw failure;
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setIsSaving(false);
      }
    });
  }, [enqueue, loadCycles]);

  const startCycle = useCallback((
    startDateKey: string,
    details: PlanningCycleDetails = {}
  ) => saveCycle(() => createApiPlanningCycle({
    ...details,
    startDate: startDateKey,
  })), [saveCycle]);

  const editCurrentCycle = useCallback(async (
    startDateKey: string,
    details: PlanningCycleDetails = {}
  ) => {
    if (!currentCycle) {
      throw new Error('Start a planning cycle first.');
    }

    await saveCycle(() => updateApiPlanningCycle(currentCycle.id, {
      ...details,
      startDate: startDateKey,
    }));
  }, [currentCycle, saveCycle]);

  const value = useMemo(() => ({
    cycles,
    currentCycle,
    isLoading,
    isSaving,
    error,
    refreshCycles,
    startCycle,
    editCurrentCycle,
  }), [cycles, currentCycle, isLoading, isSaving, error,
    refreshCycles, startCycle, editCurrentCycle]);

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
