import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getLocalDateKey } from '@/lib/dateUtils';
import {
  deleteTaskTemplateById,
  getTaskTemplates,
  insertTaskTemplate,
  updateTaskTemplateById,
  type TaskTemplate,
} from '@/lib/taskTemplateStorage';
import {
  convertTaskToRecurringRule,
  deleteRecurringRuleById,
  ensureRecurringOccurrences,
  getRecurringRules,
  insertRecurringRule,
  setRecurringRuleActive,
  updateRecurringRuleById,
  updateRecurringRuleFromOccurrence,
  type CreateRecurringRuleInput,
  type DeleteRecurringRuleMode,
  type RecurrenceFrequency,
  type RecurringRule,
  type UpdateRecurringRuleFromOccurrenceInput,
  type UpdateRecurringRuleInput,
} from '@/lib/recurringStorage';
import {
  completeTaskById,
  deleteTaskById,
  getTasks,
  insertTask,
  moveTaskToDayById,
  moveTaskToInboxById,
  scheduleTaskByDate,
  Task,
  updateTaskById,
} from '@/lib/taskStorage';

export type {
  CreateRecurringRuleInput,
  DeleteRecurringRuleMode,
  RecurrenceFrequency,
  RecurringRule,
  UpdateRecurringRuleFromOccurrenceInput,
  UpdateRecurringRuleInput,
  Task,
  TaskTemplate,
};

