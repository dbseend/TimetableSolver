"""Time <-> slot utilities.

All internal computation uses (day_index, slot_index). Only the API boundary uses "HH:MM".

Grid: Mon-Sat, 08:00-24:00, 30-minute slots. Real 2026-2 data uses periods 1-10 (09:00 + 90min
steps, last class ends 23:45) and has a few Saturday classes (docs/academic_rules.md §1).

Rounding rule for times that are not aligned to the grid: the start is rounded DOWN and the end
is rounded UP, so a meeting always occupies every slot it touches (conservative for conflicts).
"""

import re
from typing import Literal

Day = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
DAYS: tuple[Day, ...] = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

DAY_START_MIN = 8 * 60  # 08:00
DAY_END_MIN = 24 * 60  # 24:00 (end of day; exclusive)
SLOT_MIN = 30
N_SLOTS = (DAY_END_MIN - DAY_START_MIN) // SLOT_MIN  # 32

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def parse_hhmm(value: str) -> int:
    """'09:30' -> minutes since midnight. Raises ValueError on bad format."""
    m = _HHMM.match(value)
    if not m:
        raise ValueError(f"invalid time {value!r}, expected HH:MM (00:00-23:59)")
    return int(m.group(1)) * 60 + int(m.group(2))


def format_hhmm(minutes: int) -> str:
    if not 0 <= minutes < 24 * 60:
        raise ValueError(f"minutes out of range: {minutes}")
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def day_index(day: str) -> int:
    try:
        return DAYS.index(day)  # type: ignore[arg-type]
    except ValueError:
        raise ValueError(f"invalid day {day!r}, expected one of {DAYS}") from None


def slot_start(slot: int) -> int:
    """First minute (since midnight) of a slot."""
    return DAY_START_MIN + slot * SLOT_MIN


def meeting_slots(day: str, start: str, end: str) -> frozenset[tuple[int, int]]:
    """Set of (day_index, slot_index) occupied by a meeting. `end` is exclusive."""
    d = day_index(day)
    s, e = parse_hhmm(start), parse_hhmm(end)
    if s >= e:
        raise ValueError(f"start {start} must be before end {end}")
    if s < DAY_START_MIN or e > DAY_END_MIN:
        raise ValueError(
            f"meeting {start}-{end} outside grid {format_hhmm(DAY_START_MIN)}-"
            f"{DAY_END_MIN // 60:02d}:{DAY_END_MIN % 60:02d}"
        )
    first = (s - DAY_START_MIN) // SLOT_MIN
    last_exclusive = -(-(e - DAY_START_MIN) // SLOT_MIN)  # ceil division
    return frozenset((d, t) for t in range(first, last_exclusive))
