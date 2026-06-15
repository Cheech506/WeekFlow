import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  deleteTaskById,
  getTasks,
  insertTask,
  markTaskComplete,
  updateTaskDayById,
  type StoredTask,
} from '@/lib/taskStorage';

export type Task = StoredTask;

type TaskContextValue = {
  tasks: Task[];
  isLoading: boolean;
  addTask: (
    title: string,
    day: string,
    notes?: string | null,
    priority?: number,
    goalId?: number | null
  ) => Promise<void>;
  completeTask: (id: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  moveTaskToDay: (id: number, day: string) => Promise<void>;
  getActiveTasksByDay: (day: string) => Task[];
  getInboxTasks: () => Task[];
};

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadTasks() {
      try {
        const storedTasks = await getTasks();

        if (mounted) {
          setTasks(storedTasks);
        }
      } catch (error) {
        console.error('Failed to load tasks:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadTasks();

    return () => {
      mounted = false;
    };
  }, []);

  const addTask = useCallback(
    async (
      title: string,
      day: string,
      notes: string | null = null,
      priority: number = 0,
      goalId: number | null = null
    ) => {
      if (!title.trim()) return;

      try {
        const newTask = await insertTask(
          title,
          day,
          notes,
          priority,
          goalId
        );

        setTasks((currentTasks) => [newTask, ...currentTasks]);
      } catch (error) {
        console.error('Failed to add task:', error);
      }
    },
    []
  );

  const completeTask = useCallback(async (id: number) => {
    try {
      const completedAt = await markTaskComplete(id);

      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === id
            ? { ...task, completed: true, completedAt }
            : task
        )
      );
    } catch (error) {
      console.error('Failed to complete task:', error);
    }
  }, []);

  const deleteTask = useCallback(async (id: number) => {
    try {
      await deleteTaskById(id);

      setTasks((currentTasks) =>
        currentTasks.filter((task) => task.id !== id)
      );
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  }, []);

  const moveTaskToDay = useCallback(async (id: number, day: string) => {
    try {
      await updateTaskDayById(id, day);

      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === id ? { ...task, day } : task
        )
      );
    } catch (error) {
      console.error('Failed to move task:', error);
    }
  }, []);

  const getActiveTasksByDay = useCallback(
    (day: string) => {
      return tasks.filter((task) => task.day === day && !task.completed);
    },
    [tasks]
  );

  const getInboxTasks = useCallback(() => {
    return tasks.filter((task) => task.day === 'Inbox' && !task.completed);
  }, [tasks]);

  const value = useMemo(
    () => ({
      tasks,
      isLoading,
      addTask,
      completeTask,
      deleteTask,
      moveTaskToDay,
      getActiveTasksByDay,
      getInboxTasks,
    }),
    [
      tasks,
      isLoading,
      addTask,
      completeTask,
      deleteTask,
      moveTaskToDay,
      getActiveTasksByDay,
      getInboxTasks,
    ]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const context = useContext(TaskContext);

  if (!context) {
    throw new Error('useTasks must be used inside TaskProvider');
  }

  return context;
}