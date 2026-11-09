"""S(정확성·상태), O(목적함수·다양성), X(진단) 인수 테스트 + 전수조사 oracle 대조."""

import asyncio
import random

import pytest

from app.application.solve import InternalSolverError, diagnose, solve
from app.contracts import Catalog, DiagnoseRequest
from app.domain.catalog import CatalogIndex
from app.domain.request_checks import RequestProblem
from app.domain.validator import validate_selection
from app.solver.engine import run_search
from app.solver.runner import InProcessRunner
from tests.helpers import con, credit, load_catalog, make_request, oracle, tiny_base

TINY_ALL = {frozenset(s) for s in [("A1", "B1"), ("A1", "B2"), ("A2", "B1"), ("A2", "B2")]}


def run(req):
    return asyncio.run(solve(req, InProcessRunner(), "req-test"))


def run_diag(req, budget=5000):
    d = DiagnoseRequest.model_validate({**req.model_dump(mode="json"), "diagnosis_budget_ms": budget})
    return asyncio.run(diagnose(d, InProcessRunner(), "req-test"))


@pytest.fixture
def tiny():
    return load_catalog()


def test_oracle_tiny_exact_sets(tiny):
    allowed = [s.id for s in tiny.sections]
    valid, _ = oracle(tiny, allowed, tiny_base())
    assert valid == TINY_ALL
    valid_fri, _ = oracle(tiny, allowed, tiny_base() + [con("fri", "day_off", days=["Fri"])])
    assert valid_fri == {frozenset(("A1", "B1")), frozenset(("A1", "B2"))}


def test_S01_tiny_base(tiny):
    r = run(make_request(tiny, tiny_base(), max_candidates=5, min_section_distance=1))
    assert r.status == "optimal"
    got = {frozenset(c.selected_section_ids) for c in r.candidates}
    assert got <= TINY_ALL and len(got) == len(r.candidates)
    assert len(got) == 4  # distance 1이면 4개 전부 탐색 가능
    assert all(c.hard_validation == "passed" for c in r.candidates)


def test_S02_O07_tiny_friday(tiny):
    r = run(make_request(tiny, tiny_base() + [con("fri", "day_off", days=["Fri"])], max_candidates=3, min_section_distance=2))
    got = {frozenset(c.selected_section_ids) for c in r.candidates}
    assert got == {frozenset(("A1", "B1")), frozenset(("A1", "B2"))}
    assert r.search.returned_count == 2
    assert r.search.termination_reason == "exhausted_under_diversity"
    assert r.status == "optimal"  # 원문제 상태는 첫 풀이 기준, infeasible 아님


def test_S03_infeasible(tiny):
    cs = [credit(600, 600), con("incD", "must_include", course_id="D"), con("fri", "day_off", days=["Fri"])]
    r = run(make_request(tiny, cs))
    assert r.status == "infeasible" and r.candidates == []
    assert r.search.termination_reason == "not_started"


def test_S04_course_without_allowed_sections(tiny):
    allowed = [s.id for s in tiny.sections if s.course_id != "A"]
    r = run(make_request(tiny, tiny_base(), allowed=allowed))
    assert r.status == "infeasible"


def test_S05_unknown_course_is_422(tiny):
    with pytest.raises(RequestProblem) as e:
        run(make_request(tiny, [credit(300, 600), con("x", "must_include", course_id="NOPE")]))
    assert e.value.status == 422


def test_empty_allowed_means_zero_sections(tiny):
    r = run(make_request(tiny, [credit(300, 600)], allowed=[]))
    assert r.status == "infeasible"


@pytest.mark.parametrize("cs", [[], [credit(0, 600)], [credit(300, 600, strength="soft", weight=3)], [credit(300, 600), credit(300, 900, cid="c2")]])
def test_S09_hard_credit_range_required(tiny, cs):
    with pytest.raises(RequestProblem) as e:
        run(make_request(tiny, cs))
    assert e.value.status == 422


def test_S12_catalog_revision_mismatch(tiny):
    req = make_request(tiny, tiny_base())
    bad = req.model_copy(update={"catalog_revision": "0" * 64})
    with pytest.raises(RequestProblem) as e:
        run(bad)
    assert e.value.status == 409


