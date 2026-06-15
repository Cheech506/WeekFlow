import { getDb, migrateDb } from './db';

export type StoredTask = {
  id: number;
  title: string;
  day: string;
  notes: string | null;
  priority: number;
  goalId: number | null;
  completed: boolean;
  completedAt: string | null;
};

type TaskRow = {
  id: number;
  title: string;
  day: string;
  notes: string | null;
  priority: number;
  goal_id: number | null;
  completed: number;
  completed_at: string | null;
};

export async function getTasks(): Promise<StoredTask[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<TaskRow>(`
    SELECT id, title, day, notes, priority, goal_id, completed, completed_at
    FROM tasks
    ORDER BY id DESC;
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    day: row.day,
    notes: row.notes,
    priority: row.priority ?? 0,
    goalId: row.goal_id ?? null,
    completed: row.completed === 1,
    completedAt: row.completed_at,
  }));
}

export async function insertTask(
  title: string,
  day: string,
  notes: string | null = null,
  priority: number = 0,
  goalId: number | null = null
): Promise<StoredTask> {
  await migrateDb();

  const db = await getDb();
  const now = new Date().toISOString();
  const id = Date.now();

  const cleanTitle = title.trim();
  const cleanNotes = notes?.trim() ? notes.trim() : null;

  await db.runAsync(
    `
    INSERT INTO tasks (
      id,
      title,
      day,
      notes,
      priority,
      goal_id,
      completed,
      created_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL);
    `,
    [id, cleanTitle, day, cleanNotes, priority, goalId, now]
  );

  return {
    id,
    title: cleanTitle,
    day,
    notes: cleanNotes,
    priority,
    goalId,
    completed: false,
    completedAt: null,
  };
}

export async function markTaskComplete(id: number): Promise<string> {
  await migrateDb();

  const db = await getDb();
  const now = new Date().toISOString();

  await db.runAsync(
    `
    UPDATE tasks
    SET completed = 1, completed_at = ?
    WHERE id = ?;
    `,
    [now, id]
  );

  return now;
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

export async function updateTaskDayById(id: number, day: string): Promise<void> {
  await migrateDb();

  const db = await getDb();

  await db.runAsync(
    `
    UPDATE tasks
    SET day = ?
    WHERE id = ?;
    `,
    [day, id]
  );
}