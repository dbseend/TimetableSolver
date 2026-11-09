"""'15~18학점'이 하한만·상한만 초안 두 개로 온 경우의 정규화. 외부 LLM 없이 provider 출력을 직접 구성."""

from __future__ import annotations

from app.application.normalize import merge_split_credit_ranges
from app.application.parse import build_response
from app.contracts import ParseRequest
from app.llm.base import ProviderOutput


def cr(did, lo, hi, strength="hard", src="15~18학점으로"):
    unresolved = [f"params.{k}" for k, v in (("min_units", lo), ("max_units", hi)) if v is None]
    return {
        "draft_id": did,
        "type": "credit_range",
        "action": "add",
        "strength": strength,
        "weight": None,
        "params": {"min_units": lo, "max_units": hi},
        "source_text": src,
        "unresolved_fields": unresolved,
    }


def req():
    return ParseRequest.model_validate(
        {
            "text": "15~18학점으로",
            "catalog_revision": "a" * 64,
            "input_revision": 1,
            "entities": {"courses": [], "instructors": [], "category_groups": {}, "category_ids": ["전선"]},
        }
    )


def test_split_halves_become_one_resolved_range():
    resp = build_response(req(), ProviderOutput(drafts=[cr("d1", 1500, None), cr("d2", None, 1800)]), "live", "r")
    [d] = resp.draft_constraints
    assert d.params == {"min_units": 1500, "max_units": 1800} and d.unresolved_fields == [] and resp.status == "parsed"
    assert any("하나의 학점 범위" in w for w in resp.warnings)


def test_questions_for_merged_fields_are_dropped():
    q = [
        {"id": "q1", "draft_id": "d1", "field": "params.max_units", "message": "최대?", "options": []},
        {"id": "q2", "draft_id": "d2", "field": "params.min_units", "message": "최소?", "options": []},
    ]
    drafts, qs, _ = merge_split_credit_ranges([cr("d1", 1500, None), cr("d2", None, 1800)], q)
    assert len(drafts) == 1 and qs == []


def test_not_merged_when_strength_differs_or_contradictory_or_ambiguous():
    for ds in (
        [cr("d1", 1500, None, "hard"), cr("d2", None, 1800, "soft")],  # 강도 다름
        [cr("d1", 1800, None), cr("d2", None, 1500)],  # 모순(min > max)
        [cr("d1", 1500, None), cr("d2", None, 1800), cr("d3", None, 2100)],  # 상한 후보 여러 개
        [cr("d1", 1500, 1800), cr("d2", None, 2100)],  # 이미 완전한 범위는 건드리지 않음
    ):
        out, _, w = merge_split_credit_ranges(ds, [])
        assert out == ds and w == []


def test_total_credit_and_category_credit_are_not_merged():
    cat = {
        "draft_id": "d2",
        "type": "category_min",
        "action": "add",
        "strength": "hard",
        "weight": None,
        "params": {"category_ids": ["전선"], "min_units": 1200},
        "source_text": "전공 12학점",
        "unresolved_fields": [],
    }
    ds = [cr("d1", None, 1800), cat]
    out, _, w = merge_split_credit_ranges(ds, [])
    assert out == ds and w == []
