"""교수+과목 요구의 분반 제한(서버 매핑) 회귀 테스트. 같은 과목을 서로 다른 교수가 나눠 맡는 합성 카탈로그.
외부 LLM 호출 없음(mock transport)."""

from __future__ import annotations

import json

import httpx

from app.application.parse import build_response
from app.contracts import Catalog, ParseRequest
from app.domain.catalog import CatalogIndex
from app.domain.validator import validate_selection
from app.llm.fixture import FixtureProvider
from app.llm.gemini import GeminiProvider
from app.solver.engine import run_search
from tests.helpers import con, credit, make_request

ENT = {
    "courses": [
        {"id": "ALG", "name": "알고리즘", "category_ids": ["전선"], "section_ids": ["ALG-01", "ALG-02", "ALG-03"]},
        {"id": "DB", "name": "데이터베이스", "category_ids": ["전선"], "section_ids": ["DB-01"]},
    ],
    "instructors": [
        {"id": "I1", "name": "정우진", "course_ids": ["ALG"], "section_ids": ["ALG-01", "ALG-03"]},
        {"id": "I2", "name": "이영희", "course_ids": ["ALG", "DB"], "section_ids": ["ALG-02", "DB-01"]},
        {"id": "I3", "name": "김민수", "course_ids": ["ALG"], "section_ids": []},
        {"id": "I4", "name": "박준호", "course_ids": ["DB"], "section_ids": []},
    ],
    "category_groups": {},
    "category_ids": ["전선"],
}
ENT_HOMONYM = {**ENT, "instructors": [*ENT["instructors"], {"id": "I5", "name": "정우진", "course_ids": ["ALG"], "section_ids": ["ALG-02"]}]}


def req(text: str, ent: dict = ENT) -> ParseRequest:
    return ParseRequest.model_validate({"text": text, "catalog_revision": "a" * 64, "input_revision": 1, "entities": ent})


