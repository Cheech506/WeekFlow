import { getDb, migrateDb } from './db';
import {
  normalizeGoalNotes,
  normalizeGoalPurpose,
  normalizeGoalSuccessDefinition,
} from './goalPlanningUtils';
import {
  normalizeGoalCompletionReflection,
  type GoalCompletionReflection,
  type GoalCompletionSnapshot,
} from './goalReviewUtils';
import { normalizeGoalReward } from './goalRewardUtils';
import {
  createDefaultGoalDateRange,
  validateGoalDateRange,
} from './goalUtils';

export type StoredGoal = {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  startDate: string;
  endDate: string;
  reward: string | null;
  purpose: string | null;
  successDefinition: string | null;
  notes: string | null;
  completionWhatHelped: string | null;
  completionHardestPart: string | null;
  completionLearned: string | null;
  completionDoDifferently: string | null;
  completionTaskTotal: number | null;
  completionTaskCompleted: number | null;
  completionMilestoneTotal: number | null;
  completionMilestoneCompleted: number | null;
  completionHighPriorityCompleted: number | null;
};

type GoalRow = {
  id: number;
  title: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
  start_date: string;
  end_date: string;
  reward: string | null;
  purpose: string | null;
  success_definition: string | null;
  notes: string | null;
  completion_what_helped: string | null;
  completion_hardest_part: string | null;
  completion_learned: string | null;
  completion_do_differently: string | null;
  completion_task_total: number | null;
  completion_task_completed: number | null;
  completion_milestone_total: number | null;
  completion_milestone_completed: number | null;
  completion_high_priority_completed: number | null;
};

export type GoalPlanningDetails = {
  purpose?: string | null;
  successDefinition?: string | null;
  notes?: string | null;
};

function mapGoalRow(row: GoalRow): StoredGoal {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    startDate: row.start_date,
    endDate: row.end_date,
    reward: row.reward,
    purpose: row.purpose,
    successDefinition: row.success_definition,
    notes: row.notes,
    completionWhatHelped: row.completion_what_helped,
    completionHardestPart: row.completion_hardest_part,
    completionLearned: row.completion_learned,
    completionDoDifferently: row.completion_do_differently,
    completionTaskTotal: row.completion_task_total,
    completionTaskCompleted: row.completion_task_completed,
    completionMilestoneTotal: row.completion_milestone_total,
    completionMilestoneCompleted: row.completion_milestone_completed,
    completionHighPriorityCompleted:
      row.completion_high_priority_completed,
  };
}

function validateSnapshotCount(
  value: number,
  label: string
): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }

  return value;
}

function normalizeCompletionSnapshot(
  snapshot?: GoalCompletionSnapshot
): GoalCompletionSnapshot | null {
  if (!snapshot) return null;

  const normalized = {
    taskTotal: validateSnapshotCount(snapshot.taskTotal, 'Task total'),
    taskCompleted: validateSnapshotCount(
      snapshot.taskCompleted,
      'Completed task total'
    ),
    milestoneTotal: validateSnapshotCount(
      snapshot.milestoneTotal,
      'Milestone total'
    ),
    milestoneCompleted: validateSnapshotCount(
      snapshot.milestoneCompleted,
      'Completed milestone total'
    ),
    highPriorityCompleted: validateSnapshotCount(
      snapshot.highPriorityCompleted,
      'High-priority completed total'
    ),
  };

  if (normalized.taskCompleted > normalized.taskTotal) {
    throw new Error('Completed tasks cannot exceed the total linked tasks.');
  }

  if (normalized.milestoneCompleted > normalized.milestoneTotal) {
    throw new Error(
      'Completed milestones cannot exceed the total milestones.'
    );
  }

  if (normalized.highPriorityCompleted > normalized.taskCompleted) {
    throw new Error(
      'High-priority completed tasks cannot exceed completed tasks.'
    );
  }

  return normalized;
}

