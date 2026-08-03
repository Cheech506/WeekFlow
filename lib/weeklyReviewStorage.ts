import {
  addDays,
  getLocalDateKey,
  parseLocalDateKey,
} from './dateUtils';
import { getDb, migrateDb } from './db';
import type { WeeklyReviewSnapshot } from './weeklyReview';

export const MAX_WEEKLY_COMMITMENT_TITLE_LENGTH = 180;
export const MAX_WEEKLY_REVIEW_RESPONSE_LENGTH = 2000;

export type WeeklyReviewReflectionInput = {
  whatWentWell?: string;
  whatCausedProblems?: string;
  whatLearned?: string;
  whatChangeNextWeek?: string;
  nextWeekFocus?: string;
};

export type StoredWeeklyReview = WeeklyReviewSnapshot & {
  id: number;
  weekStart: string;
  cycleId: number | null;
  whatWentWell: string | null;
  whatCausedProblems: string | null;
  whatLearned: string | null;
  whatChangeNextWeek: string | null;
  nextWeekFocus: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string;
};

export type WeeklyCommitment = {
  id: number;
  weekStart: string;
  cycleId: number | null;
  taskId: number | null;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
};

export const WEEKLY_TASK_DECISION_ACTIONS = [
  'nextWeek',
  'inbox',
  'reschedule',
  'keep',
  'delete',
] as const;

export type WeeklyTaskDecisionAction =
  (typeof WEEKLY_TASK_DECISION_ACTIONS)[number];

export type WeeklyTaskDecision = {
  id: number;
  weekStart: string;
  taskId: number | null;
  taskTitle: string;
  originalDueDate: string;
  action: WeeklyTaskDecisionAction;
  resolvedDueDate: string | null;
  recurringRuleId: number | null;
  recurrenceOccurrenceDate: string | null;
  decidedAt: string;
};

type WeeklyReviewRow = {
  id: number;
  week_start: string;
  cycle_id: number | null;
  what_went_well: string | null;
  what_caused_problems: string | null;
  what_learned: string | null;
  what_change_next_week: string | null;
  next_week_focus: string | null;
  snapshot_completed_count: number;
  snapshot_unfinished_count: number;
  snapshot_overdue_count: number;
  snapshot_completion_rate: number;
  snapshot_goals_progressed_count: number;
  snapshot_best_day: string | null;
  snapshot_best_day_count: number;
  snapshot_archived_brain_dump_count: number;
  snapshot_high_priority_completed_count: number;
  snapshot_recurring_completed_count: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string;
};

type WeeklyCommitmentRow = {
  id: number;
  week_start: string;
  cycle_id: number | null;
  task_id: number | null;
  title: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
};

type WeeklyTaskDecisionRow = {
  id: number;
  week_start: string;
  task_id: number | null;
  task_title: string;
  original_due_date: string;
  action: WeeklyTaskDecisionAction;
  resolved_due_date: string | null;
  recurring_rule_id: number | null;
  recurrence_occurrence_date: string | null;
  decided_at: string;
};

const WEEKDAY_NAMES = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]);

function requireLocalDateKey(dateKey: string, label: string) {
  const parsedDate = parseLocalDateKey(dateKey);

  if (!parsedDate) {
    throw new Error(`Invalid ${label}: ${dateKey}`);
  }

  return parsedDate;
}

function assertValidWeekStart(weekStart: string) {
  const parsedDate = requireLocalDateKey(weekStart, 'week start date');

  if (parsedDate.getDay() !== 1) {
    throw new Error('Weekly review weeks must start on Monday.');
  }
}

function assertValidCycleId(cycleId: number | null) {
  if (
    cycleId !== null &&
    (!Number.isSafeInteger(cycleId) || cycleId <= 0)
  ) {
    throw new Error('The weekly review has an invalid planning-cycle link.');
  }
}

