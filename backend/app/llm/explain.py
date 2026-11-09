"""Explanations of solver results (D23).

Facts come only from the solver result. A template text is always built; if an LLM is
configured it may rewrite each text, and the rewrite is kept only if every time, course name
and credit number it mentions is among the facts. Otherwise the template stands.
"""

import json
import re
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ValidationError

from app.domain.api_models import ExplainRequest, ExplainResponse
from app.domain.constraints import Constraint
from app.domain.models import Catalog
from app.llm.entities import normalize
from app.llm.provider import LLMError, Provider

SYSTEM = (Path(__file__).parent / "prompts" / "explain.md").read_text(encoding="utf-8")
DAY = {"Mon": "월", "Tue": "화", "Wed": "수", "Thu": "목", "Fri": "금", "Sat": "토"}
UNIT = {
    "credit_range": "반학점",
    "category_min": "반학점",
    "day_off": "일",
    "lunch_free": "일",
    "max_days_on_campus": "일",
    "time_avoid": "분",
    "time_prefer": "분",
    "max_gap": "교시",
    "max_consecutive": "교시",
    "instructor_avoid": "분반",
}


def describe(c: Constraint) -> str:
    """Short Korean label; the user's own words win when we have them."""
    if c.source_text:
        return c.source_text
    p = c.params

    def days(ds: list[str]) -> str:
        return "·".join(DAY.get(d, d) for d in ds)

    return {
        "credit_range": lambda: f"총 {p.min}–{p.max}학점",
        "must_include": lambda: f"{p.course_id} 포함",
        "must_exclude": lambda: f"{p.course_id} 제외",
        "day_off": lambda: f"{days(p.days)} 공강",
        "time_avoid": lambda: f"{days(p.days)} {p.start}–{p.end} 피하기",
        "time_prefer": lambda: f"{days(p.days)} {p.start}–{p.end} 선호",
        "max_gap": lambda: f"공강 최대 {p.minutes}분",
        "lunch_free": lambda: f"점심 {p.min_free_minutes}분 비우기",
        "max_consecutive": lambda: f"연강 최대 {p.minutes}분",
        "max_days_on_campus": lambda: f"주 {p.max_days}일 이하 등교",
        "category_min": lambda: f"{p.category} {p.credits}학점 이상",
        "instructor_avoid": lambda: f"{p.instructor} 피하기",
        "instructor_prefer": lambda: f"{p.instructor} 선호",
    }[c.type]()


def _fmt(n: float) -> str:
    return str(int(n)) if n == int(n) else str(n)


def facts(req: ExplainRequest) -> dict:
    cat, by_id = req.catalog, {c.id: c for c in req.constraints}
    sections = {s.id: s for s in cat.sections}
    names = {c.id: c.name for c in cat.courses}
    out = {"candidates": [], "diagnosis": None}
    for cand in req.result.candidates:
        chosen = [sections[sid] for sid in cand.sections if sid in sections]
        total = sum(cat.credit_and_category(s)[0] for s in chosen)
        out["candidates"].append(
            {
                "total_credits": _fmt(total),
                "courses": [
                    {
                        "name": names[s.course_id],
                        "times": [f"{DAY[m.day]} {m.start}–{m.end}" for m in s.meetings],
                    }
                    for s in chosen
                ],
                "kept": [describe(by_id[i]) for i in cand.satisfied if i in by_id],
                "missed": [
                    f"{describe(by_id[v.id])} ({v.amount}{UNIT.get(by_id[v.id].type, '')})"
                    for v in cand.violated
                    if v.id in by_id
                ],
            }
        )
    if req.result.diagnosis:
        d = req.result.diagnosis
        out["diagnosis"] = {
            "conflicting": [describe(by_id[i]) for i in d.core if i in by_id],
            "drop_to_fix": [
                describe(by_id[r.drop]) for r in d.relaxations if r.feasible and r.drop in by_id
            ],
        }
    return out


def template(f: dict) -> tuple[list[str], str | None]:
    texts = []
    for i, c in enumerate(f["candidates"], start=1):
        days = sorted(
            {t.split()[0] for co in c["courses"] for t in co["times"]}, key="월화수목금토".index
        )
        text = f"후보 {i}: {c['total_credits']}학점, {len(c['courses'])}과목"
        text += f", {'·'.join(days)} 등교." if days else "."
        if c["missed"]:
            text += f" 못 지킨 선호: {', '.join(c['missed'])}."
        elif c["kept"]:
            text += " 입력한 조건을 모두 지켰다."
        texts.append(text)
    d = f["diagnosis"]
    diag = None
    if d:
        diag = f"다음 조건은 함께 만족할 수 없다: {', '.join(d['conflicting'])}."
        if d["drop_to_fix"]:
            diag += f" 이 중 {' 또는 '.join(d['drop_to_fix'])}을(를) 빼면 시간표를 만들 수 있다."
    return texts, diag


_TIME = re.compile(r"\b\d{1,2}:\d{2}\b")
_CREDITS = re.compile(r"(\d+(?:\.\d+)?)\s*학점")


def grounded(
    text: str, facts_text: str, credits: set[str], catalog: Catalog, chosen: set[str]
) -> bool:
    """Times appear in the facts, "N학점" only uses `credits`, and no unchosen course is named."""
    if any(t not in facts_text for t in _TIME.findall(text)):
        return False
    if any(n not in credits for n in _CREDITS.findall(text)):
        return False
    plain = normalize(text)
    for c in catalog.courses:
        name = normalize(c.name)
        if len(name) >= 2 and name in plain and c.name not in chosen:
            return False
    return True


class _Rewrite(BaseModel):
    candidate_explanations: list[str]
    diagnosis_text: str | None = None


@lru_cache
def _schema() -> dict:
    return _Rewrite.model_json_schema()


def explain(req: ExplainRequest, provider: Provider | None) -> ExplainResponse:
    f = facts(req)
    texts, diag = template(f)
    sources = ["template"] * (len(texts) + (diag is not None))
    if provider is None or not (texts or diag):
        return ExplainResponse(candidate_explanations=texts, diagnosis_text=diag, sources=sources)
    try:
        raw = provider.generate_json(SYSTEM, json.dumps(f, ensure_ascii=False), _schema())
        rewrite = _Rewrite.model_validate(json.loads(raw))
    except (LLMError, ValidationError, json.JSONDecodeError):
        return ExplainResponse(candidate_explanations=texts, diagnosis_text=diag, sources=sources)
    pairs = zip(f["candidates"], rewrite.candidate_explanations, strict=False)
    for i, (cand, new) in enumerate(pairs):
        names = {co["name"] for co in cand["courses"]}
        cand_text = json.dumps(cand, ensure_ascii=False)
        if grounded(new, cand_text, {cand["total_credits"]}, req.catalog, names):
            texts[i], sources[i] = new, "llm"
    if diag and rewrite.diagnosis_text:
        d_text = json.dumps(f["diagnosis"], ensure_ascii=False)
        if grounded(
            rewrite.diagnosis_text, d_text, set(_CREDITS.findall(d_text)), req.catalog, set()
        ):
            diag, sources[-1] = rewrite.diagnosis_text, "llm"
    return ExplainResponse(candidate_explanations=texts, diagnosis_text=diag, sources=sources)
