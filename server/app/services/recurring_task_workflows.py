"""Convert tasks and revise recurring series in a single transaction."""

from sqlalchemy import and_, delete, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Goal, RecurringOccurrenceException, RecurringRule, Task
from app.schemas import (
    RecurrenceGenerationRead,
    RecurringEditFromOccurrenceRequest,
    RecurringRuleCreate,
    RecurringRuleRead,
    RecurringTaskWorkflowRead,
    TaskConvertToRecurringRequest,
    TaskRead,
)
from app.services.recurrence_generation import (
    DAY_NAMES,
    RecurrenceGenerationConflictError,
    RecurrenceGenerationResult,
    generate_recurring_tasks_in_transaction,
)


class RecurringTaskNotFoundError(Exception):
    """The selected task, schedule, or requested goal does not exist."""


class RecurringTaskConflictError(Exception):
    """The requested action cannot safely change the selected task."""


def _lock_workflow_writes(db: Session) -> None:
    """Keep tasks, goals, skips, and dependent history stable while editing."""

    # Match the order used by schedule deletion, weekly decisions, and
    # backup imports. Deleting later tasks clears their live links in the
    # weekly tables through ON DELETE SET NULL; saved history is retained.
    db.execute(text(
        "LOCK TABLE goals, recurring_occurrence_exceptions, "
        "recurring_rules, tasks, weekly_commitments, "
        "weekly_task_decisions IN SHARE ROW EXCLUSIVE MODE"
    ))


