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
  type StoredTask,
} from '@/lib/taskStorage';

export type Task = StoredTask;

type TaskContextValue = {
  tasks: Task[];
  isLoading: boolean;
  addTask: (title: string, day: string) => Promise<void>;
  completeTask: (id: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  getActiveTasksByDay: (day: string) => Task[];
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

  const addTask = useCallback(async (title: string, day: string) => {
    if (!title.trim()) return;

    try {
      const newTask = await insertTask(title, day);

      setTasks((currentTasks) => [newTask, ...currentTasks]);
    } catch (error) {
      console.error('Failed to add task:', error);
    }
  }, []);

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

  const getActiveTasksByDay = useCallback(
    (day: string) => {
      return tasks.filter((task) => task.day === day && !task.completed);
    },
    [tasks]
  );

  const value = useMemo(
    () => ({
      tasks,
      isLoading,
      addTask,
      completeTask,
      deleteTask,
      getActiveTasksByDay,
    }),
    [tasks, isLoading, addTask, completeTask, deleteTask, getActiveTasksByDay]
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