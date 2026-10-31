import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useTasks } from '@/context/TaskContext';
import {
  archiveApiBrainDump,
  convertApiBrainDumpToTask,
  createApiBrainDump,
  deleteApiBrainDump,
  fetchApiBrainDumps,
  restoreApiBrainDump,
  updateApiBrainDump,
  type ApiBrainDump,
} from '@/lib/api/brainDumpApi';
import type { StoredBrainDump } from '@/lib/brainDumpStorage';

// Keep the existing screen contract without running SQLite storage code.
export type BrainDump = StoredBrainDump;

type BrainDumpContextValue = {
  brainDumps: ApiBrainDump[];
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
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

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('The Brain Dump request failed.');
}

export function BrainDumpProvider({ children }: { children: ReactNode }) {
  const [brainDumps, setBrainDumps] = useState<ApiBrainDump[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { refreshTasks } = useTasks();
  const mountedRef = useRef(false);
  const notesRef = useRef<ApiBrainDump[]>([]);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(new Set<string>());

  // Keep a slow, older read from replacing a more recent saved change.
  const enqueue = useCallback((operation: () => Promise<void>): Promise<void> => {
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.catch(() => undefined);
    return result;
  }, []);

  const storeNotes = useCallback((records: ApiBrainDump[]) => {
    notesRef.current = records;
    if (mountedRef.current) setBrainDumps(records);
  }, []);

  const putNote = useCallback((record: ApiBrainDump) => {
    const current = notesRef.current;
    storeNotes(current.some((note) => note.id === record.id)
      ? current.map((note) => note.id === record.id ? record : note)
      : [record, ...current]);
  }, [storeNotes]);

  const removeNote = useCallback((id: number) => {
    storeNotes(notesRef.current.filter((note) => note.id !== id));
  }, [storeNotes]);

  const refreshBrainDumps = useCallback(() => enqueue(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const records = await fetchApiBrainDumps();
      if (mountedRef.current) storeNotes(records);
    } catch (cause) {
      // Keep the last successful list and preserve API error details.
      const failure = asError(cause);
      if (mountedRef.current) setError(failure);
      throw failure;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }), [enqueue, storeNotes]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshBrainDumps().catch((failure) => {
      console.warn('Failed to load Brain Dump notes:', failure);
    });
    return () => { mountedRef.current = false; };
  }, [refreshBrainDumps]);

  const saveChange = useCallback(function saveChange<T>(
    key: string,
    write: () => Promise<T>,
    afterSave: (record: T) => void | Promise<void>
  ): Promise<void> {
    if (!mountedRef.current) {
      return Promise.reject(new Error('The Brain Dump provider is not available.'));
    }
    if (pendingWritesRef.current.has(key)) {
      return Promise.reject(new Error('This Brain Dump note is already being saved.'));
    }
    pendingWritesRef.current.add(key);
    setIsSaving(true);

    return enqueue(async () => {
      let saved = false;
      try {
        if (!mountedRef.current) throw new Error('The Brain Dump provider is not available.');
        setError(null);
        const record = await write();
        saved = true;
        await afterSave(record);
      } catch (cause) {
        const failure = saved
          ? new Error(
              'The change was saved, but related task data could not be refreshed. ' +
              'Refresh the app before submitting again.'
            )
          : asError(cause);
        if (mountedRef.current) setError(failure);
        throw failure;
      } finally {
        pendingWritesRef.current.delete(key);
        if (mountedRef.current) setIsSaving(pendingWritesRef.current.size > 0);
      }
    });
  }, [enqueue]);

  const addBrainDump = useCallback((body: string): Promise<void> => {
    if (!body.trim()) return Promise.resolve();
    return saveChange('note:create', () => createApiBrainDump({ body }), putNote);
  }, [putNote, saveChange]);

  const editBrainDump = useCallback((id: number, body: string) =>
    saveChange(`note:${id}`, () => updateApiBrainDump(id, { body }), putNote),
  [putNote, saveChange]);

  const archiveBrainDump = useCallback((id: number) =>
    saveChange(`note:${id}`, () => archiveApiBrainDump(id), putNote),
  [putNote, saveChange]);

  const restoreBrainDump = useCallback((id: number) =>
    saveChange(`note:${id}`, () => restoreApiBrainDump(id), putNote),
  [putNote, saveChange]);

  const deleteBrainDump = useCallback((id: number) =>
    saveChange(`note:${id}`, () => deleteApiBrainDump(id), () => removeNote(id)),
  [removeNote, saveChange]);

  const turnBrainDumpIntoTask = useCallback((id: number) =>
    saveChange(`note:${id}`, () => convertApiBrainDumpToTask(id), async () => {
      // Python creates the task and removes the note in one transaction.
      // Once acknowledged, remove the note even if the task refresh fails.
      // Never send a second conversion to compensate for a failed read.
      removeNote(id);
      await refreshTasks();
    }),
  [refreshTasks, removeNote, saveChange]);

  const getActiveBrainDumps = useCallback(() =>
    brainDumps.filter((note) => !note.archived), [brainDumps]);
  const getArchivedBrainDumps = useCallback(() =>
    brainDumps.filter((note) => note.archived), [brainDumps]);

  const value = useMemo(() => ({
    brainDumps, isLoading, isSaving, error, refreshBrainDumps,
    addBrainDump, editBrainDump, archiveBrainDump, restoreBrainDump,
    deleteBrainDump, turnBrainDumpIntoTask, getActiveBrainDumps, getArchivedBrainDumps,
  }), [brainDumps, isLoading, isSaving, error, refreshBrainDumps,
    addBrainDump, editBrainDump, archiveBrainDump, restoreBrainDump,
    deleteBrainDump, turnBrainDumpIntoTask, getActiveBrainDumps, getArchivedBrainDumps]);

  return <BrainDumpContext.Provider value={value}>{children}</BrainDumpContext.Provider>;
}

export function useBrainDumps() {
  const context = useContext(BrainDumpContext);
  if (!context) throw new Error('useBrainDumps must be used inside BrainDumpProvider');
  return context;
}
