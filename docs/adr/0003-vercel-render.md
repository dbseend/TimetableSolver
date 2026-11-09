# ADR 0003: 프론트 Vercel, 백엔드 Render
- 상태: 채택
- 결정: Vercel(root `frontend`, SPA rewrite), Render 무료 웹서비스(root `backend`, `/health` 체크).
- CORS: `ALLOWED_ORIGINS` + 프로젝트 prefix로 제한한 `ALLOWED_ORIGIN_REGEX`(프리뷰용). `*.vercel.app` 전체 허용 금지.
- `PYTHON_VERSION`은 3.13.5처럼 전체 버전으로 고정(기본값은 3.11).
- `VITE_*`는 클라이언트에 노출되므로 비밀값 금지.
