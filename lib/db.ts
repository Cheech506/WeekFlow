import * as SQLite from 'expo-sqlite';

import { getNextOccurrenceDateKey } from './dateUtils';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let migrationPromise: Promise<void> | null = null;

type DuplicateRecurringOccurrenceGroup = {
  recurring_rule_id: number;
  recurrence_occurrence_date: string;
};

type DuplicateRecurringOccurrenceTask = {
  id: number;
  completed: number;
};

/**
 * Removes broken references that may exist in older databases or data that was
 * created before WeekFlow started validating relationships consistently.
 *
 * The repair is intentionally conservative:
 * - Missing goals are unlinked instead of deleting tasks or recurring rules.
 * - Broken recurring identities are detached and become standalone tasks.
 * - Exceptions for missing schedules are removed because they cannot affect
 *   generation without the schedule they belonged to.
 */
async function repairOrphanedRelationships(
  db: SQLite.SQLiteDatabase
) {
  await db.runAsync(`
    UPDATE tasks
    SET goal_id = NULL
    WHERE goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM goals
        WHERE goals.id = tasks.goal_id
      );
  `);

  await db.runAsync(`
    UPDATE recurring_rules
    SET goal_id = NULL
    WHERE goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM goals
        WHERE goals.id = recurring_rules.goal_id
      );
  `);

  await db.runAsync(`
    UPDATE task_templates
    SET goal_id = NULL
    WHERE goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM goals
        WHERE goals.id = task_templates.goal_id
      );
  `);

  await db.runAsync(`
    UPDATE tasks
    SET recurring_rule_id = NULL,
        recurrence_occurrence_date = NULL
    WHERE
      (
        recurring_rule_id IS NULL
        AND recurrence_occurrence_date IS NOT NULL
      )
      OR
      (
        recurring_rule_id IS NOT NULL
        AND recurrence_occurrence_date IS NULL
      )
      OR
      (
        recurring_rule_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM recurring_rules
          WHERE recurring_rules.id = tasks.recurring_rule_id
        )
      );
  `);

  await db.runAsync(`
    DELETE FROM recurring_occurrence_exceptions
    WHERE NOT EXISTS (
      SELECT 1
      FROM recurring_rules
      WHERE recurring_rules.id =
        recurring_occurrence_exceptions.recurring_rule_id
    );
  `);

  await db.runAsync(`
    DELETE FROM goal_milestones
    WHERE NOT EXISTS (
      SELECT 1
      FROM goals
      WHERE goals.id = goal_milestones.goal_id
    );
  `);

  await db.runAsync(`
    UPDATE weekly_reviews
    SET cycle_id = NULL
    WHERE cycle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM planning_cycles
        WHERE planning_cycles.id = weekly_reviews.cycle_id
      );
  `);

  await db.runAsync(`
    UPDATE weekly_commitments
    SET cycle_id = NULL
    WHERE cycle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM planning_cycles
        WHERE planning_cycles.id = weekly_commitments.cycle_id
      );
  `);

  await db.runAsync(`
    UPDATE weekly_commitments
    SET task_id = NULL
    WHERE task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE tasks.id = weekly_commitments.task_id
      );
  `);

  await db.runAsync(`
    UPDATE weekly_task_decisions
    SET task_id = NULL
    WHERE task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM tasks
        WHERE tasks.id = weekly_task_decisions.task_id
      );
  `);
}

/**
 * Adds lightweight SQLite triggers that act like foreign-key guardrails.
 *
 * The existing WeekFlow tables predate SQL foreign-key declarations, so these
 * triggers protect every write without rebuilding the user's database. The
 * storage functions still perform their own transaction logic; the triggers
 * are the final safety net for restores, older code, and direct database writes.
 */
