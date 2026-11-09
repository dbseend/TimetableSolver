"""해석 초안 정규화: 같은 요청에서 '총학점 하한만'·'상한만' 초안 두 개로 쪼개진 학점 범위를 하나로 합친다.

합치는 조건(모두 만족할 때만):
- 둘 다 type=credit_range, action=add
- 하나는 min만(max=null), 다른 하나는 max만(min=null)
- 강도가 같다(둘 다 null이면 강도 미해결 그대로 하나로)
- min <= max
- 위 조건에 맞는 쌍이 정확히 하나(여러 개면 의미가 모호하므로 합치지 않음)
합치지 않는 것: 총학점과 분류별 학점(category_min), 강도가 다른 조건, 모순되는 하한·상한, 이미 완전한 범위.
기존 확정 조건과의 충돌은 화면(사용자 선택)에서 다룬다.
"""

from __future__ import annotations


def _half(d: dict) -> str | None:
    if d.get("type") != "credit_range" or d.get("action", "add") != "add":
        return None
    p = d.get("params") or {}
    lo, hi = p.get("min_units"), p.get("max_units")
    if lo is not None and hi is None:
        return "min"
    if hi is not None and lo is None:
        return "max"
    return None


def merge_split_credit_ranges(drafts: list[dict], questions: list[dict]) -> tuple[list[dict], list[dict], list[str]]:
    """(정규화된 초안, 정리된 질문, 경고)."""
    mins = [d for d in drafts if _half(d) == "min"]
    maxs = [d for d in drafts if _half(d) == "max"]
    if len(mins) != 1 or len(maxs) != 1:
        return drafts, questions, []
    a, b = mins[0], maxs[0]
    if a.get("strength") != b.get("strength"):
        return drafts, questions, []
    lo, hi = a["params"]["min_units"], b["params"]["max_units"]
    if not (isinstance(lo, int) and isinstance(hi, int)) or lo > hi:
        return drafts, questions, []
    src = a.get("source_text") or ""
    if b.get("source_text") and b.get("source_text") != src:
        src = f"{src} / {b['source_text']}" if src else b["source_text"]
    merged = {
        **a,
        "params": {"min_units": lo, "max_units": hi},
        "source_text": src,
        "unresolved_fields": [f for f in (a.get("unresolved_fields") or []) if f not in ("params.min_units", "params.max_units")],
    }
    out = [merged if d is a else d for d in drafts if d is not b]
    # 합쳐져 해결된 필드에 대한 질문과, 사라진 초안의 질문은 버린다
    qs = [
        q
        for q in questions
        if q.get("draft_id") != b["draft_id"] and not (q.get("draft_id") == a["draft_id"] and q.get("field") in ("params.min_units", "params.max_units"))
    ]
    return out, qs, [f"'{src}'의 최소·최대 학점을 하나의 학점 범위({lo / 100:g}~{hi / 100:g}학점)로 합쳤습니다."]
