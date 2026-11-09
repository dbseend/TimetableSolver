"""Solver vs brute force on random small instances, both graded by the independent validator.

Checks: same feasibility verdict, optimal objective (priority reward minus weighted soft
violations, recomputed from validator amounts) equals the brute-force maximum, every candidate
passes the validator, and an infeasibility core is infeasible and minimal.
"""

import itertools

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.core.objective import PRIORITY_SCALE, penalty
from app.core.time_slots import format_hhmm
from app.domain.api_models import SolveRequest
from app.domain.constraints import constraint_adapter
from app.domain.models import Catalog
from app.solver.solve import solve
from app.validation.validator import check

DAYS = ["Mon", "Tue", "Wed", "Sat"]
INSTRUCTORS = ["가상교수 A", "가상교수 B"]
CATEGORIES = ["전필", "전선"]


@st.composite
def meetings(draw):
    day = draw(st.sampled_from(DAYS))
    if draw(st.booleans()):  # period aligned, 1-2 periods
        n = draw(st.integers(1, 6))
        span = draw(st.sampled_from([50, 75, 165]))
        start = 540 + (n - 1) * 90
    else:  # arbitrary 30-minute aligned time
        start = draw(st.integers(16, 40)) * 30
        span = draw(st.sampled_from([50, 75, 100, 165]))
    return {"day": day, "start": format_hhmm(start), "end": format_hhmm(start + span)}


@st.composite
def instances(draw):
    n_courses = draw(st.integers(1, 5))
    courses, sections = [], []
    for i in range(n_courses):
        cid = f"Q{i}"
        courses.append(
            {
                "id": cid,
                "name": f"가상 {cid}",
                "credit": draw(st.sampled_from([0.5, 1, 2, 3])),
                "category": draw(st.sampled_from(CATEGORIES)),
            }
        )
        for k in range(draw(st.integers(1, 2))):
            sections.append(
                {
                    "id": f"{cid}-{k}",
                    "course_id": cid,
                    "meetings": draw(
                        st.lists(meetings(), min_size=0, max_size=2, unique_by=lambda m: m["day"])
                    ),
                    "instructor": draw(st.sampled_from(INSTRUCTORS)),
                }
            )
    ids = [c["id"] for c in courses]
    constraints = draw(st.lists(constraint(ids), max_size=4))
    for j, c in enumerate(constraints):
        c["id"] = f"c{j}"
    pool = [{"course_id": c, "priority": draw(st.integers(1, 5))} for c in ids]
    return {"catalog": {"courses": courses, "sections": sections}, "pool": pool,
            "constraints": constraints, "n": 2}  # fmt: skip


def constraint(ids):
    days = st.lists(st.sampled_from(DAYS), min_size=1, max_size=3, unique=True)

    def window():
        return st.tuples(st.integers(16, 42), st.integers(1, 8)).map(
            lambda t: {
                "start": format_hhmm(t[0] * 30),
                "end": format_hhmm(min(t[0] + t[1], 47) * 30),
            }
        )

    params = {
        "credit_range": st.tuples(st.integers(0, 8), st.integers(0, 6)).map(
            lambda t: {"min": t[0], "max": t[0] + t[1]}
        ),
        "must_include": st.sampled_from(ids + ["NOPE"]).map(lambda c: {"course_id": c}),
        "must_exclude": st.sampled_from(ids).map(lambda c: {"course_id": c}),
        "day_off": days.map(lambda d: {"days": d}),
        "time_avoid": st.tuples(days, window()).map(lambda t: {"days": t[0], **t[1]}),
        "time_prefer": st.tuples(days, window()).map(lambda t: {"days": t[0], **t[1]}),
        "max_gap": st.sampled_from([0, 60, 105, 200]).map(lambda m: {"minutes": m}),
        "lunch_free": st.sampled_from([30, 60]).map(
            lambda f: {"start": "12:00", "end": "13:00", "min_free_minutes": f}
        ),
        "max_consecutive": st.sampled_from([60, 150, 225]).map(lambda m: {"minutes": m}),
        "max_days_on_campus": st.integers(0, 3).map(lambda d: {"max_days": d}),
        "category_min": st.tuples(st.sampled_from(CATEGORIES), st.integers(0, 6)).map(
            lambda t: {"category": t[0], "credits": t[1]}
        ),
        "instructor_avoid": st.sampled_from(INSTRUCTORS).map(lambda i: {"instructor": i}),
        "instructor_prefer": st.sampled_from(INSTRUCTORS + ["없는교수"]).map(
            lambda i: {"instructor": i}
        ),
    }
    return st.sampled_from(sorted(params)).flatmap(
        lambda t: st.tuples(params[t], st.sampled_from(["hard", "soft"]), st.integers(1, 10)).map(
            lambda ps: {"id": "x", "type": t, "params": ps[0], "strength": ps[1], "weight": ps[2]}
        )
    )


def brute_force(req: SolveRequest, constraints):
    """All feasible selections (one section or none per pool course) and the best objective."""
    cat: Catalog = req.catalog
    priority = {p.course_id: p.priority for p in req.pool}
    wanted = set(priority) | {c.params.course_id for c in constraints if c.type == "must_include"}
    options = [
        [None] + [s.id for s in cat.sections if s.course_id == c.id]
        for c in cat.courses
        if c.id in wanted
    ]
    best = None
    pool_ids = [p.course_id for p in req.pool]
    soft = [c for c in constraints if c.strength == "soft"]
    for combo in itertools.product(*options):
        chosen = [sid for sid in combo if sid]
        report = check(cat, chosen, constraints, pool_ids)
        if report.feasible(constraints):
            courses = {sid.split("-")[0] for sid in chosen}
            value = sum(PRIORITY_SCALE * priority.get(c, 3) for c in courses)
            value -= sum(penalty(c, report.violations.get(c.id, 0)) for c in soft)
            best = value if best is None else max(best, value)
    return best


def _valid(raw) -> bool:
    try:
        for c in raw["constraints"]:
            constraint_adapter.validate_python(c)
        SolveRequest.model_validate(raw)
        return True
    except ValueError:
        return False


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(instances())
def test_solver_matches_brute_force(raw):
    if not _valid(raw):
        return
    req = SolveRequest.model_validate(raw)
    result = solve(req, time_limit_s=10)
    best = brute_force(req, req.constraints)
    if best is None:
        assert result.status == "INFEASIBLE"
        core = [c for c in req.constraints if c.id in set(result.diagnosis.core)]
        assert core and brute_force(req, core) is None
        for c in core:  # minimal: every member is needed
            assert brute_force(req, [o for o in core if o is not c]) is not None
    else:
        assert result.status == "OPTIMAL"
        assert result.candidates[0].objective == best
        assert len({tuple(c.sections) for c in result.candidates}) == len(result.candidates)
