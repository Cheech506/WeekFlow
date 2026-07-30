import type { GoalMilestone } from './goalMilestoneStorage';
import type { StoredGoal } from './goalStorage';
import type { Task } from './taskStorage';

export const MAX_GOAL_REFLECTION_LENGTH = 1000;
export const GOAL_HEALTH_RECENT_DAYS = 7;

export type GoalCompletionReflection = {
  whatHelped?: string | null;
  hardestPart?: string | null;
  learned?: string | null;
  doDifferently?: string | null;
};

export type NormalizedGoalCompletionReflection = {
  whatHelped: string | null;
  hardestPart: string | null;
  learned: string | null;
  doDifferently: string | null;
};

export type GoalCompletionSnapshot = {
  taskTotal: number;
  taskCompleted: number;
  milestoneTotal: number;
  milestoneCompleted: number;
  highPriorityCompleted: number;
};

export type GoalHealthStatus =
  | 'healthy'
  | 'needsAttention'
  | 'noActivity'
  | 'completed';

export type GoalAnalytics = {
  taskTotal: number;
  taskCompleted: number;
  taskRemaining: number;
  taskProgress: number;
  milestoneTotal: number;
  milestoneCompleted: number;
  milestoneRemaining: number;
  highPriorityCompleted: number;
  lastActivityAt: string | null;
  healthStatus: GoalHealthStatus;
  healthLabel: string;
  healthReason: string;
};

function normalizeOptionalReflectionField(
  value: string | null | undefined,
  label: string
): string | null {
  const normalized = value?.trim() ?? '';

  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_GOAL_REFLECTION_LENGTH) {
    throw new Error(
      `${label} must be ${MAX_GOAL_REFLECTION_LENGTH} characters or fewer.`
    );
  }

  return normalized;
}

export function normalizeGoalCompletionReflection(
  reflection: GoalCompletionReflection = {}
): NormalizedGoalCompletionReflection {
  return {
    whatHelped: normalizeOptionalReflectionField(
      reflection.whatHelped,
      'What helped'
    ),
    hardestPart: normalizeOptionalReflectionField(
      reflection.hardestPart,
      'Hardest part'
    ),
    learned: normalizeOptionalReflectionField(
      reflection.learned,
      'What you learned'
    ),
    doDifferently: normalizeOptionalReflectionField(
      reflection.doDifferently,
      'What you would do differently'
    ),
  };
}

function getValidTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getDaysSince(timestamp: number, now: Date): number {
  const activityDate = new Date(timestamp);
  const activityDay = new Date(
    activityDate.getFullYear(),
    activityDate.getMonth(),
    activityDate.getDate()
  ).getTime();
  const currentDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  return Math.max(0, Math.floor((currentDay - activityDay) / 86_400_000));
}

function buildHealthSummary(
  goal: Pick<StoredGoal, 'completed'>,
  lastActivityAt: string | null,
  now: Date
): Pick<
  GoalAnalytics,
  'healthStatus' | 'healthLabel' | 'healthReason'
> {
  if (goal.completed) {
    return {
      healthStatus: 'completed',
      healthLabel: 'Completed',
      healthReason: 'This goal has been marked complete.',
    };
  }

  const lastActivityTimestamp = getValidTimestamp(lastActivityAt);

  if (lastActivityTimestamp === null) {
    return {
      healthStatus: 'noActivity',
      healthLabel: 'No Activity Yet',
      healthReason:
        'No linked task or milestone has been completed for this goal yet.',
    };
  }

  const daysSinceActivity = getDaysSince(lastActivityTimestamp, now);

  if (daysSinceActivity <= GOAL_HEALTH_RECENT_DAYS) {
    return {
      healthStatus: 'healthy',
      healthLabel: 'Healthy',
      healthReason:
        daysSinceActivity === 0
          ? 'Linked work was completed today.'
          : `Linked work was completed ${daysSinceActivity} day${
              daysSinceActivity === 1 ? '' : 's'
            } ago.`,
    };
  }

  return {
    healthStatus: 'needsAttention',
    healthLabel: 'Needs Attention',
    healthReason: `No linked task or milestone has been completed in ${daysSinceActivity} days.`,
  };
}

export function calculateGoalAnalytics(
  goal: Pick<StoredGoal, 'completed'>,
  linkedTasks: Task[],
  milestones: GoalMilestone[],
  now: Date = new Date()
): GoalAnalytics {
  const taskCompleted = linkedTasks.filter((task) => task.completed).length;
  const milestoneCompleted = milestones.filter(
    (milestone) => milestone.completed
  ).length;
  const completedActivityTimestamps = [
    ...linkedTasks
      .filter((task) => task.completed)
      .map((task) => task.completedAt),
    ...milestones
      .filter((milestone) => milestone.completed)
      .map((milestone) => milestone.completedAt),
  ]
    .map(getValidTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null);

  const lastActivityTimestamp =
    completedActivityTimestamps.length > 0
      ? Math.max(...completedActivityTimestamps)
      : null;
  const lastActivityAt =
    lastActivityTimestamp === null
      ? null
      : new Date(lastActivityTimestamp).toISOString();
  const taskProgress =
    linkedTasks.length === 0
      ? 0
      : Math.round((taskCompleted / linkedTasks.length) * 100);
  const health = buildHealthSummary(goal, lastActivityAt, now);

  return {
    taskTotal: linkedTasks.length,
    taskCompleted,
    taskRemaining: linkedTasks.length - taskCompleted,
    taskProgress,
    milestoneTotal: milestones.length,
    milestoneCompleted,
    milestoneRemaining: milestones.length - milestoneCompleted,
    highPriorityCompleted: linkedTasks.filter(
      (task) => task.completed && task.priority === 2
    ).length,
    lastActivityAt,
    ...health,
  };
}

export function createGoalCompletionSnapshot(
  analytics: GoalAnalytics
): GoalCompletionSnapshot {
  return {
    taskTotal: analytics.taskTotal,
    taskCompleted: analytics.taskCompleted,
    milestoneTotal: analytics.milestoneTotal,
    milestoneCompleted: analytics.milestoneCompleted,
    highPriorityCompleted: analytics.highPriorityCompleted,
  };
}

export function resolveGoalCompletionSnapshot(
  goal: Pick<
    StoredGoal,
    | 'completionTaskTotal'
    | 'completionTaskCompleted'
    | 'completionMilestoneTotal'
    | 'completionMilestoneCompleted'
    | 'completionHighPriorityCompleted'
  >,
  fallbackAnalytics: GoalAnalytics
): GoalCompletionSnapshot {
  return {
    taskTotal: goal.completionTaskTotal ?? fallbackAnalytics.taskTotal,
    taskCompleted:
      goal.completionTaskCompleted ?? fallbackAnalytics.taskCompleted,
    milestoneTotal:
      goal.completionMilestoneTotal ?? fallbackAnalytics.milestoneTotal,
    milestoneCompleted:
      goal.completionMilestoneCompleted ?? fallbackAnalytics.milestoneCompleted,
    highPriorityCompleted:
      goal.completionHighPriorityCompleted ??
      fallbackAnalytics.highPriorityCompleted,
  };
}

export function hasGoalCompletionReflection(
  goal: Pick<
    StoredGoal,
    | 'completionWhatHelped'
    | 'completionHardestPart'
    | 'completionLearned'
    | 'completionDoDifferently'
  >
): boolean {
  return Boolean(
    goal.completionWhatHelped ||
      goal.completionHardestPart ||
      goal.completionLearned ||
      goal.completionDoDifferently
  );
}
