from fastapi import APIRouter, Request

from app.api._common import ERROR_RESPONSES
from app.domain.api_models import SolveRequest, SolveResult
from app.solver.solve import solve as run_solver

router = APIRouter(tags=["solve"])


@router.post("/solve", response_model=SolveResult, responses=ERROR_RESPONSES)
def solve(body: SolveRequest, request: Request) -> SolveResult:
    cap = request.app.state.settings.solver_time_limit_s
    return run_solver(body, min(body.time_limit_s or cap, cap))
