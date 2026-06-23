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
  recurringRuleId: number | null;
  recurrenceOccurrenceDate: string | null;
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
  recurring_rule_id: number | null;
  recurrence_occurrence_date: string | null;
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
    recurringRuleId: row.recurring_rule_id,
    recurrenceOccurrenceDate: row.recurrence_occurrence_date,
  };
}

export async function getTasks(): Promise<Task[]> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<TaskRow>(`
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
      completed_at,
      recurring_rule_id,
      recurrence_occurrence_date
    FROM tasks
    ORDER BY created_at DESC;
  `);

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
      completed_at,
      recurring_rule_id,
      recurrence_occurrence_date
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL);
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

  /*
   * Editing a recurring occurrence changes only that occurrence.
   */
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

  await db.runAsync(
    `
    UPDATE tasks
    SET completed = 1,
        completed_at = ?
    WHERE id = ?;
    `,
    [new Date().toISOString(), id]
  );
}

/**
 * Deleting one generated task records an exception first. The generator
 * therefore cannot bring that same rule/date occurrence back.
 */
export async function deleteTaskById(id: number): Promise<void> {
  await migrateDb();
  const db = await getDb();

  const task = await db.getFirstAsync<{
    recurring_rule_id: number | null;
    recurrence_occurrence_date: string | null;
  }>(
    `
    SELECT recurring_rule_id, recurrence_occurrence_date
    FROM tasks
    WHERE id = ?;
    `,
    [id]
  );

  await db.withTransactionAsync(async () => {
    if (
      task?.recurring_rule_id !== null &&
      task?.recurring_rule_id !== undefined &&
      task.recurrence_occurrence_date
    ) {
      await db.runAsync(
        `
        INSERT OR IGNORE INTO recurring_occurrence_exceptions (
          recurring_rule_id,
          occurrence_date,
          created_at
        )
        VALUES (?, ?, ?);
        `,
        [
          task.recurring_rule_id,
          task.recurrence_occurrence_date,
          new Date().toISOString(),
        ]
      );
    }

    await db.runAsync(
      `
      DELETE FROM tasks
      WHERE id = ?;
      `,
      [id]
    );
  });
}

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

  /*
   * The original occurrence date stays unchanged when the task moves.
   */
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

export async function moveTaskToInboxById(
  id: number
): Promise<void> {
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
