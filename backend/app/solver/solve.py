"""Top-N candidates, infeasibility core, and the API result (docs/PHASE_D_DESIGN.md DD4, DD6)."""

import time

from ortools.sat.python import cp_model

from app.domain.api_models import (
    Candidate,
    Diagnosis,
    Relaxation,
    SolveRequest,
    SolveResult,
    SolveStats,
    Violation,
)
from app.solver.model import build
from app.validation.validator import check

MAX_RELAX = 5

_STATUS = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.UNKNOWN: "UNKNOWN",
}


def solve(req: SolveRequest, time_limit_s: float) -> SolveResult:
    started = time.perf_counter()
    built = build(req.catalog, req.pool, req.constraints, req.profile)
    deadline = started + time_limit_s
    pool_ids = [p.course_id for p in req.pool]
    k = max(1, req.diversity_k)

    status, candidates, diagnosis = "UNKNOWN", [], None
    for i in range(req.n):
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            break
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = remaining
        code = solver.solve(built.model)
        if code == cp_model.MODEL_INVALID:
            raise RuntimeError(f"invalid CP-SAT model: {built.model.validate()}")
        if i == 0:
            status = _STATUS[code]
        if code == cp_model.INFEASIBLE and i == 0:
            core = _core(built, max(remaining, 0.1))
            diagnosis = Diagnosis(core=core, relaxations=_relaxations(built, core, deadline))
        if code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        chosen = sorted(sid for sid, v in built.x.items() if solver.value(v))
        candidates.append(_candidate(req, chosen, pool_ids, round(solver.objective_value)))
        if not chosen:
            break  # the empty timetable has no different neighbour to exclude
        built.model.add(sum(built.x[sid] for sid in chosen) <= len(chosen) - k)

    return SolveResult(
        status=status,
        candidates=candidates,
        diagnosis=diagnosis,
        stats=SolveStats(
            solve_ms=round((time.perf_counter() - started) * 1000),
            n_sections_after_filter=built.n_sections,
        ),
    )


def _core(built, time_limit_s: float) -> list[str]:
    """A minimal set of hard constraint ids that cannot hold together.

    CP-SAT gives a sufficient core; each member is then dropped in turn and kept out if the rest
    is still infeasible (deletion filter). Solves take milliseconds at campus scale.
    """
    deadline = time.perf_counter() + time_limit_s
    model = built.model

    def infeasible(lits) -> tuple[bool, list[int]]:
        model.clear_assumptions()
        model.add_assumptions(lits)
        solver = cp_model.CpSolver()
        solver.parameters.num_workers = 1  # assumption cores need the single-worker search
        solver.parameters.max_time_in_seconds = max(deadline - time.perf_counter(), 0.01)
        code = solver.solve(model)
        if code != cp_model.INFEASIBLE:
            return False, []
        return True, list(solver.sufficient_assumptions_for_infeasibility())

    all_lits = list(built.lits.values())
    ok, indices = infeasible(all_lits)
    core = [lit for lit in all_lits if lit.index in set(indices)] if ok else []
    for lit in list(core):
        rest = [other for other in core if other is not lit]
        if rest and time.perf_counter() < deadline and infeasible(rest)[0]:
            core = rest
    model.clear_assumptions()
    model.add_assumptions(all_lits)
    by_index = {lit.index: cid for cid, lit in built.lits.items()}
    return [by_index[lit.index] for lit in core]


def _best(built, lits, deadline: float) -> int | None:
    built.model.clear_assumptions()
    built.model.add_assumptions(lits)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(deadline - time.perf_counter(), 0.01)
    code = solver.solve(built.model)
    ok = code in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    return round(solver.objective_value) if ok else None


def _relaxations(built, core: list[str], deadline: float) -> list[Relaxation]:
    """Drop each core constraint alone and re-solve (D21). Skipped for large cores."""
    if not core or len(core) > MAX_RELAX:
        return []
    baseline = _best(built, [], deadline)  # no hard user constraints: always feasible
    out = []
    for cid in core:
        best = _best(built, [lit for k, lit in built.lits.items() if k != cid], deadline)
        delta = None if best is None or baseline is None else best - baseline
        out.append(Relaxation(drop=cid, feasible=best is not None, objective_delta=delta))
    built.model.clear_assumptions()
    built.model.add_assumptions(list(built.lits.values()))
    return out


def _candidate(req: SolveRequest, chosen: list[str], pool_ids: list[str], objective: int):
    report = check(req.catalog, chosen, req.constraints, pool_ids, req.profile)
    # the validator is independent of the model: any disagreement is a solver bug
    if not report.feasible(req.constraints):
        raise AssertionError(
            f"solver produced an invalid timetable: {report.structural} "
            f"{report.hard_violations(req.constraints)}"
        )
    return Candidate(
        sections=chosen,
        objective=objective,
        satisfied=[c.id for c in req.constraints if c.id not in report.violations],
        violated=[Violation(id=cid, amount=amt) for cid, amt in report.violations.items()],
    )
