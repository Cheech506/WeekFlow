import {
  normalizePlanningCycleDetails,
  type PlanningCycleDetails,
} from './cycleIdentityUtils';
import { createPlanningCycleRange } from './cycleUtils';
import { getDb, migrateDb } from './db';
import { validateGoalDateRange } from './goalUtils';
import {
  CYCLE_GOAL_OUTCOME_ACTIONS,
  getFirstWeekStartDate,
  normalizeCycleReviewReflection,
  normalizeFirstWeekCommitments,
  normalizeReplacementGoalTitle,
  type CycleGoalOutcomeAction,
  type CycleGoalOutcomeInput,
  type CycleReviewReflectionInput,
  type CycleReviewSnapshot,
  type NextCyclePlanInput,
} from './cycleReviewUtils';

export type StoredCycleReview = CycleReviewSnapshot & {
  id: number;
  cycleId: number;
  biggestAccomplishment: string | null;
  biggestChallenge: string | null;
  whatWorkedWell: string | null;
  whatChangeNextCycle: string | null;
  whatStopDoing: string | null;
  whatContinueDoing: string | null;
  whatLearned: string | null;
  nextCycleName: string | null;
  nextCyclePrimaryFocus: string | null;
  nextCycleTheme: string | null;
  nextCycleStartDate: string | null;
  nextCycleFirstWeekCommitments: string[];
  nextCycleId: number | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
};

export type StoredCycleGoalOutcome = {
  id: number;
  cycleReviewId: number;
  goalId: number | null;
  goalTitle: string;
  action: CycleGoalOutcomeAction;
  replacementTitle: string | null;
  destinationGoalId: number | null;
  createdAt: string;
  updatedAt: string;
};

type CycleReviewRow = {
  id: number;
  cycle_id: number;
  biggest_accomplishment: string | null;
  biggest_challenge: string | null;
  what_worked_well: string | null;
  what_change_next_cycle: string | null;
  what_stop_doing: string | null;
  what_continue_doing: string | null;
  what_learned: string | null;
  snapshot_goal_total: number;
  snapshot_goal_completed: number;
  snapshot_task_completed: number;
  snapshot_milestone_total: number;
  snapshot_milestone_completed: number;
  snapshot_weekly_reviews_completed: number;
  snapshot_longest_streak: number;
  snapshot_best_week_number: number | null;
  snapshot_best_week_count: number;
  snapshot_best_day: string | null;
  snapshot_best_day_count: number;
  snapshot_high_priority_completed: number;
  snapshot_recurring_completed: number;
  snapshot_rewards_unlocked: number;
  snapshot_brain_dumps_archived: number;
  next_cycle_name: string | null;
  next_cycle_primary_focus: string | null;
  next_cycle_theme: string | null;
  next_cycle_start_date: string | null;
  next_cycle_first_commitments: string;
  next_cycle_id: number | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
};

type CycleGoalOutcomeRow = {
  id: number;
  cycle_review_id: number;
  goal_id: number | null;
  goal_title: string;
  action: CycleGoalOutcomeAction;
  replacement_title: string | null;
  destination_goal_id: number | null;
  created_at: string;
  updated_at: string;
};

type GoalCopySourceRow = {
  id: number;
  title: string;
  reward: string | null;
  purpose: string | null;
  success_definition: string | null;
  notes: string | null;
};

const CYCLE_REVIEW_SELECT = `
  id,
  cycle_id,
  biggest_accomplishment,
  biggest_challenge,
  what_worked_well,
  what_change_next_cycle,
  what_stop_doing,
  what_continue_doing,
  what_learned,
  snapshot_goal_total,
  snapshot_goal_completed,
  snapshot_task_completed,
  snapshot_milestone_total,
  snapshot_milestone_completed,
  snapshot_weekly_reviews_completed,
  snapshot_longest_streak,
  snapshot_best_week_number,
  snapshot_best_week_count,
  snapshot_best_day,
  snapshot_best_day_count,
  snapshot_high_priority_completed,
  snapshot_recurring_completed,
  snapshot_rewards_unlocked,
  snapshot_brain_dumps_archived,
  next_cycle_name,
  next_cycle_primary_focus,
  next_cycle_theme,
  next_cycle_start_date,
  next_cycle_first_commitments,
  next_cycle_id,
  created_at,
  updated_at,
  finalized_at
`;

