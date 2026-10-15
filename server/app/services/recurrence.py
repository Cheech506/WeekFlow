"""Calculate recurring occurrence dates without reading or writing a database."""

from calendar import monthrange
from datetime import date, timedelta
from typing import Protocol


DEFAULT_GENERATION_HORIZON_DAYS = 30
MAX_GENERATION_HORIZON_DAYS = 366

SUPPORTED_FREQUENCIES = {
    "daily",
    "weekly",
    "everyTwoWeeks",
    "certainDays",
    "monthly",
}


class RecurringSchedule(Protocol):
    """The schedule fields needed to calculate dates."""

    frequency: str
    start_date: date
    end_date: date | None
    weekdays: list[int]
    active: bool


def generation_window_end(
    current_date: date,
    horizon_days: int = DEFAULT_GENERATION_HORIZON_DAYS,
) -> date:
    """Return the inclusive end of a finite generation window.

    A horizon of zero checks the current date only. A horizon of 30
    includes the current date and the following 30 calendar days.
    """

    # datetime is a date subclass, but generation expects a calendar date.
    if type(current_date) is not date:
        raise ValueError("current_date must be a calendar date")

    if type(horizon_days) is not int:
        raise ValueError("horizon_days must be an integer")

    if not 0 <= horizon_days <= MAX_GENERATION_HORIZON_DAYS:
        raise ValueError(
            f"horizon_days must be between 0 and {MAX_GENERATION_HORIZON_DAYS}"
        )

    try:
        return current_date + timedelta(days=horizon_days)
    except OverflowError as error:
        raise ValueError("The generation window exceeds the supported date range") from error


def _matches_recurring_date(rule: RecurringSchedule, candidate: date) -> bool:
    """Match WeekFlow's existing calendar rules within a valid date range."""

    if rule.frequency == "daily":
        return True

    if rule.frequency == "weekly":
        return candidate.weekday() == rule.start_date.weekday()

    if rule.frequency == "everyTwoWeeks":
        # Calendar-day subtraction is unaffected by daylight-saving time.
        return (candidate - rule.start_date).days % 14 == 0

    if rule.frequency == "certainDays":
        # WeekFlow uses JavaScript's numbering: Sunday=0, Saturday=6.
        weekday = (candidate.weekday() + 1) % 7
        return weekday in rule.weekdays

    if rule.frequency == "monthly":
        # Keep the original anchor after shorter months. For a Jan 31
        # schedule, February uses its last day and March returns to the 31st.
        last_day = monthrange(candidate.year, candidate.month)[1]
        return candidate.day == min(rule.start_date.day, last_day)

    raise ValueError("Recurring schedule frequency is invalid")


def get_recurring_occurrence_dates(
    rule: RecurringSchedule,
    current_date: date,
    horizon_days: int = DEFAULT_GENERATION_HORIZON_DAYS,
) -> list[date]:
    """Return ascending dates inside the schedule and request boundaries.

    Both boundaries are inclusive. The caller supplies its calendar date
    explicitly instead of relying on the API host's timezone or clock.
    Paused schedules and schedules outside the window return no dates.

    This function calculates candidates only. The database-writing service
    must separately exclude skips and existing task occurrence identities.
    """

    window_end = generation_window_end(current_date, horizon_days)

    if not rule.active:
        return []

    if rule.frequency not in SUPPORTED_FREQUENCIES:
        raise ValueError("Recurring schedule frequency is invalid")

    if rule.end_date is not None and rule.end_date < rule.start_date:
        raise ValueError("end_date cannot be before start_date")

    if rule.frequency == "certainDays" and not rule.weekdays:
        raise ValueError("certainDays requires at least one weekday")

    first_date = max(current_date, rule.start_date)
    last_date = (
        min(window_end, rule.end_date)
        if rule.end_date is not None
        else window_end
    )

    if last_date < first_date:
        return []

    occurrences: list[date] = []
    for offset in range((last_date - first_date).days + 1):
        candidate = first_date + timedelta(days=offset)
        if _matches_recurring_date(rule, candidate):
            occurrences.append(candidate)

    return occurrences
