import { getDb, migrateDb } from './db';

export type Task = {
  id: number;
  title: string;
  day: string;
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
  goalId: number | null = null
): Promise<void> {
  await migrateDb();

  const db = await getDb();
  const createdAt = new Date().toISOString();

  await db.runAsync(
    `
    INSERT INTO tasks (
      title,
      day,
      notes,
      priority,
      goal_id,
      completed,
      created_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, NULL);
    `,
    [
      title.trim(),
      day,
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

export async function moveTaskToDayById(
  id: number,
  day: string
): Promise<void> {
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