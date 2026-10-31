import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useCelebrations } from '@/context/CelebrationContext';
import {
  createApiRecurringRule, deleteApiRecurringRule, fetchApiRecurringRules,
  generateApiRecurringTasks, updateApiRecurringRule, type ApiRecurringRule,
} from '@/lib/api/recurringRuleApi';
import {
  convertApiTaskToRecurring, detachApiRecurringTask, editApiRecurringFromOccurrence,
  editApiRecurringSeries,
} from '@/lib/api/recurringTaskWorkflowApi';
import { createApiTask, deleteApiTask, fetchApiTasks, updateApiTask, type ApiTask } from '@/lib/api/taskApi';
import {
  createApiTaskFromTemplate, createApiTaskTemplate, deleteApiTaskTemplate,
  fetchApiTaskTemplates, updateApiTaskTemplate, type ApiTaskTemplate,
} from '@/lib/api/taskTemplateApi';
import { getLocalDateKey, getNextOccurrenceDateKey } from '@/lib/dateUtils';
import type {
  CreateRecurringRuleInput, DeleteRecurringRuleMode, RecurrenceFrequency,
  RecurringRule, UpdateRecurringRuleFromOccurrenceInput, UpdateRecurringRuleInput,
} from '@/lib/recurringStorage';
import type { Task } from '@/lib/taskStorage';
import type { TaskTemplate } from '@/lib/taskTemplateStorage';

export type {
  CreateRecurringRuleInput, DeleteRecurringRuleMode, RecurrenceFrequency,
  RecurringRule, Task, TaskTemplate, UpdateRecurringRuleFromOccurrenceInput, UpdateRecurringRuleInput
};

type TaskContextValue = {
  tasks: ApiTask[];
  recurringRules: ApiRecurringRule[];
  taskTemplates: ApiTaskTemplate[];
  isLoading: boolean;
  isSaving: boolean;
  error: Error | null;
  refreshTasks: () => Promise<void>;
  addTaskTemplate: (title: string, notes?: string, priority?: number, goalId?: number | null) => Promise<void>;
  editTaskTemplate: (id: number, title: string, notes?: string, priority?: number, goalId?: number | null) => Promise<void>;
  deleteTaskTemplate: (id: number) => Promise<void>;
  addTaskFromTemplate: (id: number) => Promise<void>;
  addTask: (title: string, day: string, notes?: string, priority?: number, goalId?: number | null, dueDate?: string | null) => Promise<number | null>;
  createRecurringTask: (input: CreateRecurringRuleInput) => Promise<void>;
  convertTaskToRecurring: (taskId: number, input: CreateRecurringRuleInput) => Promise<void>;
  updateRecurringTask: (id: number, input: UpdateRecurringRuleInput) => Promise<void>;
  updateRecurringTaskFromOccurrence: (taskId: number, input: UpdateRecurringRuleFromOccurrenceInput) => Promise<void>;
  toggleRecurringRule: (id: number) => Promise<void>;
  deleteRecurringRule: (id: number, mode: DeleteRecurringRuleMode) => Promise<void>;
  detachTaskFromRecurring: (id: number) => Promise<void>;
  editTask: (id: number, title: string, notes?: string, priority?: number, goalId?: number | null) => Promise<void>;
  completeTask: (id: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  scheduleTask: (id: number, dueDate: string) => Promise<void>;
  moveTaskToInbox: (id: number) => Promise<void>;
  moveTaskToDay: (id: number, day: string) => Promise<void>;
  getActiveTasksByDate: (dateKey: string) => Task[];
  getActiveTasksByDay: (day: string) => Task[];
  getOverdueTasks: (currentDate?: Date) => Task[];
  getInboxTasks: () => Task[];
  getCompletedTasks: () => Task[];
};

const TaskContext = createContext<TaskContextValue | undefined>(undefined);

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('The task request failed.');
}

