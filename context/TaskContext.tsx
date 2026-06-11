import React, { createContext, useContext, useMemo, useState } from 'react';

export type Task = {
  id: number;
  title: string;
  day: string;
  completed: boolean;
};

type TaskContextValue = {
  tasks: Task[];
  addTask: (title: string, day: string) => void;
  completeTask: (id: number) => void;
  getActiveTasksByDay: (day: string) => Task[];
};

const TaskContext = createContext<TaskContextValue | null>(null);

const starterTasks: Task[] = [
  {
    id: 1,
    title: 'Example weekly task',
    day: 'Monday',
    completed: false,
  },
];

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(starterTasks);

  function addTask(title: string, day: string) {
    if (!title.trim()) return;

    setTasks((currentTasks) => [
      {
        id: Date.now(),
        title: title.trim(),
        day,
        completed: false,
      },
      ...currentTasks,
    ]);
  }

  function completeTask(id: number) {
    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === id ? { ...task, completed: true } : task
      )
    );
  }

  function getActiveTasksByDay(day: string) {
    return tasks.filter((task) => task.day === day && !task.completed);
  }

  const value = useMemo(
    () => ({
      tasks,
      addTask,
      completeTask,
      getActiveTasksByDay,
    }),
    [tasks]
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