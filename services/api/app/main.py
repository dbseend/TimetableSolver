"""FastAPI 진입점. 모든 경로는 /api/v1 prefix.

로깅 정책: 요청 ID·경로·상태·처리시간·크기만 기록. 요청 본문·입력값·LLM 원문은 기록하지 않는다.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.application.default_catalogs import get_catalog, list_catalogs
from app.application.parse import build_response, provider_from_env
from app.application.solve import InternalSolverError, diagnose, solve
from app.contracts import (
    SUPPORTED_CONSTRAINT_TYPES,
    UNSUPPORTED_CONSTRAINT_TYPES,
    Capabilities,
    CatalogValidateRequest,
    CatalogValidateResponse,
    DefaultCatalogList,
    DefaultCatalogResponse,
    DiagnoseRequest,
    DiagnosisResponse,
    ErrorResponse,
    ParseRequest,
    ParseResponse,
    SolveRequest,
    SolveResponse,
)
from app.domain.catalog import catalog_revision, validate_catalog_semantics
from app.domain.request_checks import RequestProblem
from app.llm.base import ProviderError
from app.protection import basic_auth_failure, limiter, llm_daily_limit, rate_limit_failure
from app.solver.runner import SolverBusy, SolverCancelled, SolverCrashed, SolverTimeout, make_runner

log = logging.getLogger("timetable.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

MAX_BODY_BYTES = 5 * 1024 * 1024

app = FastAPI(
    title="TimetableSolver API",
    version="0.1.0",
    responses={
        400: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.state.runner = make_runner()
api = APIRouter(prefix="/api/v1")


def rid(request: Request) -> str:
    return getattr(request.state, "request_id", "req-unknown")


def err(request: Request, status: int, code: str, message: str, fields: list[tuple[str, str]] | None = None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "request_id": rid(request), "fields": [{"path": p, "reason": r} for p, r in (fields or [])]}}
    return JSONResponse(status_code=status, content=body)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = "req-" + uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    cl = request.headers.get("content-length")
    if cl is not None and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
        resp = err(request, 413, "PAYLOAD_TOO_LARGE", "요청 크기가 5 MiB를 초과합니다.")
    elif (denied := basic_auth_failure(request)) is not None:
        resp = denied  # 접근 비밀번호(ACCESS_PASSWORD 설정 시)
    elif (limited := rate_limit_failure(request, request.state.request_id)) is not None:
        resp = limited  # IP별 요청 제한
    else:
        resp = await call_next(request)
    resp.headers["X-Request-ID"] = request.state.request_id
    log.info(
        "rid=%s %s %s status=%s ms=%.1f bytes=%s",
        request.state.request_id,
        request.method,
        request.url.path,
        resp.status_code,
        (time.perf_counter() - t0) * 1000,
        cl or "-",
    )
    return resp


def _loc_path(loc: tuple) -> str:
    out = ""
    for part in loc:
        if part == "body":
            continue
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out or "body"


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    # 입력값(input/ctx)을 응답에 넣지 않는다(P-02).
    fields, unsupported = [], False
    for e in exc.errors()[:50]:
        if e.get("type") == "union_tag_invalid":
            tag = (e.get("ctx") or {}).get("tag")
            if tag in UNSUPPORTED_CONSTRAINT_TYPES:
                unsupported = True
                fields.append((_loc_path(e["loc"]) + ".type", f"unsupported:{tag}"))
                continue
        fields.append((_loc_path(e["loc"]), e.get("type", "invalid")))
    if unsupported:
        return err(request, 422, "UNSUPPORTED_CONSTRAINT", "아직 지원하지 않는 조건입니다.", fields)
    return err(request, 422, "SCHEMA_ERROR", "요청 형식이 계약과 다릅니다.", fields)


@app.exception_handler(RequestProblem)
async def problem_handler(request: Request, exc: RequestProblem):
    return err(request, exc.status, exc.code, exc.message, exc.fields)


@app.exception_handler(InternalSolverError)
async def internal_handler(request: Request, exc: InternalSolverError):
    log.error("rid=%s internal solver error code=%s", rid(request), exc.code)
    return err(request, 500, "INTERNAL_SOLVER_ERROR", "내부 오류로 결과를 반환하지 않았습니다(조건 불가능이 아님).", [("solver", exc.code)])


@app.exception_handler(SolverBusy)
async def busy_handler(request: Request, exc: SolverBusy):
    return err(request, 429, "SOLVER_BUSY", "다른 계산이 진행 중입니다. 잠시 후 다시 시도하세요.")


@app.exception_handler(SolverTimeout)
async def timeout_handler(request: Request, exc: SolverTimeout):
    return err(request, 504, "SOLVER_DEADLINE", "계산 프로세스가 hard deadline을 넘겨 종료했습니다.")


@app.exception_handler(SolverCrashed)
async def crash_handler(request: Request, exc: SolverCrashed):
    log.error("rid=%s solver process failed kind=%s", rid(request), str(exc)[:80])
    return err(request, 500, "SOLVER_PROCESS_FAILED", "계산 프로세스 오류(조건 불가능이 아님).")


@app.exception_handler(SolverCancelled)
async def cancelled_handler(request: Request, exc: SolverCancelled):
    return err(request, 400, "CANCELLED", "클라이언트가 요청을 취소했습니다.")


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.error("rid=%s unhandled %s", rid(request), type(exc).__name__)
    return err(request, 500, "INTERNAL_ERROR", "내부 오류")


# ------------------------------------------------------------------ routes


@api.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@api.get("/ready")
async def ready():
    try:
        await asyncio.to_thread(__import__, "ortools.sat.python.cp_model")
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "not_ready", "solver": False})
    provider = provider_from_env()
    return {"status": "ready", "solver": True, "parse_mode": provider.mode if provider else "unavailable", "manual_mode_available": True}


@api.get("/capabilities", response_model=Capabilities)
async def capabilities() -> Capabilities:
    provider = provider_from_env()
    ni = "not_implemented"
    return Capabilities(
        supported_constraint_types=list(SUPPORTED_CONSTRAINT_TYPES),
        unsupported_constraint_types=list(UNSUPPORTED_CONSTRAINT_TYPES),
        parse_provider_mode=provider.mode if provider else "unavailable",
        live_llm_configured=bool(provider and provider.mode == "live"),
        features={
            "solve": "implemented",
            "diversity_candidates": "implemented",
            "diagnose_single_change": "implemented",
            "diagnose_multi_change": ni,
            "csv_import": "implemented",
            "default_school_catalog": "implemented",
            "xlsx_import": ni,
            "advanced_time_constraints": ni,
            "explain_llm": ni,
            "pdf_attributes": ni,
            "png_ics_export": ni,
            "login": ni,
            "server_db": ni,
            "crawling": ni,
            "auto_registration": ni,
        },
        limits={
            "max_body_bytes": MAX_BODY_BYTES,
            "max_sections": 1000,
            "max_constraints": 50,
            "max_text_chars": 2000,
            "max_candidates": 5,
            "solve_budget_ms_max": 8000,
            "diagnose_budget_ms_max": 10000,
            "solver_concurrency": app.state.runner.concurrency,
        },
    )


@api.post("/catalog/validate", response_model=CatalogValidateResponse)
async def catalog_validate(body: CatalogValidateRequest, request: Request) -> CatalogValidateResponse:
    errors, warnings = validate_catalog_semantics(body.catalog)
    ok = not errors
    c = body.catalog
    return CatalogValidateResponse(
        request_id=rid(request),
        valid=ok,
        catalog_revision=catalog_revision(c) if ok else None,
        catalog=c if ok else None,
        errors=errors,
        warnings=warnings,
        stats={
            "courses": len(c.courses),
            "sections": len(c.sections),
            "supported_sections": sum(1 for s in c.sections if s.support_status == "supported"),
            "unsupported_sections": sum(1 for s in c.sections if s.support_status != "supported"),
            "meetings": sum(len(s.meetings) for s in c.sections),
        },
    )


@api.get("/catalogs", response_model=DefaultCatalogList)
async def catalogs_list() -> DefaultCatalogList:
    """관리자가 변환해 둔 기본 학교 카탈로그 목록(학기·기준일·지원 분반 수·제외 사유)."""
    return DefaultCatalogList(catalogs=await asyncio.to_thread(list_catalogs))


@api.get("/catalogs/{catalog_id}", response_model=DefaultCatalogResponse)
async def catalogs_get(catalog_id: str, request: Request):
    """기본 학교 카탈로그 본문. 업로드와 같은 서버 검증을 통과한 것만 내려준다."""
    resp = await asyncio.to_thread(get_catalog, catalog_id)
    if resp is None:
        return err(request, 404, "CATALOG_NOT_FOUND", "기본 학교 카탈로그가 없거나 검증에 실패했습니다.")
    return resp


def _disconnect_probe(request: Request):
    async def probe() -> bool:
        return await request.is_disconnected()

    return probe


@api.post("/solve", response_model=SolveResponse)
async def solve_route(body: SolveRequest, request: Request) -> SolveResponse:
    return await solve(body, request.app.state.runner, rid(request), _disconnect_probe(request))


@api.post("/diagnose", response_model=DiagnosisResponse)
async def diagnose_route(body: DiagnoseRequest, request: Request) -> DiagnosisResponse:
    return await diagnose(body, request.app.state.runner, rid(request), _disconnect_probe(request))


@api.post("/constraints/parse", response_model=ParseResponse)
async def parse_route(body: ParseRequest, request: Request):
    provider = provider_from_env()
    if provider is None:
        return err(request, 503, "PARSER_UNAVAILABLE", "자연어 해석기가 설정되지 않았습니다. 수동 조건 입력을 사용하세요.")
    if provider.mode == "live" and not limiter.take_llm_call(llm_daily_limit()):
        # 공개 배포에서 외부 LLM 호출 남용·비용 방지: 일일 총 상한(재시작 시 초기화)
        return err(request, 429, "LLM_DAILY_LIMIT", "오늘 자연어 해석 사용량을 모두 썼어요. 직접 조건 추가로 계속할 수 있어요.")
    try:
        out = await asyncio.to_thread(provider.parse, body)
    except ProviderError as e:
        status = {"TIMEOUT": 504, "RATE_LIMITED": 429}.get(e.code, 502)
        return err(request, status, "LLM_" + e.code, "자연어 해석에 실패했습니다. 수동 조건 입력은 계속 사용할 수 있습니다.")
    return build_response(body, out, provider.mode, rid(request))


app.include_router(api)

# 배포: 빌드된 프론트(apps/web/dist)를 같은 주소에서 제공(WEB_DIST 설정 시). API 경로가 먼저 등록되어 우선한다.
_web_dist = os.environ.get("WEB_DIST")
if _web_dist and os.path.isdir(_web_dist):
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_web_dist, html=True), name="web")
