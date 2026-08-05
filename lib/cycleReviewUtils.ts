import type { StoredBrainDump } from './brainDumpStorage';
import type { PlanningCycle } from './cycleStorage';
import {
  addDays,
  getLocalDateKey,
  getStartOfWeek,
  parseLocalDateKey,
} from './dateUtils';
import type { GoalMilestone } from './goalMilestoneStorage';
import type { StoredGoal } from './goalStorage';
import type { Task } from './taskStorage';
import type { StoredWeeklyReview } from './weeklyReviewStorage';

export const MAX_CYCLE_REVIEW_RESPONSE_LENGTH = 2000;
export const MAX_REPLACEMENT_GOAL_TITLE_LENGTH = 180;
export const MAX_FIRST_WEEK_COMMITMENTS = 5;
export const MAX_FIRST_WEEK_COMMITMENT_LENGTH = 180;

export const CYCLE_GOAL_OUTCOME_ACTIONS = [
  'complete',
  'carryForward',
  'archive',
  'replace',
] as const;

export type CycleGoalOutcomeAction =
  (typeof CYCLE_GOAL_OUTCOME_ACTIONS)[number];

export type CycleReviewReflectionInput = {
  biggestAccomplishment?: string | null;
  biggestChallenge?: string | null;
  whatWorkedWell?: string | null;
  whatChangeNextCycle?: string | null;
  whatStopDoing?: string | null;
  whatContinueDoing?: string | null;
  whatLearned?: string | null;
};

export type NormalizedCycleReviewReflection = {
  biggestAccomplishment: string | null;
  biggestChallenge: string | null;
  whatWorkedWell: string | null;
  whatChangeNextCycle: string | null;
  whatStopDoing: string | null;
  whatContinueDoing: string | null;
  whatLearned: string | null;
};

export type NextCyclePlanInput = {
  name?: string | null;
  primaryFocus?: string | null;
  theme?: string | null;
  startDate: string;
  firstWeekCommitments?: string[];
};

export type CycleGoalOutcomeInput = {
  goalId: number;
  action: CycleGoalOutcomeAction;
  replacementTitle?: string | null;
};

export type CycleReviewSnapshot = {
  goalTotal: number;
  goalCompleted: number;
  taskCompleted: number;
  milestoneTotal: number;
  milestoneCompleted: number;
  weeklyReviewsCompleted: number;
  longestStreak: number;
  bestWeekNumber: number | null;
  bestWeekCount: number;
  bestDay: string | null;
  bestDayCount: number;
  highPriorityCompleted: number;
  recurringCompleted: number;
  rewardsUnlocked: number;
  brainDumpsArchived: number;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function normalizeOptionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number = MAX_CYCLE_REVIEW_RESPONSE_LENGTH
) {
  const normalized = value?.trim() ?? '';

  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }

  return normalized || null;
}

export function normalizeCycleReviewReflection(
  input: CycleReviewReflectionInput = {}
): NormalizedCycleReviewReflection {
  return {
    biggestAccomplishment: normalizeOptionalText(
      input.biggestAccomplishment,
      'Biggest accomplishment'
    ),
    biggestChallenge: normalizeOptionalText(
      input.biggestChallenge,
      'Biggest challenge'
    ),
    whatWorkedWell: normalizeOptionalText(
      input.whatWorkedWell,
      'What worked well'
    ),
    whatChangeNextCycle: normalizeOptionalText(
      input.whatChangeNextCycle,
      'What should change next cycle'
    ),
    whatStopDoing: normalizeOptionalText(
      input.whatStopDoing,
      'What to stop doing'
    ),
    whatContinueDoing: normalizeOptionalText(
      input.whatContinueDoing,
      'What to continue doing'
    ),
    whatLearned: normalizeOptionalText(
      input.whatLearned,
      'What you learned'
    ),
  };
}

export function normalizeReplacementGoalTitle(
  value: string | null | undefined
) {
  return normalizeOptionalText(
    value,
    'Replacement goal title',
    MAX_REPLACEMENT_GOAL_TITLE_LENGTH
  );
}

