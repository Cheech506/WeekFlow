import { getDb, migrateDb } from './db';
import {
  normalizeMilestoneNotes,
  normalizeMilestoneTargetDate,
  normalizeMilestoneTitle,
} from './goalPlanningUtils';

export type GoalMilestone = {
  id: number;
  goalId: number;
  title: string;
  notes: string | null;
  targetDate: string | null;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
};

type GoalMilestoneRow = {
  id: number;
  goal_id: number;
  title: string;
  notes: string | null;
  target_date: string | null;
  completed: number;
  created_at: string;
  completed_at: string | null;
};

function mapMilestoneRow(row: GoalMilestoneRow): GoalMilestone {
  return {
    id: row.id,
    goalId: row.goal_id,
    title: row.title,
    notes: row.notes,
    targetDate: row.target_date,
    completed: row.completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function getGoalMilestones(): Promise<GoalMilestone[]> {
  await migrateDb();

  const db = await getDb();
  const rows = await db.getAllAsync<GoalMilestoneRow>(`
    SELECT
      id,
      goal_id,
      title,
      notes,
      target_date,
      completed,
      created_at,
      completed_at
    FROM goal_milestones
    ORDER BY completed ASC, target_date IS NULL, target_date ASC, created_at ASC;
  `);

  return rows.map(mapMilestoneRow);
}

export async function insertGoalMilestone(
  goalId: number,
  title: string,
  targetDate?: string | null,
  notes?: string | null
): Promise<GoalMilestone> {
  await migrateDb();

  const db = await getDb();
  const normalizedTitle = normalizeMilestoneTitle(title);
  const normalizedTargetDate = normalizeMilestoneTargetDate(targetDate);
  const normalizedNotes = normalizeMilestoneNotes(notes);
  const createdAt = new Date().toISOString();

  const result = await db.runAsync(
    `
    INSERT INTO goal_milestones (
      goal_id,
      title,
      notes,
      target_date,
      completed,
      created_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, 0, ?, NULL);
    `,
    [goalId, normalizedTitle, normalizedNotes, normalizedTargetDate, createdAt]
  );

  return {
    id: Number(result.lastInsertRowId),
    goalId,
    title: normalizedTitle,
    notes: normalizedNotes,
    targetDate: normalizedTargetDate,
    completed: false,
    createdAt,
    completedAt: null,
  };
}

export async function updateGoalMilestone(
  id: number,
  title: string,
  targetDate?: string | null,
  notes?: string | null
): Promise<Pick<GoalMilestone, 'title' | 'targetDate' | 'notes'>> {
  await migrateDb();

  const db = await getDb();
  const normalizedTitle = normalizeMilestoneTitle(title);
  const normalizedTargetDate = normalizeMilestoneTargetDate(targetDate);
  const normalizedNotes = normalizeMilestoneNotes(notes);

  await db.runAsync(
    `
    UPDATE goal_milestones
    SET title = ?, target_date = ?, notes = ?
    WHERE id = ?;
    `,
    [normalizedTitle, normalizedTargetDate, normalizedNotes, id]
  );

  return {
    title: normalizedTitle,
    targetDate: normalizedTargetDate,
    notes: normalizedNotes,
  };
}

export async function updateGoalMilestoneCompletion(
  id: number,
  completed: boolean
): Promise<string | null> {
  await migrateDb();

  const db = await getDb();
  const completedAt = completed ? new Date().toISOString() : null;

  await db.runAsync(
    `
    UPDATE goal_milestones
    SET completed = ?, completed_at = ?
    WHERE id = ?;
    `,
    [completed ? 1 : 0, completedAt, id]
  );

  return completedAt;
}

export async function deleteGoalMilestoneById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();
  await db.runAsync('DELETE FROM goal_milestones WHERE id = ?;', [id]);
}
