import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';

import {
    archiveBrainDumpById,
    deleteBrainDumpById,
    getBrainDumps,
    insertBrainDump,
    type StoredBrainDump,
} from '@/lib/brainDumpStorage';

export type BrainDump = StoredBrainDump;

type BrainDumpContextValue = {
  brainDumps: BrainDump[];
  isLoading: boolean;
  addBrainDump: (body: string) => Promise<void>;
  archiveBrainDump: (id: number) => Promise<void>;
  deleteBrainDump: (id: number) => Promise<void>;
  getActiveBrainDumps: () => BrainDump[];
  getArchivedBrainDumps: () => BrainDump[];
};

const BrainDumpContext = createContext<BrainDumpContextValue | null>(null);

export function BrainDumpProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [brainDumps, setBrainDumps] = useState<BrainDump[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadBrainDumps() {
      try {
        const storedBrainDumps = await getBrainDumps();

        if (mounted) {
          setBrainDumps(storedBrainDumps);
        }
      } catch (error) {
        console.error('Failed to load brain dumps:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadBrainDumps();

    return () => {
      mounted = false;
    };
  }, []);

  const addBrainDump = useCallback(async (body: string) => {
    if (!body.trim()) return;

    try {
      const newBrainDump = await insertBrainDump(body);
      setBrainDumps((currentBrainDumps) => [
        newBrainDump,
        ...currentBrainDumps,
      ]);
    } catch (error) {
      console.error('Failed to add brain dump:', error);
    }
  }, []);

  const archiveBrainDump = useCallback(async (id: number) => {
    try {
      const archivedAt = await archiveBrainDumpById(id);

      setBrainDumps((currentBrainDumps) =>
        currentBrainDumps.map((brainDump) =>
          brainDump.id === id
            ? { ...brainDump, archived: true, archivedAt }
            : brainDump
        )
      );
    } catch (error) {
      console.error('Failed to archive brain dump:', error);
    }
  }, []);

  const deleteBrainDump = useCallback(async (id: number) => {
    try {
      await deleteBrainDumpById(id);

      setBrainDumps((currentBrainDumps) =>
        currentBrainDumps.filter((brainDump) => brainDump.id !== id)
      );
    } catch (error) {
      console.error('Failed to delete brain dump:', error);
    }
  }, []);

  const getActiveBrainDumps = useCallback(() => {
    return brainDumps.filter((brainDump) => !brainDump.archived);
  }, [brainDumps]);

  const getArchivedBrainDumps = useCallback(() => {
    return brainDumps.filter((brainDump) => brainDump.archived);
  }, [brainDumps]);

  const value = useMemo(
    () => ({
      brainDumps,
      isLoading,
      addBrainDump,
      archiveBrainDump,
      deleteBrainDump,
      getActiveBrainDumps,
      getArchivedBrainDumps,
    }),
    [
      brainDumps,
      isLoading,
      addBrainDump,
      archiveBrainDump,
      deleteBrainDump,
      getActiveBrainDumps,
      getArchivedBrainDumps,
    ]
  );

  return (
    <BrainDumpContext.Provider value={value}>
      {children}
    </BrainDumpContext.Provider>
  );
}

export function useBrainDumps() {
  const context = useContext(BrainDumpContext);

  if (!context) {
    throw new Error('useBrainDumps must be used inside BrainDumpProvider');
  }

  return context;
}