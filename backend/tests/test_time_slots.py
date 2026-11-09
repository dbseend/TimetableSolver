import pytest

from app.core.time_slots import (
    DAY_END_MIN,
    DAY_START_MIN,
    N_SLOTS,
    SLOT_MIN,
    format_hhmm,
    meeting_slots,
    parse_hhmm,
)


def test_grid_dimensions():
    assert N_SLOTS == (DAY_END_MIN - DAY_START_MIN) // SLOT_MIN == 32


@pytest.mark.parametrize("s,m", [("00:00", 0), ("09:30", 570), ("23:59", 1439)])
def test_parse_and_format_roundtrip(s, m):
    assert parse_hhmm(s) == m
    assert format_hhmm(m) == s


@pytest.mark.parametrize("bad", ["9:30", "24:00", "12:60", "", "ab:cd", "12:5"])
def test_parse_rejects_bad_format(bad):
    with pytest.raises(ValueError):
        parse_hhmm(bad)


def test_meeting_slots_aligned():
    # 08:00 is slot 0, so 09:00 is slot 2 and 10:30 (exclusive) is slot 5
    assert meeting_slots("Mon", "09:00", "10:30") == {(0, 2), (0, 3), (0, 4)}


def test_unaligned_times_round_outward():
    # 09:15 floors to slot 2, 10:10 ceils to slot 5 (exclusive)
    assert meeting_slots("Tue", "09:15", "10:10") == {(1, 2), (1, 3), (1, 4)}


def test_adjacent_meetings_do_not_overlap():
    a = meeting_slots("Wed", "09:00", "10:00")
    b = meeting_slots("Wed", "10:00", "11:00")
    assert a.isdisjoint(b)


def test_different_days_do_not_overlap():
    assert meeting_slots("Mon", "09:00", "10:00").isdisjoint(meeting_slots("Tue", "09:00", "10:00"))


@pytest.mark.parametrize(
    "day,start,end",
    [
        ("Mon", "10:00", "10:00"),  # empty
        ("Mon", "11:00", "10:00"),  # reversed
        ("Mon", "07:00", "09:00"),  # before grid
        ("Mon", "07:30", "08:30"),  # straddles grid start
        ("Sun", "09:00", "10:00"),  # unsupported day
    ],
)
def test_meeting_slots_rejects_invalid(day, start, end):
    with pytest.raises(ValueError):
        meeting_slots(day, start, end)


def test_saturday_and_late_classes_fit_grid():
    assert meeting_slots("Sat", "09:00", "10:15") == frozenset({(5, 2), (5, 3), (5, 4)})
    last = meeting_slots("Fri", "22:30", "23:45")  # 10th period
    assert max(t for _, t in last) == N_SLOTS - 1