function fullScheduleInput(input: CreateRecurringRuleInput) {
  return {
    title: input.title,
    notes: input.notes ?? '',
    priority: input.priority ?? 0,
    goalId: input.goalId ?? null,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    weekdays: [...(input.weekdays ?? [])],
  };
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [recurringRules, setRecurringRules] = useState<ApiRecurringRule[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<ApiTaskTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { celebrate } = useCelebrations();
  const mountedRef = useRef(false);
  const tasksRef = useRef<ApiTask[]>([]);
  const rulesRef = useRef<ApiRecurringRule[]>([]);
  const templatesRef = useRef<ApiTaskTemplate[]>([]);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(new Set<string>());

  const enqueue = useCallback(function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueueRef.current.then(operation);
    operationQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const storeTasks = useCallback((records: ApiTask[]) => {
    tasksRef.current = records;
    if (mountedRef.current) setTasks(records);
  }, []);
  const storeRules = useCallback((records: ApiRecurringRule[]) => {
    rulesRef.current = records;
    if (mountedRef.current) setRecurringRules(records);
  }, []);
  const storeTemplates = useCallback((records: ApiTaskTemplate[]) => {
    templatesRef.current = records;
    if (mountedRef.current) setTaskTemplates(records);
  }, []);
  const putTask = useCallback((record: ApiTask) => {
    const current = tasksRef.current;
    storeTasks(current.some((task) => task.id === record.id)
      ? current.map((task) => task.id === record.id ? record : task)
      : [record, ...current]);
  }, [storeTasks]);
  const putTemplate = useCallback((record: ApiTaskTemplate) => {
    const current = templatesRef.current;
    storeTemplates(current.some((template) => template.id === record.id)
      ? current.map((template) => template.id === record.id ? record : template)
      : [record, ...current]);
  }, [storeTemplates]);

  const readTaskData = useCallback(async () => {
    const [loadedTasks, loadedRules, loadedTemplates] = await Promise.all([
      fetchApiTasks(), fetchApiRecurringRules(), fetchApiTaskTemplates(),
    ]);
    if (mountedRef.current) {
      storeTasks(loadedTasks);
      storeRules(loadedRules);
      storeTemplates(loadedTemplates);
    }
  }, [storeTasks, storeRules, storeTemplates]);

  const generateOccurrences = useCallback((recurringRuleId?: number) =>
    generateApiRecurringTasks({
      currentDate: getLocalDateKey(new Date()),
      horizonDays: 30,
      ...(recurringRuleId === undefined ? {} : { recurringRuleId }),
    }), []);

  const refreshTasks = useCallback(() => enqueue(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      // Replace SQLite's ensureRecurringOccurrences with server-side generation.
      // The backend owns uniqueness, skip records, and recurring task links.
      await generateOccurrences();
      await readTaskData();
    } catch (cause) {
      const failure = asError(cause);
      if (mountedRef.current) setError(failure);
      throw failure;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }), [enqueue, generateOccurrences, readTaskData]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshTasks().catch((failure) => {
      console.warn('Failed to load tasks, schedules, and templates:', failure);
    });
    return () => { mountedRef.current = false; };
  }, [refreshTasks]);

  const saveChange = useCallback(function saveChange<T>(
    key: string,
    write: () => Promise<T>,
    afterSave: (record: T) => void | Promise<void>
  ): Promise<T> {
    if (!mountedRef.current) {
      return Promise.reject(new Error('The task provider is not available.'));
    }
    if (pendingWritesRef.current.has(key)) {
      return Promise.reject(new Error('This task, schedule, or template is already being saved.'));
    }
    pendingWritesRef.current.add(key);
    setIsSaving(true);
    return enqueue(async () => {
      let saved = false;
      try {
        if (!mountedRef.current) throw new Error('The task provider is not available.');
        setError(null);
        const record = await write();
        saved = true;
        await afterSave(record);
        return record;
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

  const addTaskTemplate = useCallback(async (
    title: string, notes = '', priority = 0, goalId: number | null = null
  ) => {
    await saveChange('template:create', () => createApiTaskTemplate({ title, notes, priority, goalId }), putTemplate);
  }, [putTemplate, saveChange]);

  const editTaskTemplate = useCallback(async (
    id: number, title: string, notes = '', priority = 0, goalId: number | null = null
  ) => {
    await saveChange(`template:${id}`, () => updateApiTaskTemplate(id, { title, notes, priority, goalId }), putTemplate);
  }, [putTemplate, saveChange]);

  const deleteTaskTemplate = useCallback(async (id: number) => {
    await saveChange(`template:${id}`, () => deleteApiTaskTemplate(id),
      () => storeTemplates(templatesRef.current.filter((template) => template.id !== id)));
  }, [saveChange, storeTemplates]);

  const addTaskFromTemplate = useCallback(async (id: number) => {
    // One explicit request creates one task from the server's current template.
    await saveChange(`template:${id}`, () => createApiTaskFromTemplate(id), putTask);
  }, [putTask, saveChange]);

  const addTask = useCallback(async (
    title: string, day: string, notes = '', priority = 0,
    goalId: number | null = null, dueDate: string | null = null
  ): Promise<number | null> => {
    if (!title.trim()) return null;
    let resolvedDate = dueDate;
    if (resolvedDate === null && day !== 'Inbox') {
      resolvedDate = getNextOccurrenceDateKey(day);
      if (resolvedDate === null) throw new Error(`Invalid weekday: ${day}`);
    }
    const created = await saveChange('task:create', () => createApiTask({
      title, notes, priority, goalId, dueDate: resolvedDate,
    }), putTask);
    return created.id;
  }, [putTask, saveChange]);

  const createRecurringTask = useCallback(async (input: CreateRecurringRuleInput) => {
    const details = fullScheduleInput(input);
    await saveChange('rule:create', () => createApiRecurringRule(details), async (rule) => {
      await generateOccurrences(rule.id);
      await readTaskData();
    });
  }, [generateOccurrences, readTaskData, saveChange]);

  const convertTaskToRecurring = useCallback(async (taskId: number, input: CreateRecurringRuleInput) => {
    const request = { ...fullScheduleInput(input), currentDate: getLocalDateKey(new Date()), horizonDays: 30 };
    await saveChange(`task:${taskId}`, () => convertApiTaskToRecurring(taskId, request), async () => {
      // Conversion already generates occurrences in its database transaction.
      await readTaskData();
    });
  }, [readTaskData, saveChange]);

  const updateRecurringTask = useCallback(async (
    id: number, input: UpdateRecurringRuleInput
  ) => {
    const request = {
      ...fullScheduleInput(input),
      currentDate: getLocalDateKey(new Date()),
      horizonDays: 30,
    };
    await saveChange(`rule:${id}`, () => editApiRecurringSeries(id, request), async () => {
      // The backend already saved the schedule and rebuilt its tasks together.
      // Read the result without starting a second generation request.
      await readTaskData();
    });
  }, [readTaskData, saveChange]);

  const updateRecurringTaskFromOccurrence = useCallback(async (
    taskId: number, input: UpdateRecurringRuleFromOccurrenceInput
  ) => {
    const request = {
      title: input.title, notes: input.notes ?? '', priority: input.priority ?? 0,
      goalId: input.goalId ?? null, frequency: input.frequency,
      endDate: input.endDate ?? null, weekdays: [...(input.weekdays ?? [])],
      currentDate: getLocalDateKey(new Date()), horizonDays: 30,
    };
    await saveChange(`task:${taskId}`, () => editApiRecurringFromOccurrence(taskId, request), async () => {
      await readTaskData();
    });
  }, [readTaskData, saveChange]);

  const toggleRecurringRule = useCallback(async (id: number) => {
    await saveChange(`rule:${id}`, async () => {
      const rule = rulesRef.current.find((record) => record.id === id);
      if (!rule) throw new Error('Refresh schedules before changing this record.');
      return updateApiRecurringRule(id, { active: !rule.active });
    }, async (rule) => {
      if (rule.active) await generateOccurrences(rule.id);
      await readTaskData();
    });
  }, [generateOccurrences, readTaskData, saveChange]);

  const deleteRecurringRule = useCallback(async (id: number, mode: DeleteRecurringRuleMode) => {
    await saveChange(`rule:${id}`, () => deleteApiRecurringRule(id, mode), async () => {
      await readTaskData();
    });
  }, [readTaskData, saveChange]);

  const detachTaskFromRecurring = useCallback(async (id: number) => {
    await saveChange(`task:${id}`, () => detachApiRecurringTask(id), putTask);
  }, [putTask, saveChange]);

  const editTask = useCallback(async (
    id: number, title: string, notes = '', priority = 0, goalId: number | null = null
  ) => {
    if (!title.trim()) return;
    await saveChange(`task:${id}`, () => updateApiTask(id, { title, notes, priority, goalId }), putTask);
  }, [putTask, saveChange]);

  const completeTask = useCallback(async (id: number) => {
    if (tasksRef.current.find((task) => task.id === id)?.completed) return;
    await saveChange(`task:${id}`, () => updateApiTask(id, { completed: true }), (record) => {
      putTask(record);
      celebrate('task', record.title);
    });
  }, [celebrate, putTask, saveChange]);

  const deleteTask = useCallback(async (id: number) => {
    // The backend records the skip and deletes a recurring occurrence atomically.
    await saveChange(`task:${id}`, () => deleteApiTask(id),
      () => storeTasks(tasksRef.current.filter((task) => task.id !== id)));
  }, [saveChange, storeTasks]);

  const scheduleTask = useCallback(async (id: number, dueDate: string) => {
    await saveChange(`task:${id}`, () => updateApiTask(id, { dueDate }), putTask);
  }, [putTask, saveChange]);

  const moveTaskToInbox = useCallback(async (id: number) => {
    // Rescheduling changes placement; original recurrence identity stays intact.
    await saveChange(`task:${id}`, () => updateApiTask(id, { dueDate: null }), putTask);
  }, [putTask, saveChange]);

  const moveTaskToDay = useCallback(async (id: number, day: string) => {
    const dueDate = getNextOccurrenceDateKey(day);
    if (dueDate === null) throw new Error(`Invalid weekday: ${day}`);
    await scheduleTask(id, dueDate);
  }, [scheduleTask]);

  const getActiveTasksByDate = useCallback((dateKey: string) =>
    tasks.filter((task) => task.dueDate === dateKey && !task.completed), [tasks]);
  const getActiveTasksByDay = useCallback((day: string) =>
    tasks.filter((task) => task.day === day && !task.completed), [tasks]);
  const getOverdueTasks = useCallback((currentDate = new Date()) => {
    const today = getLocalDateKey(currentDate);
    return tasks.filter((task) => !task.completed && task.dueDate !== null && task.dueDate < today)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }, [tasks]);
  const getInboxTasks = useCallback(() =>
    tasks.filter((task) => task.day === 'Inbox' && !task.completed), [tasks]);
  const getCompletedTasks = useCallback(() => tasks.filter((task) => task.completed), [tasks]);

  return (
    <TaskContext.Provider value={{
      tasks, recurringRules, taskTemplates, isLoading, isSaving, error, refreshTasks,
      addTaskTemplate, editTaskTemplate, deleteTaskTemplate, addTaskFromTemplate, addTask,
      createRecurringTask, convertTaskToRecurring, updateRecurringTask,
      updateRecurringTaskFromOccurrence, toggleRecurringRule, deleteRecurringRule,
      detachTaskFromRecurring, editTask, completeTask, deleteTask,
      scheduleTask, moveTaskToInbox, moveTaskToDay, getActiveTasksByDate,
      getActiveTasksByDay, getOverdueTasks, getInboxTasks, getCompletedTasks,
    }}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) throw new Error('useTasks must be used inside TaskProvider');
  return context;
}
