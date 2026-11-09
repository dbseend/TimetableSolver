"""CP-SAT model for one solve request (docs/PHASE_D_DESIGN.md DD1-DD4).

Always on: at most one section per course, no overlapping meetings (exact minutes), only pool
courses (+ must_include targets). Each hard user constraint gets an assumption literal so an
infeasible request can be explained by a core of constraint ids.

Objective = pool priority reward - sum(weight * COST[type] * violation) over soft constraints.
Each soft violation is encoded to equal the validator's amount for the same timetable, so the
reported objective can be recomputed independently (tests do, by brute force).
"""

from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from app.core.periods import LAST_PERIOD, max_consecutive_periods, max_gap_periods, periods_of
from app.core.time_slots import DAYS, parse_hhmm
from app.domain.api_models import PoolItem
from app.domain.constraints import Constraint
from app.domain.models import Catalog, Profile, Section
from app.validation.validator import norm_name

PRIORITY_SCALE = 1000  # per priority point of a chosen pool course (priority 3 -> 3000)
# Penalty per unit of violation at weight 1, in the validator's units (see validator docstring).
# Calibrated so a weight-5 violation of a typical size costs about half a priority-3 course:
# one 75min class in an avoided window 5*4*75=1500, one class day on a day off 5*300=1500.
COST = {
    "credit_range": 100,  # per half-credit
    "category_min": 100,  # per half-credit
    "must_include": 600,
    "must_exclude": 600,
    "day_off": 300,  # per day
    "time_avoid": 4,  # per minute
    "time_prefer": 4,  # per minute
    "max_gap": 200,  # per period over
    "max_consecutive": 200,  # per period over
    "lunch_free": 300,  # per day
    "max_days_on_campus": 300,  # per day over
    "instructor_avoid": 300,  # per section
    "instructor_prefer": 300,
}
BIG = 10_000  # loose upper bound for slack variables


def penalty(constraint: Constraint, amount: int) -> int:
    return constraint.weight * COST[constraint.type] * amount


def candidate_sections(
    catalog: Catalog, pool: list[PoolItem], constraints: list[Constraint], profile: Profile
) -> list[Section]:
    wanted = {p.course_id for p in pool}
    wanted |= {c.params.course_id for c in constraints if c.type == "must_include"}
    done = set(profile.taken) | set(profile.in_progress)
    courses = {c.id: c for c in catalog.courses}
    return [
        s
        for s in catalog.sections
        if s.course_id in wanted
        and s.course_id not in done
        and set(courses[s.course_id].prerequisites) <= done
    ]


