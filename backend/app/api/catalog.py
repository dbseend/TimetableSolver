from fastapi import APIRouter

from app.api._common import ERROR_RESPONSES, not_implemented
from app.domain.api_models import CatalogValidateRequest, CatalogValidateResponse

router = APIRouter(tags=["catalog"])


@router.post(
    "/catalog/validate",
    response_model=CatalogValidateResponse,
    responses=ERROR_RESPONSES,
)
def validate_catalog(body: CatalogValidateRequest) -> CatalogValidateResponse:
    raise not_implemented("catalog validation")
