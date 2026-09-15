import type { Task } from './taskStorage';

export type TaskMigrationInventory = {
  total: number;
  plain: number;
  goalLinked: number;
  recurring: number;
  completed: number;
};

/**
 * Count SQLite task categories before migration.
 * This only reads tasks and does not change either database.
 */
export function getTaskMigrationInventory(
  tasks: readonly Task[]
): TaskMigrationInventory {
  let plain = 0;
  let goalLinked = 0;
  let recurring = 0;
  let completed = 0;

  for (const task of tasks) {
    const hasGoal = task.goalId !== null;
    const hasRecurringRule = task.recurringRuleId !== null;

    if (!hasGoal && !hasRecurringRule) plain += 1;
    if (hasGoal) goalLinked += 1;
    if (hasRecurringRule) recurring += 1;
    if (task.completed) completed += 1;
  }

  return {
    total: tasks.length,
    plain,
    goalLinked,
    recurring,
    completed,
  };
}