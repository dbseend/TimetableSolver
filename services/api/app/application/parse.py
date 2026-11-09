"""provider DTO → 구조·범위·참조·지원 기능 검증 → ParseResponse.

schema-valid 응답이라도 없는 ID·범위 밖 값·미지원 type이면 초안을 거절하고 unsupported로 드러낸다.
"""

from __future__ import annotations

import os

from app.application.instructor_sections import resolve_must_include
from app.application.normalize import merge_split_credit_ranges
from app.contracts import (
    DAYS,
    SUPPORTED_CONSTRAINT_TYPES,
    UNSUPPORTED_CONSTRAINT_TYPES,
    DraftConstraint,
    ParseRequest,
    ParseResponse,
    Question,
    UnsupportedRequest,
)
from app.llm.base import ProviderOutput
from app.llm.fixture import FixtureProvider
from app.llm.gemini import GeminiProvider


def provider_from_env():
    """LLM_PROVIDER=gemini + GEMINI_API_KEY + LLM_MODEL 이면 live, 아니면 ENABLE_DEMO_FIXTURES(기본 1)로 fixture."""
    if os.environ.get("LLM_PROVIDER", "fixture") == "gemini":
        key, model = os.environ.get("GEMINI_API_KEY"), os.environ.get("LLM_MODEL")
        if key and model:
            return GeminiProvider(key, model)
    if os.environ.get("ENABLE_DEMO_FIXTURES", "1") == "1":
        return FixtureProvider()
    return None


def _check_draft(d: dict, req: ParseRequest) -> str | None:
    """문제가 있으면 reason code."""
    if d.get("action") == "delete":
        tgt = d.get("target_constraint_id")
        if tgt is not None and tgt not in {c.id for c in req.existing_constraints}:
            return "ENTITY_NOT_FOUND"
        return None
    t = d.get("type")
    if t in UNSUPPORTED_CONSTRAINT_TYPES:
        return "P1_NOT_IMPLEMENTED"
    if t not in SUPPORTED_CONSTRAINT_TYPES:
        return "UNSUPPORTED_TYPE"
    if d.get("strength") not in ("hard", "soft", None):
        return "INVALID_VALUE"
    p = d.get("params") or {}
    courses = {c.id: c for c in req.entities.courses}
    instructors = {i.id for i in req.entities.instructors}
    cats = set(req.entities.category_ids) | {c for g in req.entities.category_groups.values() for c in g}

    def intval(k, lo, hi):
        v = p.get(k)
        return v is None or (isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi)

    if not all(intval(k, 0, 6000) for k in ("min_units", "max_units")):
        return "INVALID_VALUE"
    if not all(intval(k, 0, 1440) for k in ("start_minute", "end_minute")):
        return "INVALID_VALUE"
    if not intval("max_days", 0, 7):
        return "INVALID_VALUE"
    if p.get("start_minute") is not None and p.get("end_minute") is not None and p["start_minute"] >= p["end_minute"]:
        return "INVALID_VALUE"
    if p.get("min_units") is not None and p.get("max_units") is not None and p["min_units"] > p["max_units"]:
        return "INVALID_VALUE"
    if any(day not in DAYS for day in (p.get("days") or [])):
        return "INVALID_VALUE"
    cid = p.get("course_id")
    if cid is not None and cid not in courses:
        return "ENTITY_NOT_FOUND"
    if p.get("allowed_section_ids") is not None:
        if cid is None or not p["allowed_section_ids"] or not set(p["allowed_section_ids"]) <= set(courses[cid].section_ids):
            return "ENTITY_NOT_FOUND"
    if any(i not in instructors for i in (p.get("instructor_ids") or [])):
        return "ENTITY_NOT_FOUND"
    if any(c not in cats for c in (p.get("category_ids") or [])):
        return "ENTITY_NOT_FOUND"
    return None


REASON_MSG = {
    "ENTITY_NOT_FOUND": "해석 결과가 카탈로그에 없는 대상을 가리켜 거절했습니다.",
    "INVALID_VALUE": "해석 결과 값이 허용 범위를 벗어나 거절했습니다.",
    "UNSUPPORTED_TYPE": "지원하지 않는 조건 유형입니다.",
    "P1_NOT_IMPLEMENTED": "이번 MVP에서 구현하지 않은 조건 유형입니다.",
    "SECTION_INSTRUCTOR_MISMATCH": "해석 결과의 분반이 요청한 교수의 분반이 아니라 거절했습니다.",
}


def build_response(req: ParseRequest, out: ProviderOutput, mode: str, request_id: str) -> ParseResponse:
    drafts, unsupported = [], [UnsupportedRequest(**u) for u in out.unsupported]
    rejected: set[str] = set()
    extra_questions: list[dict] = []
    # 같은 요청에서 하한만·상한만으로 쪼개진 총학점 범위를 하나로(의미가 명확할 때만)
    norm_drafts, norm_questions, norm_warnings = merge_split_credit_ranges(list(out.drafts), list(out.questions))
    out = ProviderOutput(drafts=norm_drafts, questions=norm_questions, unsupported=out.unsupported, warnings=[*out.warnings, *norm_warnings])
    for d in out.drafts:
        # 교수+과목 요구는 서버 매핑으로 분반 제한을 만들고 검증한다(누락·모호하면 질문).
        reason, qs = resolve_must_include(d, req)
        extra_questions += qs
        reason = reason or _check_draft(d, req)
        if reason:
            rejected.add(d["draft_id"])
            unsupported.append(UnsupportedRequest(source_text=d.get("source_text", ""), reason_code=reason, message=REASON_MSG[reason]))
            continue
        # null 값 파라미터는 미해결로 표시
        unresolved = list(d.get("unresolved_fields") or [])
        for k, v in (d.get("params") or {}).items():
            if v is None and f"params.{k}" not in unresolved and k != "allowed_section_ids":
                unresolved.append(f"params.{k}")
        if d.get("strength") is None and d.get("action") != "delete" and "strength" not in unresolved:
            unresolved.append("strength")
        drafts.append(DraftConstraint(**{**d, "unresolved_fields": unresolved}))
    questions = [Question(**q) for q in [*out.questions, *extra_questions] if q.get("draft_id") not in rejected]
    needs = bool(questions) or any(d.unresolved_fields for d in drafts)
    return ParseResponse(
        request_id=request_id,
        catalog_revision=req.catalog_revision,
        input_revision=req.input_revision,
        status="needs_clarification" if needs else "parsed",
        draft_constraints=drafts,
        questions=questions,
        unsupported_requests=unsupported,
        warnings=out.warnings,
        provider_mode=mode,
    )
