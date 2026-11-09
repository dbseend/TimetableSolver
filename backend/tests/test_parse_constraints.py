"""NL -> constraints with a scripted fake provider (no network)."""

import json

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.domain.api_models import CatalogSummary
from app.llm.entities import match
from app.llm.parse_constraints import llm_schema, parse_constraints
from app.llm.provider import CachedProvider, LLMError
from app.main import create_app


class Fake:
    model = "fake"

    def __init__(self, *responses: str) -> None:
        self.responses = list(responses)
        self.prompts: list[str] = []

    def generate_json(self, system: str, user: str, schema: dict) -> str:
        self.prompts.append(user)
        return self.responses.pop(0)


def out(*constraints, ambiguities=()):
    return json.dumps({"constraints": list(constraints), "ambiguities": list(ambiguities)})


def c(cid, type_, strength="soft", **params):
    return {"id": cid, "type": type_, "strength": strength, "params": params}


SUMMARY = CatalogSummary(
    courses=[
        {"id": "SYN101", "name": "가상과목 알파 1"},
        {"id": "SYN111", "name": "가상과목 알파 2"},
        {"id": "SYN102", "name": "가상과목 베타 1"},
        {"id": "GCS10004", "name": "파이썬 프로그래밍(Python Programming)"},
    ],
    instructors=["가상교수 A01", "가상교수 B02"],
    categories=["전필", "전선", "교양"],
)


def test_schema_has_no_const_or_discriminator():
    text = json.dumps(llm_schema())
    assert '"const"' not in text and "discriminator" not in text
    assert '"enum": ["day_off"]' in text


def test_resolves_names_and_renumbers_ids():
    fake = Fake(
        out(
            c("x", "must_include", "hard", course_id="파이썬 프로그래밍"),
            c("x", "instructor_avoid", instructor="가상교수A01"),
            c("y", "day_off", days=["Fri"]),
        )
    )
    r = parse_constraints("파이썬 프로그래밍 꼭, A01 교수 싫어, 금공강", SUMMARY, fake)
    assert [x.id for x in r.constraints] == ["c1", "c2", "c3"]
    assert r.constraints[0].params.course_id == "GCS10004"
    assert r.constraints[1].params.instructor == "가상교수 A01"
    assert r.entity_candidates == [] and r.ambiguities == []
    assert "카테고리 목록: 전필, 전선, 교양" in fake.prompts[0]


def test_ambiguous_course_returns_candidates_without_picking():
    fake = Fake(out(c("c1", "must_include", "hard", course_id="알파")))
    r = parse_constraints("알파 과목 넣어줘", SUMMARY, fake)
    assert r.constraints[0].params.course_id == "알파"  # left as written
    (cand,) = r.entity_candidates
    assert {m.id for m in cand.candidates} == {"SYN101", "SYN111"}
    assert r.ambiguities[0].constraint_id == "c1"


def test_unknown_category_is_flagged():
    fake = Fake(out(c("c1", "category_min", "hard", category="전공", credits=12)))
    r = parse_constraints("전공 12학점", SUMMARY, fake)
    assert "전공" in r.ambiguities[0].message


def test_retries_with_validation_error_then_succeeds():
    bad = out(c("c1", "day_off", days=["Funday"]))
    fake = Fake(bad, out(c("c1", "day_off", days=["Fri"])))
    r = parse_constraints("금공강", None, fake)
    assert r.constraints[0].params.days == ["Fri"]
    assert "스키마에 맞지 않았다" in fake.prompts[1]


def test_gives_up_after_retries():
    fake = Fake("not json", "not json", "not json")
    with pytest.raises(LLMError) as e:
        parse_constraints("x", None, fake)
    assert e.value.code == "llm_invalid_output"


def test_match_prefers_exact_and_refuses_ties():
    options = {s.id: s.name for s in SUMMARY.courses}
    assert match("SYN102", options)[0] == "SYN102"
    assert match("가상과목 베타 1", options)[0] == "SYN102"
    assert match("가상과목 알파", options)[0] is None


def test_cache_and_daily_limit(tmp_path):
    inner = Fake(out(), out())
    cached = CachedProvider(inner, tmp_path, daily_limit=1)
    assert cached.generate_json("s", "u", {}) == cached.generate_json("s", "u", {})
    assert len(inner.prompts) == 1  # second call served from disk
    with pytest.raises(LLMError) as e:
        cached.generate_json("s", "other", {})
    assert e.value.code == "llm_daily_limit"


def client_with(provider) -> TestClient:
    app = create_app(Settings(_env_file=None, llm_provider="none"))
    app.state.llm = provider
    return TestClient(app)


def test_endpoint_disabled_without_provider():
    r = client_with(None).post("/constraints/parse", json={"text": "금공강"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_disabled"


def test_endpoint_maps_limit_to_429():
    class Limited(Fake):
        def generate_json(self, *a):
            raise LLMError("llm_daily_limit", "limit")

    r = client_with(Limited()).post("/constraints/parse", json={"text": "금공강"})
    assert r.status_code == 429


def test_endpoint_parses():
    body = {"text": "금요일 공강", "catalog_summary": SUMMARY.model_dump()}
    r = client_with(Fake(out(c("c1", "day_off", days=["Fri"])))).post(
        "/constraints/parse", json=body
    )
    assert r.status_code == 200
    assert r.json()["constraints"][0]["type"] == "day_off"
