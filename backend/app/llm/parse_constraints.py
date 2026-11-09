"""Natural-language preferences -> validated constraints (D14).

The LLM fills the exact constraint schema (const -> enum so Gemini honours the type tags), the
server re-validates with `constraints_adapter`, retries with the validation error (max 2), then
resolves course and instructor mentions against the catalog. The LLM never builds a timetable.
"""

import hashlib
import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, ValidationError

from app.domain.api_models import (
    Ambiguity,
    CatalogSummary,
    ConstraintsParseResponse,
    EntityCandidate,
    EntityMatch,
)
from app.domain.constraints import Constraint, constraint_adapter
from app.llm.entities import match
from app.llm.provider import LLMError, Provider

MAX_RETRIES = 2
RETRY_HINT = "이전 출력이 스키마에 맞지 않았다. 고쳐서 다시 출력하라:"

# Edit the prompt file, not this module; the text is part of the LLM cache key.
SYSTEM = (Path(__file__).parent / "prompts" / "parse_constraints.md").read_text(encoding="utf-8")


class _LLMOutput(BaseModel):
    constraints: list[Constraint]
    ambiguities: list[Ambiguity] = Field(default_factory=list)


def _enum_tags(node):
    """Gemini ignores JSON-schema `const`; `enum` with one value is enforced."""
    if isinstance(node, dict):
        node = {k: _enum_tags(v) for k, v in node.items() if k != "discriminator"}
        if "const" in node:
            node["enum"] = [node.pop("const")]
        return node
    if isinstance(node, list):
        return [_enum_tags(v) for v in node]
    return node


@lru_cache
def llm_schema() -> dict:
    return _enum_tags(_LLMOutput.model_json_schema())


def prompt_fingerprint() -> str:
    """Changes whenever the prompt or schema does; recorded fixtures must match it."""
    blob = SYSTEM + _user_prompt("{text}", None) + json.dumps(llm_schema(), sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _user_prompt(text: str, summary: CatalogSummary | None) -> str:
    categories = ", ".join(summary.categories) if summary and summary.categories else "(모름)"
    return f"카테고리 목록: {categories}\n\n선호 문장:\n{text}"


def parse_constraints(
    text: str, summary: CatalogSummary | None, provider: Provider
) -> ConstraintsParseResponse:
    user = _user_prompt(text, summary)
    prompt, last_error = user, ""
    for _ in range(MAX_RETRIES + 1):
        raw = provider.generate_json(SYSTEM, prompt, llm_schema())
        try:
            out = _LLMOutput.model_validate(json.loads(raw))
            break
        except (json.JSONDecodeError, ValidationError) as e:
            last_error = _short(e)
            prompt = (
                f"{user}\n\n이전 출력이 스키마에 맞지 않았다. 고쳐서 다시 출력하라:\n{last_error}"
            )
    else:
        raise LLMError("llm_invalid_output", f"LLM output failed validation: {last_error}")
    return _resolve(_renumber(out), summary)


def _short(e: Exception) -> str:
    if isinstance(e, ValidationError):
        return "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:10])
    return str(e)


def _renumber(out: _LLMOutput) -> _LLMOutput:
    """Guarantee unique ids c1..cN and keep ambiguity references pointing at the same items."""
    mapping: dict[str, str] = {}
    for i, c in enumerate(out.constraints, start=1):
        mapping.setdefault(c.id, f"c{i}")
        c.id = f"c{i}"
    for a in out.ambiguities:
        if a.constraint_id is not None:
            a.constraint_id = mapping.get(a.constraint_id)
    return out


def _resolve(out: _LLMOutput, summary: CatalogSummary | None) -> ConstraintsParseResponse:
    ambiguities = list(out.ambiguities)
    candidates: list[EntityCandidate] = []
    courses = {c.id: c.name for c in summary.courses} if summary else {}
    instructors = {i: i for i in summary.instructors} if summary else {}
    out.constraints = [_course_or_instructor(c, courses, instructors) for c in out.constraints]
    for c in out.constraints:
        p = c.params
        if c.type in ("must_include", "must_exclude") and courses:
            field, kind, options = "course_id", "course", courses
        elif c.type in ("instructor_avoid", "instructor_prefer") and instructors:
            field, kind, options = "instructor", "instructor", instructors
        else:
            if c.type == "category_min" and summary and summary.categories:
                if p.category not in summary.categories:
                    known = ", ".join(summary.categories)
                    msg = f"'{p.category}'는 카탈로그 카테고리({known})에 없다"
                    ambiguities.append(Ambiguity(constraint_id=c.id, message=msg))
            continue
        mention = getattr(p, field)
        picked, ranked = match(mention, options)
        if picked:
            setattr(p, field, picked)
        else:
            candidates.append(_candidate(mention, kind, ranked))
            msg = _which("과목" if kind == "course" else "교수", mention, ranked)
            ambiguities.append(Ambiguity(constraint_id=c.id, message=msg))
    return ConstraintsParseResponse(
        constraints=out.constraints, ambiguities=ambiguities, entity_candidates=candidates
    )


def _course_or_instructor(c: Constraint, courses: dict, instructors: dict) -> Constraint:
    """The LLM sometimes files a professor under must_include/must_exclude; fix it when the name
    clearly is an instructor and not a course."""
    if c.type not in ("must_include", "must_exclude") or not instructors:
        return c
    mention = c.params.course_id
    if match(mention, courses)[0] if courses else False:
        return c
    who = match(mention, instructors)[0]
    if who is None:
        return c
    kind = "instructor_prefer" if c.type == "must_include" else "instructor_avoid"
    data = c.model_dump() | {"type": kind, "params": {"instructor": who}}
    return constraint_adapter.validate_python(data)


def _candidate(mention: str, kind: str, ranked) -> EntityCandidate:
    return EntityCandidate(
        mention=mention,
        kind=kind,
        candidates=[EntityMatch(id=i, name=n, score=round(s, 3)) for i, n, s in ranked],
    )


def _which(kind: str, mention: str, ranked) -> str:
    if not ranked:
        return f"'{mention}'와 맞는 {kind}을(를) 찾지 못했다"
    return f"'{mention}'가 어느 {kind}인지 골라야 한다 (후보 {len(ranked)}개)"
