from fastapi import APIRouter, Query, Request, Response

from app.api._common import ERROR_RESPONSES, not_implemented
from app.core.errors import ApiError
from app.domain.api_models import (
    CatalogValidateRequest,
    CatalogValidateResponse,
    ErrorResponse,
    SemestersResponse,
)
from app.domain.models import Catalog

router = APIRouter(tags=["catalog"])


@router.get(
    "/semesters",
    response_model=SemestersResponse,
    responses={
        **ERROR_RESPONSES,
        502: {"model": ErrorResponse, "description": "Database query failed"},
        503: {"model": ErrorResponse, "description": "Database disabled"},
    },
)
def list_semesters(request: Request) -> SemestersResponse:
    repo = getattr(request.app.state, "catalog_repo", None)
    if repo is None or not repo.is_enabled:
        raise ApiError(503, "db_disabled", "database is not configured")
    semesters = repo.list_semesters()
    return SemestersResponse(semesters=semesters)


@router.get(
    "/catalog/{semester_id}",
    response_model=Catalog,
    responses={
        **ERROR_RESPONSES,
        404: {"model": ErrorResponse, "description": "Catalog not found"},
        502: {"model": ErrorResponse, "description": "Database query failed"},
        503: {"model": ErrorResponse, "description": "Database disabled"},
    },
)
def get_catalog_by_id(semester_id: str, request: Request, response: Response) -> Catalog:
    repo = getattr(request.app.state, "catalog_repo", None)
    if repo is None or not repo.is_enabled:
        raise ApiError(503, "db_disabled", "database is not configured")
    catalog = repo.get_catalog(semester_id)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return catalog


@router.get(
    "/catalog",
    response_model=Catalog,
    responses={
        **ERROR_RESPONSES,
        404: {"model": ErrorResponse, "description": "Catalog not found"},
        502: {"model": ErrorResponse, "description": "Database query failed"},
        503: {"model": ErrorResponse, "description": "Database disabled"},
    },
)
def get_catalog_by_query(
    request: Request,
    response: Response,
    semester: str = Query(..., alias="semester"),
) -> Catalog:
    return get_catalog_by_id(semester, request, response)


@router.post(
    "/catalog/validate",
    response_model=CatalogValidateResponse,
    responses=ERROR_RESPONSES,
)
def validate_catalog(body: CatalogValidateRequest) -> CatalogValidateResponse:
    raise not_implemented("catalog validation")
