import { getDb, migrateDb } from './db';

export type StoredTask = {
  id: number;
  title: string;
  day: string;
  completed: boolean;
};

type TaskRow = {
  id: number;
  title: string;
  day: string;
  completed: number;
};

export async function getTasks(): Promise<StoredTask[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<TaskRow>(`
    SELECT id, title, day, completed
    FROM tasks
    ORDER BY created_at DESC;
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    day: row.day,
    completed: row.completed === 1,
  }));
}

export async function insertTask(title: string, day: string): Promise<StoredTask> {
  await migrateDb();

  const db = await getDb();
  const now = new Date().toISOString();
  const id = Date.now();

  await db.runAsync(
    `
    INSERT INTO tasks (id, title, day, completed, created_at)
    VALUES (?, ?, ?, 0, ?);
    `,
    [id, title.trim(), day, now]
  );

  return {
    id,
    title: title.trim(),
    day,
    completed: false,
  };
}

export async function markTaskComplete(id: number): Promise<void> {
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
}