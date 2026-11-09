"""배포용 기본 보호 장치(단일 인스턴스, 메모리 기반).

- 접근 제한(선택): `ACCESS_PASSWORD`가 있으면 모든 경로에 HTTP Basic 인증을 요구한다(`/api/v1/health` 제외 — 플랫폼 health check용).
  사용자명은 `ACCESS_USER`(기본 "student"). 비밀번호는 환경 변수로만 받고 로그에 남기지 않는다.
- 요청 제한: IP별 분당 횟수(자연어 해석 `PARSE_PER_MIN`, 계산 `SOLVE_PER_MIN`; 코드 기본 0=끔, 배포 이미지에서 켬)와
  live LLM 일일 총 호출 상한 `LLM_DAILY_LIMIT`(UTC 날짜 기준). 초과 시 429와 한국어 안내.
- 클라이언트 IP: `TRUST_PROXY=1`일 때만 `X-Forwarded-For` 첫 값(리버스 프록시 뒤 배포), 아니면 연결 주소.
- 한계: 프로세스 메모리 기반이라 재시작 시 초기화되고, 인스턴스가 여러 개면 인스턴스별로 따로 센다.
"""

from __future__ import annotations

import base64
import hmac
import os
import threading
import time
from collections import deque
from datetime import UTC, datetime

from fastapi import Request
from fastapi.responses import JSONResponse, Response

HEALTH_PATH = "/api/v1/health"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class RateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._llm_day = ""
        self._llm_count = 0

    def allow(self, bucket: str, key: str, per_min: int, now: float | None = None) -> bool:
        if per_min <= 0:
            return True
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._hits.setdefault((bucket, key), deque())
            while q and now - q[0] >= 60:
                q.popleft()
            if len(q) >= per_min:
                return False
            q.append(now)
            return True

    def take_llm_call(self, limit: int, today: str | None = None) -> bool:
        """live LLM 호출 1회를 일일 상한에서 차감. 상한 초과면 False(호출하지 않음)."""
        if limit <= 0:
            return True
        today = today or datetime.now(UTC).strftime("%Y-%m-%d")
        with self._lock:
            if today != self._llm_day:
                self._llm_day, self._llm_count = today, 0
            if self._llm_count >= limit:
                return False
            self._llm_count += 1
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._llm_day, self._llm_count = "", 0


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    if os.environ.get("TRUST_PROXY") == "1":
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def basic_auth_failure(request: Request) -> Response | None:
    """접근 비밀번호가 설정됐는데 인증이 없거나 틀리면 401 응답, 아니면 None."""
    password = os.environ.get("ACCESS_PASSWORD")
    if not password or request.url.path == HEALTH_PATH:
        return None
    user = os.environ.get("ACCESS_USER", "student")
    header = request.headers.get("authorization", "")
    if header.lower().startswith("basic "):
        try:
            got_user, _, got_pw = base64.b64decode(header[6:]).decode("utf-8").partition(":")
        except (ValueError, UnicodeDecodeError):
            got_user, got_pw = "", ""
        if hmac.compare_digest(got_user.encode(), user.encode()) and hmac.compare_digest(got_pw.encode(), password.encode()):
            return None
    return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="TimetableSolver", charset="UTF-8"'}, content="접근 비밀번호가 필요합니다.")


RATE_RULES = {
    "/api/v1/constraints/parse": ("parse", "PARSE_PER_MIN", 0, "자연어 해석 요청이 많아요. 1분 뒤 다시 시도해 주세요. 직접 조건 추가는 계속 사용할 수 있어요."),
    "/api/v1/solve": ("solve", "SOLVE_PER_MIN", 0, "시간표 계산 요청이 많아요. 잠시 뒤 다시 시도해 주세요."),
    "/api/v1/diagnose": ("solve", "SOLVE_PER_MIN", 0, "계산 요청이 많아요. 잠시 뒤 다시 시도해 주세요."),
}


def rate_limit_failure(request: Request, request_id: str) -> JSONResponse | None:
    rule = RATE_RULES.get(request.url.path)
    if rule is None or request.method != "POST":
        return None
    bucket, env, default, message = rule
    if limiter.allow(bucket, client_ip(request), _int_env(env, default)):
        return None
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": "60"},
        content={"error": {"code": "RATE_LIMITED", "message": message, "request_id": request_id, "fields": []}},
    )


def llm_daily_limit() -> int:
    return _int_env("LLM_DAILY_LIMIT", 200)
