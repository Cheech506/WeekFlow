import { getLocalDateKey } from './dateUtils';
import type { Task } from './taskStorage';

export type ActiveTaskPriorityFilter = 'all' | 0 | 1 | 2;
export type ActiveTaskGoalFilter = 'all' | 'unlinked' | `goal:${number}`;
export type ActiveTaskScheduleFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'unscheduled';
export type ActiveTaskRecurrenceFilter =
  | 'all'
  | 'recurring'
  | 'standalone';

export type ActiveTaskFilterState = {
  searchText: string;
  priority: ActiveTaskPriorityFilter;
  goal: ActiveTaskGoalFilter;
  schedule: ActiveTaskScheduleFilter;
  recurrence: ActiveTaskRecurrenceFilter;
  dueDate: string;
};

export function createDefaultActiveTaskFilters(): ActiveTaskFilterState {
  return {
    searchText: '',
    priority: 'all',
    goal: 'all',
    schedule: 'all',
    recurrence: 'all',
    dueDate: '',
  };
}

export function countActiveTaskFilters(filters: ActiveTaskFilterState) {
  let count = 0;

  if (filters.searchText.trim()) count += 1;
  if (filters.priority !== 'all') count += 1;
  if (filters.goal !== 'all') count += 1;
  if (filters.schedule !== 'all') count += 1;
  if (filters.recurrence !== 'all') count += 1;
  if (filters.dueDate.trim()) count += 1;

  return count;
}

export function filterActiveTasks(
  tasks: Task[],
  filters: ActiveTaskFilterState,
  currentDate: Date = new Date()
) {
  const normalizedSearch = filters.searchText.trim().toLowerCase();
  const dueDateFilter = filters.dueDate.trim();
  const todayKey = getLocalDateKey(currentDate);

  return tasks.filter((task) => {
    if (task.completed) return false;

    if (normalizedSearch) {
      const searchableText = `${task.title} ${task.notes ?? ''}`.toLowerCase();

      if (!searchableText.includes(normalizedSearch)) {
        return false;
      }
    }

    if (
      filters.priority !== 'all' &&
      task.priority !== filters.priority
    ) {
      return false;
    }

    if (filters.goal === 'unlinked' && task.goalId !== null) {
      return false;
    }

    if (filters.goal.startsWith('goal:')) {
      const selectedGoalId = Number(filters.goal.slice('goal:'.length));

      if (task.goalId !== selectedGoalId) {
        return false;
      }
    }

    if (filters.recurrence === 'recurring' && task.recurringRuleId === null) {
      return false;
    }

    if (
      filters.recurrence === 'standalone' &&
      task.recurringRuleId !== null
    ) {
      return false;
    }

    if (dueDateFilter && task.dueDate !== dueDateFilter) {
      return false;
    }

    if (filters.schedule === 'unscheduled' && task.dueDate !== null) {
      return false;
    }

    if (filters.schedule === 'overdue') {
      if (task.dueDate === null || task.dueDate >= todayKey) {
        return false;
      }
    }

    if (filters.schedule === 'today' && task.dueDate !== todayKey) {
      return false;
    }

    if (filters.schedule === 'upcoming') {
      if (task.dueDate === null || task.dueDate <= todayKey) {
        return false;
      }
    }

    return true;
  });
}