type TaskContextValue = {
  tasks: Task[];
  recurringRules: RecurringRule[];
  taskTemplates: TaskTemplate[];
  isLoading: boolean;
  refreshTasks: () => Promise<void>;
  addTaskTemplate: (
    title: string,
    notes?: string,
    priority?: number,
    goalId?: number | null
  ) => Promise<void>;
  editTaskTemplate: (
    id: number,
    title: string,
    notes?: string,
    priority?: number,
    goalId?: number | null
  ) => Promise<void>;
  deleteTaskTemplate: (id: number) => Promise<void>;
  addTaskFromTemplate: (id: number) => Promise<void>;
  addTask: (
    title: string,
    day: string,
    notes?: string,
    priority?: number,
    goalId?: number | null,
    dueDate?: string | null
  ) => Promise<number | null>;
  createRecurringTask: (
    input: CreateRecurringRuleInput
  ) => Promise<void>;
  convertTaskToRecurring: (
    taskId: number,
    input: CreateRecurringRuleInput
  ) => Promise<void>;
  updateRecurringTask: (
    id: number,
    input: UpdateRecurringRuleInput
  ) => Promise<void>;
  updateRecurringTaskFromOccurrence: (
    taskId: number,
    input: UpdateRecurringRuleFromOccurrenceInput
  ) => Promise<void>;
  toggleRecurringRule: (id: number) => Promise<void>;
  deleteRecurringRule: (
    id: number,
    mode: DeleteRecurringRuleMode
  ) => Promise<void>;
  editTask: (
    id: number,
    title: string,
    notes?: string,
    priority?: number,
    goalId?: number | null
  ) => Promise<void>;
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

const TaskContext = createContext<TaskContextValue | undefined>(
  undefined
);

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recurringRules, setRecurringRules] = useState<
    RecurringRule[]
  >([]);
  const [taskTemplates, setTaskTemplates] = useState<
    TaskTemplate[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  /*
   * Expo SQLite on web uses a worker. Serializing refresh requests prevents
   * overlapping provider refreshes from competing for that worker, especially
   * immediately after a backup replaces the database contents.
   */
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());

  const loadTasks = useCallback((): Promise<void> => {
    const queuedLoad = loadQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setIsLoading(true);

        try {
          await ensureRecurringOccurrences();

          const [loadedTasks, loadedRules, loadedTemplates] =
            await Promise.all([
              getTasks(),
              getRecurringRules(),
              getTaskTemplates(),
            ]);

          setTasks(loadedTasks);
          setRecurringRules(loadedRules);
          setTaskTemplates(loadedTemplates);
        } finally {
          setIsLoading(false);
        }
      });

    loadQueueRef.current = queuedLoad;
    return queuedLoad;
  }, []);

  useEffect(() => {
    void loadTasks().catch((error) => {
      // Keep startup failures visible without triggering Expo's red error overlay.
      console.warn('Failed to load tasks:', error);
    });
  }, [loadTasks]);

  async function addTaskTemplate(
    title: string,
    notes: string = '',
    priority: number = 0,
    goalId: number | null = null
  ) {
    await insertTaskTemplate(
      title,
      notes,
      priority,
      goalId
    );
    await loadTasks();
  }

  async function editTaskTemplate(
    id: number,
    title: string,
    notes: string = '',
    priority: number = 0,
    goalId: number | null = null
  ) {
    await updateTaskTemplateById(
      id,
      title,
      notes,
      priority,
      goalId
    );
    await loadTasks();
  }

  async function deleteTaskTemplate(id: number) {
    await deleteTaskTemplateById(id);
    await loadTasks();
  }

  async function addTaskFromTemplate(id: number) {
    const template = taskTemplates.find(
      (item) => item.id === id
    );

    if (!template) {
      throw new Error('The task template could not be found.');
    }

    await insertTask(
      template.title,
      'Inbox',
      template.notes ?? '',
      template.priority,
      template.goalId
    );
    await loadTasks();
  }

  async function addTask(
    title: string,
    day: string,
    notes: string = '',
    priority: number = 0,
    goalId: number | null = null,
    dueDate: string | null = null
  ) {
    if (!title.trim()) return null;

    const taskId = await insertTask(
      title,
      day,
      notes,
      priority,
      goalId,
      dueDate
    );
    await loadTasks();

    return taskId;
  }

  async function createRecurringTask(
    input: CreateRecurringRuleInput
  ) {
    await insertRecurringRule(input);
    await loadTasks();
  }

  async function convertTaskToRecurring(
    taskId: number,
    input: CreateRecurringRuleInput
  ) {
    await convertTaskToRecurringRule(taskId, input);
    await loadTasks();
  }

  async function updateRecurringTask(
    id: number,
    input: UpdateRecurringRuleInput
  ) {
    await updateRecurringRuleById(id, input);
    await loadTasks();
  }

  async function updateRecurringTaskFromOccurrence(
    taskId: number,
    input: UpdateRecurringRuleFromOccurrenceInput
  ) {
    await updateRecurringRuleFromOccurrence(taskId, input);
    await loadTasks();
  }

  async function toggleRecurringRule(id: number) {
    const rule = recurringRules.find((item) => item.id === id);
    if (!rule) return;

    await setRecurringRuleActive(id, !rule.active);
    await loadTasks();
  }

  async function deleteRecurringRule(
    id: number,
    mode: DeleteRecurringRuleMode
  ) {
    await deleteRecurringRuleById(id, mode);
    await loadTasks();
  }

  async function editTask(
    id: number,
    title: string,
    notes: string = '',
    priority: number = 0,
    goalId: number | null = null
  ) {
    if (!title.trim()) return;

    await updateTaskById(
      id,
      title,
      notes,
      priority,
      goalId
    );
    await loadTasks();
  }

  async function completeTask(id: number) {
    await completeTaskById(id);
    await loadTasks();
  }

  async function deleteTask(id: number) {
    await deleteTaskById(id);
    await loadTasks();
  }

  async function scheduleTask(id: number, dueDate: string) {
    await scheduleTaskByDate(id, dueDate);
    await loadTasks();
  }

  async function moveTaskToInbox(id: number) {
    await moveTaskToInboxById(id);
    await loadTasks();
  }

  async function moveTaskToDay(id: number, day: string) {
    await moveTaskToDayById(id, day);
    await loadTasks();
  }

  function getActiveTasksByDate(dateKey: string) {
    return tasks.filter(
      (task) => task.dueDate === dateKey && !task.completed
    );
  }

  function getActiveTasksByDay(day: string) {
    return tasks.filter(
      (task) => task.day === day && !task.completed
    );
  }

  function getOverdueTasks(currentDate: Date = new Date()) {
    const todayKey = getLocalDateKey(currentDate);

    return tasks
      .filter(
        (task) =>
          !task.completed &&
          task.dueDate !== null &&
          task.dueDate < todayKey
      )
      .sort((a, b) =>
        (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
      );
  }

  function getInboxTasks() {
    return tasks.filter(
      (task) => task.day === 'Inbox' && !task.completed
    );
  }

  function getCompletedTasks() {
    return tasks.filter((task) => task.completed);
  }

  return (
    <TaskContext.Provider
      value={{
        tasks,
        recurringRules,
        taskTemplates,
        isLoading,
        refreshTasks: loadTasks,
        addTaskTemplate,
        editTaskTemplate,
        deleteTaskTemplate,
        addTaskFromTemplate,
        addTask,
        createRecurringTask,
        convertTaskToRecurring,
        updateRecurringTask,
        updateRecurringTaskFromOccurrence,
        toggleRecurringRule,
        deleteRecurringRule,
        editTask,
        completeTask,
        deleteTask,
        scheduleTask,
        moveTaskToInbox,
        moveTaskToDay,
        getActiveTasksByDate,
        getActiveTasksByDay,
        getOverdueTasks,
        getInboxTasks,
        getCompletedTasks,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);

  if (!context) {
    throw new Error('useTasks must be used inside TaskProvider');
  }

  return context;
}
