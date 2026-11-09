from fastapi import APIRouter

from app.api._common import ERROR_RESPONSES, not_implemented
from app.domain.api_models import ProfileParseRequest, ProfileParseResponse

router = APIRouter(tags=["profile"])


@router.post(
    "/profile/parse",
    response_model=ProfileParseResponse,
    responses=ERROR_RESPONSES,
)
def parse_profile(body: ProfileParseRequest) -> ProfileParseResponse:
    """LLM fallback for completed-course parsing. Requires explicit consent and minimal columns."""
    raise not_implemented("profile parsing")