def _require_unfinished_task(db: Session, task_id: int) -> Task:
    """Load the latest selected task under the workflow's table locks."""

    if type(task_id) is not int or not 0 < task_id <= 2_147_483_647:
        raise ValueError("task_id must be a positive PostgreSQL ID")

    task = db.scalar(
        select(Task)
        .where(Task.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if task is None:
        raise RecurringTaskNotFoundError("Task not found.")
    if task.completed or task.completed_at is not None:
        raise RecurringTaskConflictError(
            "Only an unfinished task can change a recurring schedule. "
            "No changes were saved."
        )
    return task


def _require_goal(db: Session, goal_id: int | None) -> Goal | None:
    """Resolve the requested native goal and its migration metadata."""

    if goal_id is None:
        return None
    goal = db.scalar(
        select(Goal)
        .where(Goal.id == goal_id)
        .execution_options(populate_existing=True)
    )
    if goal is None:
        raise RecurringTaskNotFoundError("Goal not found.")
    return goal


def _require_task_schedule(db: Session, task: Task) -> RecurringRule:
    """Prefer the native rule link; resolve source-only imported tasks."""

    if task.recurrence_occurrence_date is None:
        raise RecurringTaskConflictError(
            "This task has no recurring occurrence date. No changes were saved."
        )

    if task.recurring_rule_id is not None:
        identity = RecurringRule.id == task.recurring_rule_id
    elif task.source_recurring_rule_id is not None:
        identity = (
            RecurringRule.source_recurring_rule_id == task.source_recurring_rule_id
        )
    else:
        raise RecurringTaskConflictError(
            "This task does not belong to a recurring schedule. "
            "No changes were saved."
        )

    rule = db.scalar(
        select(RecurringRule)
        .where(identity)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if rule is None:
        raise RecurringTaskNotFoundError("Recurring schedule not found.")
    return rule


def _task_rule_link(rule: RecurringRule):
    """Match native occurrences and only genuinely source-only fallbacks."""

    link = Task.recurring_rule_id == rule.id
    if rule.source_recurring_rule_id is not None:
        link = or_(
            link,
            and_(
                Task.recurring_rule_id.is_(None),
                Task.source_recurring_rule_id == rule.source_recurring_rule_id,
            ),
        )
    return link


def _apply_selected_details(
    task: Task,
    schedule: RecurringRuleCreate,
    goal: Goal | None,
) -> None:
    """Edit the selected task without replacing its own row or identity."""

    task.title = schedule.title
    task.notes = schedule.notes
    task.priority = schedule.priority
    task.goal_id = goal.id if goal is not None else None
    task.source_goal_id = goal.source_goal_id if goal is not None else None
    # The task's id, source_task_id, created_at, and completion fields stay.


def _result_before_commit(
    task: Task,
    rule: RecurringRule,
    generation: RecurrenceGenerationResult,
    deleted_task_ids: list[int],
) -> RecurringTaskWorkflowRead:
    """Validate and copy the response while the transaction is still open.

    If response validation fails, the caller rolls back before anything is
    committed. Returning copied schemas also avoids reloading expired ORM
    objects after commit and mixing their values with a later write.
    """

    return RecurringTaskWorkflowRead(
        task=TaskRead.model_validate(task),
        rule=RecurringRuleRead.model_validate(rule),
        generation=RecurrenceGenerationRead.model_validate(generation),
        deleted_task_ids=deleted_task_ids,
    )


def convert_task_to_recurring(
    *,
    db: Session,
    task_id: int,
    request: TaskConvertToRecurringRequest,
) -> RecurringTaskWorkflowRead:
    """Use an existing standalone task as a new schedule's first occurrence.

    The task keeps its PostgreSQL ID, source_task_id, and original creation
    timestamp. Its supplied start date becomes its due date AND original
    recurrence date. The selected task is linked before generation, so
    generation cannot create a duplicate for that first occurrence.

    This function owns the transaction. It commits once after the rule,
    selected task, generated tasks, and response have all been validated.
    A retry after successful conversion returns a conflict because the
    task already belongs to a series; it cannot create a second schedule.
    """

    try:
        _lock_workflow_writes(db)
        task = _require_unfinished_task(db, task_id)
        if any(value is not None for value in (
            task.recurring_rule_id,
            task.source_recurring_rule_id,
            task.recurrence_occurrence_date,
        )):
            raise RecurringTaskConflictError(
                "This task already has a recurring identity. No changes were saved."
            )

        schedule = RecurringRuleCreate.model_validate(
            request.model_dump(exclude={"current_date", "horizon_days"})
        )
        goal = _require_goal(db, schedule.goal_id)
        rule = RecurringRule(**schedule.model_dump())
        db.add(rule)
        # Obtain the new PostgreSQL rule ID without committing anything.
        db.flush()

        _apply_selected_details(task, schedule, goal)
        task.recurring_rule_id = rule.id
        task.source_recurring_rule_id = rule.source_recurring_rule_id
        task.recurrence_occurrence_date = schedule.start_date
        task.due_date = schedule.start_date
        task.day = DAY_NAMES[schedule.start_date.weekday()]
        db.flush()

        generation = generate_recurring_tasks_in_transaction(
            db=db,
            current_date=request.current_date,
            horizon_days=request.horizon_days,
            recurring_rule_id=rule.id,
        )
        result = _result_before_commit(task, rule, generation, [])
        db.commit()
        return result

    except (IntegrityError, RecurrenceGenerationConflictError) as error:
        db.rollback()
        raise RecurringTaskConflictError(
            "The task could not be converted safely. No changes were saved."
        ) from error
    except Exception:
        db.rollback()
        raise


def edit_recurring_from_occurrence(
    *,
    db: Session,
    task_id: int,
    request: RecurringEditFromOccurrenceRequest,
) -> RecurringTaskWorkflowRead:
    """Revise the selected occurrence and rebuild later unfinished tasks.

    This matches WeekFlow's SQLite series-edit behavior:
    - Anchor the revised rule to the selected ORIGINAL occurrence date.
    - Preserve the selected task's ID, due date, and Inbox/scheduled state.
    - Preserve earlier unfinished tasks and ALL completed tasks unchanged,
      including their individual historical goal relationships.
    - Delete only later unfinished occurrences of this rule, even if moved
      to another date or Inbox. Rebuild from the revised pattern within the
      requested generation window; dates beyond it are generated later.
    - Keep existing skips. Keep paused schedules paused.

    Rule IDs and source identities are retained. Weekly commitments and
    decision records referring to deleted tasks retain their saved history
    but lose the live task link, as specified by their database foreign keys.

    This is a series edit, not a harmless read: another successful call can
    rebuild later unfinished tasks again, assigning those tasks fresh IDs.
    """

    try:
        _lock_workflow_writes(db)
        task = _require_unfinished_task(db, task_id)
        rule = _require_task_schedule(db, task)
        occurrence_date = task.recurrence_occurrence_date
        schedule = request.schedule_for_occurrence(
            occurrence_date,
            active=rule.active,
        )
        goal = _require_goal(db, schedule.goal_id)

        # Do not silently erase an explicit skip to make an inconsistent
        # selected task valid. Restore the skipped occurrence first.
        skipped = db.get(RecurringOccurrenceException, (rule.id, occurrence_date))
        if skipped is not None:
            raise RecurringTaskConflictError(
                "The selected occurrence is marked as skipped. "
                "Restore it before editing the series. No changes were saved."
            )

        for field, value in schedule.model_dump().items():
            setattr(rule, field, value)
        _apply_selected_details(task, schedule, goal)
        # A source-only imported selected occurrence now gets its native
        # link. Other historical tasks retain their existing metadata.
        task.recurring_rule_id = rule.id
        task.source_recurring_rule_id = rule.source_recurring_rule_id
        db.flush()

        # Compare original occurrence dates, NOT editable due dates.
        # Native links are authoritative over any stale source metadata.
        deleted_task_ids = sorted(db.scalars(
            delete(Task)
            .where(
                _task_rule_link(rule),
                Task.id != task.id,
                Task.completed.is_(False),
                Task.completed_at.is_(None),
                Task.recurrence_occurrence_date > occurrence_date,
            )
            .returning(Task.id)
            .execution_options(synchronize_session="fetch")
        ).all())

        generation = generate_recurring_tasks_in_transaction(
            db=db,
            current_date=request.current_date,
            horizon_days=request.horizon_days,
            recurring_rule_id=rule.id,
        )
        result = _result_before_commit(task, rule, generation, deleted_task_ids)
        db.commit()
        return result

    except (IntegrityError, RecurrenceGenerationConflictError) as error:
        db.rollback()
        raise RecurringTaskConflictError(
            "The recurring series could not be revised safely. No changes were saved."
        ) from error
    except Exception:
        db.rollback()
        raise


def detach_recurring_task(
    *,
    db: Session,
    task_id: int,
) -> TaskRead:
    """Keep one unfinished occurrence as a standalone task and skip its old slot.

    The original occurrence date, rather than the editable due date, identifies
    the slot that generation must skip. The schedule, other occurrences, goal
    links, task ID, creation timestamp, and weekly history links stay intact.

    This function owns the transaction: saving the skip and clearing all three
    recurring identity fields either succeed together or are rolled back.
    Repeating a successful detach returns a conflict because the task no longer
    belongs to a series. Callers must not automatically retry uncertain writes.
    """

    try:
        # Use the same locks as conversion and series edits so generation,
        # schedule deletion, and other task writes cannot race this change.
        _lock_workflow_writes(db)
        task = _require_unfinished_task(db, task_id)
        rule = _require_task_schedule(db, task)
        occurrence_date = task.recurrence_occurrence_date

        # A native occurrence and a source-only imported occurrence could
        # represent the same slot despite their separate UNIQUE constraints.
        # Do not save a skip that would also apply to a different live task.
        other_task_id = db.scalar(
            select(Task.id)
            .where(
                _task_rule_link(rule),
                Task.recurrence_occurrence_date == occurrence_date,
                Task.id != task.id,
            )
            .limit(1)
        )
        if other_task_id is not None:
            raise RecurringTaskConflictError(
                "Another task represents this recurring occurrence. "
                "Resolve that duplicate before detaching. No changes were saved."
            )

        # Reuse an existing skip without changing its original timestamp.
        identity = (rule.id, occurrence_date)
        skipped = db.get(
            RecurringOccurrenceException,
            identity,
            populate_existing=True,
        )
        if skipped is None:
            db.add(RecurringOccurrenceException(
                recurring_rule_id=rule.id,
                occurrence_date=occurrence_date,
            ))

        # Clear the native link AND imported recurring metadata. Leaving a
        # source rule/date behind would still make generation see recurrence.
        # The task's own source_task_id and goal metadata are preserved.
        task.recurring_rule_id = None
        task.source_recurring_rule_id = None
        task.recurrence_occurrence_date = None
        db.flush()

        # Copy and validate the response before committing, as with the other
        # workflows. A bad response must not leave a half-completed action.
        result = TaskRead.model_validate(task)
        db.commit()
        return result

    except IntegrityError as error:
        db.rollback()
        raise RecurringTaskConflictError(
            "The task could not be detached safely. No changes were saved."
        ) from error
    except Exception:
        db.rollback()
        raise
