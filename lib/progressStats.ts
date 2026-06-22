import type { Task } from './taskStorage';
import {
  addDays,
  getLocalDateKey,
  getStartOfWeek,
  parseLocalDateKey,
  startOfLocalDay,
} from './dateUtils';

export type WeeklyDayProgress = {
  day: string;
  shortDay: string;
  dateKey: string;
  completedCount: number;
  isToday: boolean;
  isFuture: boolean;
};

export type ProgressStats = {
  completedToday: number;
  completedThisWeek: number;
  currentStreak: number;
  longestStreak: number;
  weeklyCompletionRate: number;
  bestDay: string | null;
  bestDayCount: number;
  weeklyDays: WeeklyDayProgress[];
};

const weekDays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function getCompletedDate(task: Task): Date | null {
  if (!task.completed || !task.completedAt) {
    return null;
  }

  const completedDate = new Date(task.completedAt);
  return Number.isNaN(completedDate.getTime()) ? null : completedDate;
}

/**
 * Calculates completion history, streaks, and the current week's progress.
 */
export function calculateProgressStats(
  tasks: Task[],
  currentDate: Date = new Date()
): ProgressStats {
  const today = startOfLocalDay(currentDate);
  const todayKey = getLocalDateKey(today);
  const weekStart = getStartOfWeek(today);
  const nextWeekStart = addDays(weekStart, 7);

  const completedTasks = tasks
    .map((task) => ({ task, completedDate: getCompletedDate(task) }))
    .filter(
      (item): item is { task: Task; completedDate: Date } =>
        item.completedDate !== null
    );

  const completedToday = completedTasks.filter(
    ({ completedDate }) => getLocalDateKey(completedDate) === todayKey
  ).length;

  const completedThisWeekTasks = completedTasks.filter(
    ({ completedDate }) =>
      completedDate >= weekStart && completedDate < nextWeekStart
  );

  const completedThisWeek = completedThisWeekTasks.length;

  /* Multiple completions on one date count as one streak day. */
  const completionDaysByKey = new Map<string, Date>();

  completedTasks.forEach(({ completedDate }) => {
    const completionDay = startOfLocalDay(completedDate);
    completionDaysByKey.set(getLocalDateKey(completionDay), completionDay);
  });

  const completionDateKeys = new Set(completionDaysByKey.keys());
  let streakCursor = completionDateKeys.has(todayKey)
    ? today
    : addDays(today, -1);
  let currentStreak = 0;

  while (completionDateKeys.has(getLocalDateKey(streakCursor))) {
    currentStreak += 1;
    streakCursor = addDays(streakCursor, -1);
  }

  const sortedCompletionDays = Array.from(
    completionDaysByKey.values()
  ).sort((first, second) => first.getTime() - second.getTime());

  let longestStreak = 0;
  let runningStreak = 0;
  let previousCompletionDay: Date | null = null;

  sortedCompletionDays.forEach((completionDay) => {
    if (!previousCompletionDay) {
      runningStreak = 1;
    } else {
      const expectedNextDay = addDays(previousCompletionDay, 1);
      const isConsecutive =
        getLocalDateKey(completionDay) === getLocalDateKey(expectedNextDay);

      runningStreak = isConsecutive ? runningStreak + 1 : 1;
    }

    longestStreak = Math.max(longestStreak, runningStreak);
    previousCompletionDay = completionDay;
  });

  const completionCountsByDate = new Map<string, number>();

  completedThisWeekTasks.forEach(({ completedDate }) => {
    const dateKey = getLocalDateKey(completedDate);
    completionCountsByDate.set(
      dateKey,
      (completionCountsByDate.get(dateKey) ?? 0) + 1
    );
  });

  const weeklyDays: WeeklyDayProgress[] = weekDays.map((day, index) => {
    const date = addDays(weekStart, index);
    const dateKey = getLocalDateKey(date);

    return {
      day,
      shortDay: day.slice(0, 3),
      dateKey,
      completedCount: completionCountsByDate.get(dateKey) ?? 0,
      isToday: dateKey === todayKey,
      isFuture: date > today,
    };
  });

  let bestDay: string | null = null;
  let bestDayCount = 0;

  weeklyDays.forEach((day) => {
    if (day.completedCount > bestDayCount) {
      bestDay = day.day;
      bestDayCount = day.completedCount;
    }
  });

  /*
   * With real due dates, only active tasks due during the current week
   * belong in this week's completion percentage.
   */
  const activeScheduledThisWeek = tasks.filter((task) => {
    if (task.completed || !task.dueDate) {
      return false;
    }

    const dueDate = parseLocalDateKey(task.dueDate);
    return Boolean(
      dueDate && dueDate >= weekStart && dueDate < nextWeekStart
    );
  }).length;

  const weeklyPlannedTotal =
    completedThisWeek + activeScheduledThisWeek;

  const weeklyCompletionRate =
    weeklyPlannedTotal === 0
      ? 0
      : Math.round((completedThisWeek / weeklyPlannedTotal) * 100);

  return {
    completedToday,
    completedThisWeek,
    currentStreak,
    longestStreak,
    weeklyCompletionRate,
    bestDay,
    bestDayCount,
    weeklyDays,
  };
}
