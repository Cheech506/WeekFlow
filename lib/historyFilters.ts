import type { StoredBrainDump } from './brainDumpStorage';
import type { PlanningCycle } from './cycleStorage';
import { getLocalDateKey, parseLocalDateKey } from './dateUtils';
import type { StoredGoal } from './goalStorage';
import type { Task } from './taskStorage';

export type HistoryContentFilter =
  | 'all'
  | 'tasks'
  | 'goals'
  | 'cycles'
  | 'brainDumps';
export type HistoryPriorityFilter = 'all' | 0 | 1 | 2;
export type HistoryGoalFilter = 'all' | 'none' | number;
export type HistoryRecurrenceFilter = 'all' | 'recurring' | 'standalone';
export type HistoryCycleFilter = 'all' | 'none' | number;
export type HistoryDatePreset = 'all' | '7days' | '30days' | '90days' | 'custom';

export type HistoryFilterState = {
  searchText: string;
  content: HistoryContentFilter;
  priority: HistoryPriorityFilter;
  goal: HistoryGoalFilter;
  recurrence: HistoryRecurrenceFilter;
  cycle: HistoryCycleFilter;
  datePreset: HistoryDatePreset;
  customStartDate: string;
  customEndDate: string;
};

export type ResolvedHistoryDateRange = {
  startDateKey: string | null;
  endDateKey: string | null;
  error: string | null;
};

export function createDefaultHistoryFilters(): HistoryFilterState {
  return {
    searchText: '',
    content: 'all',
    priority: 'all',
    goal: 'all',
    recurrence: 'all',
    cycle: 'all',
    datePreset: 'all',
    customStartDate: '',
    customEndDate: '',
  };
}

function subtractLocalDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

export function resolveHistoryDateRange(
  filters: Pick<
    HistoryFilterState,
    'datePreset' | 'customStartDate' | 'customEndDate'
  >,
  currentDate: Date = new Date()
): ResolvedHistoryDateRange {
  if (filters.datePreset === 'all') {
    return { startDateKey: null, endDateKey: null, error: null };
  }

  const todayKey = getLocalDateKey(currentDate);

  if (filters.datePreset !== 'custom') {
    const dayCount =
      filters.datePreset === '7days'
        ? 7
        : filters.datePreset === '30days'
          ? 30
          : 90;

    return {
      startDateKey: getLocalDateKey(subtractLocalDays(currentDate, dayCount - 1)),
      endDateKey: todayKey,
      error: null,
    };
  }

  const startDateKey = filters.customStartDate.trim();
  const endDateKey = filters.customEndDate.trim();

  if (!startDateKey && !endDateKey) {
    return {
      startDateKey: null,
      endDateKey: null,
      error: 'Enter a start date, an end date, or both.',
    };
  }

  if (startDateKey && !parseLocalDateKey(startDateKey)) {
    return {
      startDateKey: null,
      endDateKey: null,
      error: 'Enter a valid start date in YYYY-MM-DD format.',
    };
  }

  if (endDateKey && !parseLocalDateKey(endDateKey)) {
    return {
      startDateKey: null,
      endDateKey: null,
      error: 'Enter a valid end date in YYYY-MM-DD format.',
    };
  }

  if (startDateKey && endDateKey && startDateKey > endDateKey) {
    return {
      startDateKey: null,
      endDateKey: null,
      error: 'The start date cannot be after the end date.',
    };
  }

  return {
    startDateKey: startDateKey || null,
    endDateKey: endDateKey || null,
    error: null,
  };
}

/**
 * Accepts either an ISO timestamp or a YYYY-MM-DD key. Plain date keys are
 * compared directly so timezone conversion cannot move a cycle end date into
 * the previous local day.
 */
export function timestampMatchesHistoryRange(
  timestamp: string | null,
  range: ResolvedHistoryDateRange
) {
  if (range.error) return true;
  if (!range.startDateKey && !range.endDateKey) return true;
  if (!timestamp) return false;

  const trimmedTimestamp = timestamp.trim();
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(trimmedTimestamp)
    ? trimmedTimestamp
    : (() => {
        const date = new Date(trimmedTimestamp);
        return Number.isNaN(date.getTime()) ? null : getLocalDateKey(date);
      })();

  if (!dateKey) return false;

  if (range.startDateKey && dateKey < range.startDateKey) return false;
  if (range.endDateKey && dateKey > range.endDateKey) return false;

  return true;
}

export function findCycleForTimestamp(
  timestamp: string | null,
  cycles: PlanningCycle[]
): number | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const dateKey = getLocalDateKey(date);

  return (
    cycles.find(
      (cycle) => dateKey >= cycle.startDate && dateKey <= cycle.endDate
    )?.id ?? null
  );
}