function assertValidSnapshot(snapshot: WeeklyReviewSnapshot) {
  const counts = [
    snapshot.completedCount,
    snapshot.unfinishedCount,
    snapshot.overdueCount,
    snapshot.goalsProgressedCount,
    snapshot.bestDayCount,
    snapshot.archivedBrainDumpCount,
    snapshot.highPriorityCompletedCount,
    snapshot.recurringCompletedCount,
  ];

  if (
    counts.some(
      (count) => !Number.isSafeInteger(count) || count < 0
    )
  ) {
    throw new Error('The weekly review contains an invalid saved count.');
  }

  const total = snapshot.completedCount + snapshot.unfinishedCount;
  const expectedCompletionRate =
    total === 0
      ? 0
      : Math.round((snapshot.completedCount / total) * 100);
  const hasValidBestDay =
    snapshot.bestDay === null
      ? snapshot.bestDayCount === 0
      : WEEKDAY_NAMES.has(snapshot.bestDay) &&
        snapshot.bestDayCount > 0;

  if (
    snapshot.completionRate !== expectedCompletionRate ||
    snapshot.overdueCount > snapshot.unfinishedCount ||
    snapshot.goalsProgressedCount > snapshot.completedCount ||
    snapshot.bestDayCount > snapshot.completedCount ||
    snapshot.highPriorityCompletedCount > snapshot.completedCount ||
    snapshot.recurringCompletedCount > snapshot.completedCount ||
    !hasValidBestDay
  ) {
    throw new Error(
      'The weekly review contains inconsistent saved analytics.'
    );
  }
}

function normalizeOptionalResponse(value: string | undefined) {
  const normalized = value?.trim() ?? '';

  if (normalized.length > MAX_WEEKLY_REVIEW_RESPONSE_LENGTH) {
    throw new Error(
      `Weekly review responses must be ${MAX_WEEKLY_REVIEW_RESPONSE_LENGTH} characters or fewer.`
    );
  }

  return normalized || null;
}

function normalizeCommitmentTitle(title: string) {
  const normalized = title.trim();

  if (!normalized) {
    throw new Error('Enter a weekly commitment first.');
  }

  if (normalized.length > MAX_WEEKLY_COMMITMENT_TITLE_LENGTH) {
    throw new Error(
      `Weekly commitments must be ${MAX_WEEKLY_COMMITMENT_TITLE_LENGTH} characters or fewer.`
    );
  }

  return normalized;
}