function parseStoredCommitments(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapCycleReviewRow(row: CycleReviewRow): StoredCycleReview {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    biggestAccomplishment: row.biggest_accomplishment,
    biggestChallenge: row.biggest_challenge,
    whatWorkedWell: row.what_worked_well,
    whatChangeNextCycle: row.what_change_next_cycle,
    whatStopDoing: row.what_stop_doing,
    whatContinueDoing: row.what_continue_doing,
    whatLearned: row.what_learned,
    goalTotal: row.snapshot_goal_total,
    goalCompleted: row.snapshot_goal_completed,
    taskCompleted: row.snapshot_task_completed,
    milestoneTotal: row.snapshot_milestone_total,
    milestoneCompleted: row.snapshot_milestone_completed,
    weeklyReviewsCompleted: row.snapshot_weekly_reviews_completed,
    longestStreak: row.snapshot_longest_streak,
    bestWeekNumber: row.snapshot_best_week_number,
    bestWeekCount: row.snapshot_best_week_count,
    bestDay: row.snapshot_best_day,
    bestDayCount: row.snapshot_best_day_count,
    highPriorityCompleted: row.snapshot_high_priority_completed,
    recurringCompleted: row.snapshot_recurring_completed,
    rewardsUnlocked: row.snapshot_rewards_unlocked,
    brainDumpsArchived: row.snapshot_brain_dumps_archived,
    nextCycleName: row.next_cycle_name,
    nextCyclePrimaryFocus: row.next_cycle_primary_focus,
    nextCycleTheme: row.next_cycle_theme,
    nextCycleStartDate: row.next_cycle_start_date,
    nextCycleFirstWeekCommitments: parseStoredCommitments(
      row.next_cycle_first_commitments
    ),
    nextCycleId: row.next_cycle_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
  };
}

