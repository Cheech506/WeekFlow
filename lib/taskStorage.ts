import {
  getDayNameFromDateKey,
  getNextOccurrenceDateKey,
  parseLocalDateKey,
} from './dateUtils';
import { getDb, migrateDb } from './db';

export type Task = {
  id: number;
  title: string;
  day: string;
  dueDate: string | null;
  notes: string | null;
  priority: number;
  goalId: number | null;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
};

type TaskRow = {
  id: number;
  title: string;
  day: string;
  due_date: string | null;
  notes: string | null;
  priority: number;
  goal_id: number | null;
  completed: number;
  created_at: string;
  completed_at: string | null;
};

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    day: row.day,
    dueDate: row.due_date,
    notes: row.notes,
    priority: row.priority,
    goalId: row.goal_id,
    completed: row.completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function getTasks(): Promise<Task[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<TaskRow>(
    `
    SELECT
      id,
      title,
      day,
      due_date,
      notes,
      priority,
      goal_id,
      completed,
      created_at,
      completed_at
    FROM tasks
    ORDER BY created_at DESC;
    `
  );

  return rows.map(mapTaskRow);
}

export async function insertTask(
  title: string,
  day: string,
  notes: string = '',
  priority: number = 0,
  goalId: number | null = null,
  dueDate: string | null = null
): Promise<void> {
  await migrateDb();

  const db = await getDb();
  const createdAt = new Date().toISOString();

  /*
   * When a real date is provided, the weekday is derived from it.
   * Otherwise the task stays in Inbox or keeps the supplied legacy day value.
   */
  const resolvedDay = dueDate
    ? getDayNameFromDateKey(dueDate) ?? day
    : day;

  await db.runAsync(
    `
    INSERT INTO tasks (
      title,
      day,
      due_date,
      notes,
      priority,
      goal_id,
      completed,
      created_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL);
    `,
    [
      title.trim(),
      resolvedDay,
      dueDate,
      notes.trim() || null,
      priority,
      goalId,
      createdAt,
    ]
  );
}

export async function updateTaskById(
  id: number,
  title: string,
  notes: string = '',
  priority: number = 0,
  goalId: number | null = null
): Promise<void> {
  await migrateDb();

  const db = await getDb();

  await db.runAsync(
    `
    UPDATE tasks
    SET
      title = ?,
      notes = ?,
      priority = ?,
      goal_id = ?
    WHERE id = ?;
    `,
    [
      title.trim(),
      notes.trim() || null,
      priority,
      goalId,
      id,
    ]
  );
}

export async function completeTaskById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();
  const completedAt = new Date().toISOString();

  await db.runAsync(
    `
    UPDATE tasks
    SET completed = 1,
        completed_at = ?
    WHERE id = ?;
    `,
    [completedAt, id]
  );
}

export async function deleteTaskById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();

  await db.runAsync(
    `
    DELETE FROM tasks
    WHERE id = ?;
    `,
    [id]
  );
}

/**
 * Assigns a task to a specific calendar date.
 * The weekday is stored too so older parts of the app remain compatible.
 */
export async function scheduleTaskByDate(
  id: number,
  dueDate: string
): Promise<void> {
  await migrateDb();

  const parsedDate = parseLocalDateKey(dueDate);
  const day = getDayNameFromDateKey(dueDate);

  if (!parsedDate || !day) {
    throw new Error(`Invalid due date: ${dueDate}`);
  }

  const db = await getDb();

  await db.runAsync(
    `
    UPDATE tasks
    SET day = ?,
        due_date = ?
    WHERE id = ?;
    `,
    [day, dueDate, id]
  );
}

/**
 * Returning a task to Inbox removes its due date because it is unscheduled again.
 */
export async function moveTaskToInboxById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();

  await db.runAsync(
    `
    UPDATE tasks
    SET day = 'Inbox',
        due_date = NULL
    WHERE id = ?;
    `,
    [id]
  );
}

/**
 * Kept for backward compatibility with older screen code.
 * A weekday now schedules the task for the next occurrence of that day.
 */
export async function moveTaskToDayById(
  id: number,
  day: string
): Promise<void> {
  const dueDate = getNextOccurrenceDateKey(day);

  if (!dueDate) {
    throw new Error(`Invalid weekday: ${day}`);
  }

  await scheduleTaskByDate(id, dueDate);
}
