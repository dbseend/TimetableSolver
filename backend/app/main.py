import logging
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import api_router
from app.catalog.repository import CatalogRepository
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.llm.provider import CachedProvider, GeminiProvider, Provider

logger = logging.getLogger("app.request")

LLM_CACHE_DIR = Path(__file__).resolve().parent.parent / "llm_cache"  # gitignored


def make_llm(settings: Settings) -> Provider | None:
    """None when LLM features are off (no key or LLM_PROVIDER=none); the API still runs."""
    if not settings.llm_enabled or not settings.llm_model:
        return None
    gemini = GeminiProvider(settings.llm_api_key.get_secret_value(), settings.llm_model)
    return CachedProvider(gemini, LLM_CACHE_DIR, settings.daily_llm_call_limit)


def make_catalog_repo(settings: Settings) -> CatalogRepository | None:
    """None when DB features are off (no Supabase URL or key); the API still runs."""
    if not settings.db_enabled:
        return None
    key = settings.supabase_key.get_secret_value() if settings.supabase_key else None
    return CatalogRepository(settings.supabase_url, key)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(title="TimetableSolver API", version=__version__)
    app.state.settings = settings
    app.state.llm = make_llm(settings)
    app.state.catalog_repo = make_catalog_repo(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_origin_regex=settings.allowed_origin_regex,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def log_requests(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        # Method/path/status/duration only. Bodies (user text) are never logged.
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - start) * 1000, 1),
            },
        )
        return response

    register_error_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
