import type { GoalMilestone } from './goalMilestoneStorage';
import {
  calculateGoalAnalytics,
  type GoalHealthStatus,
} from './goalReviewUtils';
import type { StoredGoal } from './goalStorage';
import { calculateProgressStats } from './progressStats';
import type { Task } from './taskStorage';
import {
  getLocalDateKey,
  getStartOfWeek,
  isDateKeyOverdue,
} from './dateUtils';
import type { WeeklyCommitment } from './weeklyReviewStorage';

export type DashboardGoalSummary = {
  id: number;
  title: string;
  taskProgress: number;
  taskCompleted: number;
  taskTotal: number;
  milestoneCompleted: number;
  milestoneTotal: number;
  healthStatus: GoalHealthStatus;
  healthLabel: string;
  healthReason: string;
};

export type DashboardCommitmentSummary = {
  id: number;
  title: string;
  completed: boolean;
  linkedToTask: boolean;
};

export type GoalDashboardSnapshot = {
  todayDateKey: string;
  currentWeekStart: string;
  completedToday: number;
  todayRemaining: number;
  todayTotal: number;
  todayCompletionRate: number;
  overdueCount: number;
  currentStreak: number;
  longestStreak: number;
  commitmentCompleted: number;
  commitmentTotal: number;
  commitments: DashboardCommitmentSummary[];
  goals: DashboardGoalSummary[];
};

const GOAL_HEALTH_ORDER: Record<GoalHealthStatus, number> = {
  needsAttention: 0,
  noActivity: 1,
  healthy: 2,
  completed: 3,
};

function calculatePercentage(completed: number, total: number) {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Builds the small command-center snapshot used by the Goals dashboard.
 * All values are derived from existing records so the dashboard never creates
 * a second source of truth or requires another database table.
 */
export function calculateGoalDashboardSnapshot(
  tasks: Task[],
  goals: StoredGoal[],
  milestones: GoalMilestone[],
  commitments: WeeklyCommitment[],
  cycleId: number,
  currentDate: Date = new Date()
): GoalDashboardSnapshot {
  const todayDateKey = getLocalDateKey(currentDate);
  const currentWeekStart = getLocalDateKey(getStartOfWeek(currentDate));
  const progressStats = calculateProgressStats(tasks, currentDate);
  const activeTodayTasks = tasks.filter(
    (task) => !task.completed && task.dueDate === todayDateKey
  );
  const overdueCount = tasks.filter(
    (task) => !task.completed && isDateKeyOverdue(task.dueDate, currentDate)
  ).length;
  const todayTotal = progressStats.completedToday + activeTodayTasks.length;
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  /*
   * Linked commitments read the live task title and completion state. Manual
   * commitments continue to use their own stored values.
   */
  const currentCommitments = commitments
    .filter((commitment) => commitment.weekStart === currentWeekStart)
    .map((commitment): DashboardCommitmentSummary => {
      const linkedTask =
        commitment.taskId === null
          ? null
          : tasksById.get(commitment.taskId) ?? null;

      return {
        id: commitment.id,
        title: linkedTask?.title ?? commitment.title,
        completed: linkedTask?.completed ?? commitment.completed,
        linkedToTask: commitment.taskId !== null,
      };
    });

  const activeCycleGoals = goals.filter(
    (goal) => goal.cycleId === cycleId && !goal.completed
  );

  const goalSummaries = activeCycleGoals
    .map((goal): DashboardGoalSummary => {
      const analytics = calculateGoalAnalytics(
        goal,
        tasks.filter((task) => task.goalId === goal.id),
        milestones.filter((milestone) => milestone.goalId === goal.id),
        currentDate
      );

      return {
        id: goal.id,
        title: goal.title,
        taskProgress: analytics.taskProgress,
        taskCompleted: analytics.taskCompleted,
        taskTotal: analytics.taskTotal,
        milestoneCompleted: analytics.milestoneCompleted,
        milestoneTotal: analytics.milestoneTotal,
        healthStatus: analytics.healthStatus,
        healthLabel: analytics.healthLabel,
        healthReason: analytics.healthReason,
      };
    })
    .sort((first, second) => {
      const healthDifference =
        GOAL_HEALTH_ORDER[first.healthStatus] -
        GOAL_HEALTH_ORDER[second.healthStatus];

      if (healthDifference !== 0) return healthDifference;
      return first.title.localeCompare(second.title);
    });

  return {
    todayDateKey,
    currentWeekStart,
    completedToday: progressStats.completedToday,
    todayRemaining: activeTodayTasks.length,
    todayTotal,
    todayCompletionRate: calculatePercentage(
      progressStats.completedToday,
      todayTotal
    ),
    overdueCount,
    currentStreak: progressStats.currentStreak,
    longestStreak: progressStats.longestStreak,
    commitmentCompleted: currentCommitments.filter(
      (commitment) => commitment.completed
    ).length,
    commitmentTotal: currentCommitments.length,
    commitments: currentCommitments,
    goals: goalSummaries,
  };
}
