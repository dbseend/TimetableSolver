"""Independent checker for a chosen timetable. Must NOT import app.solver (enforced by a test).

It recomputes everything from the catalog in plain Python, so it can grade the solver, an LLM
baseline, or a hand-made timetable the same way. Violation amounts use natural units:

credit_range / category_min: half-credits outside the bound; day_off / lunch_free: days;
time_avoid / time_prefer: minutes; max_gap / max_consecutive: periods over the limit;
max_days_on_campus: days over; must_* / instructor_prefer: 0 or 1; instructor_avoid: sections.
"""

from collections import defaultdict
from dataclasses import dataclass, field

from app.core.periods import max_consecutive_periods, max_gap_periods, periods_of
from app.core.time_slots import parse_hhmm
from app.domain.constraints import Constraint
from app.domain.models import Catalog, Profile


@dataclass
class Report:
    structural: list[str] = field(default_factory=list)  # always-on rules (conflicts, pool...)
    violations: dict[str, int] = field(default_factory=dict)  # constraint id -> amount > 0

    def hard_violations(self, constraints: list[Constraint]) -> list[str]:
        return [c.id for c in constraints if c.strength == "hard" and c.id in self.violations]

    def feasible(self, constraints: list[Constraint]) -> bool:
        return not self.structural and not self.hard_violations(constraints)


def norm_name(name: str | None) -> str:
    return "".join((name or "").split())


def _overlap(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def _runs(flags: list[bool], value: bool) -> list[int]:
    """Lengths of maximal runs equal to `value`; for empty runs only those between classes."""
    runs, n = [], 0
    for f in flags:
        if f == value:
            n += 1
        else:
            if n:
                runs.append(n)
            n = 0
    if n and value:  # a trailing empty run is after the last class, not a gap
        runs.append(n)
    if not value and flags and not flags[0] and runs:
        runs = runs[1:]  # a leading empty run is before the first class
    return runs


def check(
    catalog: Catalog,
    section_ids: list[str],
    constraints: list[Constraint],
    pool: list[str] | None = None,
    profile: Profile | None = None,
) -> Report:
    r = Report()
    by_id = {s.id: s for s in catalog.sections}
    courses = {c.id: c for c in catalog.courses}
    secs = []
    for sid in section_ids:
        if sid in by_id:
            secs.append(by_id[sid])
        else:
            r.structural.append(f"unknown section {sid}")
    chosen = [s.course_id for s in secs]
    if len(set(chosen)) != len(chosen):
        r.structural.append("more than one section of a course")
    if pool is not None:
        allowed = set(pool) | {c.params.course_id for c in constraints if c.type == "must_include"}
        r.structural += [f"{c} not in pool" for c in chosen if c not in allowed]
    if profile is not None:
        done = set(profile.taken) | set(profile.in_progress)
        r.structural += [f"{c} already taken" for c in chosen if c in done]
        r.structural += [
            f"{c} prerequisites unmet" for c in chosen if not set(courses[c].prerequisites) <= done
        ]

    blocks = [  # (day, start, end, section)
        (m.day, parse_hhmm(m.start), parse_hhmm(m.end), s) for s in secs for m in s.meetings
    ]
    for i, (d1, s1, e1, x) in enumerate(blocks):
        for d2, s2, e2, y in blocks[i + 1 :]:
            if d1 == d2 and x.id != y.id and _overlap(s1, e1, s2, e2):
                r.structural.append(f"time conflict {x.id} / {y.id}")

    days = {b[0] for b in blocks}
    occupied: dict[str, set[int]] = defaultdict(set)
    for d, s, e, _ in blocks:
        occupied[d].update(periods_of(s, e))

    def flags(day: str) -> list[bool]:
        top = max(occupied[day], default=0)
        return [p in occupied[day] for p in range(0, top + 1)]

    credit2 = {s.id: round(catalog.credit_and_category(s)[0] * 2) for s in secs}
    total2 = sum(credit2.values())

    for c in constraints:
        p = c.params
        amount = 0
        match c.type:
            case "credit_range":
                amount = max(0, 2 * p.min - total2) + max(0, total2 - 2 * p.max)
            case "must_include":
                amount = int(p.course_id not in chosen)
            case "must_exclude":
                amount = int(p.course_id in chosen)
            case "day_off":
                amount = len(days & set(p.days))
            case "time_avoid":
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                amount = sum(_overlap(s, e, w0, w1) for d, s, e, _ in blocks if d in p.days)
            case "time_prefer":  # minutes on the listed days outside the window
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                amount = sum(
                    (e - s) - _overlap(s, e, w0, w1) for d, s, e, _ in blocks if d in p.days
                )
            case "max_gap":
                g = max_gap_periods(p.minutes)
                amount = sum(max(0, n - g) for d in days for n in _runs(flags(d), False))
            case "lunch_free":
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                amount = sum(
                    1
                    for d in days
                    if (w1 - w0) - sum(_overlap(s, e, w0, w1) for dd, s, e, _ in blocks if dd == d)
                    < p.min_free_minutes
                )
            case "max_consecutive":
                k = max_consecutive_periods(p.minutes)
                amount = sum(max(0, n - k) for d in days for n in _runs(flags(d), True))
            case "max_days_on_campus":
                amount = max(0, len(days) - p.max_days)
            case "category_min":
                got = sum(
                    credit2[s.id] for s in secs if catalog.credit_and_category(s)[1] == p.category
                )
                amount = max(0, 2 * p.credits - got)
            case "instructor_avoid":
                amount = sum(norm_name(s.instructor) == norm_name(p.instructor) for s in secs)
            case "instructor_prefer":
                amount = int(
                    not any(norm_name(s.instructor) == norm_name(p.instructor) for s in secs)
                )
        if amount:
            r.violations[c.id] = amount
    return r
