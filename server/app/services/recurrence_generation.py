"""Create missing recurring tasks while retaining existing task history."""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Goal, RecurringOccurrenceException, RecurringRule, Task
from app.services.recurrence import (
    DEFAULT_GENERATION_HORIZON_DAYS,
    generation_window_end,
    get_recurring_occurrence_dates,
)


DAY_NAMES = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)


class RecurringScheduleNotFoundError(Exception):
    """The requested PostgreSQL schedule does not exist."""


class RecurrenceGenerationConflictError(Exception):
    """Generation could not finish safely; the entire request was rolled back."""


@dataclass(frozen=True)
class RecurrenceGenerationResult:
    """Summary for one completed generation transaction.

    Counts describe candidate occurrences, rather than all stored tasks.
    A candidate that is both skipped and already stored counts as skipped.
    Existing tasks are preserved in either case.
    """

    current_date: date
    horizon_days: int
    window_end: date
    rules_checked: int
    candidate_count: int
    created_count: int
    existing_count: int
    skipped_count: int
    created_task_ids: list[int]
    database_changed: bool


def generate_recurring_tasks(
    *,
    db: Session,
    current_date: date,
    horizon_days: int = DEFAULT_GENERATION_HORIZON_DAYS,
    recurring_rule_id: int | None = None,
) -> RecurrenceGenerationResult:
    """Generate missing occurrences for one schedule or all schedules.

    The caller supplies its local calendar date. Paused schedules create
    nothing. Native and legacy occurrence identities prevent duplicates,
    including tasks moved to another date or to Inbox.

    New tasks copy the schedule's current goal and details. Existing tasks
    are never edited, relinked, completed, reopened, or deleted here.

    This service owns the session transaction: it commits only after every
    selected schedule succeeds and rolls back all its writes on failure.
    """

    try:
        window_end = generation_window_end(current_date, horizon_days)

        if recurring_rule_id is not None and (
            type(recurring_rule_id) is not int
            or not 0 < recurring_rule_id <= 2_147_483_647
        ):
            raise ValueError("recurring_rule_id must be a positive PostgreSQL ID")

        # Match task writes, schedule edits, skip writes, and backup imports.
        # This keeps the schedule, parent goal, skips, and task identities
        # stable between checking for duplicates and inserting new tasks.
        db.execute(text(
            "LOCK TABLE goals, recurring_occurrence_exceptions, "
            "recurring_rules, tasks IN SHARE ROW EXCLUSIVE MODE"
        ))

        statement = select(RecurringRule).order_by(RecurringRule.id.asc())
        if recurring_rule_id is not None:
            statement = statement.where(RecurringRule.id == recurring_rule_id)

        rules = list(db.scalars(
            statement.execution_options(populate_existing=True)
        ).all())

        if recurring_rule_id is not None and not rules:
            raise RecurringScheduleNotFoundError("Recurring schedule not found.")

        # Calculate every selected rule before creating any tasks. The date
        # service returns no candidates for paused or out-of-window rules.
        candidates = [
            (rule, get_recurring_occurrence_dates(rule, current_date, horizon_days))
            for rule in rules
        ]
        candidate_count = sum(len(dates) for _, dates in candidates)
        rule_ids = {rule.id for rule, dates in candidates if dates}
        source_rule_ids = {
            rule.source_recurring_rule_id
            for rule, dates in candidates
            if dates and rule.source_recurring_rule_id is not None
        }

        native_occurrences: set[tuple[int, date]] = set()
        source_owners: dict[tuple[int, date], int | None] = {}
        skipped_occurrences: set[tuple[int, date]] = set()
        goals: dict[int, Goal] = {}

        if rule_ids:
            # Match by original occurrence date, not the editable due date.
            # Also inspect source owners with a different native schedule:
            # those are genuine conflicts, not safe identical retries.
            task_link = Task.recurring_rule_id.in_(rule_ids)
            if source_rule_ids:
                task_link = or_(
                    task_link,
                    Task.source_recurring_rule_id.in_(source_rule_ids),
                )

            existing_tasks = db.scalars(
                select(Task)
                .where(
                    task_link,
                    Task.recurrence_occurrence_date.between(current_date, window_end),
                )
                .execution_options(populate_existing=True)
            ).all()

            for task in existing_tasks:
                occurrence_date = task.recurrence_occurrence_date
                if task.recurring_rule_id is not None:
                    native_occurrences.add((task.recurring_rule_id, occurrence_date))
                if task.source_recurring_rule_id is not None:
                    source_owners[(task.source_recurring_rule_id, occurrence_date)] = (
                        task.recurring_rule_id
                    )

            exceptions = db.scalars(
                select(RecurringOccurrenceException).where(
                    RecurringOccurrenceException.recurring_rule_id.in_(rule_ids),
                    RecurringOccurrenceException.occurrence_date.between(current_date, window_end),
                )
            ).all()
            skipped_occurrences = {
                (item.recurring_rule_id, item.occurrence_date)
                for item in exceptions
            }

            goal_ids = {
                rule.goal_id
                for rule, dates in candidates
                if dates and rule.goal_id is not None
            }
            if goal_ids:
                goals = {
                    goal.id: goal
                    for goal in db.scalars(
                        select(Goal)
                        .where(Goal.id.in_(goal_ids))
                        .execution_options(populate_existing=True)
                    ).all()
                }
                if set(goals) != goal_ids:
                    raise RecurrenceGenerationConflictError(
                        "A selected schedule references a missing goal. No changes were saved."
                    )

        created_task_ids: list[int] = []
        existing_count = 0
        skipped_count = 0

        for rule, dates in candidates:
            for occurrence_date in dates:
                native_key = (rule.id, occurrence_date)

                if native_key in skipped_occurrences:
                    skipped_count += 1
                    continue

                if native_key in native_occurrences:
                    existing_count += 1
                    continue

                source_key = (rule.source_recurring_rule_id, occurrence_date)
                if rule.source_recurring_rule_id is not None and source_key in source_owners:
                    owner_rule_id = source_owners[source_key]
                    if owner_rule_id is None or owner_rule_id == rule.id:
                        # Preserve a source-only imported occurrence exactly
                        # as stored. Relationship repair belongs to imports.
                        existing_count += 1
                        continue

                    raise RecurrenceGenerationConflictError(
                        "An occurrence source identity belongs to another schedule. "
                        "No changes were saved."
                    )

                goal = goals.get(rule.goal_id)
                task = Task(
                    # PostgreSQL generates id; there is no SQLite task ID.
                    source_task_id=None,
                    title=rule.title,
                    notes=rule.notes,
                    priority=rule.priority,
                    goal_id=rule.goal_id,
                    source_goal_id=goal.source_goal_id if goal is not None else None,
                    day=DAY_NAMES[occurrence_date.weekday()],
                    due_date=occurrence_date,
                    recurring_rule_id=rule.id,
                    source_recurring_rule_id=rule.source_recurring_rule_id,
                    recurrence_occurrence_date=occurrence_date,
                    completed=False,
                    completed_at=None,
                )
                db.add(task)
                db.flush()
                created_task_ids.append(task.id)
                native_occurrences.add(native_key)
                if rule.source_recurring_rule_id is not None:
                    source_owners[source_key] = rule.id

        result = RecurrenceGenerationResult(
            current_date=current_date,
            horizon_days=horizon_days,
            window_end=window_end,
            rules_checked=len(rules),
            candidate_count=candidate_count,
            created_count=len(created_task_ids),
            existing_count=existing_count,
            skipped_count=skipped_count,
            created_task_ids=created_task_ids,
            database_changed=bool(created_task_ids),
        )

        db.commit()
        return result

    except IntegrityError as error:
        db.rollback()
        raise RecurrenceGenerationConflictError(
            "Recurring tasks could not be generated safely. No changes were saved."
        ) from error

    except Exception:
        db.rollback()
        raise
