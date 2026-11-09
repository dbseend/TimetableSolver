"""분반별 학점·이수구분(docs/decisions/0008) 회귀 테스트. 합성 데이터만 사용."""

from __future__ import annotations

import asyncio
import hashlib

from app.contracts import Catalog
from app.domain.catalog import CatalogIndex, canonical_json, catalog_revision, validate_catalog_semantics
from app.domain.request_checks import check_solve_request
from app.domain.validator import validate_selection
from app.solver.engine import run_search
from tests.helpers import con, credit, load_catalog, make_request, oracle


def cat(sections: list[dict], courses: list[dict] | None = None) -> Catalog:
    courses = courses or [
        {"id": "V", "name": "가변학점실습", "credit_units": 600, "category_ids": ["자선"]},
        {"id": "M", "name": "분반별구분과목", "credit_units": 300, "category_ids": ["전선"]},
        {"id": "G", "name": "교양", "credit_units": 200, "category_ids": ["교선"]},
    ]
    return Catalog.model_validate({"catalog_id": "syn", "term_id": "t", "courses": courses, "instructors": [], "sections": sections})


def sec(sid, cid, meetings, **kw):
    return {"id": sid, "course_id": cid, "section_label": sid[-2:], "delivery_mode": "in_person", "meetings": meetings, **kw}


def mt(day, s, e):
    return {"day": day, "start_minute": s, "end_minute": e, "campus_required": True}


CATALOG = cat(
    [
        sec("V-01", "V", [mt("Mon", 540, 615)]),  # 과목 값 600 상속
        sec("V-02", "V", [mt("Tue", 540, 615)], credit_units=200),  # 분반 2학점
        sec("M-01", "M", [mt("Wed", 540, 615), mt("Fri", 540, 615)]),  # 전선 상속, Meeting 2개
        sec("M-02", "M", [mt("Thu", 540, 615), mt("Fri", 660, 735)], category_ids=["전필"]),  # 분반 전필
        sec("G-01", "G", [mt("Mon", 660, 735)]),
    ]
)
IDX = CatalogIndex.build(CATALOG)


def test_effective_units_and_categories():
    assert IDX.units_of("V-01") == 600 and IDX.units_of("V-02") == 200
    assert IDX.categories_of("M-01") == ["전선"] and IDX.categories_of("M-02") == ["전필"]
    assert "전필" in IDX.category_ids  # 분반에만 있는 분류도 참조 가능


def test_selected_section_credit_counts_once_regardless_of_meetings():
    v = validate_selection(IDX, [s.id for s in CATALOG.sections], [credit(100, 3000)], ["V-02", "M-01"])
    assert v.hard_ok and v.total_credit_units == 200 + 300  # M-01 Meeting 2개여도 300 한 번


def test_category_min_uses_selected_section_category():
    c = con("cm", "category_min", category_ids=["전필"], min_units=300)
    allowed = [s.id for s in CATALOG.sections]
    assert validate_selection(IDX, allowed, [credit(100, 3000), c], ["M-02"]).hard_ok
    assert not validate_selection(IDX, allowed, [credit(100, 3000), c], ["M-01"]).hard_ok  # 같은 과목이라도 전선 분반은 전필 아님


def test_one_section_per_course_still_enforced():
    v = validate_selection(IDX, [s.id for s in CATALOG.sections], [credit(100, 3000)], ["M-01", "M-02"])
    assert not v.hard_ok


def test_solver_matches_oracle_with_overrides():
    cases = [
        [credit(800, 800)],  # 6+2 불가(같은 과목) → V-01(6)+G(2) 또는 V-02(2)+M(3)+... 조합 탐색
        [credit(500, 500), con("cm", "category_min", category_ids=["전필"], min_units=300)],
        [credit(200, 200)],  # V-02 단독 또는 G 단독
        [credit(900, 1100), con("cm", "category_min", category_ids=["전선"], min_units=300)],
    ]
    for cs in cases:
        req = make_request(CATALOG, cs, max_candidates=5, min_section_distance=1)
        valid, best = oracle(CATALOG, [s.id for s in CATALOG.sections], cs)
        raw = run_search(req.model_dump(mode="json"))
        got = [frozenset(c["selected"]) for c in raw["candidates"]]
        if not valid:
            assert raw["first_status"] == "infeasible" and not got
            continue
        assert raw["first_status"] == "optimal"
        assert all(g in valid for g in got), (cs, got)


def test_revision_unchanged_for_catalogs_without_overrides():
    c = load_catalog()
    legacy = c.model_dump(mode="json")
    for s in legacy["sections"]:
        s.pop("credit_units"), s.pop("category_ids")
    assert catalog_revision(c) == hashlib.sha256(canonical_json(legacy).encode("utf-8")).hexdigest()


def test_revision_changes_when_override_present():
    a = cat([sec("M-01", "M", [mt("Mon", 540, 615)])])
    b = cat([sec("M-01", "M", [mt("Mon", 540, 615)], category_ids=["전필"])])
    assert catalog_revision(a) != catalog_revision(b)


def test_request_accepts_section_only_category_and_redundant_override_warns():
    req = make_request(CATALOG, [credit(300, 600), con("cm", "category_min", category_ids=["전필"], min_units=300)])
    check_solve_request(req)  # 분반에만 있는 '전필' 참조가 REFERENCE_ERROR가 아님
    redundant = cat([sec("M-01", "M", [mt("Mon", 540, 615)], credit_units=300)])
    errors, warnings = validate_catalog_semantics(redundant)
    assert not errors and any(w.code == "REDUNDANT_SECTION_OVERRIDE" for w in warnings)


def test_api_roundtrip_returns_section_fields():
    from fastapi.testclient import TestClient

    from app.main import app

    r = TestClient(app).post("/api/v1/catalog/validate", json={"catalog": CATALOG.model_dump(mode="json")})
    body = r.json()
    assert r.status_code == 200 and body["valid"]
    secs = {s["id"]: s for s in body["catalog"]["sections"]}
    assert secs["V-02"]["credit_units"] == 200 and secs["V-01"]["credit_units"] is None
    assert body["catalog_revision"] == catalog_revision(CATALOG)


def test_full_solve_reports_effective_credits():
    from app.application.solve import solve
    from app.solver.runner import make_runner

    req = make_request(CATALOG, [credit(500, 500), con("cm", "category_min", category_ids=["전필"], min_units=300)])
    res = asyncio.run(solve(req, make_runner(), "rid"))
    assert res.status == "optimal" and res.candidates
    for c in res.candidates:
        assert c.total_credit_units == 500 and "M-02" in c.selected_section_ids