export async function getGoals(): Promise<StoredGoal[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<GoalRow>(`
    SELECT
      id,
      title,
      completed,
      created_at,
      completed_at,
      start_date,
      end_date,
      reward,
      purpose,
      success_definition,
      notes,
      completion_what_helped,
      completion_hardest_part,
      completion_learned,
      completion_do_differently,
      completion_task_total,
      completion_task_completed,
      completion_milestone_total,
      completion_milestone_completed,
      completion_high_priority_completed
    FROM goals
    ORDER BY created_at DESC;
  `);

  return rows.map(mapGoalRow);
}

export async function insertGoal(
  title: string,
  startDateKey?: string,
  endDateKey?: string,
  reward?: string | null,
  planningDetails: GoalPlanningDetails = {}
): Promise<StoredGoal> {
  await migrateDb();

  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error('Enter a goal title first.');
  }

  const db = await getDb();
  const defaultDates = createDefaultGoalDateRange();
  const dateRange = validateGoalDateRange(
    startDateKey ?? defaultDates.startDateKey,
    endDateKey ?? defaultDates.endDateKey
  );

  const id = Date.now();
  const createdAt = new Date().toISOString();
  const startDate = dateRange.startDateIso;
  const endDate = dateRange.endDateIso;
  const normalizedReward = normalizeGoalReward(reward);
  const purpose = normalizeGoalPurpose(planningDetails.purpose);
  const successDefinition = normalizeGoalSuccessDefinition(
    planningDetails.successDefinition
  );
  const notes = normalizeGoalNotes(planningDetails.notes);

  await db.runAsync(
    `
    INSERT INTO goals (
      id,
      title,
      completed,
      created_at,
      completed_at,
      start_date,
      end_date,
      reward,
      purpose,
      success_definition,
      notes,
      completion_what_helped,
      completion_hardest_part,
      completion_learned,
      completion_do_differently,
      completion_task_total,
      completion_task_completed,
      completion_milestone_total,
      completion_milestone_completed,
      completion_high_priority_completed
    )
    VALUES (
      ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    );
    `,
    [
      id,
      trimmedTitle,
      createdAt,
      startDate,
      endDate,
      normalizedReward,
      purpose,
      successDefinition,
      notes,
    ]
  );

  return {
    id,
    title: trimmedTitle,
    completed: false,
    createdAt,
    completedAt: null,
    startDate,
    endDate,
    reward: normalizedReward,
    purpose,
    successDefinition,
    notes,
    completionWhatHelped: null,
    completionHardestPart: null,
    completionLearned: null,
    completionDoDifferently: null,
    completionTaskTotal: null,
    completionTaskCompleted: null,
    completionMilestoneTotal: null,
    completionMilestoneCompleted: null,
    completionHighPriorityCompleted: null,
  };
}

export async function updateGoalDetails(
  id: number,
  title: string,
  startDateKey: string,
  endDateKey: string,
  reward?: string | null,
  planningDetails: GoalPlanningDetails = {}
): Promise<{
  title: string;
  startDate: string;
  endDate: string;
  reward: string | null;
  purpose: string | null;
  successDefinition: string | null;
  notes: string | null;
}> {
  await migrateDb();

  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error('Enter a goal title first.');
  }

  const db = await getDb();
  const dateRange = validateGoalDateRange(startDateKey, endDateKey);
  const normalizedReward = normalizeGoalReward(reward);
  const purpose = normalizeGoalPurpose(planningDetails.purpose);
  const successDefinition = normalizeGoalSuccessDefinition(
    planningDetails.successDefinition
  );
  const notes = normalizeGoalNotes(planningDetails.notes);

  /*
   * All editable goal details are written together so the goal cannot be left
   * partially updated if one field fails validation before the database write.
   */
  await db.runAsync(
    `
    UPDATE goals
    SET
      title = ?,
      start_date = ?,
      end_date = ?,
      reward = ?,
      purpose = ?,
      success_definition = ?,
      notes = ?
    WHERE id = ?;
    `,
    [
      trimmedTitle,
      dateRange.startDateIso,
      dateRange.endDateIso,
      normalizedReward,
      purpose,
      successDefinition,
      notes,
      id,
    ]
  );

  return {
    title: trimmedTitle,
    startDate: dateRange.startDateIso,
    endDate: dateRange.endDateIso,
    reward: normalizedReward,
    purpose,
    successDefinition,
    notes,
  };
}

