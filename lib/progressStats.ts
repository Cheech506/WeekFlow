import type { Task } from './taskStorage';

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

// WeekFlow uses Monday as the beginning of the week.
const weekDays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * Removes the time portion of a Date.
 *
 * This allows dates to be compared by calendar day without
 * hours, minutes, or seconds changing the result.
 */
function startOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

/**
 * Creates a date key using the user's local calendar date.
 *
 * Example:
 * June 22, 2026 becomes "2026-06-22".
 *
 * We do not use toISOString() because ISO dates use UTC and
 * could place late-night completions on the wrong local day.
 */
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Returns a new date moved forward or backward by the
 * requested number of calendar days.
 */
function addDays(date: Date, amount: number): Date {
  const updatedDate = new Date(date);

  updatedDate.setDate(updatedDate.getDate() + amount);

  return startOfLocalDay(updatedDate);
}

/**
 * Finds Monday at the beginning of the current week.
 *
 * JavaScript uses Sunday as day zero, so this converts the
 * date into WeekFlow's Monday-based week.
 */
function getStartOfWeek(date: Date): Date {
  const start = startOfLocalDay(date);
  const daysSinceMonday = (start.getDay() + 6) % 7;

  start.setDate(start.getDate() - daysSinceMonday);

  return startOfLocalDay(start);
}

/**
 * Returns a valid completion date for a completed task.
 *
 * Incomplete tasks, tasks without completedAt, and invalid
 * timestamps are ignored by the progress system.
 */
function getCompletedDate(task: Task): Date | null {
  if (!task.completed || !task.completedAt) {
    return null;
  }

  const completedDate = new Date(task.completedAt);

  if (Number.isNaN(completedDate.getTime())) {
    return null;
  }

  return completedDate;
}

/**
 * Calculates all progress information from the current task list.
 *
 * currentDate is optional so tests can calculate statistics for
 * a specific date instead of always using the real current date.
 */
export function calculateProgressStats(
  tasks: Task[],
  currentDate: Date = new Date()
): ProgressStats {
  const today = startOfLocalDay(currentDate);
  const todayKey = getLocalDateKey(today);

  const weekStart = getStartOfWeek(today);
  const nextWeekStart = addDays(weekStart, 7);

  /*
   * Convert completed tasks into task/date pairs once.
   *
   * This avoids repeatedly parsing completedAt timestamps
   * during every calculation below.
   */
  const completedTasks = tasks
    .map((task) => ({
      task,
      completedDate: getCompletedDate(task),
    }))
    .filter(
      (
        item
      ): item is {
        task: Task;
        completedDate: Date;
      } => item.completedDate !== null
    );

  // Count tasks whose local completion date matches today.
  const completedToday = completedTasks.filter(
    ({ completedDate }) =>
      getLocalDateKey(completedDate) === todayKey
  ).length;

  /*
   * The current week starts Monday at midnight and ends
   * immediately before the following Monday.
   */
  const completedThisWeekTasks = completedTasks.filter(
    ({ completedDate }) =>
      completedDate >= weekStart &&
      completedDate < nextWeekStart
  );

  const completedThisWeek = completedThisWeekTasks.length;

  /*
   * Store each unique date where at least one task was completed.
   *
   * Multiple completions on the same day still represent only
   * one streak day.
   */
  const completionDaysByKey = new Map<string, Date>();

  completedTasks.forEach(({ completedDate }) => {
    const completionDay = startOfLocalDay(completedDate);
    const dateKey = getLocalDateKey(completionDay);

    completionDaysByKey.set(dateKey, completionDay);
  });

  const completionDateKeys = new Set(
    completionDaysByKey.keys()
  );

  /*
   * Calculate the current streak.
   *
   * If nothing has been completed today, checking begins from
   * yesterday because the current day is still in progress.
   */
  let streakCursor = today;

  if (!completionDateKeys.has(todayKey)) {
    streakCursor = addDays(today, -1);
  }

  let currentStreak = 0;

  while (
    completionDateKeys.has(getLocalDateKey(streakCursor))
  ) {
    currentStreak += 1;
    streakCursor = addDays(streakCursor, -1);
  }

  /*
   * Calculate the longest streak across all saved task history.
   *
   * The unique completion days are sorted from oldest to newest.
   * Each date is compared with the day immediately after the
   * previous completion date.
   */
  const sortedCompletionDays = Array.from(
    completionDaysByKey.values()
  ).sort((firstDate, secondDate) => {
    return firstDate.getTime() - secondDate.getTime();
  });

  let longestStreak = 0;
  let runningStreak = 0;
  let previousCompletionDay: Date | null = null;

  sortedCompletionDays.forEach((completionDay) => {
    if (previousCompletionDay === null) {
      runningStreak = 1;
    } else {
      const expectedNextDay = addDays(
        previousCompletionDay,
        1
      );

      const isConsecutive =
        getLocalDateKey(completionDay) ===
        getLocalDateKey(expectedNextDay);

      runningStreak = isConsecutive
        ? runningStreak + 1
        : 1;
    }

    if (runningStreak > longestStreak) {
      longestStreak = runningStreak;
    }

    previousCompletionDay = completionDay;
  });

  /*
   * Count completed tasks by local date for the seven-day
   * visual progress display.
   */
  const completionCountsByDate = new Map<string, number>();

  completedThisWeekTasks.forEach(({ completedDate }) => {
    const dateKey = getLocalDateKey(completedDate);
    const previousCount =
      completionCountsByDate.get(dateKey) ?? 0;

    completionCountsByDate.set(
      dateKey,
      previousCount + 1
    );
  });

  /*
   * Build one progress record for each day from Monday
   * through Sunday.
   */
  const weeklyDays: WeeklyDayProgress[] = weekDays.map(
    (day, index) => {
      const date = addDays(weekStart, index);
      const dateKey = getLocalDateKey(date);

      return {
        day,
        shortDay: day.slice(0, 3),
        dateKey,
        completedCount:
          completionCountsByDate.get(dateKey) ?? 0,
        isToday: dateKey === todayKey,
        isFuture: date > today,
      };
    }
  );

  let bestDay: string | null = null;
  let bestDayCount = 0;

  // Find the weekday with the most completed tasks.
  weeklyDays.forEach((day) => {
    if (day.completedCount > bestDayCount) {
      bestDay = day.day;
      bestDayCount = day.completedCount;
    }
  });

  /*
   * Only scheduled active tasks are included in weekly planning.
   *
   * Inbox tasks are excluded because they have not been assigned
   * to the current weekly plan yet.
   */
  const activeScheduledTasks = tasks.filter(
    (task) => !task.completed && task.day !== 'Inbox'
  ).length;

  const weeklyPlannedTotal =
    completedThisWeek + activeScheduledTasks;

  /*
   * Weekly completion rate:
   *
   * completed this week
   * ------------------------------- × 100
   * completed + active scheduled
   */
  const weeklyCompletionRate =
    weeklyPlannedTotal === 0
      ? 0
      : Math.round(
          (completedThisWeek / weeklyPlannedTotal) * 100
        );

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