"""solve/diagnose 오케스트레이션: 요청 검증 → 격리 solver → 독립 검증 → 응답."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from app.contracts import (
    Candidate,
    ConstraintChange,
    DiagnoseRequest,
    DiagnosisResponse,
    RelaxationProposal,
    SearchInfo,
    SolveRequest,
    SolveResponse,
    Timing,
)
from app.domain.catalog import CatalogIndex
from app.domain.facts import compute_facts
from app.domain.request_checks import check_solve_request, request_hash
from app.domain.validator import evaluate_constraint, soft_score, validate_selection
from app.solver.runner import ProcessRunner

PROCESS_GRACE_S = 15.0  # spawn 시작·import 비용 여유(논리 budget과 별도인 hard deadline)


class InternalSolverError(Exception):
    """MODEL_INVALID 또는 독립 검증 실패. 500으로 응답하며 후보를 반환하지 않는다."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def build_candidate(
    idx: CatalogIndex, req: SolveRequest, constraints: list, selected: list[str], status: str, solver_objective: int | None, cid: str
) -> Candidate:
    v = validate_selection(idx, req.allowed_section_ids, constraints, selected)
    if not v.hard_ok:
        raise InternalSolverError("VALIDATOR_REJECTED_CANDIDATE")
    if solver_objective is not None and solver_objective != v.penalty:
        # 목적함수와 독립 재계산 penalty 불일치 = soft boolean 정의 오류(O-12)
        raise InternalSolverError("PENALTY_MISMATCH")
    return Candidate(
        id=cid,
        selected_section_ids=selected,
        search_status=status,
        optimality_proven=(status == "optimal"),
        objective_penalty=v.penalty,
        original_soft_score=v.score,
        total_credit_units=v.total_credit_units,
        constraint_evaluations=v.evaluations,
        facts=compute_facts(idx, selected),
        hard_validation="passed",
    )


async def solve(req: SolveRequest, runner: ProcessRunner, request_id: str, is_cancelled: Callable[[], Awaitable[bool]] | None = None) -> SolveResponse:
    t0 = time.perf_counter()
    idx = check_solve_request(req)
    rhash = request_hash(req)
    t_val = (time.perf_counter() - t0) * 1000
    raw, process_ms = await runner.run("search", req.model_dump(mode="json"), req.options.time_budget_ms / 1000 + PROCESS_GRACE_S, is_cancelled)
    if raw.get("error"):
        raise InternalSolverError(raw["error"])
    tv = time.perf_counter()
    candidates = [
        build_candidate(idx, req, req.constraints, c["selected"], c["status"], c["objective"], f"cand-{i + 1}") for i, c in enumerate(raw["candidates"])
    ]
    t_val += (time.perf_counter() - tv) * 1000
    first = raw["first_status"] or "unknown"
    warnings: list[str] = []
    if first == "unknown" and raw["termination_reason"] == "time_limit" and not candidates:
        warnings.append("시간 한도 안에 판정하지 못했습니다(불가능이 아님).")
    termination = raw["termination_reason"]
    if first in ("infeasible", "unknown"):
        candidates = []
    return SolveResponse(
        request_id=request_id,
        input_revision=req.confirmation.input_revision,
        catalog_revision=req.catalog_revision,
        request_hash=rhash,
        status=first,
        candidates=candidates,
        search=SearchInfo(
            requested_count=req.options.max_candidates,
            returned_count=len(candidates),
            termination_reason=termination,
            min_section_distance=req.options.min_section_distance,
        ),
        timing=Timing(
            validation_ms=round(t_val, 2),
            model_build_ms=round(raw["model_build_ms"], 2),
            first_candidate_ms=raw["first_candidate_ms"],
            solve_ms=round(raw["solve_ms"], 2),
            total_ms=round((time.perf_counter() - t0) * 1000, 2),
            process_ms=round(process_ms, 2),
        ),
        warnings=warnings,
    )


SCOPE_NOTE = "단일 조건 수정만 탐색합니다(hard→soft 전환, 학점 범위 3학점 단위 조정). 복수 조건 동시 수정 탐색은 이번 MVP에서 구현하지 않았습니다."


async def diagnose(
    req: DiagnoseRequest, runner: ProcessRunner, request_id: str, is_cancelled: Callable[[], Awaitable[bool]] | None = None
) -> DiagnosisResponse:
    idx = check_solve_request(req)
    rhash = request_hash(req)
    raw, _ = await runner.run("diagnose", req.model_dump(mode="json"), req.diagnosis_budget_ms / 1000 + PROCESS_GRACE_S, is_cancelled)
    if raw.get("error"):
        raise InternalSolverError(raw["error"])
    original_soft = [c for c in req.constraints if c.strength == "soft"]
    proposals: list[RelaxationProposal] = []
    for i, p in enumerate(raw["proposals"]):
        trial = SolveRequest.model_validate({**req.model_dump(mode="json", exclude={"diagnosis_budget_ms"}), "constraints": p["constraints"]})
        hard_ranges = [c for c in trial.constraints if c.type == "credit_range" and c.strength == "hard"]
        if len(hard_ranges) != 1 or hard_ranges[0].params.min_units <= 0:
            raise InternalSolverError("PROPOSAL_REMOVED_CREDIT_RANGE")  # X-10 방어
        cand = build_candidate(idx, trial, trial.constraints, p["selected"], p["status"], None, f"prop-{i + 1}-cand")
        orig_evals = [evaluate_constraint(c, idx, p["selected"]) for c in original_soft]
        o_pen, o_score = soft_score(orig_evals)
        changed = [e for e in cand.constraint_evaluations if e.constraint_id == p["constraint_id"]]
        proposals.append(
            RelaxationProposal(
                proposal_id=f"prop-{i + 1}",
                base_request_hash=rhash,
                changes=[ConstraintChange(constraint_id=p["constraint_id"], before=p["before"], after=p["after"])],
                changed_hard_count=1,
                verified_candidate=cand,
                original_soft_penalty=o_pen if original_soft else None,
                original_soft_score=o_score,
                changed_constraint_violations=changed,
                verification_status="passed",
            )
        )
    return DiagnosisResponse(
        request_id=request_id,
        request_hash=rhash,
        input_revision=req.confirmation.input_revision,
        status=raw["status"],
        core_constraint_ids=raw["core"],
        background_infeasible=raw["background_infeasible"],
        proposals=proposals,
        attempted_changes_count=raw["attempted"],
        search_complete_within_declared_scope=raw["complete"],
        termination_reason=raw["termination_reason"],
        scope_note=SCOPE_NOTE,
    )
