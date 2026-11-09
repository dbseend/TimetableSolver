from fastapi import APIRouter, Request

from app.api._common import ERROR_RESPONSES
from app.core.errors import ApiError
from app.domain.api_models import ConstraintsParseRequest, ConstraintsParseResponse, ErrorResponse
from app.llm.parse_constraints import parse_constraints as run_parser
from app.llm.provider import LLMError

router = APIRouter(tags=["constraints"])

_LLM_STATUS = {"llm_daily_limit": 429, "llm_rate_limited": 429}


@router.post(
    "/constraints/parse",
    response_model=ConstraintsParseResponse,
    responses={
        **ERROR_RESPONSES,
        429: {"model": ErrorResponse, "description": "LLM rate or daily limit reached"},
        502: {"model": ErrorResponse, "description": "LLM failed or returned invalid output"},
        503: {"model": ErrorResponse, "description": "LLM disabled (no provider or key)"},
    },
)
def parse_constraints(
    body: ConstraintsParseRequest,
    request: Request,
) -> ConstraintsParseResponse:
    settings = request.app.state.settings
    if len(body.text) > settings.max_input_chars:
        raise ApiError(
            422,
            "input_too_long",
            f"text exceeds {settings.max_input_chars} characters",
        )
    provider = request.app.state.llm
    if provider is None:
        raise ApiError(503, "llm_disabled", "natural-language parsing is not configured")
    try:
        return run_parser(body.text, body.catalog_summary, provider)
    except LLMError as e:
        raise ApiError(_LLM_STATUS.get(e.code, 502), e.code, str(e)) from None
