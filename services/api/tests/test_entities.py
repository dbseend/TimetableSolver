"""LLM 엔티티 후보 축소: 정답 과목·교수가 빠지지 않는지(재현율), 실제로 줄어드는지, 검증은 전체 목록 기준인지.
외부 LLM 호출 없음(mock transport)."""

from __future__ import annotations

import itertools
import json

import httpx

from app.application.parse import build_response
from app.contracts import ParseRequest
from app.llm.entities import NARROW_THRESHOLD, select_entities
from app.llm.fixture import FixtureProvider
from app.llm.gemini import GeminiProvider

SYL = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하", "거", "너", "더", "러"]
SUF = ["론", "학", "실습", "연구", "세미나"]
KNOWN = [
    ("CSE201", "자료구조"),
    ("CSE299", "고급자료구조"),
    ("CSE301", "운영체제"),
    ("CSE490", "캡스톤디자인"),
    ("GEN101", "글쓰기와소통"),
    ("ENG100", "English Chapel 1"),
]


def big_entities() -> dict:
    courses = [{"id": cid, "name": name, "category_ids": ["전선"], "section_ids": [f"{cid}-01"]} for cid, name in KNOWN]
    for n, (a, b, s) in enumerate(itertools.product(SYL, SYL, SUF)):
        if len(courses) >= 400:
            break
        if a == b:
            continue
        courses.append({"id": f"SYN{n:04d}", "name": f"{a}{b}{s}", "category_ids": ["교선"], "section_ids": [f"SYN{n:04d}-01"]})
    instructors = [
        {"id": "I1", "name": "김민수", "course_ids": ["CSE201"], "section_ids": ["CSE201-01"]},
        {"id": "I2", "name": "김민수", "course_ids": ["CSE301"], "section_ids": ["CSE301-01"]},
        {"id": "I3", "name": "이영희", "course_ids": ["CSE490"], "section_ids": ["CSE490-01"]},
        {"id": "I4", "name": "Grace Lee", "course_ids": ["ENG100"], "section_ids": ["ENG100-01"]},
    ]
    names = itertools.islice(itertools.permutations(SYL, 3), 250)
    instructors += [{"id": f"P{n:03d}", "name": "".join(t), "course_ids": [courses[6 + n]["id"]], "section_ids": []} for n, t in enumerate(names)]
    return {"courses": courses, "instructors": instructors, "category_groups": {}, "category_ids": ["전선", "교선"]}


ENT = big_entities()


def req(text: str, entities: dict | None = None) -> ParseRequest:
    return ParseRequest.model_validate({"text": text, "catalog_revision": "a" * 64, "input_revision": 1, "entities": entities or ENT})


def picked(text: str) -> tuple[set[str], set[str], bool]:
    c, i, narrowed = select_entities(req(text))
    return {x.id for x in c}, {x.id for x in i}, narrowed


def test_large_catalog_is_narrowed_and_actually_small():
    assert len(ENT["courses"]) > NARROW_THRESHOLD
    c, i, narrowed = picked("금요일은 공강이면 좋겠어")
    assert narrowed and len(c) < 0.05 * len(ENT["courses"]) and len(i) < 0.05 * len(ENT["instructors"])


def test_exact_code_match_first_including_case():
    for text in ["CSE201 꼭 들어야 해", "cse201은 빼줘", "(CSE301) 필수"]:
        c, _, _ = picked(text)
        assert ({"CSE201"} if "201" in text else {"CSE301"}) <= c


def test_names_with_spacing_and_particles_are_kept():
    cases = {
        "운영 체제는 꼭 들어야 해": "CSE301",
        "자료 구조 과목 듣고 싶어": "CSE201",
        "캡스톤 디자인 수업 넣어줘": "CSE490",
        "글쓰기와 소통은 빼고": "GEN101",
        "english chapel 1 필수": "ENG100",
    }
    for text, cid in cases.items():
        assert cid in picked(text)[0], text


def test_homonym_instructors_both_kept_with_their_courses():
    c, i, _ = picked("김민수 교수 수업은 피하고 싶어")
    assert {"I1", "I2"} <= i and {"CSE201", "CSE301"} <= c  # 동명이인을 하나로 줄이지 않음 → 이후 질문으로 선택


def test_instructor_plus_course():
    c, i, _ = picked("이영희 교수님 캡스톤디자인 꼭")
    assert "I3" in i and "CSE490" in c
    c, i, _ = picked("grace lee 수업 듣고 싶어")
    assert "I4" in i and "ENG100" in c


def test_every_course_and_instructor_is_recalled_by_name_or_code():
    """전수: 모든 과목 이름·코드, 모든 교수 이름으로 만든 문장에서 정답이 후보에 남는다."""
    for co in ENT["courses"]:
        assert co["id"] in picked(f"{co['name']} 꼭 들을래")[0], co
        assert co["id"] in picked(f"{co['id']} 필수")[0], co
    for ins in ENT["instructors"]:
        assert ins["id"] in picked(f"{ins['name']} 교수 싫어")[1], ins


def test_superset_of_deterministic_matcher():
    """규칙 기반 해석기(fixture)가 찾는 과목은 모두 후보에 있어야 한다."""
    fx = FixtureProvider()
    for text in ["자료구조는 꼭", "고급자료구조 빼줘", "운영체제랑 캡스톤디자인 넣어줘", "CSE490 필수", "가나론 들을래", "글쓰기와소통 싫어"]:
        r = req(text)
        found = {c.id for c in fx._match_courses(text, r)}
        assert found <= {c.id for c in select_entities(r)[0]}, (text, found)


def test_small_catalog_not_narrowed():
    small = {**ENT, "courses": ENT["courses"][:20]}
    c, i, narrowed = select_entities(req("금요일 공강", small))
    assert not narrowed and len(c) == 20 and len(i) == len(ENT["instructors"])


def _gem(handler):
    return GeminiProvider("test-key", "model-from-env", deadline_s=5, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_gemini_payload_uses_narrowed_list_but_validation_uses_full_catalog():
    seen = {}

    def h(request):
        seen["body"] = json.loads(request.content)

        def inc(src, cid):
            return {"type": "must_include", "action": "add", "strength": "hard", "source_text": src, "params": {"course_id": cid, "allowed_section_ids": None}}

        drafts = [inc("운영체제 꼭", "CSE301"), inc("없는 과목", "NOPE999")]
        text = json.dumps({"drafts": drafts, "unsupported": []})
        return httpx.Response(200, json={"status": "completed", "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}]})

    r = req("운영체제는 꼭 들어야 해")
    resp = build_response(r, _gem(h).parse(r), "live", "rid")
    sent = seen["body"]["input"]
    payload = json.loads(sent.split("\n", 1)[1].split("\n\n[사용자 선호 문장", 1)[0])
    sent_ids = {c["id"] for c in payload["courses"]}
    assert "CSE301" in sent_ids and len(sent_ids) < 20  # 축소된 목록만 전송
    assert [d.params["course_id"] for d in resp.draft_constraints] == ["CSE301"]
    assert any(u.reason_code == "ENTITY_NOT_FOUND" for u in resp.unsupported_requests)  # ID 검증 유지
