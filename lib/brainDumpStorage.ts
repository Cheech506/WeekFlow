import { getDb, migrateDb } from './db';

export type StoredBrainDump = {
  id: number;
  body: string;
  archived: boolean;
  createdAt: string;
  archivedAt: string | null;
};

type BrainDumpRow = {
  id: number;
  body: string;
  archived: number;
  created_at: string;
  archived_at: string | null;
};

export async function getBrainDumps(): Promise<StoredBrainDump[]> {
  await migrateDb();

  const db = await getDb();

  const rows = await db.getAllAsync<BrainDumpRow>(`
    SELECT id, body, archived, created_at, archived_at
    FROM brain_dumps
    ORDER BY created_at DESC;
  `);

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    archived: row.archived === 1,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  }));
}

export async function insertBrainDump(
  body: string
): Promise<StoredBrainDump> {
  await migrateDb();

  const db = await getDb();
  const now = new Date().toISOString();
  const id = Date.now();
  const cleanBody = body.trim();

  await db.runAsync(
    `
    INSERT INTO brain_dumps (
      id,
      body,
      archived,
      created_at,
      archived_at
    )
    VALUES (?, ?, 0, ?, NULL);
    `,
    [id, cleanBody, now]
  );

  return {
    id,
    body: cleanBody,
    archived: false,
    createdAt: now,
    archivedAt: null,
  };
}

/**
 * Updates the text of an existing Brain Dump note without changing its
 * original creation date or archive state. Keeping this as a focused UPDATE
 * prevents an edit from behaving like a delete-and-recreate operation.
 */
export async function updateBrainDumpById(
  id: number,
  body: string
): Promise<string> {
  await migrateDb();

  const db = await getDb();
  const cleanBody = body.trim();

  if (!cleanBody) {
    throw new Error('A Brain Dump note cannot be empty.');
  }

  const result = await db.runAsync(
    `
    UPDATE brain_dumps
    SET body = ?
    WHERE id = ?;
    `,
    [cleanBody, id]
  );

  if (result.changes !== 1) {
    throw new Error('The Brain Dump note could not be found.');
  }

  return cleanBody;
}

export async function archiveBrainDumpById(id: number): Promise<string> {
  await migrateDb();

  const db = await getDb();
  const now = new Date().toISOString();

  await db.runAsync(
    `
    UPDATE brain_dumps
    SET archived = 1, archived_at = ?
    WHERE id = ?;
    `,
    [now, id]
  );

  return now;
}

export async function restoreBrainDumpById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();

  await db.runAsync(
    `
    UPDATE brain_dumps
    SET archived = 0, archived_at = NULL
    WHERE id = ?;
    `,
    [id]
  );
}

export async function deleteBrainDumpById(id: number): Promise<void> {
  await migrateDb();

  const db = await getDb();

  await db.runAsync(
    `
    DELETE FROM brain_dumps
    WHERE id = ?;
    `,
    [id]
  );
}

/**
 * Converts one active Brain Dump note into an Inbox task in a single
 * transaction.
 *
 * The older UI performed this as two separate operations: create the task,
 * then delete the note. If the second step failed, the same idea existed in
 * both places. Keeping both writes in one transaction means SQLite either
 * completes the entire conversion or leaves the original note untouched.
 */
export async function convertBrainDumpToTaskById(
  id: number
): Promise<void> {
  await migrateDb();

  const db = await getDb();
  const createdAt = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    const brainDump = await db.getFirstAsync<{
      body: string;
      archived: number;
    }>(
      `
      SELECT body, archived
      FROM brain_dumps
      WHERE id = ?;
      `,
      [id]
    );

    if (!brainDump) {
      throw new Error('The Brain Dump note could not be found.');
    }

    if (brainDump.archived === 1) {
      throw new Error(
        'Restore the Brain Dump note before turning it into a task.'
      );
    }

    const cleanBody = brainDump.body.trim();

    if (!cleanBody) {
      throw new Error(
        'An empty Brain Dump note cannot be turned into a task.'
      );
    }

    const insertResult = await db.runAsync(
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
      VALUES (?, 'Inbox', NULL, NULL, 0, NULL, 0, ?, NULL, NULL, NULL);
      `,
      [cleanBody, createdAt]
    );

    if (insertResult.changes !== 1) {
      throw new Error(
        'The Brain Dump task could not be created.'
      );
    }

    const deleteResult = await db.runAsync(
      `
      DELETE FROM brain_dumps
      WHERE id = ?
        AND archived = 0;
      `,
      [id]
    );

    if (deleteResult.changes !== 1) {
      throw new Error(
        'The Brain Dump note changed before conversion finished.'
      );
    }
  });
}
