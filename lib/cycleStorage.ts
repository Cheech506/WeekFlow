import { getDb, migrateDb } from './db';
import { createPlanningCycleRange } from './cycleUtils';

export type PlanningCycle = {
  id: number;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
  completedAt: string | null;
};

type PlanningCycleRow = {
  id: number;
  start_date: string;
  end_date: string;
  active: number;
  created_at: string;
  completed_at: string | null;
};

function mapPlanningCycleRow(
  row: PlanningCycleRow
): PlanningCycle {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    active: row.active === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function getPlanningCycles(): Promise<
  PlanningCycle[]
> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<PlanningCycleRow>(`
    SELECT
      id,
      start_date,
      end_date,
      active,
      created_at,
      completed_at
    FROM planning_cycles
    ORDER BY start_date DESC, id DESC;
  `);

  return rows.map(mapPlanningCycleRow);
}

export async function getActivePlanningCycle(): Promise<
  PlanningCycle | null
> {
  await migrateDb();
  const db = await getDb();

  const row = await db.getFirstAsync<PlanningCycleRow>(`
    SELECT
      id,
      start_date,
      end_date,
      active,
      created_at,
      completed_at
    FROM planning_cycles
    WHERE active = 1
    ORDER BY id DESC
    LIMIT 1;
  `);

  return row ? mapPlanningCycleRow(row) : null;
}

export async function startPlanningCycle(
  startDateKey: string
): Promise<PlanningCycle> {
  await migrateDb();
  const db = await getDb();
  const range = createPlanningCycleRange(startDateKey);
  const now = new Date().toISOString();
  let insertedId = 0;

  /*
   * Starting a new cycle closes the previously selected cycle and inserts the
   * new one atomically. Historical cycle rows remain available for backups and
   * future reporting instead of being overwritten.
   */
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
      UPDATE planning_cycles
      SET active = 0,
          completed_at = COALESCE(completed_at, ?)
      WHERE active = 1;
      `,
      [now]
    );

    const result = await db.runAsync(
      `
      INSERT INTO planning_cycles (
        start_date,
        end_date,
        active,
        created_at,
        completed_at
      )
      VALUES (?, ?, 1, ?, NULL);
      `,
      [range.startDate, range.endDate, now]
    );

    insertedId = Number(result.lastInsertRowId);
  });

  return {
    id: insertedId,
    startDate: range.startDate,
    endDate: range.endDate,
    active: true,
    createdAt: now,
    completedAt: null,
  };
}

export async function updatePlanningCycleStartDate(
  id: number,
  startDateKey: string
): Promise<PlanningCycle> {
  await migrateDb();
  const db = await getDb();
  const range = createPlanningCycleRange(startDateKey);

  const existing = await db.getFirstAsync<PlanningCycleRow>(
    `
    SELECT
      id,
      start_date,
      end_date,
      active,
      created_at,
      completed_at
    FROM planning_cycles
    WHERE id = ?;
    `,
    [id]
  );

  if (!existing) {
    throw new Error('The planning cycle could not be found.');
  }

  if (existing.active !== 1) {
    throw new Error(
      'Only the current planning cycle can be edited.'
    );
  }

  await db.runAsync(
    `
    UPDATE planning_cycles
    SET start_date = ?, end_date = ?
    WHERE id = ?;
    `,
    [range.startDate, range.endDate, id]
  );

  return {
    ...mapPlanningCycleRow(existing),
    startDate: range.startDate,
    endDate: range.endDate,
  };
}
