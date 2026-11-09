"""자식 프로세스에서 실행되는 순수 풀이 로직. 입력/출력은 JSON 직렬화 가능한 dict.

검증(독립 validator)은 부모 프로세스(application 계층)에서 수행한다.
"""

from __future__ import annotations

import time

from app.contracts import DiagnoseRequest, SolveRequest
from app.domain.catalog import CatalogIndex
from app.solver.model import build_model, make_solver, solver_status_name

CREDIT_STEP = 300  # 수정안의 학점 범위 조정 단위(3학점)


def _selected(built, solver) -> list[str]:
    return sorted(sid for sid, v in built.x.items() if solver.boolean_value(v))


def run_search(req_dict: dict) -> dict:
    t0 = time.perf_counter()
    req = SolveRequest.model_validate(req_dict)
    idx = CatalogIndex.build(req.catalog)
    budget = req.options.time_budget_ms / 1000.0
    out: dict = {
        "first_status": None,
        "candidates": [],
        "termination_reason": "not_started",
        "model_build_ms": 0.0,
        "solve_ms": 0.0,
        "first_candidate_ms": None,
        "error": None,
    }
    previous: list[list[str]] = []
    for k in range(req.options.max_candidates):
        remaining = budget - (time.perf_counter() - t0)  # 전체 budget 공유(반복마다 리셋하지 않음)
        if remaining <= 0.005:
            out["termination_reason"] = "time_limit"
            break
        tb = time.perf_counter()
        built = build_model(idx, req.allowed_section_ids, req.constraints, previous=previous, min_distance=req.options.min_section_distance)
        invalid = built.model.validate()
        out["model_build_ms"] += (time.perf_counter() - tb) * 1000
        if invalid:
            out["error"] = "MODEL_INVALID"
            return out
        remaining = budget - (time.perf_counter() - t0)
        if remaining <= 0.005:
            out["termination_reason"] = "time_limit"
            break
        solver = make_solver(remaining)
        ts = time.perf_counter()
        code = solver.solve(built.model)
        out["solve_ms"] += (time.perf_counter() - ts) * 1000
        status = solver_status_name(code)
        if status == "model_invalid":
            out["error"] = "MODEL_INVALID"
            return out
        if k == 0:
            out["first_status"] = status
        if status in ("optimal", "feasible"):
            sel = _selected(built, solver)
            out["candidates"].append(
                {
                    "selected": sel,
                    "status": status,
                    "objective": int(round(solver.objective_value)) if built.has_objective else 0,
                }
            )
            if out["first_candidate_ms"] is None:
                out["first_candidate_ms"] = (time.perf_counter() - t0) * 1000
            previous.append(sel)
            out["termination_reason"] = "requested_count"
            continue
        if status == "infeasible":
            out["termination_reason"] = "not_started" if k == 0 else "exhausted_under_diversity"
        else:  # unknown
            out["termination_reason"] = "time_limit"
        break
    return out


def _proposal_changes(c) -> list[dict]:
    """core 안 hard 제약 하나에 대한 후보 수정. credit_range는 제거/soft 전환 금지(min>0 새 범위만)."""
    before = c.model_dump(mode="json")
    changes = []
    if c.type == "credit_range":
        lo, hi = c.params.min_units, c.params.max_units
        for k in (1, 2, 3):
            nm = lo - CREDIT_STEP * k
            if nm >= 100:
                after = {**before, "params": {"min_units": nm, "max_units": hi}}
                changes.append({"group": "credit_lower", "before": before, "after": after})
        for k in (1, 2):
            nx = hi + CREDIT_STEP * k
            if nx <= 6000:
                after = {**before, "params": {"min_units": lo, "max_units": nx}}
                changes.append({"group": "credit_upper", "before": before, "after": after})
    else:
        after = {**before, "strength": "soft", "weight": 5}
        changes.append({"group": f"soft:{c.id}", "before": before, "after": after})
    return changes


def run_diagnosis(req_dict: dict) -> dict:
    t0 = time.perf_counter()
    req = DiagnoseRequest.model_validate(req_dict)
    idx = CatalogIndex.build(req.catalog)
    budget = req.diagnosis_budget_ms / 1000.0
    out: dict = {
        "status": None,
        "core": [],
        "background_infeasible": None,
        "proposals": [],
        "attempted": 0,
        "complete": False,
        "termination_reason": "",
        "error": None,
    }

    def remaining() -> float:
        return budget - (time.perf_counter() - t0)

    built = build_model(idx, req.allowed_section_ids, req.constraints, diagnosis=True)
    if built.model.validate():
        out["error"] = "MODEL_INVALID"
        return out
    solver = make_solver(min(remaining(), budget * 0.5), workers=1)
    status = solver_status_name(solver.solve(built.model))
    if status == "model_invalid":
        out["error"] = "MODEL_INVALID"
        return out
    if status in ("optimal", "feasible"):
        out.update(status="not_infeasible", complete=True, termination_reason="original_feasible")
        return out
    if status == "unknown":
        out.update(status="unknown", termination_reason="time_limit")
        return out

    core_idx = list(solver.sufficient_assumptions_for_infeasibility())
    core = [built.assumptions[i] for i in core_idx if i in built.assumptions]
    out["core"] = core
    if not core:
        # 사용자 조건 없이 배경(허용 분반·구조)만으로 불가능. 사용자 조건 탓으로 표시하지 않는다.
        out.update(status="diagnosed", background_infeasible=True, complete=True, termination_reason="background_infeasible")
        return out
    out["background_infeasible"] = False

    by_id = {c.id: c for c in req.constraints}
    done_groups: set[str] = set()
    for cid in core:
        for ch in _proposal_changes(by_id[cid]):
            if ch["group"] in done_groups:
                continue
            if remaining() <= 0.01:
                out.update(status="partial", termination_reason="time_limit")
                return out
            out["attempted"] += 1
            # 원래 전체 제약에서 해당 변경 하나만 적용(core 밖 hard도 모두 유지).
            new_constraints = [ch["after"] if c.id == cid else c.model_dump(mode="json") for c in req.constraints]
            trial = SolveRequest.model_validate({**req.model_dump(mode="json", exclude={"diagnosis_budget_ms"}), "constraints": new_constraints})
            b2 = build_model(idx, trial.allowed_section_ids, trial.constraints)
            if b2.model.validate():
                out["error"] = "MODEL_INVALID"
                return out
            s2 = make_solver(remaining())
            st2 = solver_status_name(s2.solve(b2.model))
            if st2 in ("optimal", "feasible"):
                done_groups.add(ch["group"])
                out["proposals"].append(
                    {
                        "constraint_id": cid,
                        "before": ch["before"],
                        "after": ch["after"],
                        "constraints": new_constraints,
                        "selected": _selected(b2, s2),
                        "status": st2,
                    }
                )
            elif st2 == "unknown":
                out.update(status="partial", termination_reason="time_limit")
                return out
    out.update(status="diagnosed", complete=True, termination_reason="proposals_found" if out["proposals"] else "no_single_change_found")
    return out