def test_stale_confirmation_409(tiny):
    req = make_request(tiny, tiny_base())
    bad = req.model_copy(update={"confirmation": req.confirmation.model_copy(update={"confirmed_revision": 0})})
    with pytest.raises(RequestProblem) as e:
        run(bad)
    assert e.value.status == 409


def test_S10_soft_max_days_vs_hard_include(tiny):
    cs = tiny_base() + [con("days", "max_days_on_campus", "soft", 4, max_days=0)]
    r = run(make_request(tiny, cs))
    assert r.candidates and all(frozenset(c.selected_section_ids) in TINY_ALL for c in r.candidates)
    ev = {e.constraint_id: e for e in r.candidates[0].constraint_evaluations}
    assert not ev["days"].satisfied and ev["incA"].satisfied


def test_S13_legal_empty_space(tiny):
    r = run(make_request(tiny, [credit(1500, 1800)]))  # 최대 4과목=1200
    assert r.status == "infeasible"


# ---------------------------------------------------------------- S-06/07/08 injected statuses
class FakeRunner(InProcessRunner):
    def __init__(self, raw):
        super().__init__(1)
        self.raw = raw

    async def _run(self, kind, payload, hard_deadline_s, is_cancelled):
        return self.raw, 1.0


def raw(first, cands, term="requested_count", error=None):
    return {
        "first_status": first,
        "candidates": cands,
        "termination_reason": term,
        "model_build_ms": 0.0,
        "solve_ms": 0.0,
        "first_candidate_ms": None,
        "error": error,
    }


def test_S06_unknown_not_infeasible(tiny):
    r = asyncio.run(solve(make_request(tiny, tiny_base()), FakeRunner(raw("unknown", [], "time_limit")), "r"))
    assert r.status == "unknown" and r.candidates == []
    assert r.search.termination_reason == "time_limit"


def test_S07_feasible_not_optimal(tiny):
    rr = raw("feasible", [{"selected": ["A1", "B1"], "status": "feasible", "objective": 0}])
    r = asyncio.run(solve(make_request(tiny, tiny_base()), FakeRunner(rr), "r"))
    assert r.status == "feasible" and r.candidates[0].optimality_proven is False


def test_S08_model_invalid_and_validator_failure(tiny):
    with pytest.raises(InternalSolverError):
        asyncio.run(solve(make_request(tiny, tiny_base()), FakeRunner(raw(None, [], error="MODEL_INVALID")), "r"))
    bad = raw("optimal", [{"selected": ["A1", "A2"], "status": "optimal", "objective": 0}])
    with pytest.raises(InternalSolverError):
        asyncio.run(solve(make_request(tiny, tiny_base()), FakeRunner(bad), "r"))


def test_O12_penalty_mismatch_detected(tiny):
    cs = tiny_base() + [con("fri", "day_off", "soft", 7, days=["Fri"])]
    bad = raw("optimal", [{"selected": ["A2", "B1"], "status": "optimal", "objective": 0}])  # 실제 penalty 7
    with pytest.raises(InternalSolverError):
        asyncio.run(solve(make_request(tiny, cs), FakeRunner(bad), "r"))


# ---------------------------------------------------------------- O
def test_O01_penalty_and_score(tiny):
    cs = [
        credit(600, 600),
        con("incA", "must_include", course_id="A", allowed_section_ids=["A2"]),
        con("incB", "must_include", course_id="B", allowed_section_ids=["B1"]),
        con("fri", "day_off", "soft", 7, days=["Fri"]),
        con("wed", "day_off", "soft", 3, days=["Wed"]),
    ]
    r = run(make_request(tiny, cs, max_candidates=1))
    c = r.candidates[0]
    assert c.objective_penalty == 7 and c.original_soft_score == pytest.approx(30.0)


def test_O03_multi_day_single_constraint(tiny):
    idx = CatalogIndex.build(tiny)
    c = con("mf", "day_off", "soft", 5, days=["Mon", "Fri"])
    v = validate_selection(idx, [s.id for s in tiny.sections], [c], ["A2", "B2"])  # Fri만 수업
    assert v.penalty == 5 and v.score == 0.0


def test_O04_O05_O06_hamming(tiny):
    def dist(a, b):
        return len(set(a) ^ set(b))

    assert dist(["A1", "B1"], ["A2", "B1"]) == 2
    assert dist(["a", "b"], ["a", "b", "c"]) == 1


