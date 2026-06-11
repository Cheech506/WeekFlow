import { getDb, migrateDb } from './db';

export type StoredTask = {
  id: number;
  title: string;
  day: string;
  completed: boolean;
  completedAt: string | null;
};

type TaskRow = {
  id: number;
  title: string;
  day: string;
  completed: number;
  completed_at: string | null;
};

export async function getTasks(): Promise<StoredTask[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<TaskRow>(`
    SELECT id, title, day, completed, completed_at
    FROM tasks
    ORDER BY created_at DESC;
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    day: row.day,
    completed: row.completed === 1,
    completedAt: row.completed_at,
  }));
}

export async function insertTask(title: string, day: string): Promise<StoredTask> {
  await migrateDb();

  const db = await getDb();
  const now = new Date().toISOString();
  const id = Date.now();

  await db.runAsync(
    `
    INSERT INTO tasks (id, title, day, completed, created_at, completed_at)
    VALUES (?, ?, ?, 0, ?, NULL);
    `,
    [id, title.trim(), day, now]
  );

  return {
    id,
    title: title.trim(),
    day,
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