export function normalizeFirstWeekCommitments(values: string[] = []) {
  if (values.length > MAX_FIRST_WEEK_COMMITMENTS) {
    throw new Error(
      `Add no more than ${MAX_FIRST_WEEK_COMMITMENTS} first-week commitments.`
    );
  }

  const normalized = values
    .map((value, index) =>
      normalizeOptionalText(
        value,
        `First-week commitment ${index + 1}`,
        MAX_FIRST_WEEK_COMMITMENT_LENGTH
      )
    )
    .filter((value): value is string => value !== null);

  if (new Set(normalized.map((value) => value.toLowerCase())).size !== normalized.length) {
    throw new Error('First-week commitments must be unique.');
  }

  return normalized;
}

export function getCycleGoalOutcomeLabel(
  action: CycleGoalOutcomeAction
) {
  if (action === 'complete') return 'Marked Complete';
  if (action === 'carryForward') return 'Carried Forward';
  if (action === 'replace') return 'Replaced';
  return 'Archived Unfinished';
}

function isTimestampInsideCycle(
  timestamp: string | null,
  cycle: PlanningCycle
) {
  if (!timestamp) return false;

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return false;

  const dateKey = getLocalDateKey(date);
  return dateKey >= cycle.startDate && dateKey <= cycle.endDate;
}

function differenceInCalendarDays(later: Date, earlier: Date) {
  const laterUtc = Date.UTC(
    later.getFullYear(),
    later.getMonth(),
    later.getDate()
  );
  const earlierUtc = Date.UTC(
    earlier.getFullYear(),
    earlier.getMonth(),
    earlier.getDate()
  );

  return Math.round((laterUtc - earlierUtc) / MILLISECONDS_PER_DAY);
}

/**
 * Builds the stable report metrics for one twelve-week cycle.
 *
 * Task activity uses completion timestamps inside the cycle's inclusive date
 * range. Goal and milestone totals use the explicit goal-cycle relationship,
 * so a later carry-forward copy cannot rewrite the old cycle's result.
 */
export function calculateCycleReviewSnapshot(
  cycle: PlanningCycle,
  goals: StoredGoal[],
  milestones: GoalMilestone[],
  tasks: Task[],
  weeklyReviews: StoredWeeklyReview[],
  brainDumps: StoredBrainDump[]
): CycleReviewSnapshot {
  const cycleGoals = goals.filter((goal) => goal.cycleId === cycle.id);
  const cycleGoalIds = new Set(cycleGoals.map((goal) => goal.id));
  const cycleMilestones = milestones.filter((milestone) =>
    cycleGoalIds.has(milestone.goalId)
  );
  const completedTasks = tasks.filter((task) =>
    isTimestampInsideCycle(task.completedAt, cycle)
  );

  const completionDays = new Set(
    completedTasks
      .map((task) => task.completedAt)
      .filter((value): value is string => Boolean(value))
      .map((value) => getLocalDateKey(new Date(value)))
  );

  const sortedCompletionDays = Array.from(completionDays).sort();
  let longestStreak = 0;
  let runningStreak = 0;
  let previousDate: Date | null = null;

  sortedCompletionDays.forEach((dateKey) => {
    const date = parseLocalDateKey(dateKey);
    if (!date) return;

    if (
      previousDate &&
      differenceInCalendarDays(date, previousDate) === 1
    ) {
      runningStreak += 1;
    } else {
      runningStreak = 1;
    }

    longestStreak = Math.max(longestStreak, runningStreak);
    previousDate = date;
  });

  const cycleStart = parseLocalDateKey(cycle.startDate);
  const weekCounts = new Map<number, number>();
  const weekdayCounts = new Map<string, number>();

  completedTasks.forEach((task) => {
    if (!task.completedAt) return;

    const completedDate = new Date(task.completedAt);
    const dayName = WEEKDAY_NAMES[completedDate.getDay()];
    weekdayCounts.set(dayName, (weekdayCounts.get(dayName) ?? 0) + 1);

    if (cycleStart) {
      const completedDay = parseLocalDateKey(
        getLocalDateKey(completedDate)
      );
      if (completedDay) {
        const weekNumber = Math.min(
          12,
          Math.floor(
            differenceInCalendarDays(completedDay, cycleStart) / 7
          ) + 1
        );
        weekCounts.set(
          weekNumber,
          (weekCounts.get(weekNumber) ?? 0) + 1
        );
      }
    }
  });

  let bestWeekNumber: number | null = null;
  let bestWeekCount = 0;
  weekCounts.forEach((count, weekNumber) => {
    if (count > bestWeekCount) {
      bestWeekNumber = weekNumber;
      bestWeekCount = count;
    }
  });

  let bestDay: string | null = null;
  let bestDayCount = 0;
  weekdayCounts.forEach((count, dayName) => {
    if (count > bestDayCount) {
      bestDay = dayName;
      bestDayCount = count;
    }
  });

  const reviewedWeeks = weeklyReviews.filter(
    (review) =>
      review.cycleId === cycle.id &&
      review.weekStart >= cycle.startDate &&
      review.weekStart <= cycle.endDate
  );

  return {
    goalTotal: cycleGoals.length,
    goalCompleted: cycleGoals.filter((goal) => goal.completed).length,
    taskCompleted: completedTasks.length,
    milestoneTotal: cycleMilestones.length,
    milestoneCompleted: cycleMilestones.filter(
      (milestone) => milestone.completed
    ).length,
    weeklyReviewsCompleted: reviewedWeeks.length,
    longestStreak,
    bestWeekNumber,
    bestWeekCount,
    bestDay,
    bestDayCount,
    highPriorityCompleted: completedTasks.filter(
      (task) => task.priority === 2
    ).length,
    recurringCompleted: completedTasks.filter(
      (task) => task.recurringRuleId !== null
    ).length,
    rewardsUnlocked: cycleGoals.filter(
      (goal) => goal.completed && Boolean(goal.reward)
    ).length,
    brainDumpsArchived: brainDumps.filter((brainDump) =>
      isTimestampInsideCycle(brainDump.archivedAt, cycle)
    ).length,
  };
}

