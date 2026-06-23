import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

import { getLocalDateKey } from '@/lib/dateUtils';
import {
  deleteRecurringRuleById,
  ensureRecurringOccurrences,
  getRecurringRules,
  insertRecurringRule,
  setRecurringRuleActive,
  type CreateRecurringRuleInput,
  type DeleteRecurringRuleMode,
  type RecurrenceFrequency,
  type RecurringRule,
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
  Task,
};

type TaskContextValue = {
  tasks: Task[];
  recurringRules: RecurringRule[];
  isLoading: boolean;
  refreshTasks: () => Promise<void>;
  addTask: (
    title: string,
    day: string,
    notes?: string,
    priority?: number,
    goalId?: number | null,
    dueDate?: string | null
  ) => Promise<void>;
  createRecurringTask: (
    input: CreateRecurringRuleInput
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
  const [isLoading, setIsLoading] = useState(true);

  async function loadTasks() {
    setIsLoading(true);

    try {
      await ensureRecurringOccurrences();

      const [loadedTasks, loadedRules] = await Promise.all([
        getTasks(),
        getRecurringRules(),
      ]);

      setTasks(loadedTasks);
      setRecurringRules(loadedRules);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);

  async function addTask(
    title: string,
    day: string,
    notes: string = '',
    priority: number = 0,
    goalId: number | null = null,
    dueDate: string | null = null
  ) {
    if (!title.trim()) return;

    await insertTask(
      title,
      day,
      notes,
      priority,
      goalId,
      dueDate
    );
    await loadTasks();
  }

  async function createRecurringTask(
    input: CreateRecurringRuleInput
  ) {
    await insertRecurringRule(input);
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
        isLoading,
        refreshTasks: loadTasks,
        addTask,
        createRecurringTask,
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
