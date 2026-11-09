"""Campus period (교시) rules, shared by the loader, the solver and the validator.

2026-2 (docs/academic_rules.md §1): period n starts at 09:00 + (n-1)*90min; a class lasts 75min
for 3-credit courses and 50min for 2-credit ones, so periods are separated by >=15min breaks.

Block constraints (consecutive classes, gaps) are measured in periods, not 30-minute slots:
slot rounding makes two back-to-back 75min periods look like 180 contiguous minutes.
A meeting occupies every period whose 90-minute window [start_n, start_n + 90) it overlaps;
times before 09:00 fall in period 0.
"""

FIRST_PERIOD_MIN = 9 * 60
PERIOD_STEP_MIN = 90
BREAK_MIN = 15
CLASS_MIN = 75  # length used to turn "N minutes of 연강" into a period count
LAST_PERIOD = 10


def period_start(n: int) -> int:
    return FIRST_PERIOD_MIN + (n - 1) * PERIOD_STEP_MIN


def period_len(credit: float) -> int:
    # shortcut: credits other than 2 and 3 are unconfirmed; >=3 -> 75, else 50 (50min per credit
    # rule, Academic Regulation art. 42). Revisit if real 1- or 4+-credit timings differ.
    return 75 if credit >= 3 else 50


def periods_of(start_min: int, end_min: int) -> range:
    """Periods a [start, end) meeting touches."""
    first = (start_min - FIRST_PERIOD_MIN) // PERIOD_STEP_MIN + 1
    last = (end_min - 1 - FIRST_PERIOD_MIN) // PERIOD_STEP_MIN + 1
    return range(max(first, 0), max(last, 0) + 1)


def max_consecutive_periods(minutes: int) -> int:
    """'연강 최대 N분' -> allowed run of occupied periods (150 -> 2: two 75min classes)."""
    return minutes // CLASS_MIN


def max_gap_periods(minutes: int) -> int:
    """'공강 최대 N분' -> allowed run of empty periods between classes (one empty period = 105min).
    The 15min break between adjacent periods is never a gap."""
    return max(0, (minutes - BREAK_MIN) // PERIOD_STEP_MIN)
