"""'특정 교수의 특정 과목' 요구 → 서버의 명시적 엔티티 매핑으로 must_include 분반 제한을 만든다.

규칙
- 모델은 must_include에 course_id와 instructor_ids를 줄 수 있다. 분반 목록은 서버가
  `요청 엔티티의 교수.section_ids ∩ 과목.section_ids`로 계산한다(모델의 분반 추측을 믿지 않음).
- 모델이 allowed_section_ids를 직접 주면, 그 분반이 해당 과목·해당 교수에 속하는지 검증한다. 아니면 거절.
- 동명이인이 같은 과목을 맡거나, 교수가 그 과목 분반을 맡지 않으면 질문으로 돌린다(확인 전 추가 불가).
- 문장에 교수 이름이 있는데 모델이 교수 제한 없이 과목만 돌려주면, 조용히 과목만 충족한 것으로 두지 않고
  '이 교수 분반으로 제한할지' 질문한다.
- 사용자 문장·카탈로그 문자열은 데이터로만 비교한다.
"""

from __future__ import annotations

import re

from app.contracts import EntityInstructor, ParseRequest


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


def _sections_of(inst: EntityInstructor, course_sections: set[str]) -> list[str]:
    return sorted(set(inst.section_ids) & course_sections)


def _question(d: dict, message: str, options: list[tuple[str, str, dict]]) -> dict:
    return {
        "id": f"q-inst-{d['draft_id']}",
        "draft_id": d["draft_id"],
        "field": "params.allowed_section_ids",
        "message": message,
        "options": [{"id": oid, "label": label, "patch": patch} for oid, label, patch in options],
    }


def _mark_unresolved(d: dict) -> None:
    d["params"]["allowed_section_ids"] = None
    uf = d.setdefault("unresolved_fields", [])
    if "params.allowed_section_ids" not in uf:
        uf.append("params.allowed_section_ids")


def resolve_must_include(d: dict, req: ParseRequest) -> tuple[str | None, list[dict]]:
    """must_include 초안을 교수 매핑으로 정리한다. (거절 사유 또는 None, 추가 질문 목록). d를 제자리에서 고친다."""
    if d.get("type") != "must_include" or d.get("action", "add") != "add":
        return None, []
    p = d.setdefault("params", {})
    iids = p.pop("instructor_ids", None) or []
    cid = p.get("course_id")
    course = next((c for c in req.entities.courses if c.id == cid), None)
    if course is None:
        return None, []  # 과목 미해결·없는 ID는 기존 검증(_check_draft·미해결 처리)에 맡긴다
    course_secs = set(course.section_ids)
    by_id = {i.id: i for i in req.entities.instructors}
    teaching = [i for i in req.entities.instructors if set(i.section_ids) & course_secs]

    if iids:
        if any(i not in by_id for i in iids):
            return "ENTITY_NOT_FOUND", []
        chosen = [by_id[i] for i in iids]
        allowed = sorted({s for i in chosen for s in _sections_of(i, course_secs)})
        names = {_norm(i.name) for i in chosen}
        homonyms = [i for i in teaching if _norm(i.name) in names and i.id not in iids]
        if homonyms:
            _mark_unresolved(d)
            cands = [i for i in teaching if _norm(i.name) in names]
            opts = [
                (f"inst:{i.id}", f"{i.name} ({i.id}) 분반 {len(_sections_of(i, course_secs))}개", {"params.allowed_section_ids": _sections_of(i, course_secs)})
                for i in cands
            ]
            return None, [_question(d, f"'{course.name}'을(를) 맡은 같은 이름의 교수가 여러 명입니다. 어느 교수 분반인가요?", opts)]
        if not allowed:
            _mark_unresolved(d)
            label = ", ".join(i.name for i in chosen)
            opts = [
                ("any", f"교수와 상관없이 '{course.name}' 아무 분반이나 허용", {"params.allowed_section_ids": None}),
                ("discard", "이 조건 버리기", {"discard": True}),
            ]
            return None, [_question(d, f"'{label}' 교수가 맡은 '{course.name}' 분반이 없습니다. 어떻게 할까요?", opts)]
        given = p.get("allowed_section_ids")
        if given is not None and not set(given) <= set(allowed):
            return "SECTION_INSTRUCTOR_MISMATCH", []
        p["allowed_section_ids"] = allowed
        return None, []

    if p.get("allowed_section_ids") is not None:
        return None, []  # 분반 직접 지정: 과목 소속은 _check_draft가 검증

    # 교수 제한 누락 감지: 문장에 이 과목을 맡은 교수 이름이 있는데 제한이 없다
    text = _norm(d.get("source_text") or req.text)
    mentioned = [i for i in teaching if len(_norm(i.name)) >= 2 and _norm(i.name) in text]
    if not mentioned:
        return None, []
    restricted = sorted({s for i in mentioned for s in _sections_of(i, course_secs)})
    if set(restricted) == course_secs:
        return None, []  # 그 교수가 모든 분반을 맡음 → 제한해도 같음
    _mark_unresolved(d)
    opts = [
        (f"inst:{i.id}", f"{i.name} ({i.id}) 분반 {len(_sections_of(i, course_secs))}개로 제한", {"params.allowed_section_ids": _sections_of(i, course_secs)})
        for i in mentioned
    ]
    opts.append(("any", f"교수와 상관없이 '{course.name}' 아무 분반이나", {"params.allowed_section_ids": None}))
    names = ", ".join(sorted({i.name for i in mentioned}))
    return None, [_question(d, f"문장에 '{names}' 교수가 있습니다. '{course.name}'을(를) 이 교수 분반으로 제한할까요? 확인 전에는 추가할 수 없습니다.", opts)]
