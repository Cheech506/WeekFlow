import type { StoredBrainDump } from './brainDumpStorage';
import type { StoredGoal } from './goalStorage';
import type { Task } from './taskStorage';
import {
  addDays,
  getLocalDateKey,
  getStartOfWeek,
  parseLocalDateKey,
  startOfLocalDay,
} from './dateUtils';

export type WeeklyReviewStatus = 'past' | 'current' | 'future';

export type WeeklyReviewSnapshot = {
  completedCount: number;
  unfinishedCount: number;
  overdueCount: number;
  completionRate: number;
  goalsProgressedCount: number;
  bestDay: string | null;
  bestDayCount: number;
  archivedBrainDumpCount: number;
  highPriorityCompletedCount: number;
  recurringCompletedCount: number;
};

export type WeeklyReview = WeeklyReviewSnapshot & {
  status: WeeklyReviewStatus;
  title: string;
  collapsedSummary: string;
  summaryLines: string[];
  scheduledGoalCount: number;
};

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

function isDateInsideWeek(
  date: Date,
  weekStart: Date,
  nextWeekStart: Date
) {
  return date >= weekStart && date < nextWeekStart;
}

function getCompletedDate(task: Task): Date | null {
  if (!task.completed || !task.completedAt) {
    return null;
  }

  const completedDate = new Date(task.completedAt);

  return Number.isNaN(completedDate.getTime())
    ? null
    : completedDate;
}

function getArchivedDate(brainDump: StoredBrainDump): Date | null {
  if (!brainDump.archived || !brainDump.archivedAt) {
    return null;
  }

  const archivedDate = new Date(brainDump.archivedAt);

  return Number.isNaN(archivedDate.getTime())
    ? null
    : archivedDate;
}

