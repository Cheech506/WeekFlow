import type { ActiveTaskFilterState } from './activeTaskFilters';
import { createDefaultActiveTaskFilters } from './activeTaskFilters';
import { getLocalDateKey } from './dateUtils';
import type { RecurringRule } from './recurringStorage';
import type { Task } from './taskStorage';

export type InboxQuickFilter =
  | 'all'
  | 'unscheduled'
  | 'today'
  | 'overdue'
  | 'recurring'
  | 'goalLinked';

export type InboxOverviewSnapshot = {
  totalActiveTasks: number;
  unscheduledTasks: number;
  scheduledToday: number;
  overdueTasks: number;
  activeRecurringSchedules: number;
  goalLinkedTasks: number;
};

export function calculateInboxOverview(
  tasks: Task[],
  recurringRules: RecurringRule[],
  currentDate: Date = new Date()
): InboxOverviewSnapshot {
  const todayKey = getLocalDateKey(currentDate);
  const activeTasks = tasks.filter((task) => !task.completed);

  return {
    totalActiveTasks: activeTasks.length,
    unscheduledTasks: activeTasks.filter((task) => task.dueDate === null).length,
    scheduledToday: activeTasks.filter((task) => task.dueDate === todayKey).length,
    overdueTasks: activeTasks.filter(
      (task) => task.dueDate !== null && task.dueDate < todayKey
    ).length,
    activeRecurringSchedules: recurringRules.filter((rule) => rule.active).length,
    goalLinkedTasks: activeTasks.filter((task) => task.goalId !== null).length,
  };
}

/**
 * Quick filters intentionally replace the full filter state instead of layering
 * on hidden advanced filters. Tapping an overview metric therefore produces a
 * predictable result every time.
 */
export function createInboxQuickFilterState(
  quickFilter: InboxQuickFilter
): ActiveTaskFilterState {
  const filters = createDefaultActiveTaskFilters();

  if (quickFilter === 'unscheduled') {
    return { ...filters, schedule: 'unscheduled' };
  }

  if (quickFilter === 'today') {
    return { ...filters, schedule: 'today' };
  }

  if (quickFilter === 'overdue') {
    return { ...filters, schedule: 'overdue' };
  }

  if (quickFilter === 'recurring') {
    return { ...filters, recurrence: 'recurring' };
  }

  if (quickFilter === 'goalLinked') {
    return { ...filters, goal: 'linked' };
  }

  return filters;
}

export function getSelectedInboxQuickFilter(
  filters: ActiveTaskFilterState
): InboxQuickFilter | null {
  const withoutSearch = !filters.searchText.trim();
  const withoutPriority = filters.priority === 'all';
  const withoutDate = !filters.dueDate.trim();

  if (!withoutSearch || !withoutPriority || !withoutDate) {
    return null;
  }

  if (
    filters.schedule === 'unscheduled' &&
    filters.goal === 'all' &&
    filters.recurrence === 'all'
  ) {
    return 'unscheduled';
  }

  if (
    filters.schedule === 'today' &&
    filters.goal === 'all' &&
    filters.recurrence === 'all'
  ) {
    return 'today';
  }

  if (
    filters.schedule === 'overdue' &&
    filters.goal === 'all' &&
    filters.recurrence === 'all'
  ) {
    return 'overdue';
  }

  if (
    filters.schedule === 'all' &&
    filters.goal === 'all' &&
    filters.recurrence === 'recurring'
  ) {
    return 'recurring';
  }

  if (
    filters.schedule === 'all' &&
    filters.goal === 'linked' &&
    filters.recurrence === 'all'
  ) {
    return 'goalLinked';
  }

  if (
    filters.schedule === 'all' &&
    filters.goal === 'all' &&
    filters.recurrence === 'all'
  ) {
    return 'all';
  }

  return null;
}
