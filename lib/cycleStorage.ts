import { getDb, migrateDb } from './db';
import {
  normalizePlanningCycleDetails,
  type PlanningCycleDetails,
} from './cycleIdentityUtils';
import { createPlanningCycleRange } from './cycleUtils';

export type PlanningCycle = {
  id: number;
  name: string | null;
  primaryFocus: string | null;
  theme: string | null;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
  completedAt: string | null;
};

type PlanningCycleRow = {
  id: number;
  name: string | null;
  primary_focus: string | null;
  theme: string | null;
  start_date: string;
  end_date: string;
  active: number;
  created_at: string;
  completed_at: string | null;
};

const PLANNING_CYCLE_SELECT = `
  id,
  name,
  primary_focus,
  theme,
  start_date,
  end_date,
  active,
  created_at,
  completed_at
`;

function mapPlanningCycleRow(row: PlanningCycleRow): PlanningCycle {
  return {
    id: row.id,
    name: row.name,
    primaryFocus: row.primary_focus,
    theme: row.theme,
    startDate: row.start_date,
    endDate: row.end_date,
    active: row.active === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function getPlanningCycles(): Promise<PlanningCycle[]> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<PlanningCycleRow>(`
    SELECT ${PLANNING_CYCLE_SELECT}
    FROM planning_cycles
    ORDER BY start_date DESC, id DESC;
  `);

  return rows.map(mapPlanningCycleRow);
}

export async function getActivePlanningCycle(): Promise<PlanningCycle | null> {
  await migrateDb();
  const db = await getDb();

  const row = await db.getFirstAsync<PlanningCycleRow>(`
    SELECT ${PLANNING_CYCLE_SELECT}
    FROM planning_cycles
    WHERE active = 1
    ORDER BY id DESC
    LIMIT 1;
  `);

  return row ? mapPlanningCycleRow(row) : null;
}

export async function startPlanningCycle(
  startDateKey: string,
  details: PlanningCycleDetails = {}
): Promise<PlanningCycle> {
  await migrateDb();
  const db = await getDb();
  const range = createPlanningCycleRange(startDateKey);
  const normalizedDetails = normalizePlanningCycleDetails(details);
  const now = new Date().toISOString();
  let insertedId = 0;
  let shouldClaimLegacyGoals = false;

  /*
   * Starting a new cycle closes the previously selected cycle and inserts the
   * new one atomically. Historical cycle rows remain available as read-only
   * goal folders for later reports instead of being overwritten.
   */
  await db.withTransactionAsync(async () => {
    const countRow = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM planning_cycles;'
    );
    shouldClaimLegacyGoals = (countRow?.count ?? 0) === 0;

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
        name,
        primary_focus,
        theme,
        start_date,
        end_date,
        active,
        created_at,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, NULL);
      `,
      [
        normalizedDetails.name,
        normalizedDetails.primaryFocus,
        normalizedDetails.theme,
        range.startDate,
        range.endDate,
        now,
      ]
    );

    insertedId = Number(result.lastInsertRowId);

    /*
     * Active goals created before a user's first cycle existed are claimed by
     * that first folder so none disappear when cycle-based filtering turns on.
     * Older completed goals are claimed only when their dates overlap the cycle.
     * Later cycles deliberately do not auto-carry goals; WF-027 will make that
     * an explicit review choice.
     */
    if (shouldClaimLegacyGoals) {
      await db.runAsync(
        `
        UPDATE goals
        SET cycle_id = ?
        WHERE cycle_id IS NULL
          AND (
            completed = 0
            OR (
              substr(start_date, 1, 10) <= ?
              AND substr(end_date, 1, 10) >= ?
            )
          );
        `,
        [insertedId, range.endDate, range.startDate]
      );
    }
  });

  return {
    id: insertedId,
    ...normalizedDetails,
    startDate: range.startDate,
    endDate: range.endDate,
    active: true,
    createdAt: now,
    completedAt: null,
  };
}

export async function updatePlanningCycle(
  id: number,
  startDateKey: string,
  details: PlanningCycleDetails = {}
): Promise<PlanningCycle> {
  await migrateDb();
  const db = await getDb();
  const range = createPlanningCycleRange(startDateKey);
  const normalizedDetails = normalizePlanningCycleDetails(details);

  const existing = await db.getFirstAsync<PlanningCycleRow>(
    `
    SELECT ${PLANNING_CYCLE_SELECT}
    FROM planning_cycles
    WHERE id = ?;
    `,
    [id]
  );

  if (!existing) {
    throw new Error('The planning cycle could not be found.');
  }

  if (existing.active !== 1) {
    throw new Error('Only the current planning cycle can be edited.');
  }

  await db.runAsync(
    `
    UPDATE planning_cycles
    SET
      name = ?,
      primary_focus = ?,
      theme = ?,
      start_date = ?,
      end_date = ?
    WHERE id = ?;
    `,
    [
      normalizedDetails.name,
      normalizedDetails.primaryFocus,
      normalizedDetails.theme,
      range.startDate,
      range.endDate,
      id,
    ]
  );

  return {
    ...mapPlanningCycleRow(existing),
    ...normalizedDetails,
    startDate: range.startDate,
    endDate: range.endDate,
  };
}

export async function updatePlanningCycleStartDate(
  id: number,
  startDateKey: string
): Promise<PlanningCycle> {
  const cycles = await getPlanningCycles();
  const existing = cycles.find((cycle) => cycle.id === id);

  return updatePlanningCycle(id, startDateKey, {
    name: existing?.name ?? null,
    primaryFocus: existing?.primaryFocus ?? null,
    theme: existing?.theme ?? null,
  });
}
