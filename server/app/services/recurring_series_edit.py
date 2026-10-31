"""Save a schedule edit and rebuild unfinished future tasks atomically."""

from sqlalchemy import and_, delete, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Goal, RecurringRule, Task
from app.schemas.recurrence_generation import RecurrenceGenerationRead
from app.schemas.recurring_rule import RecurringRuleRead
from app.schemas.recurring_series_edit import (
    RecurringSeriesEditRead,
    RecurringSeriesEditRequest,
)
from app.services.recurrence_generation import (
    RecurrenceGenerationConflictError,
    generate_recurring_tasks_in_transaction,
)


class RecurringSeriesEditNotFoundError(Exception):
    """The requested schedule or its new goal does not exist."""


class RecurringSeriesEditConflictError(Exception):
    """The edit could not be completed safely; no changes were committed."""


def _task_rule_link(rule: RecurringRule):
    """Prefer native links, with fallback for source-only imported occurrences."""

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


def edit_recurring_series(
    *,
    db: Session,
    rule_id: int,
    request: RecurringSeriesEditRequest,
) -> RecurringSeriesEditRead:
    """Preserve the existing schedule editor's behavior in one transaction.

    - Keep the schedule's PostgreSQL ID, source identity, creation timestamp,
      and active/paused state.
    - Keep every completed task unchanged, including historical goal links.
    - Rebuild unfinished occurrences whose ORIGINAL occurrence date is today
      or later, even when their editable due date or Inbox placement differs.
    - Keep older unfinished occurrences and their IDs/placement, but update
      their title, notes, priority, and goal to the revised schedule details.
    - Retain skip records and let the existing generator enforce occurrence
      uniqueness when creating the replacement tasks.

    Deleting rebuilt tasks clears dependent weekly records' live links through
    their foreign keys. Their saved history remains. Replacement tasks get new
    PostgreSQL IDs. The response is validated before the single commit.

    This action must not be retried automatically after an uncertain response:
    another successful call can rebuild future tasks again with fresh IDs.
    """

    try:
        if type(rule_id) is not int or not 0 < rule_id <= 2_147_483_647:
            raise ValueError("rule_id must be a positive PostgreSQL ID")

        # Match the lock order used by task writes, schedule deletion, weekly
        # decisions, and backup imports. Generation takes a subset of these
        # same locks and leaves the transaction open for this service to commit.
        db.execute(text(
            "LOCK TABLE goals, recurring_occurrence_exceptions, "
            "recurring_rules, tasks, weekly_commitments, "
            "weekly_task_decisions IN SHARE ROW EXCLUSIVE MODE"
        ))

        rule = db.scalar(
            select(RecurringRule)
            .where(RecurringRule.id == rule_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if rule is None:
            raise RecurringSeriesEditNotFoundError("Recurring schedule not found.")

        # Validation happens before changing any stored values. Preserve pause
        # state instead of accepting active=true from a full editor form.
        schedule = request.schedule_for_series(active=rule.active)
        goal = None
        if schedule.goal_id is not None:
            goal = db.scalar(
                select(Goal)
                .where(Goal.id == schedule.goal_id)
                .execution_options(populate_existing=True)
            )
            if goal is None:
                raise RecurringSeriesEditNotFoundError("Goal not found.")

        link = _task_rule_link(rule)
        unfinished = and_(Task.completed.is_(False), Task.completed_at.is_(None))

        earlier_tasks = list(db.scalars(
            select(Task)
            .where(
                link,
                unfinished,
                Task.recurrence_occurrence_date < request.current_date,
            )
            .order_by(Task.id.asc())
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all())

        for field, value in schedule.model_dump().items():
            setattr(rule, field, value)

        updated_task_ids = []
        for task in earlier_tasks:
            task.title = schedule.title
            task.notes = schedule.notes
            task.priority = schedule.priority
            task.goal_id = goal.id if goal is not None else None
            task.source_goal_id = goal.source_goal_id if goal is not None else None
            updated_task_ids.append(task.id)
        db.flush()

        # Compare the original slot, not due_date: moving an occurrence must
        # not cause it to escape or enter the wrong side of the rebuild window.
        deleted_task_ids = sorted(db.scalars(
            delete(Task)
            .where(
                link,
                unfinished,
                Task.recurrence_occurrence_date >= request.current_date,
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
        db.flush()

        result = RecurringSeriesEditRead(
            rule=RecurringRuleRead.model_validate(rule),
            generation=RecurrenceGenerationRead.model_validate(generation),
            deleted_task_ids=deleted_task_ids,
            updated_task_ids=updated_task_ids,
        )
        db.commit()
        return result

    except (IntegrityError, RecurrenceGenerationConflictError) as error:
        db.rollback()
        raise RecurringSeriesEditConflictError(
            "The recurring schedule could not be revised safely. "
            "No changes were saved."
        ) from error
    except Exception:
        db.rollback()
        raise