function pluralize(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

function buildPastOrCurrentSummary(
  status: 'past' | 'current',
  snapshot: WeeklyReviewSnapshot
) {
  const strongestDayLine =
    snapshot.bestDay && snapshot.bestDayCount > 0
      ? `${snapshot.bestDay} ${
          status === 'past' ? 'was' : 'is'
        } your strongest day with ${pluralize(
          snapshot.bestDayCount,
          'completed task'
        )}.`
      : status === 'past'
        ? 'No tasks were completed during this week.'
        : 'No tasks have been completed yet this week.';

  const unfinishedLine =
    snapshot.unfinishedCount === 0
      ? status === 'past'
        ? 'No scheduled tasks from this week remain unfinished.'
        : 'No scheduled tasks currently remain this week.'
      : snapshot.overdueCount > 0
        ? `${pluralize(
            snapshot.unfinishedCount,
            'scheduled task'
          )} remain, including ${pluralize(
            snapshot.overdueCount,
            'overdue task'
          )}.`
        : `${pluralize(
            snapshot.unfinishedCount,
            'scheduled task'
          )} still remain this week.`;

  const summaryLines = [
    `You ${
      status === 'past' ? 'completed' : 'have completed'
    } ${pluralize(snapshot.completedCount, 'task')} this week.`,
    strongestDayLine,
    snapshot.goalsProgressedCount > 0
      ? `You made progress on ${pluralize(
          snapshot.goalsProgressedCount,
          'goal'
        )}.`
      : 'No completed tasks were linked to a goal this week.',
    unfinishedLine,
  ];

  if (snapshot.highPriorityCompletedCount > 0) {
    summaryLines.push(
      `${pluralize(
        snapshot.highPriorityCompletedCount,
        'high-priority task'
      )} were completed.`
    );
  }

  if (snapshot.recurringCompletedCount > 0) {
    summaryLines.push(
      `${pluralize(
        snapshot.recurringCompletedCount,
        'recurring task'
      )} were completed.`
    );
  }

  if (snapshot.archivedBrainDumpCount > 0) {
    summaryLines.push(
      `You also archived ${pluralize(
        snapshot.archivedBrainDumpCount,
        'brain dump'
      )}.`
    );
  }

  return summaryLines;
}

/**
 * Captures the calculated fields that should remain historically stable after
 * a guided weekly review is first saved.
 */
export function createWeeklyReviewSnapshot(
  review: WeeklyReview
): WeeklyReviewSnapshot {
  return {
    completedCount: review.completedCount,
    unfinishedCount: review.unfinishedCount,
    overdueCount: review.overdueCount,
    completionRate: review.completionRate,
    goalsProgressedCount: review.goalsProgressedCount,
    bestDay: review.bestDay,
    bestDayCount: review.bestDayCount,
    archivedBrainDumpCount: review.archivedBrainDumpCount,
    highPriorityCompletedCount: review.highPriorityCompletedCount,
    recurringCompletedCount: review.recurringCompletedCount,
  };
}

/**
 * Rebuilds a past/current review from its saved snapshot. Written reflections
 * can be edited later, but subsequent task changes must not rewrite the numbers
 * that were recorded when the review was completed.
 */
export function applyWeeklyReviewSnapshot(
  review: WeeklyReview,
  snapshot: WeeklyReviewSnapshot
): WeeklyReview {
  if (review.status === 'future') {
    return review;
  }

  return {
    ...review,
    ...snapshot,
    title: 'Saved Weekly Review',
    collapsedSummary: `${pluralize(
      snapshot.completedCount,
      'task'
    )} completed • ${snapshot.completionRate}%`,
    summaryLines: buildPastOrCurrentSummary(review.status, snapshot),
  };
}

/**
 * Builds the summary for whichever Monday-through-Sunday week is selected.
 * Completion activity is based on completedAt timestamps, while unfinished
 * work is based on tasks whose due dates belong to the selected week.
 */
export function calculateWeeklyReview(
  tasks: Task[],
  goals: StoredGoal[],
  brainDumps: StoredBrainDump[],
  currentDate: Date = new Date(),
  weekOffset: number = 0
): WeeklyReview {
  const today = startOfLocalDay(currentDate);
  const currentWeekStart = getStartOfWeek(today);
  const weekStart = addDays(currentWeekStart, weekOffset * 7);
  const nextWeekStart = addDays(weekStart, 7);

  const currentWeekKey = getLocalDateKey(currentWeekStart);
  const selectedWeekKey = getLocalDateKey(weekStart);

  const status: WeeklyReviewStatus =
    selectedWeekKey < currentWeekKey
      ? 'past'
      : selectedWeekKey > currentWeekKey
        ? 'future'
        : 'current';

  const completedDuringWeek = tasks
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
      } =>
        item.completedDate !== null &&
        isDateInsideWeek(item.completedDate, weekStart, nextWeekStart)
    );

  const unfinishedScheduledTasks = tasks.filter((task) => {
    if (task.completed || !task.dueDate) {
      return false;
    }

    const dueDate = parseLocalDateKey(task.dueDate);

    return Boolean(
      dueDate && isDateInsideWeek(dueDate, weekStart, nextWeekStart)
    );
  });

  const todayKey = getLocalDateKey(today);
  const overdueCount = unfinishedScheduledTasks.filter(
    (task) => task.dueDate !== null && task.dueDate < todayKey
  ).length;

  const completedCount = completedDuringWeek.length;
  const unfinishedCount = unfinishedScheduledTasks.length;
  const reviewTotal = completedCount + unfinishedCount;
  const completionRate =
    reviewTotal === 0
      ? 0
      : Math.round((completedCount / reviewTotal) * 100);

  const validGoalIds = new Set(goals.map((goal) => goal.id));
  const goalsProgressedCount = new Set(
    completedDuringWeek
      .map(({ task }) => task.goalId)
      .filter(
        (goalId): goalId is number =>
          goalId !== null && validGoalIds.has(goalId)
      )
  ).size;

  const scheduledGoalCount = new Set(
    unfinishedScheduledTasks
      .map((task) => task.goalId)
      .filter(
        (goalId): goalId is number =>
          goalId !== null && validGoalIds.has(goalId)
      )
  ).size;

  const completionCountsByDate = new Map<string, number>();
  completedDuringWeek.forEach(({ completedDate }) => {
    const dateKey = getLocalDateKey(completedDate);
    completionCountsByDate.set(
      dateKey,
      (completionCountsByDate.get(dateKey) ?? 0) + 1
    );
  });

  let bestDay: string | null = null;
  let bestDayCount = 0;

  WEEKDAY_NAMES.forEach((dayName, index) => {
    const dateKey = getLocalDateKey(addDays(weekStart, index));
    const completedOnDay = completionCountsByDate.get(dateKey) ?? 0;

    if (completedOnDay > bestDayCount) {
      bestDay = dayName;
      bestDayCount = completedOnDay;
    }
  });

  const archivedBrainDumpCount = brainDumps.filter((brainDump) => {
    const archivedDate = getArchivedDate(brainDump);

    return Boolean(
      archivedDate &&
        isDateInsideWeek(archivedDate, weekStart, nextWeekStart)
    );
  }).length;

  const highPriorityCompletedCount = completedDuringWeek.filter(
    ({ task }) => task.priority === 2
  ).length;
  const recurringCompletedCount = completedDuringWeek.filter(
    ({ task }) => task.recurringRuleId !== null
  ).length;

  const snapshot: WeeklyReviewSnapshot = {
    completedCount,
    unfinishedCount,
    overdueCount,
    completionRate,
    goalsProgressedCount,
    bestDay,
    bestDayCount,
    archivedBrainDumpCount,
    highPriorityCompletedCount,
    recurringCompletedCount,
  };

  if (status === 'future') {
    const summaryLines = [
      `You have ${pluralize(unfinishedCount, 'task')} scheduled for this week.`,
      scheduledGoalCount > 0
        ? `Those tasks support ${pluralize(scheduledGoalCount, 'goal')}.`
        : 'No scheduled tasks are linked to a goal yet.',
      'Completion results will appear here as the week progresses.',
    ];

    return {
      ...snapshot,
      status,
      title: 'Weekly Preview',
      collapsedSummary: `${pluralize(unfinishedCount, 'task')} scheduled`,
      summaryLines,
      scheduledGoalCount,
    };
  }

  return {
    ...snapshot,
    status,
    title: status === 'current' ? 'Week So Far' : 'Weekly Review',
    collapsedSummary: `${pluralize(
      completedCount,
      'task'
    )} completed • ${completionRate}%`,
    summaryLines: buildPastOrCurrentSummary(status, snapshot),
    scheduledGoalCount,
  };
}
