from fastapi import APIRouter, Request

from app.api._common import ERROR_RESPONSES, not_implemented
from app.core.errors import ApiError
from app.domain.api_models import ConstraintsParseRequest, ConstraintsParseResponse

router = APIRouter(tags=["constraints"])


@router.post(
    "/constraints/parse",
    response_model=ConstraintsParseResponse,
    responses=ERROR_RESPONSES,
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
    raise not_implemented("constraint parsing")