def test_O05_superset_allowed_with_distance1():
    cat = Catalog.model_validate(
        {
            "catalog_id": "o5",
            "term_id": "t",
            "courses": [{"id": x, "name": x, "credit_units": 300, "category_ids": []} for x in "abc"],
            "sections": [
                {
                    "id": f"{x}1",
                    "course_id": x,
                    "section_label": "1",
                    "delivery_mode": "in_person",
                    "meetings": [{"day": d, "start_minute": 540, "end_minute": 600, "campus_required": True}],
                }
                for x, d in zip("abc", ["Mon", "Tue", "Wed"], strict=True)
            ],
        }
    )
    cs = [credit(300, 900)]
    r = run(make_request(cat, cs, max_candidates=5, min_section_distance=1))
    sets = [set(c.selected_section_ids) for c in r.candidates]
    for i in range(len(sets)):
        for j in range(i):
            assert len(sets[i] ^ sets[j]) >= 1
    valid, _ = oracle(cat, [s.id for s in cat.sections], cs)
    assert len(valid) == 7 and len(r.candidates) == 5


def test_O06_distance_against_all_previous(tiny):
    r = run(make_request(tiny, [credit(300, 900)], max_candidates=5, min_section_distance=2))
    sets = [set(c.selected_section_ids) for c in r.candidates]
    for i in range(len(sets)):
        for j in range(i):
            assert len(sets[i] ^ sets[j]) >= 2


def test_O09_no_soft_null_score(tiny):
    r = run(make_request(tiny, tiny_base()))
    assert all(c.original_soft_score is None and c.objective_penalty == 0 for c in r.candidates)


def test_O11_shared_budget(tiny):
    req = make_request(tiny, tiny_base(), max_candidates=3, time_budget_ms=300)
    out = run_search(req.model_dump(mode="json"))
    assert out["solve_ms"] + out["model_build_ms"] < 300 + 200


def test_O02_hard_never_traded_for_soft(tiny):
    softs = [con(f"s{i}", "day_off", "soft", 10, days=[d]) for i, d in enumerate(["Mon", "Tue", "Fri"])]
    r = run(make_request(tiny, tiny_base() + softs, max_candidates=4, min_section_distance=1))
    assert all(frozenset(c.selected_section_ids) in TINY_ALL for c in r.candidates)


# ---------------------------------------------------------------- random oracle comparison
TYPES = ["day_off", "time_avoid", "must_exclude", "max_days_on_campus", "category_min", "must_include"]


def random_problem(seed: int):
    rnd = random.Random(seed)
    n_courses = rnd.randint(3, 6)
    courses, sections = [], []
    for ci in range(n_courses):
        cid = f"K{ci}"
        courses.append(
            {
                "id": cid,
                "name": cid,
                "credit_units": rnd.choice([100, 150, 200, 300]),
                "category_ids": [rnd.choice(["cat1", "cat2"])],
                "equivalence_group_id": None,
            }
        )
        for si in range(rnd.randint(1, 3)):
            if len(sections) >= 12:
                break
            mode = rnd.choice(["in_person"] * 4 + ["online_sync", "online_async"])
            meetings = []
            if mode != "online_async":
                for _ in range(rnd.randint(1, 2)):
                    day = rnd.choice(["Mon", "Tue", "Wed", "Fri"])
                    st = rnd.choice(range(540, 900, 30))
                    m = {"day": day, "start_minute": st, "end_minute": st + rnd.choice([50, 75, 90]), "room": None, "campus_required": mode == "in_person"}
                    if all(not (x["day"] == m["day"] and x["start_minute"] < m["end_minute"] and m["start_minute"] < x["end_minute"]) for x in meetings):
                        meetings.append(m)
            sections.append(
                {
                    "id": f"{cid}-{si}",
                    "course_id": cid,
                    "section_label": str(si),
                    "instructor_ids": [],
                    "delivery_mode": mode,
                    "meetings": meetings,
                    "support_status": "supported",
                    "issue_codes": [],
                }
            )
    cat = Catalog.model_validate(
        {"catalog_id": f"r{seed}", "term_id": "t", "category_groups": {"all": ["cat1", "cat2"]}, "courses": courses, "sections": sections}
    )
    allowed = [s["id"] for s in sections if rnd.random() < 0.9]
    lo = rnd.choice([100, 300, 500])
    cs = [credit(lo, lo + rnd.choice([0, 200, 400, 600]))]
    for k in range(rnd.randint(1, 4)):
        t = rnd.choice(TYPES)
        strength = rnd.choice(["hard", "soft", "soft"])
        w = rnd.randint(1, 10) if strength == "soft" else None
        cid = f"c{k}"
        if t == "day_off":
            cs.append(con(cid, t, strength, w, days=rnd.sample(["Mon", "Tue", "Wed", "Fri"], rnd.randint(1, 2))))
        elif t == "time_avoid":
            st = rnd.choice(range(540, 900, 30))
            cs.append(con(cid, t, strength, w, days=["Mon", "Wed"], start_minute=st, end_minute=st + 60))
        elif t == "must_exclude":
            cs.append(con(cid, t, strength, w, course_id=rnd.choice(courses)["id"]))
        elif t == "must_include":
            cs.append(con(cid, t, strength, w, course_id=rnd.choice(courses)["id"]))
        elif t == "max_days_on_campus":
            cs.append(con(cid, t, strength, w, max_days=rnd.randint(0, 3)))
        else:
            cs.append(con(cid, t, strength, w, category_ids=["cat1"], min_units=rnd.choice([100, 300, 600])))
    return cat, allowed, cs


