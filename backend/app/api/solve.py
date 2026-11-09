from fastapi import APIRouter

from app.api._common import ERROR_RESPONSES, not_implemented
from app.domain.api_models import SolveRequest, SolveResult

router = APIRouter(tags=["solve"])


@router.post("/solve", response_model=SolveResult, responses=ERROR_RESPONSES)
def solve(body: SolveRequest) -> SolveResult:
    raise not_implemented("solve")
