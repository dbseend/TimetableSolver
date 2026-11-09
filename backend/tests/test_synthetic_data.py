"""Synthetic catalogs (C6) and infeasible scenarios (C7).

The solver does not exist yet, so infeasibility is proven here with a tiny pure-Python checker
that understands the hard constraint types used by the scenarios.
"""

import importlib.util
import itertools
import json
from pathlib import Path

import pytest

from app.core.time_slots import DAY_END_MIN, DAY_START_MIN, parse_hhmm
from app.domain.api_models import SolveRequest
from app.domain.models import Catalog

SYN = Path(__file__).resolve().parents[2] / "data" / "synthetic"
_spec = importlib.util.spec_from_file_location("generator", SYN / "generator.py")
generator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generator)

SIZES = [50, 200, 500]


# ---- C6 generator ------------------------------------------------------------------------


def test_generator_is_deterministic():
    assert generator.generate(50, 7) == generator.generate(50, 7)
    assert generator.generate(50, 7) != generator.generate(50, 8)


@pytest.mark.parametrize("n", SIZES)
def test_committed_catalog_matches_generator(n):
    committed = json.loads((SYN / f"catalog_{n}.json").read_text(encoding="utf-8"))
    assert committed == generator.generate(n, n)  # seed == size


@pytest.mark.parametrize("n", SIZES)
def test_catalog_shape(n):
    cat = Catalog.model_validate(generator.generate(n, n))
    assert len(cat.sections) == n
    assert all(c.id.startswith("SYN") and c.name.startswith("가상과목") for c in cat.courses)
    assert {c.category for c in cat.courses} <= {"전필", "전선", "교양", "기타"}
    assert all(1 <= c.credit <= 3 for c in cat.courses)
    for s in cat.sections:
        for m in s.meetings:
            assert DAY_START_MIN <= parse_hhmm(m.start) < parse_hhmm(m.end) <= DAY_END_MIN
    per_course = {}
    for s in cat.sections:
        per_course[s.course_id] = per_course.get(s.course_id, 0) + 1
    assert max(per_course.values()) > 1  # some multi-section courses
    instructors = [s.instructor for s in cat.sections]
    assert len(set(instructors)) < len(instructors)  # some instructors teach several


# ---- C7 scenarios ------------------------------------------------------------------------

SCEN = json.loads((SYN / "infeasible_scenarios.json").read_text(encoding="utf-8"))
CATALOG = Catalog.model_validate_json((SYN / SCEN["catalog"]).read_text(encoding="utf-8"))
COURSES = {c.id: c for c in CATALOG.courses}
SECTIONS: dict[str, list] = {}
for _s in CATALOG.sections:
    SECTIONS.setdefault(_s.course_id, []).append(_s)
SUPPORTED = {
    "must_include",
    "must_exclude",
    "day_off",
    "time_avoid",
    "lunch_free",
    "credit_range",
    "category_min",
}


def _blocks(sec):
    return [(m.day, parse_hhmm(m.start), parse_hhmm(m.end)) for m in sec.meetings]


def _overlap(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def _section_ok(sec, hard):
    for c in hard:
        p = c.params
        for d, s, e in _blocks(sec):
            if c.type == "day_off" and d in p.days:
                return False
            if c.type == "time_avoid" and d in p.days:
                if _overlap(s, e, parse_hhmm(p.start), parse_hhmm(p.end)):
                    return False
    return True


def _schedule_ok(secs, hard):
    blocks = [b for s in secs for b in _blocks(s)]
    for (d1, s1, e1), (d2, s2, e2) in itertools.combinations(blocks, 2):
        if d1 == d2 and _overlap(s1, e1, s2, e2):
            return False
    for c in (c for c in hard if c.type == "lunch_free"):
        w0, w1 = parse_hhmm(c.params.start), parse_hhmm(c.params.end)
        for day in {d for d, _, _ in blocks}:
            minutes = set()
            for d, s, e in blocks:
                if d == day:
                    minutes |= set(range(max(s, w0), min(e, w1)))
            if (w1 - w0) - len(minutes) < c.params.min_free_minutes:
                return False
    return True


def feasible(constraints) -> bool | None:
    """True with a witness, False with a proof, None if this checker cannot tell."""
    hard = [c for c in constraints if c.strength == "hard"]
    assert {c.type for c in hard} <= SUPPORTED, "checker does not support this type"
    excluded = {c.params.course_id for c in hard if c.type == "must_exclude"}
    musts = [c.params.course_id for c in hard if c.type == "must_include"]
    if set(musts) & excluded:
        return False
    cr = [c.params for c in hard if c.type == "credit_range"]
    lo, hi = max([p.min for p in cr], default=0), min([p.max for p in cr], default=40)
    cat_min = {c.params.category: c.params.credits for c in hard if c.type == "category_min"}

    def ok_secs(cid):
        return [s for s in SECTIONS.get(cid, []) if _section_ok(s, hard)]

    def credits(cids, cat=None):
        return sum(COURSES[i].credit for i in cids if cat is None or COURSES[i].category == cat)

    def mins_met(cids):
        return credits(cids) >= lo and all(credits(cids, k) >= v for k, v in cat_min.items())

    others = [i for i in COURSES if i not in excluded and i not in musts]
    others.sort(key=lambda i: (COURSES[i].category not in cat_min, -COURSES[i].credit, i))
    any_combo = False
    for combo in itertools.product(*(ok_secs(m) for m in musts)):
        if not _schedule_ok(combo, hard) or credits(musts) > hi:
            continue
        any_combo = True
        chosen, cids = list(combo), list(musts)
        for i in others:  # greedy witness
            if mins_met(cids):
                break
            if credits(cids) + COURSES[i].credit > hi:
                continue
            for s in ok_secs(i):
                if _schedule_ok([*chosen, s], hard):
                    chosen.append(s)
                    cids.append(i)
                    break
        if mins_met(cids):
            return True
    if not any_combo:
        return False
    # upper bound ignoring overlaps between optional courses
    reachable = list(musts) + [i for i in others if ok_secs(i)]
    if credits(reachable) < lo or any(credits(reachable, k) < v for k, v in cat_min.items()):
        return False
    return None


@pytest.mark.parametrize("sc", SCEN["scenarios"], ids=lambda s: s["id"])
def test_scenario_is_valid_and_minimally_infeasible(sc):
    req = SolveRequest.model_validate({"catalog": CATALOG, "constraints": sc["constraints"]})
    ids = {c.id for c in req.constraints}
    core = set(sc["expected_conflict_ids"])
    assert core <= ids and sc["expected_status"] == "INFEASIBLE"
    assert all(c.strength == "hard" for c in req.constraints if c.id in core)
    assert feasible(req.constraints) is False
    for drop in core:  # minimal: removing any one member restores feasibility
        assert feasible([c for c in req.constraints if c.id != drop]) is True, drop


def test_at_least_five_scenarios():
    assert len(SCEN["scenarios"]) >= 5
    assert len({s["id"] for s in SCEN["scenarios"]}) == len(SCEN["scenarios"])