export function getDefaultNextCycleStartDate(cycle: PlanningCycle) {
  const endDate = parseLocalDateKey(cycle.endDate);

  if (!endDate) {
    throw new Error('The completed cycle has an invalid end date.');
  }

  // Reserve the seven days after the cycle for the Week 13 review.
  return getLocalDateKey(addDays(endDate, 8));
}

export function getFirstWeekStartDate(nextCycleStartDate: string) {
  const startDate = parseLocalDateKey(nextCycleStartDate);

  if (!startDate) {
    throw new Error('The next cycle has an invalid start date.');
  }

  return getLocalDateKey(getStartOfWeek(startDate));
}

function formatReportDate(dateKey: string) {
  const parsed = parseLocalDateKey(dateKey);

  return parsed
    ? parsed.toLocaleDateString([], {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : dateKey;
}

function line(label: string, value: string | number | null) {
  return `- **${label}:** ${value ?? 'None'}`;
}

export function buildCycleReportMarkdown(input: {
  cycle: PlanningCycle;
  cycleLabel: string;
  review: {
    reflection: NormalizedCycleReviewReflection;
    snapshot: CycleReviewSnapshot;
    finalizedAt: string | null;
    nextCycleName: string | null;
    nextCyclePrimaryFocus: string | null;
    nextCycleTheme: string | null;
    nextCycleStartDate: string | null;
    firstWeekCommitments: string[];
  };
  goals: StoredGoal[];
  outcomes: Array<{
    goalId: number;
    action: CycleGoalOutcomeAction;
    replacementTitle: string | null;
  }>;
  weeklyReviews: StoredWeeklyReview[];
}) {
  const { cycle, cycleLabel, review, goals, outcomes, weeklyReviews } = input;
  const outcomeByGoal = new Map(
    outcomes.map((outcome) => [outcome.goalId, outcome])
  );
  const cycleGoals = goals.filter((goal) => goal.cycleId === cycle.id);
  const cycleReviews = weeklyReviews
    .filter((item) => item.cycleId === cycle.id)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  const lines = [
    `# ${cycleLabel} — Cycle Report`,
    '',
    line('Cycle dates', `${formatReportDate(cycle.startDate)} → ${formatReportDate(cycle.endDate)}`),
    line('Primary focus', cycle.primaryFocus),
    line('Theme', cycle.theme),
    line(
      'Report finalized',
      review.finalizedAt
        ? new Date(review.finalizedAt).toLocaleString()
        : 'Draft'
    ),
    '',
    '## Results',
    '',
    line(
      'Goals completed',
      `${review.snapshot.goalCompleted} of ${review.snapshot.goalTotal}`
    ),
    line('Tasks completed', review.snapshot.taskCompleted),
    line(
      'Milestones completed',
      `${review.snapshot.milestoneCompleted} of ${review.snapshot.milestoneTotal}`
    ),
    line('Weekly reviews completed', review.snapshot.weeklyReviewsCompleted),
    line('Longest streak', `${review.snapshot.longestStreak} days`),
    line(
      'Most productive cycle week',
      review.snapshot.bestWeekNumber
        ? `Week ${review.snapshot.bestWeekNumber} (${review.snapshot.bestWeekCount} tasks)`
        : 'None'
    ),
    line(
      'Most productive weekday',
      review.snapshot.bestDay
        ? `${review.snapshot.bestDay} (${review.snapshot.bestDayCount} tasks)`
        : 'None'
    ),
    line('High-priority tasks completed', review.snapshot.highPriorityCompleted),
    line('Recurring tasks completed', review.snapshot.recurringCompleted),
    line('Rewards unlocked', review.snapshot.rewardsUnlocked),
    line('Brain Dumps archived', review.snapshot.brainDumpsArchived),
    '',
    '## Goal Outcomes',
    '',
  ];

  if (cycleGoals.length === 0) {
    lines.push('No goals were assigned to this cycle.');
  } else {
    cycleGoals.forEach((goal) => {
      const outcome = outcomeByGoal.get(goal.id);
      const status = goal.completed
        ? 'Completed'
        : outcome
          ? getCycleGoalOutcomeLabel(outcome.action)
          : 'Unfinished';
      const replacement =
        outcome?.action === 'replace' && outcome.replacementTitle
          ? ` → ${outcome.replacementTitle}`
          : '';

      lines.push(`- **${goal.title}:** ${status}${replacement}`);
    });
  }

  lines.push('', '## Reflection', '');
  const reflectionEntries: Array<[string, string | null]> = [
    ['Biggest accomplishment', review.reflection.biggestAccomplishment],
    ['Biggest challenge', review.reflection.biggestChallenge],
    ['What worked well', review.reflection.whatWorkedWell],
    ['What should change next cycle', review.reflection.whatChangeNextCycle],
    ['What to stop doing', review.reflection.whatStopDoing],
    ['What to continue doing', review.reflection.whatContinueDoing],
    ['What was learned', review.reflection.whatLearned],
  ];

  reflectionEntries.forEach(([label, value]) => {
    lines.push(`### ${label}`, '', value ?? '_No response saved._', '');
  });

  lines.push('## Next Cycle Plan', '');
  lines.push(
    line('Cycle name', review.nextCycleName),
    line('Primary focus', review.nextCyclePrimaryFocus),
    line('Theme', review.nextCycleTheme),
    line(
      'Start date',
      review.nextCycleStartDate
        ? formatReportDate(review.nextCycleStartDate)
        : null
    ),
    '',
    '### First-Week Commitments',
    ''
  );

  if (review.firstWeekCommitments.length === 0) {
    lines.push('No first-week commitments were saved.');
  } else {
    review.firstWeekCommitments.forEach((commitment) =>
      lines.push(`- ${commitment}`)
    );
  }

  lines.push('', '## Weekly Review Summaries', '');
  if (cycleReviews.length === 0) {
    lines.push('No guided weekly reviews were saved for this cycle.');
  } else {
    cycleReviews.forEach((weeklyReview, index) => {
      const weekStart = parseLocalDateKey(weeklyReview.weekStart);
      const cycleStart = parseLocalDateKey(cycle.startDate);
      const weekNumber =
        weekStart && cycleStart
          ? Math.floor(differenceInCalendarDays(weekStart, cycleStart) / 7) + 1
          : index + 1;

      lines.push(
        `### Week ${weekNumber}`,
        '',
        line('Tasks completed', weeklyReview.completedCount),
        line('Completion rate', `${weeklyReview.completionRate}%`),
        line('Goals progressed', weeklyReview.goalsProgressedCount),
        line('Next-week focus', weeklyReview.nextWeekFocus),
        ''
      );
    });
  }

  return `${lines.join('\n')}\n`;
}
