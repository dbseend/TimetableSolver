# 배포용 단일 컨테이너: 빌드된 프론트(apps/web)와 API(services/api)를 같은 주소에서 제공한다.
# - 프론트는 상대 경로 /api/v1 로 호출하므로 localhost 를 가리키지 않고 CORS 도 필요 없다.
# - 실제 학교 카탈로그는 이미지에 넣지 않는다(local-data/ 제외). 플랫폼 비밀 파일 등으로 CATALOG_DIR 에 제공한다.
# - GEMINI_API_KEY·ACCESS_PASSWORD 는 플랫폼 환경 변수로만 넣는다(이미지·저장소에 없음).

FROM node:22-slim AS web
WORKDIR /src
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN cd apps/web && npm ci --no-audit --no-fund
COPY apps/web apps/web
COPY fixtures fixtures
RUN cd apps/web && npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.17 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
WORKDIR /app/services/api
COPY services/api/pyproject.toml services/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/api/app ./app
COPY --from=web /src/apps/web/dist /app/web
RUN useradd --create-home --uid 10001 app && mkdir -p /app/catalogs && chown -R app /app
USER app
ENV PATH="/app/services/api/.venv/bin:$PATH" \
    WEB_DIST=/app/web \
    CATALOG_DIR=/app/catalogs \
    PARSE_PER_MIN=6 \
    SOLVE_PER_MIN=20 \
    LLM_DAILY_LIMIT=200 \
    PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
