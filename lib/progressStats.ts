import type { Task } from './taskStorage';

export type ProgressStats = {
  completedToday: number;
  completedThisWeek: number;
  currentStreak: number;
  weeklyCompletionRate: number;
  bestDay: string | null;
  bestDayCount: number;
};

// WeekFlow treats Monday as the beginning of each week.
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
 * This lets the progress calculations compare calendar days
 * without hours, minutes, or seconds affecting the result.
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
 * June 20, 2026 becomes "2026-06-20".
 *
 * We avoid using toISOString() here because ISO dates use UTC,
 * which could place a late-night completion on the wrong local day.
 */
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Returns a new local date moved forward or backward
 * by the requested number of days.
 */
function addDays(date: Date, amount: number): Date {
  const updatedDate = new Date(date);

  updatedDate.setDate(updatedDate.getDate() + amount);

  return startOfLocalDay(updatedDate);
}

/**
 * Finds Monday at the beginning of the current week.
 *
 * JavaScript uses Sunday as day zero, so the calculation
 * converts the date into a Monday-based week.
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
 * Incomplete tasks, tasks without a completedAt value,
 * and invalid timestamps are ignored by the progress system.
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
 * Calculates all progress statistics from the current task list.
 *
 * currentDate can be passed manually during testing.
 * In normal use, it defaults to the current local date and time.
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
   * This prevents the rest of the calculations from repeatedly
   * parsing completedAt timestamps.
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
   * The current week begins Monday at midnight and ends
   * immediately before the following Monday.
   */
  const completedThisWeekTasks = completedTasks.filter(
    ({ completedDate }) =>
      completedDate >= weekStart &&
      completedDate < nextWeekStart
  );

  const completedThisWeek = completedThisWeekTasks.length;

  /*
   * A calendar day counts toward the streak when the user
   * completes at least one task on that day.
   *
   * A Set is used because completing multiple tasks on the
   * same date should still count as only one streak day.
   */
  const completionDateKeys = new Set(
    completedTasks.map(({ completedDate }) =>
      getLocalDateKey(completedDate)
    )
  );

  let streakCursor = today;

  /*
   * If the user has not completed anything today, begin checking
   * from yesterday. The current day is still in progress, so an
   * existing streak should not break until the entire day is missed.
   */
  if (!completionDateKeys.has(todayKey)) {
    streakCursor = addDays(today, -1);
  }

  let currentStreak = 0;

  /*
   * Walk backward one day at a time until a date is found
   * that has no task completion.
   */
  while (
    completionDateKeys.has(getLocalDateKey(streakCursor))
  ) {
    currentStreak += 1;
    streakCursor = addDays(streakCursor, -1);
  }

  /*
   * Store completion totals for Monday through Sunday.
   * Each array position represents one weekday.
   */
  const completionCountsByDay = new Array<number>(7).fill(0);

  completedThisWeekTasks.forEach(({ completedDate }) => {
    const mondayBasedDayIndex =
      (completedDate.getDay() + 6) % 7;

    completionCountsByDay[mondayBasedDayIndex] += 1;
  });

  let bestDay: string | null = null;
  let bestDayCount = 0;

  // Find the weekday with the most completed tasks this week.
  completionCountsByDay.forEach((count, index) => {
    if (count > bestDayCount) {
      bestDayCount = count;
      bestDay = weekDays[index];
    }
  });

  /*
   * Only active scheduled tasks are included in weekly planning.
   *
   * Inbox tasks are excluded because they have not been assigned
   * to the weekly schedule yet.
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
    weeklyCompletionRate,
    bestDay,
    bestDayCount,
  };
}