function mapCycleGoalOutcomeRow(
  row: CycleGoalOutcomeRow
): StoredCycleGoalOutcome {
  return {
    id: row.id,
    cycleReviewId: row.cycle_review_id,
    goalId: row.goal_id,
    goalTitle: row.goal_title,
    action: row.action,
    replacementTitle: row.replacement_title,
    destinationGoalId: row.destination_goal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertSnapshot(snapshot: CycleReviewSnapshot) {
  const counts = [
    snapshot.goalTotal,
    snapshot.goalCompleted,
    snapshot.taskCompleted,
    snapshot.milestoneTotal,
    snapshot.milestoneCompleted,
    snapshot.weeklyReviewsCompleted,
    snapshot.longestStreak,
    snapshot.bestWeekCount,
    snapshot.bestDayCount,
    snapshot.highPriorityCompleted,
    snapshot.recurringCompleted,
    snapshot.rewardsUnlocked,
    snapshot.brainDumpsArchived,
  ];

  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('The cycle report contains an invalid saved count.');
  }

  if (
    snapshot.goalCompleted > snapshot.goalTotal ||
    snapshot.milestoneCompleted > snapshot.milestoneTotal ||
    snapshot.highPriorityCompleted > snapshot.taskCompleted ||
    snapshot.recurringCompleted > snapshot.taskCompleted ||
    snapshot.rewardsUnlocked > snapshot.goalCompleted ||
    snapshot.bestWeekCount > snapshot.taskCompleted ||
    snapshot.bestDayCount > snapshot.taskCompleted
  ) {
    throw new Error('The cycle report contains inconsistent saved analytics.');
  }

  if (
    snapshot.bestWeekNumber !== null &&
    (!Number.isSafeInteger(snapshot.bestWeekNumber) ||
      snapshot.bestWeekNumber < 1 ||
      snapshot.bestWeekNumber > 12)
  ) {
    throw new Error('The cycle report has an invalid best week.');
  }
}

function normalizeNextCyclePlan(input: NextCyclePlanInput) {
  const range = createPlanningCycleRange(input.startDate);
  const details = normalizePlanningCycleDetails({
    name: input.name,
    primaryFocus: input.primaryFocus,
    theme: input.theme,
  });

  return {
    ...details,
    startDate: range.startDate,
    endDate: range.endDate,
    firstWeekCommitments: normalizeFirstWeekCommitments(
      input.firstWeekCommitments
    ),
  };
}

function normalizeOutcomeInputs(inputs: CycleGoalOutcomeInput[]) {
  const seenGoalIds = new Set<number>();

  return inputs.map((input) => {
    if (!Number.isSafeInteger(input.goalId) || input.goalId <= 0) {
      throw new Error('The cycle review contains an invalid goal decision.');
    }

    if (seenGoalIds.has(input.goalId)) {
      throw new Error('Each unfinished goal can have only one cycle outcome.');
    }
    seenGoalIds.add(input.goalId);

    if (!CYCLE_GOAL_OUTCOME_ACTIONS.includes(input.action)) {
      throw new Error('The cycle review contains an invalid goal outcome.');
    }

    const replacementTitle = normalizeReplacementGoalTitle(
      input.replacementTitle
    );

    if (input.action === 'replace' && !replacementTitle) {
      throw new Error('Enter a title for the replacement goal.');
    }

    return {
      goalId: input.goalId,
      action: input.action,
      replacementTitle:
        input.action === 'replace' ? replacementTitle : null,
    };
  });
}

export async function getCycleReviews(): Promise<StoredCycleReview[]> {
  await migrateDb();
  const db = await getDb();
  const rows = await db.getAllAsync<CycleReviewRow>(`
    SELECT ${CYCLE_REVIEW_SELECT}
    FROM cycle_reviews
    ORDER BY created_at DESC, id DESC;
  `);

  return rows.map(mapCycleReviewRow);
}

export async function getCycleGoalOutcomes(): Promise<
  StoredCycleGoalOutcome[]
> {
  await migrateDb();
  const db = await getDb();
  const rows = await db.getAllAsync<CycleGoalOutcomeRow>(`
    SELECT
      id,
      cycle_review_id,
      goal_id,
      goal_title,
      action,
      replacement_title,
      destination_goal_id,
      created_at,
      updated_at
    FROM cycle_goal_outcomes
    ORDER BY id ASC;
  `);

  return rows.map(mapCycleGoalOutcomeRow);
}

async function upsertReviewAndOutcomes(
  db: Awaited<ReturnType<typeof getDb>>,
  cycleId: number,
  reflectionInput: CycleReviewReflectionInput,
  nextCycleInput: NextCyclePlanInput,
  snapshot: CycleReviewSnapshot,
  outcomeInputs: CycleGoalOutcomeInput[]
) {
  assertSnapshot(snapshot);
  const reflection = normalizeCycleReviewReflection(reflectionInput);
  const nextCycle = normalizeNextCyclePlan(nextCycleInput);
  const outcomes = normalizeOutcomeInputs(outcomeInputs);
  const now = new Date().toISOString();

  const existing = await db.getFirstAsync<CycleReviewRow>(
    `SELECT ${CYCLE_REVIEW_SELECT} FROM cycle_reviews WHERE cycle_id = ?;`,
    [cycleId]
  );

  if (existing?.finalized_at) {
    throw new Error('This cycle review has already been finalized.');
  }

  await db.runAsync(
    `
    INSERT INTO cycle_reviews (
      cycle_id,
      biggest_accomplishment,
      biggest_challenge,
      what_worked_well,
      what_change_next_cycle,
      what_stop_doing,
      what_continue_doing,
      what_learned,
      snapshot_goal_total,
      snapshot_goal_completed,
      snapshot_task_completed,
      snapshot_milestone_total,
      snapshot_milestone_completed,
      snapshot_weekly_reviews_completed,
      snapshot_longest_streak,
      snapshot_best_week_number,
      snapshot_best_week_count,
      snapshot_best_day,
      snapshot_best_day_count,
      snapshot_high_priority_completed,
      snapshot_recurring_completed,
      snapshot_rewards_unlocked,
      snapshot_brain_dumps_archived,
      next_cycle_name,
      next_cycle_primary_focus,
      next_cycle_theme,
      next_cycle_start_date,
      next_cycle_first_commitments,
      next_cycle_id,
      created_at,
      updated_at,
      finalized_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, NULL, ?, ?, NULL
    )
    ON CONFLICT(cycle_id) DO UPDATE SET
      biggest_accomplishment = excluded.biggest_accomplishment,
      biggest_challenge = excluded.biggest_challenge,
      what_worked_well = excluded.what_worked_well,
      what_change_next_cycle = excluded.what_change_next_cycle,
      what_stop_doing = excluded.what_stop_doing,
      what_continue_doing = excluded.what_continue_doing,
      what_learned = excluded.what_learned,
      snapshot_goal_total = excluded.snapshot_goal_total,
      snapshot_goal_completed = excluded.snapshot_goal_completed,
      snapshot_task_completed = excluded.snapshot_task_completed,
      snapshot_milestone_total = excluded.snapshot_milestone_total,
      snapshot_milestone_completed = excluded.snapshot_milestone_completed,
      snapshot_weekly_reviews_completed = excluded.snapshot_weekly_reviews_completed,
      snapshot_longest_streak = excluded.snapshot_longest_streak,
      snapshot_best_week_number = excluded.snapshot_best_week_number,
      snapshot_best_week_count = excluded.snapshot_best_week_count,
      snapshot_best_day = excluded.snapshot_best_day,
      snapshot_best_day_count = excluded.snapshot_best_day_count,
      snapshot_high_priority_completed = excluded.snapshot_high_priority_completed,
      snapshot_recurring_completed = excluded.snapshot_recurring_completed,
      snapshot_rewards_unlocked = excluded.snapshot_rewards_unlocked,
      snapshot_brain_dumps_archived = excluded.snapshot_brain_dumps_archived,
      next_cycle_name = excluded.next_cycle_name,
      next_cycle_primary_focus = excluded.next_cycle_primary_focus,
      next_cycle_theme = excluded.next_cycle_theme,
      next_cycle_start_date = excluded.next_cycle_start_date,
      next_cycle_first_commitments = excluded.next_cycle_first_commitments,
      updated_at = excluded.updated_at;
    `,
    [
      cycleId,
      reflection.biggestAccomplishment,
      reflection.biggestChallenge,
      reflection.whatWorkedWell,
      reflection.whatChangeNextCycle,
      reflection.whatStopDoing,
      reflection.whatContinueDoing,
      reflection.whatLearned,
      snapshot.goalTotal,
      snapshot.goalCompleted,
      snapshot.taskCompleted,
      snapshot.milestoneTotal,
      snapshot.milestoneCompleted,
      snapshot.weeklyReviewsCompleted,
      snapshot.longestStreak,
      snapshot.bestWeekNumber,
      snapshot.bestWeekCount,
      snapshot.bestDay,
      snapshot.bestDayCount,
      snapshot.highPriorityCompleted,
      snapshot.recurringCompleted,
      snapshot.rewardsUnlocked,
      snapshot.brainDumpsArchived,
      nextCycle.name,
      nextCycle.primaryFocus,
      nextCycle.theme,
      nextCycle.startDate,
      JSON.stringify(nextCycle.firstWeekCommitments),
      existing?.created_at ?? now,
      now,
    ]
  );

  const review = await db.getFirstAsync<CycleReviewRow>(
    `SELECT ${CYCLE_REVIEW_SELECT} FROM cycle_reviews WHERE cycle_id = ?;`,
    [cycleId]
  );

  if (!review) {
    throw new Error('The cycle review could not be saved.');
  }

  const goalRows = await db.getAllAsync<{
    id: number;
    title: string;
    completed: number;
  }>(
    `SELECT id, title, completed FROM goals WHERE cycle_id = ?;`,
    [cycleId]
  );
  const goalById = new Map(goalRows.map((goal) => [goal.id, goal]));

  for (const outcome of outcomes) {
    const goal = goalById.get(outcome.goalId);
    if (!goal) {
      throw new Error('One of the selected goals does not belong to this cycle.');
    }
    if (goal.completed === 1) {
      throw new Error('Completed goals do not need an unfinished-goal outcome.');
    }
  }

  await db.runAsync(
    'DELETE FROM cycle_goal_outcomes WHERE cycle_review_id = ?;',
    [review.id]
  );

  for (const outcome of outcomes) {
    const goal = goalById.get(outcome.goalId)!;
    await db.runAsync(
      `
      INSERT INTO cycle_goal_outcomes (
        cycle_review_id,
        goal_id,
        goal_title,
        action,
        replacement_title,
        destination_goal_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?);
      `,
      [
        review.id,
        outcome.goalId,
        goal.title,
        outcome.action,
        outcome.replacementTitle,
        now,
        now,
      ]
    );
  }

  return {
    review: mapCycleReviewRow(review),
    outcomes,
    nextCycle,
  };
}

export async function saveCycleReviewDraft(input: {
  cycleId: number;
  reflection?: CycleReviewReflectionInput;
  nextCycle: NextCyclePlanInput;
  snapshot: CycleReviewSnapshot;
  outcomes: CycleGoalOutcomeInput[];
}) {
  await migrateDb();
  const db = await getDb();
  let savedResult: Awaited<ReturnType<typeof upsertReviewAndOutcomes>> | null = null;

  /*
   * Expo SQLite's transaction callback must resolve to void. Capture the
   * saved review outside the callback so this function can still return it
   * after the transaction commits successfully.
   */
  await db.withTransactionAsync(async () => {
    savedResult = await upsertReviewAndOutcomes(
      db,
      input.cycleId,
      input.reflection ?? {},
      input.nextCycle,
      input.snapshot,
      input.outcomes
    );
  });

  if (!savedResult) {
    throw new Error('The cycle review draft could not be saved.');
  }

  return savedResult;
}

async function createGoalCopy(
  db: Awaited<ReturnType<typeof getDb>>,
  sourceGoalId: number,
  destinationCycleId: number,
  goalId: number,
  startDateIso: string,
  endDateIso: string,
  now: string
) {
  const source = await db.getFirstAsync<GoalCopySourceRow>(
    `
    SELECT id, title, reward, purpose, success_definition, notes
    FROM goals
    WHERE id = ?;
    `,
    [sourceGoalId]
  );

  if (!source) {
    throw new Error('The goal selected for carry-forward could not be found.');
  }

  await db.runAsync(
    `
    INSERT INTO goals (
      id,
      cycle_id,
      title,
      completed,
      created_at,
      completed_at,
      start_date,
      end_date,
      reward,
      purpose,
      success_definition,
      notes,
      completion_what_helped,
      completion_hardest_part,
      completion_learned,
      completion_do_differently,
      completion_task_total,
      completion_task_completed,
      completion_milestone_total,
      completion_milestone_completed,
      completion_high_priority_completed
    )
    VALUES (?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `,
    [
      goalId,
      destinationCycleId,
      source.title,
      now,
      startDateIso,
      endDateIso,
      source.reward,
      source.purpose,
      source.success_definition,
      source.notes,
    ]
  );

  const milestones = await db.getAllAsync<{
    title: string;
    notes: string | null;
    target_date: string | null;
    completed: number;
    created_at: string;
    completed_at: string | null;
  }>(
    `
    SELECT title, notes, target_date, completed, created_at, completed_at
    FROM goal_milestones
    WHERE goal_id = ?
    ORDER BY id ASC;
    `,
    [sourceGoalId]
  );

  for (const milestone of milestones) {
    await db.runAsync(
      `
      INSERT INTO goal_milestones (
        goal_id,
        title,
        notes,
        target_date,
        completed,
        created_at,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?);
      `,
      [
        goalId,
        milestone.title,
        milestone.notes,
        milestone.target_date,
        milestone.completed,
        milestone.created_at,
        milestone.completed_at,
      ]
    );
  }
}

async function createReplacementGoal(
  db: Awaited<ReturnType<typeof getDb>>,
  title: string,
  destinationCycleId: number,
  goalId: number,
  startDateIso: string,
  endDateIso: string,
  now: string
) {
  await db.runAsync(
    `
    INSERT INTO goals (
      id,
      cycle_id,
      title,
      completed,
      created_at,
      completed_at,
      start_date,
      end_date,
      reward,
      purpose,
      success_definition,
      notes,
      completion_what_helped,
      completion_hardest_part,
      completion_learned,
      completion_do_differently,
      completion_task_total,
      completion_task_completed,
      completion_milestone_total,
      completion_milestone_completed,
      completion_high_priority_completed
    )
    VALUES (?, ?, ?, 0, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `,
    [goalId, destinationCycleId, title, now, startDateIso, endDateIso]
  );
}

async function markGoalCompleteForReview(
  db: Awaited<ReturnType<typeof getDb>>,
  goalId: number,
  now: string
) {
  const taskCounts = await db.getFirstAsync<{
    total: number;
    completed: number;
    high_priority_completed: number;
  }>(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN completed = 1 AND priority = 2 THEN 1 ELSE 0 END) AS high_priority_completed
    FROM tasks
    WHERE goal_id = ?;
    `,
    [goalId]
  );
  const milestoneCounts = await db.getFirstAsync<{
    total: number;
    completed: number;
  }>(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
    FROM goal_milestones
    WHERE goal_id = ?;
    `,
    [goalId]
  );

  await db.runAsync(
    `
    UPDATE goals
    SET completed = 1,
        completed_at = ?,
        completion_task_total = ?,
        completion_task_completed = ?,
        completion_milestone_total = ?,
        completion_milestone_completed = ?,
        completion_high_priority_completed = ?
    WHERE id = ?;
    `,
    [
      now,
      taskCounts?.total ?? 0,
      taskCounts?.completed ?? 0,
      milestoneCounts?.total ?? 0,
      milestoneCounts?.completed ?? 0,
      taskCounts?.high_priority_completed ?? 0,
      goalId,
    ]
  );
}

