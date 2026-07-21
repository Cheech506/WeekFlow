import { getDb, migrateDb } from './db';

export type TaskTemplate = {
  id: number;
  title: string;
  notes: string | null;
  priority: number;
  goalId: number | null;
  createdAt: string;
  updatedAt: string;
};

type TaskTemplateRow = {
  id: number;
  title: string;
  notes: string | null;
  priority: number;
  goal_id: number | null;
  created_at: string;
  updated_at: string;
};

function mapTaskTemplateRow(row: TaskTemplateRow): TaskTemplate {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    goalId: row.goal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTemplateInput(
  title: string,
  notes: string = '',
  priority: number = 0,
  goalId: number | null = null
) {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error('A task template needs a title.');
  }

  if (!Number.isInteger(priority) || priority < 0 || priority > 2) {
    throw new Error('Template priority must be Low, Medium, or High.');
  }

  return {
    title: trimmedTitle,
    notes: notes.trim() || null,
    priority,
    goalId,
  };
}

export async function getTaskTemplates(): Promise<TaskTemplate[]> {
  await migrateDb();

  const db = await getDb();
  const rows = await db.getAllAsync<TaskTemplateRow>(`
    SELECT
      id,
      title,
      notes,
      priority,
      goal_id,
      created_at,
      updated_at
    FROM task_templates
    ORDER BY updated_at DESC, id DESC;
  `);

  return rows.map(mapTaskTemplateRow);
}

export async function insertTaskTemplate(
  title: string,
  notes: string = '',
  priority: number = 0,
  goalId: number | null = null
): Promise<TaskTemplate> {
  await migrateDb();

  const input = normalizeTemplateInput(
    title,
    notes,
    priority,
    goalId
  );
  const now = new Date().toISOString();
  const db = await getDb();

  const result = await db.runAsync(
    `
    INSERT INTO task_templates (
      title,
      notes,
      priority,
      goal_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?);
    `,
    [
      input.title,
      input.notes,
      input.priority,
      input.goalId,
      now,
      now,
    ]
  );

  return {
    id: Number(result.lastInsertRowId),
    title: input.title,
    notes: input.notes,
    priority: input.priority,
    goalId: input.goalId,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTaskTemplateById(
  id: number,
  title: string,
  notes: string = '',
  priority: number = 0,
  goalId: number | null = null
): Promise<TaskTemplate> {
  await migrateDb();

  const input = normalizeTemplateInput(
    title,
    notes,
    priority,
    goalId
  );
  const db = await getDb();
  const existingTemplate = await db.getFirstAsync<TaskTemplateRow>(
    `
    SELECT
      id,
      title,
      notes,
      priority,
      goal_id,
      created_at,
      updated_at
    FROM task_templates
    WHERE id = ?;
    `,
    [id]
  );

  if (!existingTemplate) {
    throw new Error('The task template could not be found.');
  }

  const updatedAt = new Date().toISOString();

  await db.runAsync(
    `
    UPDATE task_templates
    SET
      title = ?,
      notes = ?,
      priority = ?,
      goal_id = ?,
      updated_at = ?
    WHERE id = ?;
    `,
    [
      input.title,
      input.notes,
      input.priority,
      input.goalId,
      updatedAt,
      id,
    ]
  );

  return {
    id,
    title: input.title,
    notes: input.notes,
    priority: input.priority,
    goalId: input.goalId,
    createdAt: existingTemplate.created_at,
    updatedAt,
  };
}

export async function deleteTaskTemplateById(
  id: number
): Promise<void> {
  await migrateDb();

  const db = await getDb();
  await db.runAsync(
    `
    DELETE FROM task_templates
    WHERE id = ?;
    `,
    [id]
  );
}