def _overlap(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


@dataclass
class Built:
    model: cp_model.CpModel
    x: dict[str, cp_model.IntVar]
    lits: dict[str, cp_model.IntVar]  # hard constraint id -> assumption literal
    n_sections: int
    _day: dict[str, cp_model.IntVar] = field(default_factory=dict)


def build(
    catalog: Catalog,
    pool: list[PoolItem],
    constraints: list[Constraint],
    profile: Profile,
) -> Built:
    m = cp_model.CpModel()
    secs = candidate_sections(catalog, pool, constraints, profile)
    x = {s.id: m.new_bool_var(f"x[{s.id}]") for s in secs}
    blocks = [  # (day, start, end, section id)
        (mt.day, parse_hhmm(mt.start), parse_hhmm(mt.end), s.id) for s in secs for mt in s.meetings
    ]

    by_course: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for s in secs:
        by_course[s.course_id].append(x[s.id])
    for vs in by_course.values():
        m.add_at_most_one(vs)

    # Every overlapping pair of intervals overlaps at the later one's start, so one clique per
    # (day, start point) covers all conflicts exactly.
    cliques = set()
    for day, start, _, _ in blocks:
        covering = frozenset(sid for d, s, e, sid in blocks if d == day and s <= start < e)
        if len(covering) > 1:
            cliques.add(covering)
    for clique in cliques:
        m.add_at_most_one(x[sid] for sid in clique)

    credit2, category = {}, {}
    for s in secs:
        credit, category[s.id] = catalog.credit_and_category(s)
        credit2[s.id] = round(credit * 2)
    total2 = sum(credit2[sid] * v for sid, v in x.items())

    on_day: dict[str, set[str]] = defaultdict(set)
    in_period: dict[tuple[str, int], set[str]] = defaultdict(set)
    for day, start, end, sid in blocks:
        on_day[day].add(sid)
        for n in periods_of(start, end):
            in_period[(day, n)].add(sid)

    def used(day: str) -> cp_model.IntVar:
        if day not in built._day:
            d = m.new_bool_var(f"day[{day}]")
            for sid in on_day[day]:
                m.add_implication(x[sid], d)
            m.add(d <= sum(x[sid] for sid in on_day[day]))
            built._day[day] = d
        return built._day[day]

    occ: dict[tuple[str, int], cp_model.IntVar] = {}

    def period(day: str, n: int):
        if not in_period[(day, n)]:
            return 0
        if (day, n) not in occ:
            p = m.new_bool_var(f"p[{day},{n}]")
            for sid in in_period[(day, n)]:
                m.add_implication(x[sid], p)
            m.add(p <= sum(x[sid] for sid in in_period[(day, n)]))
            occ[(day, n)] = p
        return occ[(day, n)]

    def earlier(day: str) -> dict[int, cp_model.IntVar]:
        """earlier[j] == some class in period j or before on that day."""
        before = {}
        for j in range(0, LAST_PERIOD + 1):
            b = m.new_bool_var(f"before[{day},{j}]")
            cur, prev = period(day, j), before.get(j - 1, 0)
            m.add(b >= cur)
            m.add(b >= prev)
            m.add(b <= cur + prev)
            before[j] = b
        return before

    def later(day: str) -> dict[int, cp_model.IntVar]:
        """later[j] == some class in a period after j on that day."""
        after = {LAST_PERIOD: 0}
        for j in reversed(range(0, LAST_PERIOD)):
            a = m.new_bool_var(f"after[{day},{j}]")
            nxt = period(day, j + 1)
            m.add(a >= nxt)
            m.add(a >= after[j + 1])
            m.add(a <= nxt + after[j + 1])
            after[j] = a
        return after

    def forbid(lit, sids) -> None:
        for sid in sids:
            m.add_implication(lit, x[sid].Not())

    def require(lit, condition: bool) -> None:
        if not condition:
            m.add_bool_or([lit.Not()])

    def enforce(expr, lit) -> None:
        """`expr` collapses to a plain bool when every term is a constant 0."""
        if isinstance(expr, bool):
            require(lit, expr)
        else:
            m.add(expr).only_enforce_if(lit)

    built = Built(m, x, {}, len(secs))
    for c in constraints:
        if c.strength != "hard":
            continue
        a = m.new_bool_var(f"hard[{c.id}]")
        built.lits[c.id] = a
        p = c.params
        match c.type:
            case "credit_range":
                enforce(total2 >= 2 * p.min, a)
                enforce(total2 <= 2 * p.max, a)
            case "must_include":
                vs = by_course.get(p.course_id, [])
                require(a, bool(vs))
                if vs:
                    m.add(sum(vs) == 1).only_enforce_if(a)
            case "must_exclude":
                forbid(a, [s.id for s in secs if s.course_id == p.course_id])
            case "day_off":
                for day in p.days:
                    if on_day[day]:
                        m.add_implication(a, used(day).Not())
            case "time_avoid" | "time_prefer":
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                bad = {
                    sid
                    for d, s, e, sid in blocks
                    if d in p.days
                    and (
                        _overlap(s, e, w0, w1) > 0
                        if c.type == "time_avoid"
                        else _overlap(s, e, w0, w1) < e - s  # prefer: must stay inside window
                    )
                }
                forbid(a, bad)
            case "max_gap":
                g = max_gap_periods(p.minutes)
                for day in DAYS:
                    if not on_day[day]:
                        continue
                    after = later(day)
                    for n in range(0, LAST_PERIOD - g):
                        inner = sum(period(day, j) for j in range(n + 1, n + g + 2))
                        enforce(period(day, n) + after[n + g + 1] - inner <= 1, a)
            case "lunch_free":
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                for day in DAYS:
                    taken = sum(
                        _overlap(s, e, w0, w1) * x[sid] for d, s, e, sid in blocks if d == day
                    )
                    enforce(taken <= (w1 - w0) - p.min_free_minutes, a)
            case "max_consecutive":
                r = max_consecutive_periods(p.minutes)
                for day in DAYS:
                    for n in range(0, LAST_PERIOD - r + 1):
                        window = sum(period(day, j) for j in range(n, n + r + 1))
                        enforce(window <= r, a)
            case "max_days_on_campus":
                enforce(sum(used(d) for d in DAYS if on_day[d]) <= p.max_days, a)
            case "category_min":
                got = sum(credit2[sid] * v for sid, v in x.items() if category[sid] == p.category)
                enforce(got >= 2 * p.credits, a)
            case "instructor_avoid" | "instructor_prefer":
                theirs = [s.id for s in secs if norm_name(s.instructor) == norm_name(p.instructor)]
                if c.type == "instructor_avoid":
                    forbid(a, theirs)
                else:
                    require(a, bool(theirs))
                    if theirs:
                        m.add(sum(x[sid] for sid in theirs) >= 1).only_enforce_if(a)
    m.add_assumptions(list(built.lits.values()))

    def slack(lower) -> cp_model.IntVar:
        """max(0, lower) under minimisation pressure."""
        v = m.new_int_var(0, BIG, "slack")
        m.add(v >= lower)
        return v

    def flag(lower) -> cp_model.IntVar:
        """A 0/1 indicator forced to 1 when `lower` >= 1 (penalised, so otherwise 0)."""
        z = m.new_bool_var("flag")
        if not isinstance(lower, int) or lower > 0:
            m.add(z >= lower)
        return z

    def violation(c: Constraint):
        p = c.params
        match c.type:
            case "credit_range":
                return slack(2 * p.min - total2) + slack(total2 - 2 * p.max)
            case "must_include":
                return 1 - sum(by_course.get(p.course_id, []))
            case "must_exclude":
                return sum(by_course.get(p.course_id, []))
            case "day_off":
                return sum(used(d) for d in p.days if on_day[d])
            case "time_avoid" | "time_prefer":
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                return sum(
                    (
                        _overlap(s, e, w0, w1)
                        if c.type == "time_avoid"
                        else e - s - _overlap(s, e, w0, w1)
                    )
                    * x[sid]
                    for d, s, e, sid in blocks
                    if d in p.days
                )
            case "max_gap":  # windows of g+1 empty periods with classes on both sides
                g = max_gap_periods(p.minutes)
                total = 0
                for day in DAYS:
                    if not on_day[day]:
                        continue
                    before, after = earlier(day), later(day)
                    for j in range(1, LAST_PERIOD - g):
                        inner = sum(period(day, k) for k in range(j, j + g + 1))
                        total += flag(before[j - 1] + after[j + g] - inner - 1)
                return total
            case "lunch_free":  # days whose window has less than the free minutes
                w0, w1 = parse_hhmm(p.start), parse_hhmm(p.end)
                total = 0
                for day in DAYS:
                    taken = sum(
                        _overlap(s, e, w0, w1) * x[sid] for d, s, e, sid in blocks if d == day
                    )
                    if not isinstance(taken, int):
                        z = m.new_bool_var("lunch")
                        m.add((w1 - w0) * z >= taken - ((w1 - w0) - p.min_free_minutes))
                        total += z
                return total
            case "max_consecutive":  # full windows of r+1 periods = periods over the limit
                r = max_consecutive_periods(p.minutes)
                return sum(
                    flag(sum(period(day, j) for j in range(n, n + r + 1)) - r)
                    for day in DAYS
                    for n in range(0, LAST_PERIOD - r + 1)
                    if on_day[day]
                )
            case "max_days_on_campus":
                return slack(sum(used(d) for d in DAYS if on_day[d]) - p.max_days)
            case "category_min":
                got = sum(credit2[sid] * v for sid, v in x.items() if category[sid] == p.category)
                return slack(2 * p.credits - got)
            case "instructor_avoid" | "instructor_prefer":
                theirs = sum(
                    x[s.id] for s in secs if norm_name(s.instructor) == norm_name(p.instructor)
                )
                return theirs if c.type == "instructor_avoid" else flag(1 - theirs)

    priority = {p.course_id: p.priority for p in pool}
    reward = sum(PRIORITY_SCALE * priority.get(cid, 3) * sum(vs) for cid, vs in by_course.items())
    penalties = sum(
        c.weight * COST[c.type] * violation(c) for c in constraints if c.strength == "soft"
    )
    m.maximize(reward - penalties)
    return built
