"""CP-SAT 모델 빌더 (docs/02 §6).

- 분반 s마다 x_s. 비허용/미지원 분반은 x_s = 0 (고정 배경).
- 과목·동등군 최대 1분반, 시간 충돌 = 요일별 시작 시점 at-most-one (모든 Meeting 대상).
- 각 사용자 제약 j에 대해 sat_j 를 **양방향 동치**로 정의한다.
  hard: sat_j = 1 (진단 모드에서는 assumption a_j => sat_j)
  soft: v_j = not sat_j, minimize Σ w_j v_j
- 다양성: 이전 후보 S_i마다 Hamming distance >= d.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from app.contracts import DAYS
from app.domain.catalog import CatalogIndex


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    x: dict[str, cp_model.IntVar]
    sat: dict[str, cp_model.IntVar]
    assumptions: dict[int, str] = field(default_factory=dict)  # literal index -> constraint id
    has_objective: bool = False


def _or_equiv(m: cp_model.CpModel, lits: list, name: str):
    """b <=> OR(lits). lits가 비면 b = 0."""
    b = m.new_bool_var(name)
    if not lits:
        m.add(b == 0)
        return b
    m.add_bool_or(lits).only_enforce_if(b)
    for lit in lits:
        m.add_implication(lit, b)
    return b


def _linear_ge_equiv(m: cp_model.CpModel, expr, k: int, name: str):
    """b <=> expr >= k."""
    b = m.new_bool_var(name)
    m.add(expr >= k).only_enforce_if(b)
    m.add(expr <= k - 1).only_enforce_if(~b)
    return b


def _linear_le_equiv(m: cp_model.CpModel, expr, k: int, name: str):
    """b <=> expr <= k."""
    b = m.new_bool_var(name)
    m.add(expr <= k).only_enforce_if(b)
    m.add(expr >= k + 1).only_enforce_if(~b)
    return b


def _and_equiv(m: cp_model.CpModel, lits: list, name: str):
    b = m.new_bool_var(name)
    if not lits:
        m.add(b == 1)
        return b
    m.add_bool_and(lits).only_enforce_if(b)
    m.add_bool_or([~lit for lit in lits]).only_enforce_if(~b)
    return b


def build_model(
    idx: CatalogIndex,
    allowed_section_ids: list[str],
    constraints: list,
    *,
    previous: list[list[str]] | None = None,
    min_distance: int = 2,
    diagnosis: bool = False,
) -> BuiltModel:
    m = cp_model.CpModel()
    allowed = set(allowed_section_ids)
    sections = sorted(idx.catalog.sections, key=lambda s: s.id)
    x = {s.id: m.new_bool_var(f"x[{s.id}]") for s in sections}

    # --- 고정 배경 hard
    for s in sections:
        if s.id not in allowed or s.support_status != "supported":
            m.add(x[s.id] == 0)
    by_course: dict[str, list] = {}
    by_equiv: dict[str, list] = {}
    for s in sections:
        by_course.setdefault(s.course_id, []).append(x[s.id])
        g = idx.course_by_id[s.course_id].equivalence_group_id
        if g is not None:
            by_equiv.setdefault(g, []).append(x[s.id])
    for vs in by_course.values():
        if len(vs) > 1:
            m.add_at_most_one(vs)
    for vs in by_equiv.values():
        if len(vs) > 1:
            m.add_at_most_one(vs)
    # 시간 충돌: 두 [s,e) 구간이 겹치면 늦게 시작한 쪽의 시작 시점이 두 구간 모두에 포함된다.
    # 따라서 요일·시작 시점마다 그 시점을 덮는 분반 집합에 at-most-one이면 정확히 동치.
    active = [s for s in sections if s.id in allowed and s.support_status == "supported"]
    for d in DAYS:
        points = sorted({mt.start_minute for s in active for mt in s.meetings if mt.day == d})
        for t in points:
            covering = [x[s.id] for s in active if any(mt.day == d and mt.start_minute <= t < mt.end_minute for mt in s.meetings)]
            if len(covering) > 1:
                m.add_at_most_one(covering)

    units = {s.id: idx.units_of(s.id) for s in sections}  # 분반별 유효 학점(0008)
    total = sum(units[s.id] * x[s.id] for s in sections)

    # 요일 활성(동기 수업) / 등교일(campus_required) 변수: OR 동치
    day_active = {d: _or_equiv(m, [x[s.id] for s in sections if any(mt.day == d for mt in s.meetings)], f"day[{d}]") for d in DAYS}
    campus_day = {d: _or_equiv(m, [x[s.id] for s in sections if any(mt.day == d and mt.campus_required for mt in s.meetings)], f"campus[{d}]") for d in DAYS}

    sat: dict[str, cp_model.IntVar] = {}
    for c in constraints:
        p = c.params
        n = f"sat[{c.id}]"
        if c.type == "credit_range":
            ge = _linear_ge_equiv(m, total, p.min_units, n + ".ge")
            le = _linear_le_equiv(m, total, p.max_units, n + ".le")
            sat[c.id] = _and_equiv(m, [ge, le], n)
        elif c.type == "must_include":
            secs = idx.sections_by_course.get(p.course_id, [])
            if p.allowed_section_ids is not None:
                perm = set(p.allowed_section_ids)
                secs = [s for s in secs if s.id in perm]
            # 과목당 최대 1분반이 배경에 있으므로 OR(permitted) <=> 정확히 1분반(허용 목록 내).
            sat[c.id] = _or_equiv(m, [x[s.id] for s in secs], n)
        elif c.type == "must_exclude":
            any_sel = _or_equiv(m, [x[s.id] for s in idx.sections_by_course.get(p.course_id, [])], n + ".any")
            sat[c.id] = any_sel.Not()
        elif c.type == "day_off":
            sat[c.id] = _and_equiv(m, [day_active[d].Not() for d in p.days], n)
        elif c.type == "time_avoid":
            days = set(p.days)
            hit = [x[s.id] for s in sections if any(mt.day in days and mt.start_minute < p.end_minute and p.start_minute < mt.end_minute for mt in s.meetings)]
            sat[c.id] = _or_equiv(m, hit, n + ".hit").Not()
        elif c.type == "category_min":
            cats = set(p.category_ids)
            expr = sum(units[s.id] * x[s.id] for s in sections if cats.intersection(idx.categories_of(s.id)))
            sat[c.id] = _linear_ge_equiv(m, expr, p.min_units, n)
        elif c.type == "instructor_avoid":
            bad = set(p.instructor_ids)
            hit = [x[s.id] for s in sections if bad.intersection(s.instructor_ids)]
            sat[c.id] = _or_equiv(m, hit, n + ".hit").Not()
        elif c.type == "max_days_on_campus":
            sat[c.id] = _linear_le_equiv(m, sum(campus_day.values()), p.max_days, n)
        else:  # pragma: no cover
            raise ValueError(c.type)

    built = BuiltModel(model=m, x=x, sat=sat)
    soft_terms = []
    for c in constraints:
        if c.strength == "hard":
            if diagnosis:
                a = m.new_bool_var(f"assume[{c.id}]")
                m.add_bool_or([sat[c.id]]).only_enforce_if(a)
                m.add_assumption(a)
                built.assumptions[a.Index()] = c.id
            else:
                m.add_bool_or([sat[c.id]])
        else:
            soft_terms.append(c.weight * sat[c.id].Not())

    for prev in previous or []:
        ps = set(prev)
        dist = sum((1 - x[s]) for s in x if s in ps) + sum(x[s] for s in x if s not in ps)
        m.add(dist >= min_distance)

    if soft_terms and not diagnosis:
        m.minimize(sum(soft_terms))
        built.has_objective = True
    return built


def solver_status_name(code: int) -> str:
    return {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.UNKNOWN: "unknown",
        cp_model.MODEL_INVALID: "model_invalid",
    }[code]


def make_solver(seconds: float, workers: int = 1, seed: int = 0) -> cp_model.CpSolver:
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = max(0.01, seconds)
    s.parameters.num_workers = workers
    s.parameters.random_seed = seed
    return s
