from fastapi import APIRouter

from app import __version__
from app.domain.api_models import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness probe used by Render. Keep it cheap: no I/O, no heavy imports."""
    return HealthResponse(status="ok", version=__version__)
