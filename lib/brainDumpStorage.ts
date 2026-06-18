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