export async function updateGoalDates(
  id: number,
  startDateKey: string,
  endDateKey: string
): Promise<{ startDate: string; endDate: string }> {
  await migrateDb();

  const db = await getDb();
  const dateRange = validateGoalDateRange(startDateKey, endDateKey);

  await db.runAsync(
    `
    UPDATE goals
    SET start_date = ?, end_date = ?
    WHERE id = ?;
    `,
    [dateRange.startDateIso, dateRange.endDateIso, id]
  );

  return {
    startDate: dateRange.startDateIso,
    endDate: dateRange.endDateIso,
  };
}

export async function updateGoalCompletion(
  id: number,
  completed: boolean,
  reflection: GoalCompletionReflection = {},
  snapshot?: GoalCompletionSnapshot
): Promise<string | null> {
  await migrateDb();

  const db = await getDb();
  const completedAt = completed ? new Date().toISOString() : null;

  if (!completed) {
    /*
     * Reopening removes the completion timestamp but deliberately preserves the
     * previous reflection and completion snapshot. If the user completes the
     * goal again, the form can reuse those answers and save a new snapshot.
     */
    await db.runAsync(
      `
      UPDATE goals
      SET completed = 0, completed_at = NULL
      WHERE id = ?;
      `,
      [id]
    );

    return null;
  }

  const normalizedReflection = normalizeGoalCompletionReflection(reflection);
  const normalizedSnapshot = normalizeCompletionSnapshot(snapshot);

  /*
   * The completion result is stored beside the goal so History remains a
   * snapshot of what was true at completion time, even if linked tasks or
   * milestones are edited later.
   */
  await db.runAsync(
    `
    UPDATE goals
    SET
      completed = 1,
      completed_at = ?,
      completion_what_helped = ?,
      completion_hardest_part = ?,
      completion_learned = ?,
      completion_do_differently = ?,
      completion_task_total = ?,
      completion_task_completed = ?,
      completion_milestone_total = ?,
      completion_milestone_completed = ?,
      completion_high_priority_completed = ?
    WHERE id = ?;
    `,
    [
      completedAt,
      normalizedReflection.whatHelped,
      normalizedReflection.hardestPart,
      normalizedReflection.learned,
      normalizedReflection.doDifferently,
      normalizedSnapshot?.taskTotal ?? null,
      normalizedSnapshot?.taskCompleted ?? null,
      normalizedSnapshot?.milestoneTotal ?? null,
      normalizedSnapshot?.milestoneCompleted ?? null,
      normalizedSnapshot?.highPriorityCompleted ?? null,
      id,
    ]
  );

  return completedAt;
}

export async function deleteGoalById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();

  /*
   * A goal is only a planning relationship. Deleting it must not delete the
   * user's tasks, task history, or recurring schedules. Milestones belong to
   * the goal itself, so they are removed in the same transaction.
   */
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
      UPDATE tasks
      SET goal_id = NULL
      WHERE goal_id = ?;
      `,
      [id]
    );

    await db.runAsync(
      `
      UPDATE recurring_rules
      SET goal_id = NULL
      WHERE goal_id = ?;
      `,
      [id]
    );

    await db.runAsync(
      `
      DELETE FROM goal_milestones
      WHERE goal_id = ?;
      `,
      [id]
    );

    await db.runAsync(
      `
      DELETE FROM goals
      WHERE id = ?;
      `,
      [id]
    );
  });
}
