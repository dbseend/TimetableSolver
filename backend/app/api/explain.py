from fastapi import APIRouter, Request

from app.api._common import ERROR_RESPONSES
from app.domain.api_models import ExplainRequest, ExplainResponse
from app.llm.explain import explain as run_explain

router = APIRouter(tags=["explain"])


@router.post("/explain", response_model=ExplainResponse, responses=ERROR_RESPONSES)
def explain(body: ExplainRequest, request: Request) -> ExplainResponse:
    """Always answers: template text, LLM rewrite only when it passes the fact check."""
    return run_explain(body, request.app.state.llm)