function mapWeeklyReviewRow(row: WeeklyReviewRow): StoredWeeklyReview {
  return {
    id: row.id,
    weekStart: row.week_start,
    cycleId: row.cycle_id,
    whatWentWell: row.what_went_well,
    whatCausedProblems: row.what_caused_problems,
    whatLearned: row.what_learned,
    whatChangeNextWeek: row.what_change_next_week,
    nextWeekFocus: row.next_week_focus,
    completedCount: row.snapshot_completed_count,
    unfinishedCount: row.snapshot_unfinished_count,
    overdueCount: row.snapshot_overdue_count,
    completionRate: row.snapshot_completion_rate,
    goalsProgressedCount: row.snapshot_goals_progressed_count,
    bestDay: row.snapshot_best_day,
    bestDayCount: row.snapshot_best_day_count,
    archivedBrainDumpCount: row.snapshot_archived_brain_dump_count,
    highPriorityCompletedCount:
      row.snapshot_high_priority_completed_count,
    recurringCompletedCount: row.snapshot_recurring_completed_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

function mapWeeklyCommitmentRow(
  row: WeeklyCommitmentRow
): WeeklyCommitment {
  return {
    id: row.id,
    weekStart: row.week_start,
    cycleId: row.cycle_id,
    taskId: row.task_id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapWeeklyTaskDecisionRow(
  row: WeeklyTaskDecisionRow
): WeeklyTaskDecision {
  return {
    id: row.id,
    weekStart: row.week_start,
    taskId: row.task_id,
    taskTitle: row.task_title,
    originalDueDate: row.original_due_date,
    action: row.action,
    resolvedDueDate: row.resolved_due_date,
    recurringRuleId: row.recurring_rule_id,
    recurrenceOccurrenceDate: row.recurrence_occurrence_date,
    decidedAt: row.decided_at,
  };
}

export async function getWeeklyReviews(): Promise<StoredWeeklyReview[]> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<WeeklyReviewRow>(`
    SELECT
      id,
      week_start,
      cycle_id,
      what_went_well,
      what_caused_problems,
      what_learned,
      what_change_next_week,
      next_week_focus,
      snapshot_completed_count,
      snapshot_unfinished_count,
      snapshot_overdue_count,
      snapshot_completion_rate,
      snapshot_goals_progressed_count,
      snapshot_best_day,
      snapshot_best_day_count,
      snapshot_archived_brain_dump_count,
      snapshot_high_priority_completed_count,
      snapshot_recurring_completed_count,
      created_at,
      updated_at,
      reviewed_at
    FROM weekly_reviews
    ORDER BY week_start DESC, id DESC;
  `);

  return rows.map(mapWeeklyReviewRow);
}

export async function saveWeeklyReview(
  weekStart: string,
  cycleId: number | null,
  reflection: WeeklyReviewReflectionInput,
  snapshot: WeeklyReviewSnapshot
): Promise<StoredWeeklyReview> {
  assertValidWeekStart(weekStart);
  assertValidCycleId(cycleId);
  await migrateDb();
  const db = await getDb();
  const now = new Date().toISOString();

  const values = {
    whatWentWell: normalizeOptionalResponse(reflection.whatWentWell),
    whatCausedProblems: normalizeOptionalResponse(
      reflection.whatCausedProblems
    ),
    whatLearned: normalizeOptionalResponse(reflection.whatLearned),
    whatChangeNextWeek: normalizeOptionalResponse(
      reflection.whatChangeNextWeek
    ),
    nextWeekFocus: normalizeOptionalResponse(reflection.nextWeekFocus),
  };

  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM weekly_reviews WHERE week_start = ?;',
    [weekStart]
  );

  if (existing) {
    /*
     * The first saved snapshot remains historical truth. Editing written
     * reflection later must not recalculate the week from subsequently changed
     * tasks, reschedules, or deletions.
     */
    await db.runAsync(
      `
      UPDATE weekly_reviews
      SET cycle_id = ?,
          what_went_well = ?,
          what_caused_problems = ?,
          what_learned = ?,
          what_change_next_week = ?,
          next_week_focus = ?,
          updated_at = ?,
          reviewed_at = ?
      WHERE id = ?;
      `,
      [
        cycleId,
        values.whatWentWell,
        values.whatCausedProblems,
        values.whatLearned,
        values.whatChangeNextWeek,
        values.nextWeekFocus,
        now,
        now,
        existing.id,
      ]
    );
  } else {
    assertValidSnapshot(snapshot);

    await db.runAsync(
      `
      INSERT INTO weekly_reviews (
        week_start,
        cycle_id,
        what_went_well,
        what_caused_problems,
        what_learned,
        what_change_next_week,
        next_week_focus,
        snapshot_completed_count,
        snapshot_unfinished_count,
        snapshot_overdue_count,
        snapshot_completion_rate,
        snapshot_goals_progressed_count,
        snapshot_best_day,
        snapshot_best_day_count,
        snapshot_archived_brain_dump_count,
        snapshot_high_priority_completed_count,
        snapshot_recurring_completed_count,
        created_at,
        updated_at,
        reviewed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [
        weekStart,
        cycleId,
        values.whatWentWell,
        values.whatCausedProblems,
        values.whatLearned,
        values.whatChangeNextWeek,
        values.nextWeekFocus,
        snapshot.completedCount,
        snapshot.unfinishedCount,
        snapshot.overdueCount,
        snapshot.completionRate,
        snapshot.goalsProgressedCount,
        snapshot.bestDay,
        snapshot.bestDayCount,
        snapshot.archivedBrainDumpCount,
        snapshot.highPriorityCompletedCount,
        snapshot.recurringCompletedCount,
        now,
        now,
        now,
      ]
    );
  }

  const saved = await db.getFirstAsync<WeeklyReviewRow>(
    'SELECT * FROM weekly_reviews WHERE week_start = ?;',
    [weekStart]
  );

  if (!saved) {
    throw new Error('The weekly review could not be saved.');
  }

  return mapWeeklyReviewRow(saved);
}

export async function getWeeklyCommitments(): Promise<WeeklyCommitment[]> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<WeeklyCommitmentRow>(`
    SELECT
      weekly_commitments.id,
      weekly_commitments.week_start,
      weekly_commitments.cycle_id,
      weekly_commitments.task_id,
      COALESCE(tasks.title, weekly_commitments.title) AS title,
      COALESCE(tasks.completed, weekly_commitments.completed) AS completed,
      weekly_commitments.created_at,
      COALESCE(tasks.completed_at, weekly_commitments.completed_at) AS completed_at
    FROM weekly_commitments
    LEFT JOIN tasks ON tasks.id = weekly_commitments.task_id
    ORDER BY
      weekly_commitments.week_start DESC,
      completed ASC,
      weekly_commitments.id ASC;
  `);

  return rows.map(mapWeeklyCommitmentRow);
}

export async function insertWeeklyCommitment(
  weekStart: string,
  cycleId: number | null,
  title: string
): Promise<number> {
  assertValidWeekStart(weekStart);
  assertValidCycleId(cycleId);
  const normalizedTitle = normalizeCommitmentTitle(title);
  await migrateDb();
  const db = await getDb();
  const result = await db.runAsync(
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
    [weekStart, cycleId, normalizedTitle, new Date().toISOString()]
  );

  return Number(result.lastInsertRowId);
}

export async function insertTaskWeeklyCommitment(
  weekStart: string,
  cycleId: number | null,
  taskId: number
): Promise<number> {
  assertValidWeekStart(weekStart);
  assertValidCycleId(cycleId);

  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new Error('The task has an invalid ID.');
  }

  await migrateDb();
  const db = await getDb();
  const task = await db.getFirstAsync<{
    title: string;
    completed: number;
    completed_at: string | null;
  }>(
    `
    SELECT title, completed, completed_at
    FROM tasks
    WHERE id = ?;
    `,
    [taskId]
  );

  if (!task) {
    throw new Error('The task could not be found.');
  }

  const existing = await db.getFirstAsync<{ id: number }>(
    `
    SELECT id
    FROM weekly_commitments
    WHERE week_start = ? AND task_id = ?;
    `,
    [weekStart, taskId]
  );

  if (existing) {
    throw new Error('That task is already a commitment for this week.');
  }

  const result = await db.runAsync(
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
    VALUES (?, ?, ?, ?, ?, ?, ?);
    `,
    [
      weekStart,
      cycleId,
      taskId,
      task.title,
      task.completed,
      new Date().toISOString(),
      task.completed_at,
    ]
  );

  return Number(result.lastInsertRowId);
}

export async function setWeeklyCommitmentCompleted(
  id: number,
  completed: boolean
): Promise<void> {
  await migrateDb();
  const db = await getDb();
  const commitment = await db.getFirstAsync<{
    task_id: number | null;
  }>(
    'SELECT task_id FROM weekly_commitments WHERE id = ?;',
    [id]
  );

  if (!commitment) {
    throw new Error('The weekly commitment could not be found.');
  }

  const completedAt = completed ? new Date().toISOString() : null;

  await db.withTransactionAsync(async () => {
    if (commitment.task_id !== null) {
      const taskResult = await db.runAsync(
        `
        UPDATE tasks
        SET completed = ?, completed_at = ?
        WHERE id = ?;
        `,
        [completed ? 1 : 0, completedAt, commitment.task_id]
      );

      if (taskResult.changes === 0) {
        throw new Error('The linked task could not be found.');
      }
    }

    await db.runAsync(
      `
      UPDATE weekly_commitments
      SET completed = ?, completed_at = ?
      WHERE id = ?;
      `,
      [completed ? 1 : 0, completedAt, id]
    );
  });
}

export async function toggleWeeklyCommitmentById(id: number): Promise<void> {
  await migrateDb();
  const db = await getDb();
  const commitment = await db.getFirstAsync<{
    completed: number;
  }>(
    `
    SELECT COALESCE(tasks.completed, weekly_commitments.completed) AS completed
    FROM weekly_commitments
    LEFT JOIN tasks ON tasks.id = weekly_commitments.task_id
    WHERE weekly_commitments.id = ?;
    `,
    [id]
  );

  if (!commitment) {
    throw new Error('The weekly commitment could not be found.');
  }

  await setWeeklyCommitmentCompleted(id, commitment.completed !== 1);
}

export async function deleteWeeklyCommitmentById(id: number): Promise<void> {
  await migrateDb();
  const db = await getDb();
  await db.runAsync('DELETE FROM weekly_commitments WHERE id = ?;', [id]);
}

export async function getWeeklyTaskDecisions(): Promise<
  WeeklyTaskDecision[]
> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<WeeklyTaskDecisionRow>(`
    SELECT
      id,
      week_start,
      task_id,
      task_title,
      original_due_date,
      action,
      resolved_due_date,
      recurring_rule_id,
      recurrence_occurrence_date,
      decided_at
    FROM weekly_task_decisions
    ORDER BY week_start DESC, decided_at DESC, id DESC;
  `);

  return rows.map(mapWeeklyTaskDecisionRow);
}

export async function recordWeeklyTaskDecision(input: {
  weekStart: string;
  taskId: number | null;
  taskTitle: string;
  originalDueDate: string;
  action: WeeklyTaskDecisionAction;
  resolvedDueDate?: string | null;
  recurringRuleId?: number | null;
  recurrenceOccurrenceDate?: string | null;
}): Promise<void> {
  assertValidWeekStart(input.weekStart);

  const weekStartDate = requireLocalDateKey(
    input.weekStart,
    'week start date'
  );
  const originalDueDate = requireLocalDateKey(
    input.originalDueDate,
    'original task date'
  );

  if (
    originalDueDate < weekStartDate ||
    originalDueDate.getTime() >=
      new Date(
        weekStartDate.getFullYear(),
        weekStartDate.getMonth(),
        weekStartDate.getDate() + 7
      ).getTime()
  ) {
    throw new Error('The unfinished task does not belong to that review week.');
  }

  if (
    input.taskId !== null &&
    (!Number.isSafeInteger(input.taskId) || input.taskId <= 0)
  ) {
    throw new Error('The unfinished task has an invalid ID.');
  }

  if (
    (input.action === 'delete' && input.taskId !== null) ||
    (input.action !== 'delete' && input.taskId === null)
  ) {
    throw new Error(
      'The unfinished-task decision does not match its task link.'
    );
  }

  if (!WEEKLY_TASK_DECISION_ACTIONS.includes(input.action)) {
    throw new Error('The unfinished-task decision is not supported.');
  }

  if (
    input.resolvedDueDate !== undefined &&
    input.resolvedDueDate !== null &&
    !parseLocalDateKey(input.resolvedDueDate)
  ) {
    throw new Error(`Invalid resolved date: ${input.resolvedDueDate}`);
  }

  const resolvedDueDate = input.resolvedDueDate ?? null;
  const requiresResolvedDate =
    input.action === 'nextWeek' || input.action === 'reschedule';

  if (requiresResolvedDate !== (resolvedDueDate !== null)) {
    throw new Error(
      requiresResolvedDate
        ? 'Choose the date where this task should be moved.'
        : 'That decision should not include a new scheduled date.'
    );
  }

  if (
    input.action === 'nextWeek' &&
    resolvedDueDate !== getLocalDateKey(addDays(originalDueDate, 7))
  ) {
    throw new Error(
      'Moving a task to next week must preserve its weekday.'
    );
  }

  const hasRecurringRule = (input.recurringRuleId ?? null) !== null;
  const hasOccurrenceDate =
    (input.recurrenceOccurrenceDate ?? null) !== null;

  if (hasRecurringRule !== hasOccurrenceDate) {
    throw new Error('The recurring occurrence identity is incomplete.');
  }

  const taskTitle = input.taskTitle.trim();
  if (!taskTitle) {
    throw new Error('The unfinished task title is required.');
  }

  await migrateDb();
  const db = await getDb();

  const params = [
    input.weekStart,
    input.taskId,
    taskTitle,
    input.originalDueDate,
    input.action,
    resolvedDueDate,
    input.recurringRuleId ?? null,
    input.recurrenceOccurrenceDate ?? null,
    new Date().toISOString(),
  ];

  if (input.taskId === null) {
    /*
     * Deleted tasks no longer have a live task row to reference. Preserve the
     * title and original date as a historical decision without creating a
     * dangling task ID.
     */
    await db.runAsync(
      `
      INSERT INTO weekly_task_decisions (
        week_start,
        task_id,
        task_title,
        original_due_date,
        action,
        resolved_due_date,
        recurring_rule_id,
        recurrence_occurrence_date,
        decided_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      params
    );
    return;
  }

  await db.runAsync(
    `
    INSERT INTO weekly_task_decisions (
      week_start,
      task_id,
      task_title,
      original_due_date,
      action,
      resolved_due_date,
      recurring_rule_id,
      recurrence_occurrence_date,
      decided_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week_start, task_id, original_due_date)
    WHERE task_id IS NOT NULL
    DO UPDATE SET
      task_title = excluded.task_title,
      action = excluded.action,
      resolved_due_date = excluded.resolved_due_date,
      recurring_rule_id = excluded.recurring_rule_id,
      recurrence_occurrence_date = excluded.recurrence_occurrence_date,
      decided_at = excluded.decided_at;
    `,
    params
  );
}

export async function deleteWeeklyTaskDecisionById(id: number): Promise<void> {
  await migrateDb();
  const db = await getDb();
  await db.runAsync('DELETE FROM weekly_task_decisions WHERE id = ?;', [id]);
}
