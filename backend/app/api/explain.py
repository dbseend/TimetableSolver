from fastapi import APIRouter

from app.api._common import ERROR_RESPONSES, not_implemented
from app.domain.api_models import ExplainRequest, ExplainResponse

router = APIRouter(tags=["explain"])


@router.post("/explain", response_model=ExplainResponse, responses=ERROR_RESPONSES)
def explain(body: ExplainRequest) -> ExplainResponse:
    raise not_implemented("explain")
