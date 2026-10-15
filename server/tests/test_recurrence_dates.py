"""Calendar recurrence tests; no running PostgreSQL instance is needed."""

from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services.recurrence import (
    DEFAULT_GENERATION_HORIZON_DAYS,
    MAX_GENERATION_HORIZON_DAYS,
    generation_window_end,
    get_recurring_occurrence_dates,
)


def make_rule(frequency="daily", start="2026-10-12", end=None, weekdays=None, active=True):
    """Provide only the fields needed by the date-calculation service."""

    return SimpleNamespace(
        frequency=frequency,
        start_date=date.fromisoformat(start),
        end_date=date.fromisoformat(end) if end is not None else None,
        weekdays=[] if weekdays is None else list(weekdays),
        active=active,
    )


@pytest.mark.parametrize(
    "rule_values,current,horizon,expected",
    [
        ({}, "2026-10-12", 0, ["2026-10-12"]),
        ({}, "2026-10-12", 2, ["2026-10-12", "2026-10-13", "2026-10-14"]),
        ({"start": "2026-10-14"}, "2026-10-12", 3, ["2026-10-14", "2026-10-15"]),
        ({"end": "2026-10-13"}, "2026-10-12", 5, ["2026-10-12", "2026-10-13"]),
        ({"end": "2026-10-13"}, "2026-10-14", 5, []),
        ({"start": "2026-11-01"}, "2026-10-12", 5, []),
        ({"active": False}, "2026-10-12", 30, []),
        ({"frequency": "weekly"}, "2026-10-12", 14,
         ["2026-10-12", "2026-10-19", "2026-10-26"]),
        ({"frequency": "weekly"}, "2026-10-13", 7, ["2026-10-19"]),
        ({"frequency": "weekly", "start": "2026-10-18"}, "2026-10-18", 7,
         ["2026-10-18", "2026-10-25"]),
        ({"frequency": "everyTwoWeeks"}, "2026-10-12", 28,
         ["2026-10-12", "2026-10-26", "2026-11-09"]),
        ({"frequency": "everyTwoWeeks"}, "2026-10-19", 20,
         ["2026-10-26"]),
        ({"frequency": "everyTwoWeeks", "start": "2026-10-25"}, "2026-10-25", 28,
         ["2026-10-25", "2026-11-08", "2026-11-22"]),
        ({"frequency": "everyTwoWeeks", "start": "2026-03-01"}, "2026-03-01", 28,
         ["2026-03-01", "2026-03-15", "2026-03-29"]),
        ({"frequency": "certainDays", "weekdays": [0, 6]}, "2026-10-12", 6,
         ["2026-10-17", "2026-10-18"]),
        ({"frequency": "certainDays", "weekdays": [1, 3, 5]}, "2026-10-12", 6,
         ["2026-10-12", "2026-10-14", "2026-10-16"]),
        ({"frequency": "certainDays", "weekdays": [5, 1, 3]}, "2026-10-12", 6,
         ["2026-10-12", "2026-10-14", "2026-10-16"]),
        ({"frequency": "monthly", "start": "2025-01-31"}, "2025-01-31", 89,
         ["2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30"]),
        ({"frequency": "monthly", "start": "2024-01-31"}, "2024-01-31", 60,
         ["2024-01-31", "2024-02-29", "2024-03-31"]),
        ({"frequency": "monthly", "start": "2025-01-30"}, "2025-02-01", 60,
         ["2025-02-28", "2025-03-30"]),
        ({"frequency": "monthly", "start": "2025-01-29"}, "2025-02-01", 60,
         ["2025-02-28", "2025-03-29"]),
        ({"frequency": "monthly", "start": "2024-02-29"}, "2025-02-01", 59,
         ["2025-02-28", "2025-03-29"]),
        ({"frequency": "monthly", "start": "2026-12-31"}, "2026-12-31", 60,
         ["2026-12-31", "2027-01-31", "2027-02-28"]),
        ({"frequency": "weekly", "end": "2026-10-19"}, "2026-10-12", 30,
         ["2026-10-12", "2026-10-19"]),
    ],
)
def test_occurrence_dates_match_calendar_expectations(rule_values, current, horizon, expected):
    rule = make_rule(**rule_values)
    actual = get_recurring_occurrence_dates(rule, date.fromisoformat(current), horizon)
    assert actual == [date.fromisoformat(value) for value in expected]
    assert actual == sorted(set(actual))


def test_default_horizon_includes_today_and_the_next_thirty_days():
    current = date(2026, 10, 12)
    dates = get_recurring_occurrence_dates(make_rule(), current)
    assert DEFAULT_GENERATION_HORIZON_DAYS == 30
    assert dates == [current + timedelta(days=offset) for offset in range(31)]
    assert generation_window_end(current) == date(2026, 11, 11)


def test_one_year_horizon_limit_is_inclusive():
    current = date(2026, 10, 12)
    assert MAX_GENERATION_HORIZON_DAYS == 366
    dates = get_recurring_occurrence_dates(make_rule(), current, 366)
    assert len(dates) == 367
    assert dates[-1] == current + timedelta(days=366)


@pytest.mark.parametrize("horizon", [-1, 367, True, False, 1.5, "30", None])
def test_invalid_horizons_are_rejected(horizon):
    with pytest.raises(ValueError, match="horizon_days"):
        get_recurring_occurrence_dates(make_rule(), date(2026, 10, 12), horizon)


@pytest.mark.parametrize("current", [None, "2026-10-12", datetime(2026, 10, 12, 12)])
def test_window_requires_an_explicit_calendar_date(current):
    with pytest.raises(ValueError, match="calendar date"):
        get_recurring_occurrence_dates(make_rule(), current, 0)


def test_overflowing_generation_window_is_rejected():
    with pytest.raises(ValueError, match="supported date range"):
        generation_window_end(date.max, 1)


def test_last_supported_date_works_without_incrementing_past_it():
    rule = make_rule(start="9999-12-31")
    assert get_recurring_occurrence_dates(rule, date.max, 0) == [date.max]


def test_first_supported_date_is_valid():
    rule = make_rule(start="0001-01-01")
    assert get_recurring_occurrence_dates(rule, date.min, 0) == [date.min]


def test_unsupported_frequency_is_rejected():
    with pytest.raises(ValueError, match="frequency"):
        get_recurring_occurrence_dates(make_rule(frequency="yearly"), date(2026, 10, 12))


def test_reversed_schedule_dates_are_rejected():
    with pytest.raises(ValueError, match="end_date"):
        get_recurring_occurrence_dates(make_rule(end="2026-10-11"), date(2026, 10, 12))


def test_selected_weekdays_cannot_be_empty():
    with pytest.raises(ValueError, match="at least one weekday"):
        get_recurring_occurrence_dates(make_rule(frequency="certainDays"), date(2026, 10, 12))


def test_calculation_does_not_rewrite_the_schedule():
    rule = make_rule(frequency="certainDays", weekdays=[5, 1, 3])
    before = {**vars(rule), "weekdays": list(rule.weekdays)}
    first = get_recurring_occurrence_dates(rule, date(2026, 10, 12), 30)
    second = get_recurring_occurrence_dates(rule, date(2026, 10, 12), 30)
    assert first == second
    assert vars(rule) == before
