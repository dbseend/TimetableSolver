"""LLM에 보낼 카탈로그 엔티티 후보 축소(main `backend/app/llm/entities.py`의 서버 측 매칭 아이디어를 선별 도입).

목적: 큰 카탈로그(실데이터 과목 511·교수 287)의 모든 이름을 매 호출 보내지 않는다(최소 전송, docs/02 §9.1).
원칙
- **정확한 과목 코드 일치가 최우선**이며 항상 포함한다.
- 이름은 공백 제거·소문자 기준 포함 관계(양방향)와 문자 bigram 유사도로 넓게 잡는다(재현율 우선).
  축소 때문에 정답 과목·교수가 빠지는 것이 과잉 포함보다 나쁘다.
- 교수 이름이 걸리면 그 교수의 담당 과목도 포함한다.
- 축소는 '보내는 목록'에만 적용한다. 응답 검증(application/parse._check_draft)은 항상 전체 엔티티로 한다.
- 작은 카탈로그(기본 150과목 이하)는 축소하지 않는다.
- 후보가 하나도 없으면 빈 목록을 보내고, 모델은 질문/미지원으로 답해야 한다(임의 과목으로 대체 금지 규칙은 그대로).
"""

from __future__ import annotations

import re

from app.contracts import EntityCourse, EntityInstructor, ParseRequest

NARROW_THRESHOLD = 150
BIGRAM_MIN = 0.5  # 이름 bigram 중 문장에 나온 비율


def _norm(s: str) -> str:
    return re.sub(r"[\s()\[\]·・,./_-]+", "", s).lower()


def _bigrams(s: str) -> set[str]:
    return {s[i : i + 2] for i in range(len(s) - 1)} if len(s) >= 2 else {s} if s else set()


def _name_hit(name: str, text_norm: str, text_bigrams: set[str]) -> bool:
    n = _norm(name)
    if not n:
        return False
    if len(n) >= 2 and n in text_norm:
        return True
    grams = _bigrams(n)
    if not grams:
        return False
    # 약칭·띄어쓰기 변형(예: '운영 체제', '자료 구조 과목')을 놓치지 않도록 bigram 겹침 비율로 판정
    return len(grams & text_bigrams) / len(grams) >= BIGRAM_MIN and len(grams & text_bigrams) >= 1 and len(n) >= 2


def _code_hits(text: str, courses: list[EntityCourse]) -> set[str]:
    low = text.lower()
    return {c.id for c in courses if re.search(rf"(?<![a-z0-9]){re.escape(c.id.lower())}(?![a-z0-9])", low)}


def select_entities(req: ParseRequest, threshold: int = NARROW_THRESHOLD) -> tuple[list[EntityCourse], list[EntityInstructor], bool]:
    """(보낼 과목, 보낼 교수, 축소 여부)."""
    courses, instructors = req.entities.courses, req.entities.instructors
    if len(courses) <= threshold:
        return courses, instructors, False
    tn = _norm(req.text)
    tb = _bigrams(tn)
    keep_c = _code_hits(req.text, courses)
    keep_c |= {c.id for c in courses if _name_hit(c.name, tn, tb)}
    keep_i = {i.id for i in instructors if _name_hit(i.name, tn, tb)}
    for i in instructors:
        if i.id in keep_i:
            keep_c |= set(i.course_ids)
    # 과목이 걸리면 그 과목의 교수도 보낸다(“A교수의 B과목” 확인용)
    for i in instructors:
        if keep_c.intersection(i.course_ids):
            keep_i.add(i.id)
    return [c for c in courses if c.id in keep_c], [i for i in instructors if i.id in keep_i], True