def gemini_returning(drafts: list[dict]) -> GeminiProvider:
    text = json.dumps({"drafts": drafts, "unsupported": []})

    def h(request):
        return httpx.Response(200, json={"status": "completed", "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}]})

    return GeminiProvider("test-key", "m", deadline_s=5, client=httpx.Client(transport=httpx.MockTransport(h)))


def inc(src: str, course: str = "ALG", **params) -> dict:
    return {
        "type": "must_include",
        "action": "add",
        "strength": "hard",
        "source_text": src,
        "params": {"course_id": course, "allowed_section_ids": None, **params},
    }


def parse_live(text: str, drafts: list[dict], ent: dict = ENT):
    r = req(text, ent)
    return build_response(r, gemini_returning(drafts).parse(r), "live", "rid")


def test_course_plus_instructor_ids_becomes_server_computed_sections():
    resp = parse_live("정우진 교수님의 알고리즘 꼭", [inc("정우진 교수님의 알고리즘 꼭", instructor_ids=["I1"])])
    d = resp.draft_constraints[0]
    assert d.params == {"course_id": "ALG", "allowed_section_ids": ["ALG-01", "ALG-03"]}  # instructor_ids는 분반으로 변환 후 제거
    assert d.unresolved_fields == [] and resp.status == "parsed"


def test_model_omits_instructor_then_question_not_silent_course_only():
    resp = parse_live("정우진 교수님의 알고리즘 꼭 듣고 싶어", [inc("정우진 교수님의 알고리즘 꼭 듣고 싶어")])
    d = resp.draft_constraints[0]
    assert "params.allowed_section_ids" in d.unresolved_fields and resp.status == "needs_clarification"
    q = resp.questions[0]
    assert q.field == "params.allowed_section_ids"
    patches = [o.patch for o in q.options]
    assert {"params.allowed_section_ids": ["ALG-01", "ALG-03"]} in patches
    assert {"params.allowed_section_ids": None} in patches  # 아무 분반 허용은 사용자가 명시적으로 고르는 선택지


def test_model_sections_must_belong_to_course_and_instructor():
    resp = parse_live("정우진 교수 알고리즘", [inc("정우진 교수 알고리즘", instructor_ids=["I1"], allowed_section_ids=["ALG-02"])])
    assert not resp.draft_constraints
    assert resp.unsupported_requests[0].reason_code == "SECTION_INSTRUCTOR_MISMATCH"
    resp = parse_live("알고리즘", [inc("알고리즘", allowed_section_ids=["DB-01"])])
    assert resp.unsupported_requests[0].reason_code == "ENTITY_NOT_FOUND"  # 과목 밖 분반


def test_homonym_instructors_teaching_same_course_ask():
    resp = parse_live("정우진 교수 알고리즘 꼭", [inc("정우진 교수 알고리즘 꼭", instructor_ids=["I1"])], ENT_HOMONYM)
    d = resp.draft_constraints[0]
    assert "params.allowed_section_ids" in d.unresolved_fields
    opts = {o.id: o.patch["params.allowed_section_ids"] for o in resp.questions[0].options}
    assert opts == {"inst:I1": ["ALG-01", "ALG-03"], "inst:I5": ["ALG-02"]}


def test_instructor_without_sections_in_course_asks():
    resp = parse_live("김민수 교수 알고리즘 꼭", [inc("김민수 교수 알고리즘 꼭", instructor_ids=["I3"])])
    d = resp.draft_constraints[0]
    assert "params.allowed_section_ids" in d.unresolved_fields
    assert {o.id for o in resp.questions[0].options} == {"any", "discard"}


def test_unknown_instructor_id_rejected():
    resp = parse_live("누구 교수 알고리즘", [inc("누구 교수 알고리즘", instructor_ids=["NOPE"])])
    assert resp.unsupported_requests[0].reason_code == "ENTITY_NOT_FOUND"


def test_instructor_teaching_all_sections_needs_no_question():
    resp = parse_live("이영희 교수 데이터베이스", [inc("이영희 교수 데이터베이스", course="DB")])
    assert resp.draft_constraints[0].unresolved_fields == [] and not resp.questions


def test_fixture_path_unchanged_and_restricted():
    r = req("이영희 교수의 알고리즘 꼭 들을래")
    resp = build_response(r, FixtureProvider().parse(r), "fixture", "rid")
    inc_d = [d for d in resp.draft_constraints if d.type == "must_include"][0]
    assert inc_d.params["allowed_section_ids"] == ["ALG-02"] and not inc_d.unresolved_fields


def test_gemini_payload_contains_instructor_course_section_links():
    seen = {}

    def h(request):
        seen["body"] = json.loads(request.content)
        empty = json.dumps({"drafts": [], "unsupported": []})
        return httpx.Response(200, json={"status": "completed", "steps": [{"type": "model_output", "content": [{"type": "text", "text": empty}]}]})

    GeminiProvider("k", "m", deadline_s=5, client=httpx.Client(transport=httpx.MockTransport(h))).parse(req("정우진 교수 알고리즘"))
    payload = json.loads(seen["body"]["input"].split("\n", 1)[1].split("\n\n[사용자 선호 문장", 1)[0])
    i1 = next(i for i in payload["instructors"] if i["id"] == "I1")
    assert i1["course_ids"] == ["ALG"] and i1["section_ids"] == ["ALG-01", "ALG-03"]
    assert "instructor_ids" in seen["body"]["system_instruction"]


def _meeting(day: str, start: int) -> dict:
    return {"day": day, "start_minute": start, "end_minute": start + 75, "campus_required": True}


def _sec(sid: str, course: str, inst: str, day: str) -> dict:
    return {"id": sid, "course_id": course, "section_label": sid[-2:], "instructor_ids": [inst], "delivery_mode": "in_person", "meetings": [_meeting(day, 540)]}


def test_restriction_holds_through_solver_selection():
    """해석된 제한(정우진 분반)이 최종 선택 분반까지 유지된다."""
    resp = parse_live("정우진 교수님의 알고리즘 꼭", [inc("정우진 교수님의 알고리즘 꼭", instructor_ids=["I1"])])
    allowed = resp.draft_constraints[0].params["allowed_section_ids"]
    cat = Catalog.model_validate(
        {
            "catalog_id": "syn",
            "term_id": "t",
            "courses": [{"id": "ALG", "name": "알고리즘", "credit_units": 300}, {"id": "DB", "name": "데이터베이스", "credit_units": 300}],
            "instructors": [{"id": f"I{i}", "name": f"교수{i}"} for i in range(1, 5)],
            "sections": [
                _sec("ALG-01", "ALG", "I1", "Mon"),
                _sec("ALG-02", "ALG", "I2", "Tue"),
                _sec("ALG-03", "ALG", "I1", "Wed"),
                _sec("DB-01", "DB", "I2", "Mon"),
            ],
        }
    )
    cs = [credit(600, 600), con("inc", "must_include", course_id="ALG", allowed_section_ids=allowed), con("db", "must_include", course_id="DB")]
    raw = run_search(make_request(cat, cs, max_candidates=5, min_section_distance=1).model_dump(mode="json"))
    picks = [set(c["selected"]) for c in raw["candidates"]]
    assert picks and all(p & {"ALG-01", "ALG-03"} and "ALG-02" not in p for p in picks)
    assert {"ALG-03", "DB-01"} in picks  # ALG-01은 DB-01과 같은 시간 → 정우진의 다른 분반 ALG-03
    idx = CatalogIndex.build(cat)
    assert not validate_selection(idx, [s.id for s in cat.sections], cs, ["ALG-02", "DB-01"]).hard_ok  # 다른 교수 분반은 위반
