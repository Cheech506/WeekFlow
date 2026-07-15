import {
  getDayNameFromDateKey,
  parseLocalDateKey,
} from './dateUtils';
import { getDb, migrateDb } from './db';
import {
  getRecurringOccurrenceDateKeys,
  normalizeWeekdays,
  RECURRENCE_FREQUENCIES,
  validateAndNormalizeRecurringRuleInput,
  type RecurrenceFrequency,
} from './recurrenceUtils';

export { RECURRENCE_FREQUENCIES };
export type { RecurrenceFrequency };

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

  const createdAt = new Date().toISOString();

  for (const rule of rules) {
    const occurrenceDates =
      getRecurringOccurrenceDateKeys(
        rule,
        currentDate,
        horizonDays
      );

    for (const occurrenceDate of occurrenceDates) {
      const exceptionKey =
        `${rule.id}:${occurrenceDate}`;

      if (exceptionKeys.has(exceptionKey)) {
        continue;
      }

      const dayName =
        getDayNameFromDateKey(occurrenceDate);

      if (!dayName) {
        continue;
      }

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

  const normalizedInput =
    validateAndNormalizeRecurringRuleInput(input);

  const {
    title,
    notes,
    priority,
    goalId,
    frequency,
    startDate,
    endDate,
    weekdays,
  } = normalizedInput;

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
      frequency,
      startDate,
      endDate,
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
    frequency,
    startDate,
    endDate,
    weekdays,
    active: true,
    createdAt,
  };

  await ensureRecurringOccurrences();
  return rule;
}

/**
 * Converts an existing unfinished standalone task into the first occurrence
 * of a new recurring schedule. The task and recurring rule are linked in one
 * transaction before future occurrences are generated, so the start date
 * cannot be duplicated by the recurrence generator.
 */
export async function convertTaskToRecurringRule(
  taskId: number,
  input: CreateRecurringRuleInput
): Promise<RecurringRule> {
  await migrateDb();

  const normalizedInput =
    validateAndNormalizeRecurringRuleInput(input);

  const {
    title,
    notes,
    priority,
    goalId,
    frequency,
    startDate,
    endDate,
    weekdays,
  } = normalizedInput;

  const parsedStartDate = parseLocalDateKey(startDate);
  const dayName = getDayNameFromDateKey(startDate);

  if (!dayName || !parsedStartDate) {
    throw new Error('Recurring task start date is invalid.');
  }

  if (
    frequency === 'certainDays' &&
    !weekdays.includes(parsedStartDate.getDay())
  ) {
    throw new Error(
      'The first scheduled date must be one of the selected weekdays.'
    );
  }

  const db = await getDb();
  const createdAt = new Date().toISOString();
  let ruleId: number | null = null;

  await db.withTransactionAsync(async () => {
    const task = await db.getFirstAsync<{
      completed: number;
      recurring_rule_id: number | null;
    }>(
      `
      SELECT completed, recurring_rule_id
      FROM tasks
      WHERE id = ?;
      `,
      [taskId]
    );

    if (!task) {
      throw new Error('The task could not be found.');
    }

    if (task.completed === 1) {
      throw new Error(
        'A completed task cannot be converted into a recurring task.'
      );
    }

    if (task.recurring_rule_id !== null) {
      throw new Error(
        'This task already belongs to a recurring schedule.'
      );
    }

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
        frequency,
        startDate,
        endDate,
        JSON.stringify(weekdays),
        createdAt,
      ]
    );

    ruleId = result.lastInsertRowId;

    const updateResult = await db.runAsync(
      `
      UPDATE tasks
      SET
        title = ?,
        day = ?,
        due_date = ?,
        notes = ?,
        priority = ?,
        goal_id = ?,
        recurring_rule_id = ?,
        recurrence_occurrence_date = ?
      WHERE id = ?
        AND completed = 0
        AND recurring_rule_id IS NULL;
      `,
      [
        title,
        dayName,
        startDate,
        notes,
        priority,
        goalId,
        ruleId,
        startDate,
        taskId,
      ]
    );

    if (updateResult.changes !== 1) {
      throw new Error(
        'The task changed before it could be converted. Please try again.'
      );
    }
  });

  if (ruleId === null) {
    throw new Error('The recurring schedule could not be created.');
  }

  const rule: RecurringRule = {
    id: ruleId,
    title,
    notes,
    priority,
    goalId,
    frequency,
    startDate,
    endDate,
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