@pytest.mark.parametrize("seed", range(60))
def test_random_vs_oracle(seed):
    cat, allowed, cs = random_problem(seed)
    valid, best = oracle(cat, allowed, cs)
    r = run(make_request(cat, cs, allowed=allowed, max_candidates=3, min_section_distance=2, time_budget_ms=5000))
    if not valid:
        assert r.status == "infeasible", f"seed={seed}"
        return
    assert r.status == "optimal", f"seed={seed}"
    assert r.candidates[0].objective_penalty == best, f"seed={seed}"
    for c in r.candidates:
        assert frozenset(c.selected_section_ids) in valid, f"seed={seed}"


# ---------------------------------------------------------------- X (diagnose)
def test_X01_X02_core_and_verified_proposal(tiny):
    cs = [credit(300, 900), con("incD", "must_include", course_id="D"), con("fri", "day_off", days=["Fri"])]
    d = run_diag(make_request(tiny, cs))
    assert d.status == "diagnosed" and d.core_is_minimal is False
    assert set(d.core_constraint_ids) >= {"incD", "fri"} or set(d.core_constraint_ids) <= {"incD", "fri", "credits"}
    assert "fri" in d.core_constraint_ids
    props = {p.changes[0].constraint_id: p for p in d.proposals}
    assert "fri" in props
    p = props["fri"]
    assert p.verification_status == "passed" and p.objective_delta is None
    assert p.changes[0].after["strength"] == "soft"
    assert "D1" in p.verified_candidate.selected_section_ids
    assert p.changed_constraint_violations[0].satisfied is False


def test_X03_two_independent_conflicts_no_single_fix():
    cat = Catalog.model_validate(
        {
            "catalog_id": "x3",
            "term_id": "t",
            "courses": [
                {"id": "D", "name": "D", "credit_units": 300},
                {"id": "E", "name": "E", "credit_units": 300},
                {"id": "F", "name": "F", "credit_units": 300},
            ],
            "sections": [
                {
                    "id": "D1",
                    "course_id": "D",
                    "section_label": "1",
                    "delivery_mode": "in_person",
                    "meetings": [{"day": "Fri", "start_minute": 540, "end_minute": 600, "campus_required": True}],
                },
                {
                    "id": "E1",
                    "course_id": "E",
                    "section_label": "1",
                    "delivery_mode": "in_person",
                    "meetings": [{"day": "Mon", "start_minute": 540, "end_minute": 600, "campus_required": True}],
                },
                {
                    "id": "F1",
                    "course_id": "F",
                    "section_label": "1",
                    "delivery_mode": "in_person",
                    "meetings": [{"day": "Wed", "start_minute": 540, "end_minute": 600, "campus_required": True}],
                },
            ],
        }
    )
    # F가 있으면 incD 또는 incE 하나의 soft 전환으로 풀릴 수 있다. 제안 여부를 oracle과 대조한다.
    cs2 = [
        credit(600, 900),
        con("incD", "must_include", course_id="D"),
        con("incE", "must_include", course_id="E"),
        con("fri", "day_off", days=["Fri"]),
        con("mon", "day_off", days=["Mon"]),
    ]
    d = run_diag(make_request(cat, cs2))
    assert d.status == "diagnosed"
    for p in d.proposals:  # 제시된 것은 모두 재풀이·검증된 비어 있지 않은 시간표
        assert p.verification_status == "passed" and p.verified_candidate.selected_section_ids
    allowed = [s.id for s in cat.sections]
    for cid in d.core_constraint_ids:
        changed = [c if c.id != cid else con(c.id, c.type, "soft", 5, **c.params.model_dump()) for c in cs2]
        valid, _ = oracle(cat, allowed, changed)
        proposed = any(p.changes[0].constraint_id == cid for p in d.proposals)
        if cid != "credits":
            assert proposed == bool(valid), cid


