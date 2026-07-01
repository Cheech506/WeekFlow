import { getDb, migrateDb } from './db';
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
};

type GoalRow = {
  id: number;
  title: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
  start_date: string;
  end_date: string;
};

export async function getGoals(): Promise<StoredGoal[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<GoalRow>(`
    SELECT id, title, completed, created_at, completed_at, start_date, end_date
    FROM goals
    ORDER BY created_at DESC;
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}

export async function insertGoal(
  title: string,
  startDateKey?: string,
  endDateKey?: string
): Promise<StoredGoal> {
  await migrateDb();

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

  await db.runAsync(
    `
    INSERT INTO goals (
      id,
      title,
      completed,
      created_at,
      completed_at,
      start_date,
      end_date
    )
    VALUES (?, ?, 0, ?, NULL, ?, ?);
    `,
    [id, title.trim(), createdAt, startDate, endDate]
  );

  return {
    id,
    title: title.trim(),
    completed: false,
    createdAt,
    completedAt: null,
    startDate,
    endDate,
  };
}

export async function updateGoalDates(
  id: number,
  startDateKey: string,
  endDateKey: string
): Promise<{ startDate: string; endDate: string }> {
  await migrateDb();

  const db = await getDb();
  const dateRange = validateGoalDateRange(
    startDateKey,
    endDateKey
  );

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

  await db.runAsync(
    `
    DELETE FROM goals
    WHERE id = ?;
    `,
    [id]
  );
}