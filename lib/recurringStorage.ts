import {
  addDays,
  getDayNameFromDateKey,
  getLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from './dateUtils';
import { getDb, migrateDb } from './db';

export const RECURRENCE_FREQUENCIES = [
  'daily',
  'weekly',
  'certainDays',
  'monthly',
] as const;

export type RecurrenceFrequency =
  (typeof RECURRENCE_FREQUENCIES)[number];

export type RecurringRule = {
  id: number;
  title: string;
  notes: string | null;
  priority: number;
  goalId: number | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  weekdays: number[];
  active: boolean;
  createdAt: string;
};

export type RecurringOccurrenceException = {
  recurringRuleId: number;
  occurrenceDate: string;
  createdAt: string;
};

export type DeleteRecurringRuleMode =
  | 'stopOnly'
  | 'deleteUnfinished';

export type CreateRecurringRuleInput = {
  title: string;
  notes?: string;
  priority?: number;
  goalId?: number | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
  weekdays?: number[];
};

type RecurringRuleRow = {
  id: number;
  title: string;
  notes: string | null;
  priority: number;
  goal_id: number | null;
  frequency: string;
  start_date: string;
  end_date: string | null;
  weekdays: string;
  active: number;
  created_at: string;
};

type RecurringExceptionRow = {
  recurring_rule_id: number;
  occurrence_date: string;
  created_at: string;
};

function isRecurrenceFrequency(
  value: string
): value is RecurrenceFrequency {
  return RECURRENCE_FREQUENCIES.includes(
    value as RecurrenceFrequency
  );
}

function normalizeWeekdays(weekdays: number[] = []) {
  return Array.from(
    new Set(
      weekdays.filter(
        (weekday) =>
          Number.isInteger(weekday) &&
          weekday >= 0 &&
          weekday <= 6
      )
    )
  ).sort((a, b) => a - b);
}

function parseStoredWeekdays(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) return [];

    return normalizeWeekdays(
      parsed.filter(
        (weekday): weekday is number =>
          typeof weekday === 'number'
      )
    );
  } catch {
    return [];
  }
}

function mapRule(row: RecurringRuleRow): RecurringRule {
  if (!isRecurrenceFrequency(row.frequency)) {
    throw new Error(
      `Unsupported recurring frequency: ${row.frequency}`
    );
  }

  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    goalId: row.goal_id,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    weekdays: parseStoredWeekdays(row.weekdays),
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

function getDaysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function matchesRuleDate(
  rule: RecurringRule,
  date: Date,
  startDate: Date
) {
  if (date < startDate) return false;

  if (rule.frequency === 'daily') return true;

  if (rule.frequency === 'weekly') {
    return date.getDay() === startDate.getDay();
  }

  if (rule.frequency === 'certainDays') {
    return rule.weekdays.includes(date.getDay());
  }

  /*
   * A monthly rule anchored on the 29th, 30th, or 31st uses the
   * final valid day of shorter months.
   */
  const targetDay = Math.min(
    startDate.getDate(),
    getDaysInMonth(date.getFullYear(), date.getMonth())
  );

  return date.getDate() === targetDay;
}

export async function getRecurringRules(): Promise<
  RecurringRule[]
> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<RecurringRuleRow>(`
    SELECT
      id,
      title,
      notes,
      priority,
      goal_id,
      frequency,
      start_date,
      end_date,
      weekdays,
      active,
      created_at
    FROM recurring_rules
    ORDER BY active DESC, created_at DESC;
  `);

  return rows.map(mapRule);
}

export async function getRecurringOccurrenceExceptions(): Promise<
  RecurringOccurrenceException[]
> {
  await migrateDb();
  const db = await getDb();

  const rows = await db.getAllAsync<RecurringExceptionRow>(`
    SELECT
      recurring_rule_id,
      occurrence_date,
      created_at
    FROM recurring_occurrence_exceptions
    ORDER BY occurrence_date ASC;
  `);

  return rows.map((row) => ({
    recurringRuleId: row.recurring_rule_id,
    occurrenceDate: row.occurrence_date,
    createdAt: row.created_at,
  }));
}

/**
 * Safely extends active rules through a rolling window.
 *
 * The unique task index prevents duplicates. Exceptions prevent deleted
 * occurrences from returning. A moved task keeps its original occurrence
 * identity, so moving it also does not create a replacement.
 */