export async function finalizeCycleReviewAndStartNextCycle(input: {
  cycleId: number;
  reflection?: CycleReviewReflectionInput;
  nextCycle: NextCyclePlanInput;
  snapshot: CycleReviewSnapshot;
  outcomes: CycleGoalOutcomeInput[];
}) {
  await migrateDb();
  const db = await getDb();
  let finalizedResult: { nextCycleId: number; reviewId: number } | null = null;

  /*
   * Expo SQLite transactions return void. Store the IDs produced inside the
   * transaction and return them only after the transaction has committed.
   */
  await db.withTransactionAsync(async () => {
    const currentCycle = await db.getFirstAsync<{
      id: number;
      end_date: string;
      active: number;
    }>(
      'SELECT id, end_date, active FROM planning_cycles WHERE id = ?;',
      [input.cycleId]
    );

    if (!currentCycle || currentCycle.active !== 1) {
      throw new Error('Only the current cycle can be finalized.');
    }

    const saved = await upsertReviewAndOutcomes(
      db,
      input.cycleId,
      input.reflection ?? {},
      input.nextCycle,
      input.snapshot,
      input.outcomes
    );

    if (saved.nextCycle.startDate <= currentCycle.end_date) {
      throw new Error('The next cycle must begin after the completed cycle ends.');
    }

    const unfinishedGoals = await db.getAllAsync<{
      id: number;
      reward: string | null;
    }>(
      'SELECT id, reward FROM goals WHERE cycle_id = ? AND completed = 0;',
      [input.cycleId]
    );
    const outcomeByGoal = new Map(
      saved.outcomes.map((outcome) => [outcome.goalId, outcome])
    );

    if (
      unfinishedGoals.some((goal) => !outcomeByGoal.has(goal.id)) ||
      saved.outcomes.length !== unfinishedGoals.length
    ) {
      throw new Error('Choose an outcome for every unfinished goal.');
    }

    const now = new Date().toISOString();

    /*
     * The database allows only one active cycle. Close the reviewed cycle
     * before inserting its successor so the unique active-cycle index remains
     * valid throughout the transaction.
     */
    await db.runAsync(
      `
      UPDATE planning_cycles
      SET active = 0,
          completed_at = COALESCE(completed_at, ?)
      WHERE id = ?;
      `,
      [now, input.cycleId]
    );

    const nextCycleResult = await db.runAsync(
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
        saved.nextCycle.name,
        saved.nextCycle.primaryFocus,
        saved.nextCycle.theme,
        saved.nextCycle.startDate,
        saved.nextCycle.endDate,
        now,
      ]
    );
    const nextCycleId = Number(nextCycleResult.lastInsertRowId);

    const firstWeekStart = getFirstWeekStartDate(saved.nextCycle.startDate);
    for (const title of saved.nextCycle.firstWeekCommitments) {
      await db.runAsync(
        `
        INSERT INTO weekly_commitments (
          week_start,
          cycle_id,
          task_id,
          title,
          completed,
          created_at,
          completed_at
        )
        VALUES (?, ?, NULL, ?, 0, ?, NULL);
        `,
        [firstWeekStart, nextCycleId, title, now]
      );
    }

    const goalDateRange = validateGoalDateRange(
      saved.nextCycle.startDate,
      saved.nextCycle.endDate
    );
    const maxGoalRow = await db.getFirstAsync<{ max_id: number | null }>(
      'SELECT MAX(id) AS max_id FROM goals;'
    );
    let nextGoalId = Math.max(
      Date.now(),
      (maxGoalRow?.max_id ?? 0) + 1
    );

    const outcomeRows = await db.getAllAsync<CycleGoalOutcomeRow>(
      `
      SELECT
        id,
        cycle_review_id,
        goal_id,
        goal_title,
        action,
        replacement_title,
        destination_goal_id,
        created_at,
        updated_at
      FROM cycle_goal_outcomes
      WHERE cycle_review_id = ?
      ORDER BY id ASC;
      `,
      [saved.review.id]
    );

    for (const outcomeRow of outcomeRows) {
      if (outcomeRow.goal_id === null) {
        throw new Error(
          `The saved outcome for “${outcomeRow.goal_title}” is missing its goal.`
        );
      }

      const sourceGoalId = outcomeRow.goal_id;
      let destinationGoalId: number | null = null;

      if (outcomeRow.action === 'complete') {
        await markGoalCompleteForReview(db, sourceGoalId, now);
      } else if (outcomeRow.action === 'carryForward') {
        destinationGoalId = nextGoalId++;
        await createGoalCopy(
          db,
          sourceGoalId,
          nextCycleId,
          destinationGoalId,
          goalDateRange.startDateIso,
          goalDateRange.endDateIso,
          now
        );
      } else if (outcomeRow.action === 'replace') {
        destinationGoalId = nextGoalId++;
        await createReplacementGoal(
          db,
          outcomeRow.replacement_title!,
          nextCycleId,
          destinationGoalId,
          goalDateRange.startDateIso,
          goalDateRange.endDateIso,
          now
        );
      }

      await db.runAsync(
        `
        UPDATE cycle_goal_outcomes
        SET destination_goal_id = ?, updated_at = ?
        WHERE id = ?;
        `,
        [destinationGoalId, now, outcomeRow.id]
      );
    }

    const completeOutcomes = outcomeRows.filter(
      (outcome) => outcome.action === 'complete'
    ).length;
    const adjustedGoalCompleted = Math.min(
      input.snapshot.goalTotal,
      input.snapshot.goalCompleted + completeOutcomes
    );
    const completedRewardOutcomes = unfinishedGoals.filter(
      (goal) =>
        Boolean(goal.reward) &&
        outcomeByGoal.get(goal.id)?.action === 'complete'
    ).length;
    const adjustedRewardsUnlocked = Math.min(
      adjustedGoalCompleted,
      input.snapshot.rewardsUnlocked + completedRewardOutcomes
    );

    await db.runAsync(
      `
      UPDATE cycle_reviews
      SET snapshot_goal_completed = ?,
          snapshot_rewards_unlocked = ?,
          next_cycle_id = ?,
          updated_at = ?,
          finalized_at = ?
      WHERE id = ?;
      `,
      [
        adjustedGoalCompleted,
        adjustedRewardsUnlocked,
        nextCycleId,
        now,
        now,
        saved.review.id,
      ]
    );

    finalizedResult = {
      nextCycleId,
      reviewId: saved.review.id,
    };
  });

  if (!finalizedResult) {
    throw new Error('The cycle review could not be finalized.');
  }

  return finalizedResult;
}
