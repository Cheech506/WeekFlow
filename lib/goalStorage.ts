import { getDb, migrateDb } from './db';
import {
  normalizeGoalNotes,
  normalizeGoalPurpose,
  normalizeGoalSuccessDefinition,
} from './goalPlanningUtils';
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
  };
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
      notes
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
      notes
    )
    VALUES (?, ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?);
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
  completed: boolean
): Promise<string | null> {
  await migrateDb();

  const db = await getDb();
  const completedAt = completed ? new Date().toISOString() : null;

  await db.runAsync(
    `
    UPDATE goals
    SET completed = ?, completed_at = ?
    WHERE id = ?;
    `,
    [completed ? 1 : 0, completedAt, id]
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