/**
 * Tasks do not store a direct cycle foreign key. A linked goal is the strongest
 * cycle relationship; unlinked tasks fall back to the cycle containing their
 * completion date so historical cycle filters still remain useful.
 */
export function getTaskHistoryCycleId(
  task: Task,
  goalsById: Map<number, StoredGoal>,
  cycles: PlanningCycle[]
) {
  if (task.goalId !== null) {
    const goalCycleId = goalsById.get(task.goalId)?.cycleId ?? null;
    if (goalCycleId !== null) return goalCycleId;
  }

  return findCycleForTimestamp(task.completedAt, cycles);
}

export function countHistoryFilters(filters: HistoryFilterState) {
  let count = 0;
  if (filters.searchText.trim()) count += 1;
  if (filters.content !== 'all') count += 1;
  if (filters.priority !== 'all') count += 1;
  if (filters.goal !== 'all') count += 1;
  if (filters.recurrence !== 'all') count += 1;
  if (filters.cycle !== 'all') count += 1;
  if (filters.datePreset !== 'all') count += 1;
  return count;
}

export function taskMatchesHistoryFilters(input: {
  task: Task;
  filters: HistoryFilterState;
  goalsById: Map<number, StoredGoal>;
  cycles: PlanningCycle[];
  range: ResolvedHistoryDateRange;
}) {
  const { task, filters, goalsById, cycles, range } = input;
  if (!task.completed) return false;
  if (filters.content !== 'all' && filters.content !== 'tasks') return false;

  const linkedGoal = task.goalId === null ? undefined : goalsById.get(task.goalId);
  const normalizedSearch = filters.searchText.trim().toLowerCase();
  const searchableText = [task.title, task.notes, linkedGoal?.title]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (normalizedSearch && !searchableText.includes(normalizedSearch)) return false;
  if (filters.priority !== 'all' && task.priority !== filters.priority) return false;

  if (filters.goal === 'none' && task.goalId !== null) return false;
  if (typeof filters.goal === 'number' && task.goalId !== filters.goal) return false;

  if (filters.recurrence === 'recurring' && task.recurringRuleId === null) {
    return false;
  }
  if (filters.recurrence === 'standalone' && task.recurringRuleId !== null) {
    return false;
  }

  const cycleId = getTaskHistoryCycleId(task, goalsById, cycles);
  if (filters.cycle === 'none' && cycleId !== null) return false;
  if (typeof filters.cycle === 'number' && cycleId !== filters.cycle) return false;

  return timestampMatchesHistoryRange(task.completedAt, range);
}

export function goalMatchesHistoryFilters(input: {
  goal: StoredGoal;
  milestonesText: string;
  filters: HistoryFilterState;
  range: ResolvedHistoryDateRange;
}) {
  const { goal, milestonesText, filters, range } = input;
  if (!goal.completed) return false;
  if (filters.content !== 'all' && filters.content !== 'goals') return false;

  if (
    filters.priority !== 'all' ||
    filters.goal !== 'all' ||
    filters.recurrence !== 'all'
  ) {
    return false;
  }

  if (filters.cycle === 'none' && goal.cycleId !== null) return false;
  if (typeof filters.cycle === 'number' && goal.cycleId !== filters.cycle) {
    return false;
  }

  const normalizedSearch = filters.searchText.trim().toLowerCase();
  const searchableText = [
    goal.title,
    goal.reward,
    goal.purpose,
    goal.successDefinition,
    goal.notes,
    goal.completionWhatHelped,
    goal.completionHardestPart,
    goal.completionLearned,
    goal.completionDoDifferently,
    milestonesText,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (normalizedSearch && !searchableText.includes(normalizedSearch)) return false;

  return timestampMatchesHistoryRange(goal.completedAt, range);
}

export function brainDumpMatchesHistoryFilters(input: {
  brainDump: StoredBrainDump;
  filters: HistoryFilterState;
  range: ResolvedHistoryDateRange;
}) {
  const { brainDump, filters, range } = input;
  if (!brainDump.archived) return false;
  if (filters.content !== 'all' && filters.content !== 'brainDumps') return false;

  if (
    filters.priority !== 'all' ||
    filters.goal !== 'all' ||
    filters.recurrence !== 'all' ||
    filters.cycle !== 'all'
  ) {
    return false;
  }

  const normalizedSearch = filters.searchText.trim().toLowerCase();
  if (normalizedSearch && !brainDump.body.toLowerCase().includes(normalizedSearch)) {
    return false;
  }

  return timestampMatchesHistoryRange(brainDump.archivedAt, range);
}
