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
  archiveBrainDumpById,
  convertBrainDumpToTaskById,
  deleteBrainDumpById,
  getBrainDumps,
  insertBrainDump,
  restoreBrainDumpById,
  updateBrainDumpById,
  type StoredBrainDump,
} from '@/lib/brainDumpStorage';

export type BrainDump = StoredBrainDump;

type BrainDumpContextValue = {
  brainDumps: BrainDump[];
  isLoading: boolean;
  refreshBrainDumps: () => Promise<void>;
  addBrainDump: (body: string) => Promise<void>;
  editBrainDump: (id: number, body: string) => Promise<void>;
  archiveBrainDump: (id: number) => Promise<void>;
  restoreBrainDump: (id: number) => Promise<void>;
  deleteBrainDump: (id: number) => Promise<void>;
  turnBrainDumpIntoTask: (id: number) => Promise<void>;
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
  const { refreshTasks } = useTasks();

  const refreshBrainDumps = useCallback(async () => {
    setIsLoading(true);

    try {
      const storedBrainDumps = await getBrainDumps();
      setBrainDumps(storedBrainDumps);
    } catch (error) {
      console.error('Failed to load brain dumps:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBrainDumps();
  }, [refreshBrainDumps]);

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

  const editBrainDump = useCallback(
    async (id: number, body: string) => {
      try {
        const cleanBody = await updateBrainDumpById(id, body);

        setBrainDumps((currentBrainDumps) =>
          currentBrainDumps.map((brainDump) =>
            brainDump.id === id
              ? { ...brainDump, body: cleanBody }
              : brainDump
          )
        );
      } catch (error) {
        console.error('Failed to edit brain dump:', error);
        throw error;
      }
    },
    []
  );

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

  const restoreBrainDump = useCallback(async (id: number) => {
    try {
      await restoreBrainDumpById(id);

      setBrainDumps((currentBrainDumps) =>
        currentBrainDumps.map((brainDump) =>
          brainDump.id === id
            ? { ...brainDump, archived: false, archivedAt: null }
            : brainDump
        )
      );
    } catch (error) {
      console.error('Failed to restore brain dump:', error);
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

  const turnBrainDumpIntoTask = useCallback(
    async (id: number) => {
      try {
        /*
         * The storage layer creates the task and removes the note in one
         * transaction. Refreshing TaskContext afterward makes the new Inbox
         * task appear everywhere without risking a duplicate note/task pair.
         */
        await convertBrainDumpToTaskById(id);
        await refreshTasks();

        setBrainDumps((currentBrainDumps) =>
          currentBrainDumps.filter((brainDump) => brainDump.id !== id)
        );
      } catch (error) {
        console.error(
          'Failed to turn brain dump into task:',
          error
        );
        throw error;
      }
    },
    [refreshTasks]
  );

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
      refreshBrainDumps,
      addBrainDump,
      editBrainDump,
      archiveBrainDump,
      restoreBrainDump,
      deleteBrainDump,
      turnBrainDumpIntoTask,
      getActiveBrainDumps,
      getArchivedBrainDumps,
    }),
    [
      brainDumps,
      isLoading,
      refreshBrainDumps,
      addBrainDump,
      editBrainDump,
      archiveBrainDump,
      restoreBrainDump,
      deleteBrainDump,
      turnBrainDumpIntoTask,
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
