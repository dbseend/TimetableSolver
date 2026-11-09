from app.core.errors import ApiError
from app.domain.api_models import ErrorResponse

# Declared on every route so the OpenAPI contract matches the unified error format.
ERROR_RESPONSES: dict[int | str, dict] = {
    422: {"model": ErrorResponse, "description": "Validation error"},
    501: {"model": ErrorResponse, "description": "Not implemented yet"},
}


def not_implemented(feature: str) -> ApiError:
    """Phase B ships the contract only; behaviour arrives in phase D."""
    return ApiError(501, "not_implemented", f"{feature} is not implemented yet")
