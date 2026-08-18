import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getCompletionCelebrationsEnabled,
  setCompletionCelebrationsEnabled,
} from '@/lib/appMetadataStorage';
import {
  buildCompletionCelebration,
  type CompletionCelebrationDescriptor,
  type CompletionCelebrationKind,
} from '@/lib/celebrationUtils';

export type ActiveCompletionCelebration =
  CompletionCelebrationDescriptor & {
    id: number;
  };

type CelebrationContextValue = {
  celebrationsEnabled: boolean;
  isLoadingCelebrationPreference: boolean;
  activeCelebration: ActiveCompletionCelebration | null;
  celebrate: (
    kind: CompletionCelebrationKind,
    subject?: string | null
  ) => void;
  dismissCelebration: () => void;
  setCelebrationsEnabled: (enabled: boolean) => Promise<void>;
};

const CelebrationContext = createContext<CelebrationContextValue | null>(null);

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [celebrationsEnabled, setCelebrationsEnabledState] = useState(true);
  const [isLoadingCelebrationPreference, setIsLoadingCelebrationPreference] =
    useState(true);
  const [activeCelebration, setActiveCelebration] =
    useState<ActiveCompletionCelebration | null>(null);
  const nextIdRef = useRef(1);

  useEffect(() => {
    let isMounted = true;

    void getCompletionCelebrationsEnabled()
      .then((enabled) => {
        if (isMounted) setCelebrationsEnabledState(enabled);
      })
      .catch((error) => {
        // A metadata read failure should not stop the rest of WeekFlow loading.
        console.warn('Failed to load completion celebration preference:', error);
      })
      .finally(() => {
        if (isMounted) setIsLoadingCelebrationPreference(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const celebrate = useCallback(
    (kind: CompletionCelebrationKind, subject?: string | null) => {
      if (!celebrationsEnabled) return;

      /*
       * Replace the current toast instead of queueing every rapid task finish.
       * That keeps fast cleanup sessions satisfying without forcing the user to
       * watch a backlog of animations after the work is already done.
       */
      setActiveCelebration({
        id: nextIdRef.current++,
        ...buildCompletionCelebration(kind, subject),
      });
    },
    [celebrationsEnabled]
  );

  const dismissCelebration = useCallback(() => {
    setActiveCelebration(null);
  }, []);

  const setCelebrationsEnabled = useCallback(async (enabled: boolean) => {
    await setCompletionCelebrationsEnabled(enabled);
    setCelebrationsEnabledState(enabled);

    if (!enabled) {
      setActiveCelebration(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      celebrationsEnabled,
      isLoadingCelebrationPreference,
      activeCelebration,
      celebrate,
      dismissCelebration,
      setCelebrationsEnabled,
    }),
    [
      activeCelebration,
      celebrate,
      celebrationsEnabled,
      dismissCelebration,
      isLoadingCelebrationPreference,
      setCelebrationsEnabled,
    ]
  );

  return (
    <CelebrationContext.Provider value={value}>
      {children}
    </CelebrationContext.Provider>
  );
}

export function useCelebrations() {
  const context = useContext(CelebrationContext);

  if (!context) {
    throw new Error('useCelebrations must be used inside CelebrationProvider');
  }

  return context;
}
