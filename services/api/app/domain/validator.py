"""독립 검증기. OR-Tools를 import하지 않는다(tests/unit/test_validator_independence.py가 확인).

원본 카탈로그·허용 ID·확정 제약·선택 ID만으로 hard 위반과 soft 만족을 다시 계산한다.
중복/알 수 없는 선택 ID를 제거해서 통과시키지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.contracts import ConstraintEvaluation
from app.domain.catalog import CatalogIndex, overlaps

DAY_KO = {"Mon": "월", "Tue": "화", "Wed": "수", "Thu": "목", "Fri": "금", "Sat": "토", "Sun": "일"}


def fmt_min(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


@dataclass
class ValidationResult:
    structural_violations: list[str] = field(default_factory=list)
    evaluations: list[ConstraintEvaluation] = field(default_factory=list)
    total_credit_units: int = 0
    penalty: int = 0
    soft_weight_total: int = 0

    @property
    def hard_violations(self) -> list[str]:
        out = list(self.structural_violations)
        out += [f"HARD_UNSATISFIED:{e.constraint_id}" for e in self.evaluations if e.strength == "hard" and not e.satisfied]
        return out

    @property
    def hard_ok(self) -> bool:
        return not self.hard_violations

    @property
    def score(self) -> float | None:
        if self.soft_weight_total == 0:
            return None
        return round(100.0 * (1 - self.penalty / self.soft_weight_total), 4)


def soft_score(evals: list[ConstraintEvaluation]) -> tuple[int, float | None]:
    soft = [e for e in evals if e.strength == "soft"]
    total = sum(e.weight or 0 for e in soft)
    penalty = sum((e.weight or 0) for e in soft if not e.satisfied)
    if total == 0:
        return 0, None
    return penalty, round(100.0 * (1 - penalty / total), 4)


def _section_desc(idx: CatalogIndex, sid: str) -> str:
    s = idx.section_by_id[sid]
    return f"{idx.course_by_id[s.course_id].name}({s.section_label})"


def evaluate_constraint(c, idx: CatalogIndex, chosen: list[str]) -> ConstraintEvaluation:
    sections = [idx.section_by_id[s] for s in chosen]
    t = c.type
    p = c.params
    satisfied = True
    violation = 0
    unit = "count"
    evidence: list[str] = []

    if t == "credit_range":
        total = sum(idx.units_of(s.id) for s in sections)
        unit = "credit_units"
        if total < p.min_units:
            violation = p.min_units - total
        elif total > p.max_units:
            violation = total - p.max_units
        satisfied = violation == 0
        evidence.append(f"선택 학점 {total / 100:g} / 범위 {p.min_units / 100:g}~{p.max_units / 100:g}")
    elif t == "must_include":
        unit = "sections"
        permitted = set(p.allowed_section_ids) if p.allowed_section_ids is not None else None
        picked = [s for s in sections if s.course_id == p.course_id]
        ok = [s for s in picked if permitted is None or s.id in permitted]
        satisfied = len(ok) == 1 and len(picked) == 1
        violation = 0 if satisfied else 1
        if not picked:
            evidence.append("해당 과목이 선택되지 않음")
        elif not ok:
            evidence.append(f"허용 목록 밖 분반 선택: {', '.join(s.id for s in picked)}")
        else:
            evidence.append(f"선택: {', '.join(s.id for s in ok)}")
    elif t == "must_exclude":
        unit = "sections"
        bad = [s for s in sections if s.course_id == p.course_id]
        violation = len(bad)
        satisfied = violation == 0
        evidence += [f"제외 과목 선택됨: {_section_desc(idx, s.id)}" for s in bad]
    elif t == "day_off":
        unit = "meetings"
        days = set(p.days)
        for s in sections:
            for m in s.meetings:
                if m.day in days:
                    violation += 1
                    evidence.append(f"{DAY_KO[m.day]} {fmt_min(m.start_minute)}~{fmt_min(m.end_minute)} {_section_desc(idx, s.id)}")
        satisfied = violation == 0
    elif t == "time_avoid":
        unit = "meetings"
        days = set(p.days)
        for s in sections:
            for m in s.meetings:
                if m.day in days and m.start_minute < p.end_minute and p.start_minute < m.end_minute:
                    violation += 1
                    evidence.append(f"{DAY_KO[m.day]} {fmt_min(m.start_minute)}~{fmt_min(m.end_minute)} {_section_desc(idx, s.id)}")
        satisfied = violation == 0
    elif t == "category_min":
        unit = "credit_units"
        cats = set(p.category_ids)
        # 과목 단위로 합집합 집계: 여러 카테고리에 속해도 1회만.
        courses = {s.course_id for s in sections}
        total = sum(idx.course_by_id[cid].credit_units for cid in courses if cats.intersection(idx.course_by_id[cid].category_ids))
        violation = max(0, p.min_units - total)
        satisfied = violation == 0
        evidence.append(f"해당 카테고리 선택 학점 {total / 100:g} / 최소 {p.min_units / 100:g}")
    elif t == "instructor_avoid":
        unit = "sections"
        bad_ids = set(p.instructor_ids)
        bad = [s for s in sections if bad_ids.intersection(s.instructor_ids)]
        violation = len(bad)
        satisfied = violation == 0
        evidence += [f"회피 교수 분반: {_section_desc(idx, s.id)}" for s in bad]
    elif t == "max_days_on_campus":
        unit = "days"
        days = sorted({m.day for s in sections for m in s.meetings if m.campus_required})
        violation = max(0, len(days) - p.max_days)
        satisfied = violation == 0
        evidence.append(f"등교일 {len(days)}일 / 상한 {p.max_days}일")
    else:  # pragma: no cover - 계약에서 이미 거절
        raise ValueError(f"unsupported constraint type {t}")

    return ConstraintEvaluation(
        constraint_id=c.id,
        type=t,
        strength=c.strength,
        weight=c.weight,
        satisfied=satisfied,
        violation=violation,
        unit=unit,
        evidence=evidence,
    )


def validate_selection(idx: CatalogIndex, allowed_section_ids: list[str], constraints: list, selected: list[str]) -> ValidationResult:
    r = ValidationResult()
    allowed = set(allowed_section_ids)

    if len(set(selected)) != len(selected):
        r.structural_violations.append("DUPLICATE_SELECTED_ID")
    unknown = [s for s in selected if s not in idx.section_by_id]
    if unknown:
        r.structural_violations.append("UNKNOWN_SECTION_ID:" + ",".join(sorted(set(unknown))))
    # 아래 검사는 알려진 ID에 대해서만. 위반 자체는 이미 기록됨.
    known = [s for s in dict.fromkeys(selected) if s in idx.section_by_id]
    for sid in known:
        if sid not in allowed:
            r.structural_violations.append(f"NOT_ALLOWED:{sid}")
        if idx.section_by_id[sid].support_status != "supported":
            r.structural_violations.append(f"UNSUPPORTED_SECTION:{sid}")
    by_course: dict[str, list[str]] = {}
    by_equiv: dict[str, set[str]] = {}
    for sid in known:
        cid = idx.section_by_id[sid].course_id
        by_course.setdefault(cid, []).append(sid)
        g = idx.course_by_id[cid].equivalence_group_id
        if g is not None:
            by_equiv.setdefault(g, set()).add(sid)
    for cid, sids in by_course.items():
        if len(sids) > 1:
            r.structural_violations.append(f"MULTIPLE_SECTIONS_SAME_COURSE:{cid}")
    for g, sids in by_equiv.items():
        if len(sids) > 1:
            r.structural_violations.append(f"EQUIVALENCE_GROUP_DUPLICATE:{g}")
    for i in range(len(known)):
        a = idx.section_by_id[known[i]]
        for j in range(i + 1, len(known)):
            b = idx.section_by_id[known[j]]
            if any(overlaps(ma, mb) for ma in a.meetings for mb in b.meetings):
                r.structural_violations.append(f"TIME_CONFLICT:{a.id}|{b.id}")

    if unknown:
        # 알 수 없는 ID가 있으면 제약 평가 자체가 무의미: 실패로만 보고.
        return r

    r.total_credit_units = sum(idx.units_of(s) for s in known)
    for c in constraints:
        r.evaluations.append(evaluate_constraint(c, idx, known))
    soft = [e for e in r.evaluations if e.strength == "soft"]
    r.soft_weight_total = sum(e.weight or 0 for e in soft)
    r.penalty = sum(e.weight or 0 for e in soft if not e.satisfied)
    return r
