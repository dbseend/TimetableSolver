"""Solver semantics on tiny hand-made catalogs (fictional names only)."""

import ast
import json
from pathlib import Path

import pytest

from app.domain.api_models import SolveRequest
from app.solver.solve import solve

P = {1: "09:00", 2: "10:30", 3: "12:00", 4: "13:30", 5: "15:00", 6: "16:30", 7: "18:00"}
END = {1: "10:15", 2: "11:45", 3: "13:15", 4: "14:45", 5: "16:15", 6: "17:45", 7: "19:15"}


def sec(sid, day_periods, instructor=None, **kw):
    meetings = [{"day": d, "start": P[n], "end": END[n]} for d, n in day_periods]
    return {"id": sid, "course_id": sid.split("-")[0], "meetings": meetings,
            "instructor": instructor, **kw}  # fmt: skip


def course(cid, credit=3, category="전선"):
    return {"id": cid, "name": f"가상 {cid}", "credit": credit, "category": category}


def run(courses, sections, constraints=(), pool=None, **kw):
    req = {
        "catalog": {"courses": courses, "sections": sections},
        "pool": [{"course_id": c} for c in (pool or [c["id"] for c in courses])],
        "constraints": list(constraints),
        **kw,
    }
    return solve(SolveRequest.model_validate(req), time_limit_s=5)


def hard(cid, type_, **params):
    return {"id": cid, "type": type_, "strength": "hard", "params": params}


DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
# three single-section courses in periods 1, 2, 3 on Monday
MON = [course("A"), course("B"), course("C")]
MON_S = [sec("A-01", [("Mon", 1)]), sec("B-01", [("Mon", 2)]), sec("C-01", [("Mon", 3)])]


def test_picks_all_compatible_pool_courses_and_respects_pool():
    r = run(MON, MON_S, pool=["A", "C"])
    assert r.status == "OPTIMAL"
    assert r.candidates[0].sections == ["A-01", "C-01"]


def test_conflicting_sections_never_together():
    courses = [course("A"), course("B")]
    sections = [sec("A-01", [("Mon", 1)]), sec("B-01", [("Mon", 1)]), sec("B-02", [("Tue", 1)])]
    r = run(courses, sections)
    assert r.candidates[0].sections == ["A-01", "B-02"]


@pytest.mark.parametrize("minutes,n_taken", [(150, 2), (225, 3), (74, 0)])
def test_max_consecutive_counts_periods_not_slots(minutes, n_taken):
    # "연강 2시간 반" (150) allows two back-to-back 75min classes but not three
    r = run(MON, MON_S, [hard("c1", "max_consecutive", minutes=minutes)])
    assert len(r.candidates[0].sections) == n_taken


def test_max_gap_in_periods():
    courses = [course("A"), course("B")]
    sections = [sec("A-01", [("Mon", 1)]), sec("B-01", [("Mon", 3)])]  # one empty period between
    assert (
        len(run(courses, sections, [hard("c1", "max_gap", minutes=105)]).candidates[0].sections)
        == 2
    )
    assert (
        len(run(courses, sections, [hard("c1", "max_gap", minutes=60)]).candidates[0].sections) == 1
    )


def test_lunch_free_blocks_period_3():
    r = run(MON, MON_S, [hard("c1", "lunch_free", start="12:00", end="13:00", min_free_minutes=60)])
    assert r.candidates[0].sections == ["A-01", "B-01"]


def test_time_prefer_hard_keeps_classes_inside_window():
    r = run(MON, MON_S, [hard("c1", "time_prefer", days=["Mon"], start="10:00", end="14:00")])
    assert r.candidates[0].sections == ["B-01", "C-01"]


def test_instructor_rules():
    courses = [course("A"), course("B")]
    sections = [sec("A-01", [("Mon", 1)], "가상 교수1"), sec("B-01", [("Tue", 1)], "가상교수2")]
    avoid = run(courses, sections, [hard("c1", "instructor_avoid", instructor="가상교수1")])
    assert avoid.candidates[0].sections == ["B-01"]  # whitespace-insensitive match
    prefer = run(courses, sections, [hard("c1", "instructor_prefer", instructor="없는교수")])
    assert prefer.status == "INFEASIBLE" and prefer.diagnosis.core == ["c1"]


def test_half_credits_and_section_overrides_count_in_credit_range():
    courses = [course("A", 0.5), course("B", 3)]
    sections = [sec("A-01", [("Mon", 1)]), sec("B-01", [("Tue", 1)], credit=6, category="전필")]
    rules = [
        hard("c1", "credit_range", min=6, max=6),
        hard("c2", "category_min", category="전필", credits=6),
    ]
    r = run(courses, sections, rules)
    assert r.candidates[0].sections == ["B-01"]


def test_missing_must_include_course_is_diagnosed():
    r = run(
        MON, MON_S, [hard("c1", "must_include", course_id="NOPE"), hard("c2", "day_off", days=DAYS)]
    )
    assert r.status == "INFEASIBLE" and r.diagnosis.core == ["c1"]


def test_must_include_outside_pool_is_added():
    r = run(MON, MON_S, [hard("c1", "must_include", course_id="B")], pool=["A"])
    assert r.candidates[0].sections == ["A-01", "B-01"]


def test_profile_removes_taken_courses():
    r = run(MON, MON_S, profile={"taken": ["A"]})
    assert "A-01" not in r.candidates[0].sections


def test_top_n_candidates_are_distinct_and_valid():
    courses = [course("A"), course("B")]
    sections = [sec("A-01", [("Mon", 1)]), sec("A-02", [("Tue", 1)]),
                sec("B-01", [("Mon", 2)]), sec("B-02", [("Wed", 2)])]  # fmt: skip
    r = run(courses, sections, n=3)
    picked = [tuple(c.sections) for c in r.candidates]
    assert len(picked) == 3 and len(set(picked)) == 3


def test_soft_constraints_are_reported_not_enforced():
    soft = {"id": "s1", "type": "day_off", "strength": "soft", "params": {"days": ["Mon"]}}
    r = run(MON, MON_S, [soft])
    assert len(r.candidates[0].sections) == 3
    assert [(v.id, v.amount) for v in r.candidates[0].violated] == [("s1", 1)]


def test_validator_does_not_import_solver():
    src = Path(__file__).resolve().parents[1] / "app" / "validation" / "validator.py"
    imported = [
        n.module or ""
        for n in ast.walk(ast.parse(src.read_text()))
        if isinstance(n, ast.ImportFrom)
    ] + [a.name for n in ast.walk(ast.parse(src.read_text())) if isinstance(n, ast.Import)
         for a in n.names]  # fmt: skip
    assert not any(m.startswith("app.solver") for m in imported)


REAL = Path(__file__).resolve().parents[2] / "data" / "private" / "catalog_2026-2_full.json"


@pytest.mark.skipif(not REAL.exists(), reason="real catalog is private (data/private)")
def test_real_catalog_smoke():
    cat = json.loads(REAL.read_text(encoding="utf-8"))
    timed = sorted({s["course_id"] for s in cat["sections"] if s["meetings"]})
    r = solve(
        SolveRequest.model_validate(
            {
                "catalog": cat,
                "pool": [{"course_id": c} for c in timed[::40]],
                "constraints": [
                    hard("c1", "credit_range", min=12, max=18),
                    hard("c2", "day_off", days=["Fri"]),
                ],  # fmt: skip
            }
        ),
        time_limit_s=5,
    )
    assert r.status in ("OPTIMAL", "FEASIBLE") and r.stats.solve_ms < 2000