def test_X03_spec_fixture_single_change_fails():
    """04 문서 X-03: D=Fri만, E=Mon만, 600~900, 둘 다 필수, Mon/Fri 공강(각각 별도 조건)."""
    cat = Catalog.model_validate(
        {
            "catalog_id": "x3b",
            "term_id": "t",
            "courses": [{"id": "D", "name": "D", "credit_units": 300}, {"id": "E", "name": "E", "credit_units": 300}],
            "sections": [
                {
                    "id": "D1",
                    "course_id": "D",
                    "section_label": "1",
                    "delivery_mode": "in_person",
                    "meetings": [{"day": "Fri", "start_minute": 540, "end_minute": 600, "campus_required": True}],
                },
                {
                    "id": "E1",
                    "course_id": "E",
                    "section_label": "1",
                    "delivery_mode": "in_person",
                    "meetings": [{"day": "Mon", "start_minute": 540, "end_minute": 600, "campus_required": True}],
                },
            ],
        }
    )
    cs = [
        credit(600, 900),
        con("incD", "must_include", course_id="D"),
        con("incE", "must_include", course_id="E"),
        con("fri", "day_off", days=["Fri"]),
        con("mon", "day_off", days=["Mon"]),
    ]
    d = run_diag(make_request(cat, cs))
    # 단일 변경으로는 해가 없다 → 성공 수정안 0개, '찾지 못함'으로 보고(존재하지 않음 주장 아님)
    assert d.proposals == []
    assert d.status == "diagnosed" and d.termination_reason == "no_single_change_found"
    allowed = [s.id for s in cat.sections]
    for cid in ["incD", "incE", "fri", "mon"]:
        changed = [c if c.id != cid else con(c.id, c.type, "soft", 5, **c.params.model_dump()) for c in cs]
        assert not oracle(cat, allowed, changed)[0]


def test_X05_feasible_original(tiny):
    d = run_diag(make_request(tiny, tiny_base()))
    assert d.status == "not_infeasible" and d.proposals == [] and d.core_constraint_ids == []


def test_X09_X10_core_outside_kept_and_credit_never_removed(tiny):
    cs = [credit(900, 900), con("incD", "must_include", course_id="D"), con("fri", "day_off", days=["Fri"]), con("noC", "must_exclude", course_id="C")]
    d = run_diag(make_request(tiny, cs))
    for p in d.proposals:
        ev = {e.constraint_id: e for e in p.verified_candidate.constraint_evaluations}
        assert ev["noC"].satisfied  # core 밖 hard 유지
        hard_ranges = [e for e in p.verified_candidate.constraint_evaluations if e.type == "credit_range" and e.strength == "hard"]
        assert len(hard_ranges) == 1
        if p.changes[0].constraint_id == "credits":
            assert p.changes[0].after["params"]["min_units"] > 0
            assert p.changes[0].after["strength"] == "hard"


def test_X04_diagnosis_tiny_budget_no_fabricated_core(tiny):
    cs = [credit(300, 900), con("incD", "must_include", course_id="D"), con("fri", "day_off", days=["Fri"])]
    d = run_diag(make_request(tiny, cs), budget=200)
    assert d.status in ("diagnosed", "partial", "unknown")
    if d.status == "unknown":
        assert d.core_constraint_ids == [] and d.proposals == []