export async function ensureRecurringOccurrences(
  currentDate: Date = new Date(),
  horizonDays: number = 30
): Promise<void> {
  await migrateDb();
  const db = await getDb();

  const [rules, exceptions] = await Promise.all([
    getRecurringRules(),
    getRecurringOccurrenceExceptions(),
  ]);

  const exceptionKeys = new Set(
    exceptions.map(
      (exception) =>
        `${exception.recurringRuleId}:${exception.occurrenceDate}`
    )
  );

  const today = startOfLocalDay(currentDate);
  const horizonEnd = addDays(today, Math.max(0, horizonDays));
  const createdAt = new Date().toISOString();

  for (const rule of rules) {
    if (!rule.active) continue;

    const start = parseLocalDateKey(rule.startDate);
    const end = rule.endDate
      ? parseLocalDateKey(rule.endDate)
      : null;

    if (!start || (rule.endDate && !end)) continue;

    const generationStart = start > today ? start : today;
    const generationEnd =
      end && end < horizonEnd ? end : horizonEnd;

    if (generationEnd < generationStart) continue;

    for (
      let cursor = generationStart;
      cursor <= generationEnd;
      cursor = addDays(cursor, 1)
    ) {
      if (!matchesRuleDate(rule, cursor, start)) continue;

      const occurrenceDate = getLocalDateKey(cursor);
      const exceptionKey = `${rule.id}:${occurrenceDate}`;

      if (exceptionKeys.has(exceptionKey)) continue;

      const dayName = getDayNameFromDateKey(occurrenceDate);
      if (!dayName) continue;

      await db.runAsync(
        `
        INSERT OR IGNORE INTO tasks (
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
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?);
        `,
        [
          rule.title,
          dayName,
          occurrenceDate,
          rule.notes,
          rule.priority,
          rule.goalId,
          createdAt,
          rule.id,
          occurrenceDate,
        ]
      );
    }
  }
}

export async function insertRecurringRule(
  input: CreateRecurringRuleInput
): Promise<RecurringRule> {
  await migrateDb();

  const title = input.title.trim();
  const notes = input.notes?.trim() || null;
  const priority = input.priority ?? 0;
  const goalId = input.goalId ?? null;
  const start = parseLocalDateKey(input.startDate);
  const end = input.endDate
    ? parseLocalDateKey(input.endDate)
    : null;
  const weekdays = normalizeWeekdays(input.weekdays);

  if (!title) {
    throw new Error('A recurring task needs a title.');
  }

  if (!Number.isInteger(priority) || priority < 0 || priority > 2) {
    throw new Error('Recurring task priority is invalid.');
  }

  if (!start) {
    throw new Error('Recurring task start date is invalid.');
  }

  if (input.endDate && !end) {
    throw new Error('Recurring task end date is invalid.');
  }

  if (end && end < start) {
    throw new Error(
      'The repeat end date cannot be before the start date.'
    );
  }

  if (
    input.frequency === 'certainDays' &&
    weekdays.length === 0
  ) {
    throw new Error(
      'Choose at least one weekday for Certain Days.'
    );
  }

  const db = await getDb();
  const createdAt = new Date().toISOString();

  const result = await db.runAsync(
    `
    INSERT INTO recurring_rules (
      title,
      notes,
      priority,
      goal_id,
      frequency,
      start_date,
      end_date,
      weekdays,
      active,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?);
    `,
    [
      title,
      notes,
      priority,
      goalId,
      input.frequency,
      input.startDate,
      input.endDate ?? null,
      JSON.stringify(weekdays),
      createdAt,
    ]
  );

  const rule: RecurringRule = {
    id: result.lastInsertRowId,
    title,
    notes,
    priority,
    goalId,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    weekdays,
    active: true,
    createdAt,
  };

  await ensureRecurringOccurrences();
  return rule;
}

export async function setRecurringRuleActive(
  id: number,
  active: boolean
): Promise<void> {
  await migrateDb();
  const db = await getDb();

  await db.runAsync(
    `
    UPDATE recurring_rules
    SET active = ?
    WHERE id = ?;
    `,
    [active ? 1 : 0, id]
  );

  if (active) {
    await ensureRecurringOccurrences();
  }
}

/**
 * Permanently removes a recurring schedule.
 *
 * stopOnly:
 * - Stops future generation.
 * - Keeps every generated task.
 * - Detaches those tasks so they become normal standalone tasks.
 *
 * deleteUnfinished:
 * - Stops future generation.
 * - Deletes every incomplete occurrence created by the rule, including
 *   occurrences that were moved to Inbox or rescheduled.
 * - Keeps completed occurrences in History as standalone tasks.
 */
export async function deleteRecurringRuleById(
  id: number,
  mode: DeleteRecurringRuleMode
): Promise<void> {
  await migrateDb();
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    if (mode === 'deleteUnfinished') {
      await db.runAsync(
        `
        DELETE FROM tasks
        WHERE recurring_rule_id = ?
          AND completed = 0;
        `,
        [id]
      );
    }

    /*
     * Any tasks that remain must be detached before the recurring rule is
     * removed. In deleteUnfinished mode, these are completed history items.
     * In stopOnly mode, this includes every generated occurrence.
     */
    await db.runAsync(
      `
      UPDATE tasks
      SET recurring_rule_id = NULL,
          recurrence_occurrence_date = NULL
      WHERE recurring_rule_id = ?;
      `,
      [id]
    );

    await db.runAsync(
      `
      DELETE FROM recurring_occurrence_exceptions
      WHERE recurring_rule_id = ?;
      `,
      [id]
    );

    await db.runAsync(
      `
      DELETE FROM recurring_rules
      WHERE id = ?;
      `,
      [id]
    );
  });
}