async function createRelationshipTriggers(
  db: SQLite.SQLiteDatabase
) {
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_goal_exists_insert
    BEFORE INSERT ON tasks
    WHEN NEW.goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM goals WHERE id = NEW.goal_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Task goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_goal_exists_update
    BEFORE UPDATE OF goal_id ON tasks
    WHEN NEW.goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM goals WHERE id = NEW.goal_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Task goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_templates_goal_exists_insert
    BEFORE INSERT ON task_templates
    WHEN NEW.goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM goals WHERE id = NEW.goal_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Task template goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_templates_goal_exists_update
    BEFORE UPDATE OF goal_id ON task_templates
    WHEN NEW.goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM goals WHERE id = NEW.goal_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Task template goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_rules_goal_exists_insert
    BEFORE INSERT ON recurring_rules
    WHEN NEW.goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM goals WHERE id = NEW.goal_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Recurring rule goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_rules_goal_exists_update
    BEFORE UPDATE OF goal_id ON recurring_rules
    WHEN NEW.goal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM goals WHERE id = NEW.goal_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Recurring rule goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_recurring_identity_insert
    BEFORE INSERT ON tasks
    WHEN
      (
        NEW.recurring_rule_id IS NULL
        AND NEW.recurrence_occurrence_date IS NOT NULL
      )
      OR
      (
        NEW.recurring_rule_id IS NOT NULL
        AND NEW.recurrence_occurrence_date IS NULL
      )
      OR
      (
        NEW.recurring_rule_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM recurring_rules
          WHERE id = NEW.recurring_rule_id
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Recurring task identity is invalid.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_recurring_identity_update
    BEFORE UPDATE OF
      recurring_rule_id,
      recurrence_occurrence_date
    ON tasks
    WHEN
      (
        NEW.recurring_rule_id IS NULL
        AND NEW.recurrence_occurrence_date IS NOT NULL
      )
      OR
      (
        NEW.recurring_rule_id IS NOT NULL
        AND NEW.recurrence_occurrence_date IS NULL
      )
      OR
      (
        NEW.recurring_rule_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM recurring_rules
          WHERE id = NEW.recurring_rule_id
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'Recurring task identity is invalid.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_milestones_goal_exists_insert
    BEFORE INSERT ON goal_milestones
    WHEN NOT EXISTS (
      SELECT 1 FROM goals WHERE id = NEW.goal_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Milestone goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_milestones_goal_exists_update
    BEFORE UPDATE OF goal_id ON goal_milestones
    WHEN NOT EXISTS (
      SELECT 1 FROM goals WHERE id = NEW.goal_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Milestone goal does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_exceptions_rule_exists_insert
    BEFORE INSERT ON recurring_occurrence_exceptions
    WHEN NOT EXISTS (
      SELECT 1
      FROM recurring_rules
      WHERE id = NEW.recurring_rule_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Recurring exception rule does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_exceptions_rule_exists_update
    BEFORE UPDATE OF recurring_rule_id
    ON recurring_occurrence_exceptions
    WHEN NOT EXISTS (
      SELECT 1
      FROM recurring_rules
      WHERE id = NEW.recurring_rule_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Recurring exception rule does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_reviews_cycle_exists_insert
    BEFORE INSERT ON weekly_reviews
    WHEN NEW.cycle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM planning_cycles WHERE id = NEW.cycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly review cycle does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_reviews_cycle_exists_update
    BEFORE UPDATE OF cycle_id ON weekly_reviews
    WHEN NEW.cycle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM planning_cycles WHERE id = NEW.cycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly review cycle does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_commitments_cycle_exists_insert
    BEFORE INSERT ON weekly_commitments
    WHEN NEW.cycle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM planning_cycles WHERE id = NEW.cycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly commitment cycle does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_commitments_cycle_exists_update
    BEFORE UPDATE OF cycle_id ON weekly_commitments
    WHEN NEW.cycle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM planning_cycles WHERE id = NEW.cycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly commitment cycle does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_commitments_task_exists_insert
    BEFORE INSERT ON weekly_commitments
    WHEN NEW.task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = NEW.task_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly commitment task does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_commitments_task_exists_update
    BEFORE UPDATE OF task_id ON weekly_commitments
    WHEN NEW.task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = NEW.task_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly commitment task does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_task_decisions_task_exists_insert
    BEFORE INSERT ON weekly_task_decisions
    WHEN NEW.task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = NEW.task_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly task decision task does not exist.');
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_weekly_task_decisions_task_exists_update
    BEFORE UPDATE OF task_id ON weekly_task_decisions
    WHEN NEW.task_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tasks WHERE id = NEW.task_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Weekly task decision task does not exist.');
    END;

    /*
     * These cleanup triggers mirror the app's normal delete workflows. They
     * protect the database even when a row is removed outside those workflows.
     */
    CREATE TRIGGER IF NOT EXISTS
      trg_goals_cleanup_after_delete
    AFTER DELETE ON goals
    BEGIN
      UPDATE tasks
      SET goal_id = NULL
      WHERE goal_id = OLD.id;

      UPDATE recurring_rules
      SET goal_id = NULL
      WHERE goal_id = OLD.id;

      UPDATE task_templates
      SET goal_id = NULL
      WHERE goal_id = OLD.id;

      DELETE FROM goal_milestones
      WHERE goal_id = OLD.id;
    END;

    /*
     * Existing installations may already have the older goal cleanup trigger.
     * Use a separate trigger name so milestone cleanup is added during upgrade
     * even when SQLite keeps the previous trigger definition unchanged.
     */
    CREATE TRIGGER IF NOT EXISTS
      trg_goal_milestones_cleanup_after_goal_delete
    AFTER DELETE ON goals
    BEGIN
      DELETE FROM goal_milestones
      WHERE goal_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_cycles_weekly_cleanup_after_delete
    AFTER DELETE ON planning_cycles
    BEGIN
      UPDATE weekly_reviews
      SET cycle_id = NULL
      WHERE cycle_id = OLD.id;

      UPDATE weekly_commitments
      SET cycle_id = NULL
      WHERE cycle_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_weekly_decision_cleanup_after_delete
    AFTER DELETE ON tasks
    BEGIN
      UPDATE weekly_task_decisions
      SET task_id = NULL
      WHERE task_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_weekly_commitment_cleanup_after_delete
    AFTER DELETE ON tasks
    BEGIN
      UPDATE weekly_commitments
      SET task_id = NULL,
          title = OLD.title,
          completed = OLD.completed,
          completed_at = OLD.completed_at
      WHERE task_id = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_tasks_weekly_commitment_sync_after_update
    AFTER UPDATE OF title, completed, completed_at ON tasks
    BEGIN
      UPDATE weekly_commitments
      SET title = NEW.title,
          completed = NEW.completed,
          completed_at = NEW.completed_at
      WHERE task_id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS
      trg_rules_cleanup_after_delete
    AFTER DELETE ON recurring_rules
    BEGIN
      UPDATE tasks
      SET recurring_rule_id = NULL,
          recurrence_occurrence_date = NULL
      WHERE recurring_rule_id = OLD.id;

      DELETE FROM recurring_occurrence_exceptions
      WHERE recurring_rule_id = OLD.id;
    END;
  `);
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('weekflow.db');
  }

  return dbPromise;
}

function isDuplicateColumnError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes('duplicate column name')
  );
}

async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${tableName});`
  );

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  try {
    await db.execAsync(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
    );
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }
}

async function backfillLegacyTaskDueDates(
  db: SQLite.SQLiteDatabase
) {
  const legacyTasks = await db.getAllAsync<{
    id: number;
    day: string;
  }>(`
    SELECT id, day
    FROM tasks
    WHERE due_date IS NULL
      AND completed = 0
      AND day != 'Inbox';
  `);

  for (const task of legacyTasks) {
    const dueDate = getNextOccurrenceDateKey(task.day);

    if (!dueDate) continue;

    await db.runAsync(
      `
      UPDATE tasks
      SET due_date = ?
      WHERE id = ?;
      `,
      [dueDate, task.id]
    );
  }
}

/**
 * Repairs legacy duplicate recurring identities before the unique index is
 * created.
 *
 * Every task row is preserved. One task keeps the recurring identity, while
 * the extra rows are detached and become normal standalone tasks. Completed
 * History is preferred as the canonical row because a completed occurrence
 * should continue to block that same schedule/date from being generated again.
 */
async function repairDuplicateRecurringOccurrenceIdentities(
  db: SQLite.SQLiteDatabase
) {
  const duplicateGroups =
    await db.getAllAsync<DuplicateRecurringOccurrenceGroup>(`
      SELECT
        recurring_rule_id,
        recurrence_occurrence_date
      FROM tasks
      WHERE recurring_rule_id IS NOT NULL
        AND recurrence_occurrence_date IS NOT NULL
      GROUP BY
        recurring_rule_id,
        recurrence_occurrence_date
      HAVING COUNT(*) > 1;
    `);

  for (const group of duplicateGroups) {
    const matchingTasks =
      await db.getAllAsync<DuplicateRecurringOccurrenceTask>(
        `
        SELECT id, completed
        FROM tasks
        WHERE recurring_rule_id = ?
          AND recurrence_occurrence_date = ?
        ORDER BY completed DESC, id ASC;
        `,
        [
          group.recurring_rule_id,
          group.recurrence_occurrence_date,
        ]
      );

    for (const duplicateTask of matchingTasks.slice(1)) {
      await db.runAsync(
        `
        UPDATE tasks
        SET recurring_rule_id = NULL,
            recurrence_occurrence_date = NULL
        WHERE id = ?;
        `,
        [duplicateTask.id]
      );
    }
  }
}

async function runMigrations() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      day TEXT NOT NULL,
      due_date TEXT,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      goal_id INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      recurring_rule_id INTEGER,
      recurrence_occurrence_date TEXT
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reward TEXT,
      purpose TEXT,
      success_definition TEXT,
      notes TEXT,
      completion_what_helped TEXT,
      completion_hardest_part TEXT,
      completion_learned TEXT,
      completion_do_differently TEXT,
      completion_task_total INTEGER,
      completion_task_completed INTEGER,
      completion_milestone_total INTEGER,
      completion_milestone_completed INTEGER,
      completion_high_priority_completed INTEGER
    );

    CREATE TABLE IF NOT EXISTS goal_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      target_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS brain_dumps (
      id INTEGER PRIMARY KEY NOT NULL,
      body TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS planning_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      goal_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      goal_id INTEGER,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      weekdays TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_occurrence_exceptions (
      recurring_rule_id INTEGER NOT NULL,
      occurrence_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (recurring_rule_id, occurrence_date)
    );

    CREATE TABLE IF NOT EXISTS weekly_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL UNIQUE,
      cycle_id INTEGER,
      what_went_well TEXT,
      what_caused_problems TEXT,
      what_learned TEXT,
      what_change_next_week TEXT,
      next_week_focus TEXT,
      snapshot_completed_count INTEGER NOT NULL DEFAULT 0,
      snapshot_unfinished_count INTEGER NOT NULL DEFAULT 0,
      snapshot_overdue_count INTEGER NOT NULL DEFAULT 0,
      snapshot_completion_rate INTEGER NOT NULL DEFAULT 0,
      snapshot_goals_progressed_count INTEGER NOT NULL DEFAULT 0,
      snapshot_best_day TEXT,
      snapshot_best_day_count INTEGER NOT NULL DEFAULT 0,
      snapshot_archived_brain_dump_count INTEGER NOT NULL DEFAULT 0,
      snapshot_high_priority_completed_count INTEGER NOT NULL DEFAULT 0,
      snapshot_recurring_completed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      cycle_id INTEGER,
      task_id INTEGER,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS weekly_task_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      task_id INTEGER,
      task_title TEXT NOT NULL,
      original_due_date TEXT NOT NULL,
      action TEXT NOT NULL,
      resolved_due_date TEXT,
      recurring_rule_id INTEGER,
      recurrence_occurrence_date TEXT,
      decided_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await ensureColumn(db, 'tasks', 'notes', 'TEXT');
  await ensureColumn(
    db,
    'tasks',
    'priority',
    'INTEGER NOT NULL DEFAULT 0'
  );
  await ensureColumn(db, 'tasks', 'goal_id', 'INTEGER');
  await ensureColumn(db, 'tasks', 'due_date', 'TEXT');
  await ensureColumn(db, 'tasks', 'recurring_rule_id', 'INTEGER');
  await ensureColumn(
    db,
    'tasks',
    'recurrence_occurrence_date',
    'TEXT'
  );

  await ensureColumn(db, 'weekly_commitments', 'task_id', 'INTEGER');

  await ensureColumn(db, 'goals', 'reward', 'TEXT');
  await ensureColumn(db, 'goals', 'purpose', 'TEXT');
  await ensureColumn(db, 'goals', 'success_definition', 'TEXT');
  await ensureColumn(db, 'goals', 'notes', 'TEXT');
  await ensureColumn(db, 'goals', 'completion_what_helped', 'TEXT');
  await ensureColumn(db, 'goals', 'completion_hardest_part', 'TEXT');
  await ensureColumn(db, 'goals', 'completion_learned', 'TEXT');
  await ensureColumn(db, 'goals', 'completion_do_differently', 'TEXT');
  await ensureColumn(db, 'goals', 'completion_task_total', 'INTEGER');
  await ensureColumn(db, 'goals', 'completion_task_completed', 'INTEGER');
  await ensureColumn(db, 'goals', 'completion_milestone_total', 'INTEGER');
  await ensureColumn(db, 'goals', 'completion_milestone_completed', 'INTEGER');
  await ensureColumn(
    db,
    'goals',
    'completion_high_priority_completed',
    'INTEGER'
  );

  await ensureColumn(
    db,
    'brain_dumps',
    'archived',
    'INTEGER NOT NULL DEFAULT 0'
  );
  await ensureColumn(
    db,
    'brain_dumps',
    'archived_at',
    'TEXT'
  );

  /*
   * Repair broken links before adding database guardrails. This keeps every
   * user-created task and recurring rule while removing references to records
   * that no longer exist.
   */
  await repairOrphanedRelationships(db);

  /*
   * Older databases or manually restored data may contain duplicate recurring
   * identities from before the unique index existed. Repair those rows without
   * deleting tasks so the index can always be created safely.
   */
  await repairDuplicateRecurringOccurrenceIdentities(db);

  /*
   * occurrence_date is the generated occurrence's permanent identity.
   * due_date can change when the user reschedules the task.
   */
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS
      idx_goal_milestones_goal_id
    ON goal_milestones (goal_id);

    CREATE INDEX IF NOT EXISTS
      idx_goal_milestones_target_date
    ON goal_milestones (target_date);

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_tasks_recurring_occurrence
    ON tasks (recurring_rule_id, recurrence_occurrence_date)
    WHERE recurring_rule_id IS NOT NULL
      AND recurrence_occurrence_date IS NOT NULL;

    CREATE INDEX IF NOT EXISTS
      idx_tasks_due_date
    ON tasks (due_date);

    CREATE INDEX IF NOT EXISTS
      idx_task_templates_updated_at
    ON task_templates (updated_at DESC);

    CREATE INDEX IF NOT EXISTS
      idx_recurring_rules_active
    ON recurring_rules (active);

    CREATE INDEX IF NOT EXISTS
      idx_weekly_reviews_cycle_id
    ON weekly_reviews (cycle_id);

    CREATE INDEX IF NOT EXISTS
      idx_weekly_commitments_week_start
    ON weekly_commitments (week_start, completed, id);

    CREATE INDEX IF NOT EXISTS
      idx_weekly_commitments_cycle_id
    ON weekly_commitments (cycle_id);

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_weekly_commitments_task_identity
    ON weekly_commitments (week_start, task_id)
    WHERE task_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS
      idx_weekly_task_decisions_week_start
    ON weekly_task_decisions (week_start, decided_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_weekly_task_decision_identity
    ON weekly_task_decisions (week_start, task_id, original_due_date)
    WHERE task_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS
      idx_planning_cycles_single_active
    ON planning_cycles (active)
    WHERE active = 1;
  `);

  await createRelationshipTriggers(db);
  await backfillLegacyTaskDueDates(db);
}

export async function migrateDb() {
  if (!migrationPromise) {
    migrationPromise = runMigrations().catch((error) => {
      migrationPromise = null;
      throw error;
    });
  }

  return migrationPromise;
}
