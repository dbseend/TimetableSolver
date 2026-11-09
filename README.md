# TimetableSolver

자연어·수동 조건 → 사용자 확인 → OR-Tools CP-SAT 시간표 생성 → 독립 검증기 통과 후보만 표시하는 로컬 웹 MVP.

- 백엔드: `services/api` (FastAPI, Pydantic v2, OR-Tools, uv)
- 프론트: `apps/web` (React 19, Vite, TypeScript, 생성 OpenAPI 타입)
- 계약 원본: `services/api/app/contracts.py` → `packages/contracts/openapi.json` → `apps/web/src/generated/api-types.ts`
- 진행 상황·미구현·미검증 목록: [`docs/PROGRESS.md`](docs/PROGRESS.md) · main 선별 통합 기록: [`docs/INTEGRATION.md`](docs/INTEGRATION.md) · main 병합 계획(미실행): [`docs/MERGE_PLAN.md`](docs/MERGE_PLAN.md)

> 이 브랜치(`feat/timetable-integration`)는 아직 main에 병합되지 않았다. main에는 이전 구현(`backend/`, `frontend/`)이 있으며, 정리 절차는 `docs/MERGE_PLAN.md`를 따른다.

## 동작하는 기능

- 강좌 준비: 합성 샘플, 학교 파일(CSV/TSV, 포털 HTML `.xls`·CP949) 가져오기, 열 매핑·요일별 교시표, 분반별 학점·이수구분 보존, 미지원 분반 사유 표시
- 조건: 자연어(데모 해석기 또는 Gemini) → 질문·빈 값 직접 입력 → 칩 확인, 직접 조건 추가, 내 전공 과목 확인 후 내 전공 최소 학점
- 생성: 사용자 확인 후 CP-SAT 후보 최대 3개(독립 검증기 통과분만), 시간표·목록·비교표, 충족/아쉬운 조건
- 불가능: 충돌 조건 묶음 → 재풀이·검증된 단일 수정안 미리보기 → 확인 후 적용
- 이수내역: 브라우저 안에서만 처리(학번·이름·성적 즉시 제거), 서버엔 수강 가능 분반 ID만

## 알려진 제한

- 시간 미정·토요일 분반은 미지원(실제 학교 파일 819분반 중 656분반 사용), 교시표 적용 학기·예외 미확인
- 내 전공 인정 규칙은 사용자가 과목을 확인하는 방식으로만 반영(학교 규칙 자동 판정 없음)
- 자연어: live 모델이 "15~18학점"을 최소만·최대만 있는 초안 2개로 나누는 경우가 있다(학점 범위 정규화 미구현 — 하나를 버리고 다른 하나를 채워야 확인 가능). 자연어 정확도 평가는 미실시
- 점심·최장 공강·연강, 복수 조건 완화, 범용 xlsx, 공개 배포는 범위 밖

## 실행 (Windows PowerShell)

필요: Python 3.12+와 [uv](https://docs.astral.sh/uv/), Node.js 22+.

터미널 1 — 백엔드:

```powershell
cd C:\dev\Timetable-solver\TimetableSolver\services\api
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

터미널 2 — 프론트:

```powershell
cd C:\dev\Timetable-solver\TimetableSolver\apps\web
npm ci
npm run dev
```

브라우저: <http://localhost:5173> (Vite가 `/api`를 `http://127.0.0.1:8000`으로 프록시). API 문서: <http://127.0.0.1:8000/docs>.

### 자연어 해석 모드

- 기본: **데모 해석(fixture)** — LLM이 아닌 규칙 기반 파서. 화면에 "데모 해석" 배지가 표시된다.
- Gemini live: `services/api\.env` 파일(커밋 제외됨)에 아래 변수를 직접 입력하고 `--env-file`로 기동한다.

  ```text
  LLM_PROVIDER=gemini
  GEMINI_API_KEY=<직접 입력>
  LLM_MODEL=<공식 문서에서 확인한 모델 ID>
  ```

  ```powershell
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
  ```

  키는 서버 환경 변수로만 읽고 프론트 번들·로그·오류 응답에 넣지 않는다. 키가 없거나 호출이 실패해도 수동 조건 입력과 솔버는 동작한다.

## 테스트

```powershell
# 백엔드
cd C:\dev\Timetable-solver\TimetableSolver\services\api
uv run pytest -q
uv run ruff check .
uv run ruff format --check .

# 프론트
cd C:\dev\Timetable-solver\TimetableSolver\apps\web
npm test              # Vitest 단위 테스트
npm run typecheck
npm run build
npx playwright install chromium   # 최초 1회
npm run e2e           # 전용 백엔드(127.0.0.1:8010, fixture 해석기)와 Vite(5174)를 자동 기동해 E2E — Gemini를 호출하지 않음
```

CI: `.github/workflows/ci.yml`(백엔드 Ubuntu/Windows × Python 3.12/3.13, 계약 드리프트, 프론트, E2E). 줄바꿈은 `.gitattributes`로 LF 고정.

계약 변경 시 타입 재생성:

```powershell
cd C:\dev\Timetable-solver\TimetableSolver\services\api; uv run python scripts/export_openapi.py
cd ..\..\apps\web; npm run gen:api
```

## 학교 개설강좌 파일

화면의 "학교 개설강좌 올리기" → (포털 HTML 내보내기 형식이면 자동 인식) 학기 ID 입력 → 교시표 확인 체크 → 필요 시 열 매핑·셀 줄·이수구분 매핑 수정 → "변환하고 검증하기".

- 지원: CSV/TSV(UTF-8), 학사 포털에서 내려받은 HTML 표(.xls 확장자, EUC-KR/CP949 가능). 엑셀 이진(.xls)·xlsx는 미지원(엑셀에서 "CSV UTF-8"로 저장).
- 시간 표기: 요일+시각 / 요일+교시 / `월1-2,수3` 한 칸. 교시표는 `1=09:00-10:15` 형식이며 요일마다 다르면 `[월,화,목,금]`·`[수]` 머리글을 쓴다. 표가 없는 요일의 교시는 추정하지 않고 해당 분반을 제외한다.
- 샘플과 업로드 파일은 모두 `apps/web/src/features/catalog/adapter.ts`의 `importCatalog`를 거쳐 같은 Catalog가 되고, 서버 `/catalog/validate`로 정규화·revision을 받은 뒤 같은 솔버를 사용한다.
- 실제 학교 파일은 `local-data/`(커밋 제외)에 둔다. 회귀 테스트는 합성 파일 `fixtures/catalogs/synthetic-portal-export.xls`를 쓴다.
