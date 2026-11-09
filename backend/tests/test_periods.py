import pytest

from app.core.periods import (
    max_consecutive_periods,
    max_gap_periods,
    period_start,
    periods_of,
)
from app.core.time_slots import parse_hhmm as t


def test_period_starts():
    assert [period_start(n) for n in (1, 3, 10)] == [t("09:00"), t("12:00"), t("22:30")]


@pytest.mark.parametrize(
    "start,end,expected",
    [
        ("09:00", "10:15", [1]),
        ("09:00", "11:45", [1, 2]),  # two periods merged into one block
        ("09:00", "09:50", [1]),
        ("12:00", "13:15", [3]),
        ("13:00", "15:45", [3, 4, 5]),  # not period-aligned: every touched period
        ("08:00", "08:50", [0]),
        ("22:30", "23:45", [10]),
    ],
)
def test_periods_of(start, end, expected):
    assert list(periods_of(t(start), t(end))) == expected


@pytest.mark.parametrize("minutes,runs", [(0, 0), (74, 0), (150, 2), (180, 2), (225, 3)])
def test_max_consecutive_periods(minutes, runs):
    assert max_consecutive_periods(minutes) == runs


@pytest.mark.parametrize("minutes,empty", [(0, 0), (60, 0), (104, 0), (105, 1), (120, 1), (195, 2)])
def test_max_gap_periods(minutes, empty):
    assert max_gap_periods(minutes) == empty
