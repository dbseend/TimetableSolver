# origin/main 대 현재 구현 비교 보고서

작성일 2026-11-09 · 읽기 전용 비교(통합·병합 안 함). 어느 쪽이 낫다고 가정하지 않고, 근거 파일을 함께 적는다.
경로 표기: `main:` = origin/main 내보내기본, 접두사 없음 = 현재 작업 트리(`C:\dev\Timetable-solver\TimetableSolver`).

---

## 1. 범위·방법

| 항목 | 내용 |
|---|---|
| main | `origin/main` = **72ef34e** "Merge pull request #3 from dbseend/feat/catalog-db". fetch는 성공했고, `git archive`로 scratch 폴더에 내보낸 사본을 읽었다. 히스토리는 `git log --oneline origin/main`(1940eb9 Phase A/B → 51cb28f Supabase 스키마)로 확인했다. |
| 현재 | 브랜치 `feat/timetable-mvp` = **07dab72**에 커밋하지 않은 변경을 더한 상태. 수정: `.gitignore`, `CLAUDE.md`, `README.md`, `services/api/app/llm/gemini.py`, `services/api/tests/test_parse.py`. 새 파일: `apps/web/**`, `docs/PROGRESS.md`, `docs/decisions/0006-llm-provider.md`, `fixtures/catalogs/{demo-campus-2026-2.csv,synthetic-portal-export.xls}`, `fixtures/profile/`. 모두 비교에 넣었다. |
| 공통 조상 | `8352ff7 Initial commit`. 두 브랜치는 그 뒤로 **완전히 따로** 개발됐다(폴더·계약·의존성 모두 별개). |
| 제외 | `local-data/`(실제 학교 데이터)와 모든 `.env`는 읽지 않았다. LLM 호출 0회. |

### 실행한 것과 읽기만 한 것

| 대상 | 명령(환경) | 결과 |
|---|---|---|
| main 백엔드 | scratch 사본에서 `uv venv --python 3.13` 생성 → `uv pip install -r requirements-dev.txt` → `pytest -q`. `LLM_PROVIDER=none`, `LLM_API_KEY`·`GEMINI_API_KEY`는 빈 값. `.env` 없음. conftest가 `LLM_PROVIDER=none`을 강제한다(`main:backend/tests/conftest.py`). | **3 failed, 177 passed, 1 skipped** (Python 3.13.13). `test_validate_labels` 2건은 Windows 기본 인코딩(CP949) 때문에 UnicodeDecodeError. `PYTHONUTF8=1`로 다시 돌리면 **1 failed, 179 passed, 1 skipped**. 남은 실패는 `tests/test_data_card.py::test_readme_hash_table_is_current`(README의 해시 표가 계산값과 다름). → **후속 조사(6.1): 내보내기 줄바꿈 변환(core.autocrlf) 때문인 환경 문제. LF로 내보내면 180 passed, 0 failed.** |
| main 프론트 | scratch 사본에서 `npm ci` → `npx tsc --noEmit` → `npx vitest run` | npm ci 성공(EBADENGINE 경고 있음). typecheck 오류 0. Vitest **5 files, 14 passed**. `npm run build`·ruff·OpenAPI `--check`는 **미실행**. |
| main 기능 동작 | — | **미실행**. 서버 기동, 실데이터 import, Gemini 호출, eval 하네스는 돌리지 않았다. main의 동작 설명은 모두 코드와 문서를 읽고 쓴 것이며 검증된 것이 아니다. |
| 현재 백엔드 | `services/api> uv run pytest -q` | **164 passed** (PROGRESS 기록과 같음) |
| 현재 프론트 | `apps/web> npx vitest run`, `npx tsc -b --noEmit` | Vitest **4 files, 51 passed**, typecheck 오류 0 |
| 현재 E2E | `apps/web> npm run e2e` (메인 세션에서 실행, 전용 fixture 백엔드 8010·Vite 5174) | **10 passed** (2026-11-09 최종 실행, PROGRESS 5절). 비교 에이전트는 이 단계를 다시 돌리지 않았다. |

---

## 2. 기능 영역별 비교

### 2.1 UI와 사용자 흐름

**main 구현**
- react-router 3페이지 구성: 준비 → 선호 → 결과(`main:frontend/src/App.tsx`).
- 준비 페이지(`main:frontend/src/pages/Prepare.tsx`)
  - 합성 카탈로그 50/200을 불러오거나 **카탈로그 JSON**을 업로드한다. 실제 학교 파일은 `backend/scripts/import_hisnet.py`로 미리 변환해야 한다.
  - 관심 과목 **pool**을 고르고 과목마다 우선순위 1–5를 정한다.
- 선호 페이지(`main:frontend/src/pages/Preferences.tsx`): 자연어 → `/constraints/parse` → 칩, 엔티티 후보, 모호성 표시. 직접 수정은 "JSON 직접 편집" textarea로 한다.
- 결과 페이지(`main:frontend/src/pages/Results.tsx`): `/solve`(n=3, diversity_k=1) → 그리드 표시, 진단 표시, "이 조건 빼고 다시 풀기" 버튼, `/explain` 호출.
- 상태: `localStorage`에 catalog·pool·제약 텍스트를 저장한다(`main:frontend/src/state.tsx`).
- revision, 확인 단계, AbortController(오래된 응답 무시) 처리는 없다. AbortController는 `HealthStatus.tsx`에만 있다.

**현재 구현**
- 단일 화면, `useReducer` 하나로 상태를 관리한다(`apps/web/src/app/{App.tsx,state.ts}`).
- 화면 흐름
  - 카탈로그: 샘플 CSV 또는 학교 파일을 열 매핑해 가져온다(`features/catalog/CatalogPanel.tsx`).
  - 로컬 이수내역(`features/profile/`).
  - 조건 편집기(`features/constraints/ConstraintEditor.tsx`)와 자연어 패널(`NlPanel.tsx`).
  - "이 조건으로 확인" → `/solve` → 후보 1–3 비교(`features/timetable/ResultsPanel.tsx`) → 진단과 수정안 미리보기, 확인 후 적용(`features/diagnostics/DiagnosisPanel.tsx`).
- revision이 바뀌면 확인을 무효화하고, `input_revision`이 다른 응답은 버리며, 새 요청 때 abort한다(PROGRESS "구현 선택").
- IndexedDB에는 정규화된 이수내역만 저장한다(`lib/storage.ts`).

**장점·누락·결함**
- main
  - (+) pool과 우선순위로 "듣고 싶은 과목"을 직접 표현할 수 있다(`main:docs/PHASE_D_DESIGN.md` DD1).
  - (−) 학교 파일을 브라우저에서 바로 가져오지 못한다.
  - (−) 오래된 응답 무시, 확인 무효화가 없다. CLAUDE.md "draft 변경은 revision…" 조항을 충족하지 못한다.
  - (−) 수동 조건 입력이 JSON textarea라 일반 사용자에게 어렵다.
  - (−) localStorage에 실카탈로그 전체를 저장한다(용량 한계, 지울 방법 없음).
- 현재
  - (+) 계약상 확인 흐름, revision, 수정안 2단계 적용이 E2E로 확인됐다(PROGRESS 기록).
  - (−) pool/우선순위 개념이 없다. 허용 분반 전체에서 soft만으로 고른다.
  - (−) 페이지 라우팅이 없다.

**제안: 조합 필요.** 현재 흐름(확인, revision, 수정안 적용)을 기반으로 두고, main의 pool·우선순위를 SolveRequest 확장(선택 필드)으로 들여오는 방안을 검토한다. 다만 pool은 목적함수 의미를 바꾸므로 사용자가 결정해야 한다(§5).

### 2.2 학교 파일 가져오기와 교시 변환

**사용자 제공 교시표(학교 공지 "변경 후")**
- 월·화·목·금: 1=09:00-10:15, 2=10:30-11:45, 3=12:00-13:15, 4=13:30-14:45, 5=15:00-16:15, 6=16:30-17:45, 7=18:00-19:15, 8=19:30-20:45, 9=21:00-22:15, 10=22:30-23:45
- 수(현행 유지): 1=08:30-09:45, 2=10:00-11:15, 3=11:30-12:45, 4~10은 다른 요일과 같음
- 토·일 시간은 없음
- 연속 교시도 교시별 구간을 그대로 쓰고, 쉬는 시간은 수업에 넣지 않음

**main 구현**
- 서버 측 Python 어댑터(`main:backend/app/loaders/hisnet.py`)
  - 입력은 웹 붙여넣기(TSV)와 `.xls`(HTML 표, CP949). 한글 시간 표기를 우선하고, `개설정보`에서 교수명을 정규식으로 추출한다.
  - 분반 ID는 `{과목코드}-{분반}`.
- 교시 → 시각 변환(`main:backend/app/core/periods.py`)
  - `period_start(n) = 09:00 + (n-1)×90분`, **모든 요일 동일**.
  - `period_len(credit) = 75 if credit >= 3 else 50`. 2학점·1학점·0.5학점·0학점은 50분이다.
  - 연속 교시는 **하나의 Meeting으로 병합**하고, 끝은 `마지막 교시 시작 + 수업 길이`(`hisnet.parse_time`). 쉬는 시간이 수업 구간에 들어간다.
  - 근거 문서: `main:docs/academic_rules.md` §1 [S7] "사용자 확인(2026-11-09): 1교시 09:00, 간격 90분, 3학점 75분·2학점 50분". 수요일 예외는 `[사용자 확인 필요]`로 남아 있다.
- 격자와 학점
  - 월–토 08:00–24:00, 30분 슬롯(`main:backend/app/core/time_slots.py`). 시간 충돌 판정은 정확한 분 단위다(`main:backend/app/validation/validator.py` `check`).
  - 공강·연강은 90분 교시 창 기준으로 센다(`periods_of`).
  - 토요일은 일반 요일과 같은 교시 시각을 쓴다.
  - `Course.credit`은 0.5 단위 실수(`main:backend/app/domain/models.py`).
  - 분반마다 학점·이수구분이 다르면 `Section.credit`/`Section.category` 덮어쓰기로 **보존**한다(첫 분반이 과목 값).

**현재 구현**
- 브라우저 측 TS 어댑터
  - `apps/web/src/features/catalog/adapter.ts` `importCatalog`: 열 매핑, `day_start_end`/`day_period`/`schedule_text` 세 모드.
  - `htmlTable.ts`: HTML .xls 읽기, UTF-8 → meta charset → EUC-KR 순으로 디코딩.
  - `presets.ts`: 포털 형식 자동 인식.
- 교시표: `presets.ts` `PORTAL_PERIOD_TABLE_TEXT`의 `[월,화,목,금]`/`[수]` 요일별 표가 **사용자 제공 표와 값이 일치**한다(10교시 모두 확인).
- 연속 교시: `periodsToMeetings`가 교시마다 따로 Meeting을 만들고 쉬는 시간은 포함하지 않는다.
- 토·일: 표가 없으므로 `PERIOD_TABLE_MISSING_FOR_DAY`로 미지원 처리한다.
- 학점: `creditToUnits`(×100, 0.01 단위)를 쓰고 `.5`는 50이 된다.
- 분반마다 학점·분류가 다르면 `COURSE_INCONSISTENT`로 **과목 전체를 제외**한다(PROGRESS 실데이터 결과: 7과목 41분반 제외).
- 분반 ID는 `{학기}:{과목코드}:{분반}`. 교시표 확인 체크를 해야 진행된다.

**두 구현이 교시를 다르게 바꾸는 경우(충돌, 사용자 결정 필요. 여기서 판정하지 않음)**

| 사례 | 사용자 제공 표 / 현재 | main |
|---|---|---|
| 월1, 3학점 | 09:00-10:15 | 09:00-10:15 (일치) |
| 월5, **2학점** | 15:00-16:15 | 15:00-**15:50** (50분) |
| **수1**, 3학점 | **08:30**-09:45 | 09:00-10:15 |
| **수3**, 3학점 | 11:30-12:45 | 12:00-13:15 |
| 화3,화4, 3학점 | 12:00-13:15 + 13:30-14:45 (Meeting 2개) | 12:00-14:45 (Meeting 1개, 쉬는 시간 포함) |
| 0.5·1학점 과목 | 교시 구간 그대로(75분) | 50분 |
| 토요일 교시 | 미지원(표 없음) | 일반 요일과 같은 시각으로 배치 |
| 분반마다 학점이 다른 과목 | 과목 제외 | 분반 덮어쓰기로 포함 |

영향
- 수요일 1–3교시는 시각 자체가 다르다. 그래서 시간 충돌, `time_avoid` 판정, 화면 그리드가 달라질 수 있다.
- main의 공강·연강 계산(`periods_of`)은 09:00 기준 90분 창을 쓴다. 수요일 08:30 시작 교시에 그대로 적용하면 교시 번호가 어긋날 수 있다(코드를 읽고 추정한 것이며 테스트로 확인하지 않음).

**제안: 현재 교시표 유지가 사용자 제공 자료와 일치한다.** 다만 main 문서 [S7]과 사용자 제공 표가 서로 다른 출처이므로, 어느 쪽이 공식인지는 사용자 결정 항목이다. 분반별 학점 차이(제외냐 덮어쓰기냐)도 결정이 필요하다. 어댑터 위치(브라우저 TS vs 서버 Python)는 §3 참조.

### 2.3 데이터 모델과 API 계약

| 항목 | main | 현재 |
|---|---|---|
| 엔드포인트 | `GET /health`, `POST /catalog/validate`(**501 스텁**), `POST /profile/parse`(**501 스텁**, LLM 이수내역 파싱 예정), `POST /constraints/parse`, `POST /solve`, `POST /explain` (`main:docs/API.md`, `main:backend/app/api/`) | `GET /health`, `GET /ready`, `GET /capabilities`, `POST /catalog/validate`(구현), `POST /solve`, `POST /diagnose`, `POST /constraints/parse` (`services/api/app/main.py`). `/explain`·`/profile/parse` 없음(아키텍처 §7에서 "제거·P0 미구현"으로 명시) |
| 시간 | `"HH:MM"` 문자열, Day=Mon–Sat | 정수 분 `start_minute/end_minute`, `[start,end)`, Day=Mon–Sun (`contracts.py` `Meeting`) |
| 학점 | `credit: float`(0.5 단위), 솔버 안에서 ×2 정수 | `credit_units: int`(×100) |
| credit_range | `min/max` 정수 학점, `min>=0` 허용 | `min_units/max_units`. solve에는 확인된 양수 하한 hard가 필요(`domain/request_checks.py`) |
| 제약 종류 | 13종: lunch_free, max_gap, max_consecutive, time_prefer, instructor_prefer 포함 | P0 8종(credit_range, must_include/exclude, day_off, time_avoid, category_min, instructor_avoid, max_days_on_campus). 점심·공강·연강은 P1로 제외(PROGRESS 범위) |
| weight | hard/soft 모두 기본 5 | hard는 `null` 강제, soft는 1–10 필수 |
| 엄격성 | 제약만 `extra="forbid"`. Catalog·SolveRequest는 기본 모드. `CatalogValidateRequest`는 `list[dict]`로 느슨함 | 모든 모델이 `extra="forbid", strict=True` (`contracts.py` `Strict`) |
| 버전·추적 | 없음 | `schema_version "1.0"`, `catalog_revision`(sha256), `input_revision`, `request_id`, `request_hash` |
| Catalog | `courses/sections`만. Section에 `instructor` 문자열, `capacity`, `prerequisites` | `catalog_id/term_id/timezone/data_origin/category_groups/instructors[]`, `support_status/issue_codes`, `delivery_mode`, `equivalence_group_id` |
| 이수 정보 | `SolveRequest.profile{taken,in_progress}`로 과목 ID를 서버에 보냄 | 클라이언트가 `allowed_section_ids`를 계산해 보냄 |
| 응답 | `status` 대문자, `candidates{sections,objective,satisfied,violated}`, `diagnosis{core,relaxations}` | 소문자 status, 후보별 `search_status/optimality_proven/constraint_evaluations/facts/hard_validation`, `search.termination_reason`, `timing` |
| 오류 형식 | `{"error":{code,message,details}}` | `ErrorResponse`(`contracts.py` `ErrorBody`, request_id 포함) |
| 계약 원본 | `main:backend/openapi.json` → `frontend/src/types/api.d.ts` | `packages/contracts/openapi.json` → `apps/web/src/generated/api-types.ts` |

**평가**
- 두 계약은 **호환되지 않는다**. 경로 이름은 같아도(`/solve`, `/constraints/parse`, `/catalog/validate`) 요청·응답 모양이 다르다.
- 현재 계약은 CLAUDE.md의 분·credit_units·revision·확인 규칙을 따른다.
- main 계약은 pool·우선순위, 13종 제약, `/explain`처럼 기능 폭이 더 넓다.

**제안: 현재 계약을 정본으로 유지하는 쪽이 CLAUDE.md와 맞다.** main의 기능(pool, P1 제약, 분반 덮어쓰기)은 현재 계약에 선택 필드로 추가할지 하나씩 결정한다. 어느 계약을 정본으로 할지는 사용자 결정 항목이다.

### 2.4 시간표 솔버와 독립 검증기

| 항목 | main | 현재 |
|---|---|---|
| 모델 | 과목당 1분반, 시간 겹침(시작점 clique), pool 밖 금지, 이수·선수과목 필터(`main:backend/app/solver/model.py`). hard 사용자 제약마다 assumption literal | 충돌, 학점, 필수/제외, 공강, 시간 회피, 분류 최소, 교수 회피, 등교일(`services/api/app/solver/model.py`) |
| 목적함수 | **최대화** Σ1000·priority − Σ weight·COST[type]·**위반량**(분·반학점·일 단위를 계수로 환산, `main:backend/app/core/objective.py`) | **최소화** Σ weight·(1−sat_j), **이진** 위반(`model.py` 7·165·173행). 독립 재계산 penalty와 일치하지 않으면 500(`application/solve.py` `PENALTY_MISMATCH`) |
| 다양성 | 이전 후보마다 `Σx_chosen <= |chosen|-k`, k=diversity_k(기본 1) | Hamming distance ≥ `min_section_distance`(기본 2), 이전 후보 전부와 비교 |
| 최적성 표시 | 응답 `status`는 **첫 번째 풀이**의 상태만 쓴다. 후보별 상태가 없다. UI는 `OPTIMAL → "최적 후보를 찾았다"`라고 표시(`Results.tsx` 15–18행) | 후보별 `search_status`와 `optimality_proven`. `termination_reason`으로 다양성 소진과 시간 제한을 구분 |
| 시간 제한·격리 | 요청 처리 스레드 **안에서** CP-SAT 실행(동기 def 라우트). `SOLVER_TIME_LIMIT_S`(기본 5) 상한, 남은 시간을 반복 호출에 나눠 줌. 취소·프로세스 회수 없음 | 요청마다 spawn 자식 프로세스 1개, deadline 넘기거나 연결이 끊기면 terminate/kill/join, semaphore가 차면 429(`solver/runner.py`) |
| 검증기 독립성 | `app.solver`를 import하지 않으며 테스트로 강제(`main:validator.py` 1행). 다만 `app.core.periods`(교시 창 해석)를 솔버와 **공유**한다 | OR-Tools를 import하지 않으며 테스트로 강제(`domain/validator.py` 1행). 솔버와 `domain/catalog.py`를 공유 |
| 검증 실패 시 | `AssertionError`(500) | `InternalSolverError` → 500, 후보 반환 안 함 |

**결함·위험(코드를 읽은 결과)**
- main
  - 2번째 이후 후보가 시간 제한 때문에 FEASIBLE이어도 응답 status가 OPTIMAL로 남을 수 있다. CLAUDE.md "FEASIBLE에 최적성 배지 금지" 조항과 충돌할 수 있다(`solve.py` `if i == 0: status = ...`).
  - 위반량에 비례하는 비용은 CLAUDE.md "P0 soft 비용 = Σ weight·binary" 조항과 다르다.
  - 프로세스 격리가 없다(아키텍처 §9.3과 다름).
- 현재: P1 시간 제약(점심·공강·연강)이 없다. 성능 측정은 실데이터 1.1초 1건뿐이다(PROGRESS).

**제안: 현재 솔버 실행 구조(격리, 후보별 상태, 이진 soft)를 유지한다.** main의 공강·연강 모델(교시 창 방식)은 P1을 구현할 때 참고하되, 교시표 충돌(§2.2)이 해결된 뒤에 검토한다. main의 목적함수 의미(우선순위 보상, 위반량 비용)를 채택할지는 사용자 결정 항목이다.

### 2.5 자연어 해석과 Gemini 연결

| 항목 | main | 현재 |
|---|---|---|
| 호출 방식 | `google-genai==3.0.0` SDK `models.generate_content`, `response_json_schema`, temperature 0 (`main:backend/app/llm/provider.py`) | httpx REST, **Interactions API** `POST /v1beta/interactions`, `Api-Revision: 2026-05-20` (`services/api/app/llm/gemini.py`) |
| provider 추상화 | `Provider.generate_json(system,user,schema)` + `CachedProvider`(디스크 캐시, 일일 호출 상한) | `LLMProvider.parse(req) → ProviderOutput` (`llm/base.py`), `FixtureProvider`(`llm/fixture.py`) |
| 출력 검증 | Pydantic 재검증, 오류 메시지를 붙여 최대 2회 재시도, `const`를 `enum`으로 바꾸는 우회(ADR 0004) | `application/parse.py` `_check_draft`가 초안을 검증. null 필수값은 미해결로 처리(PROGRESS 결함 수정 항목) |
| 엔티티 | LLM에는 **분류만** 보낸다. 과목·교수 이름은 서버에서 difflib로 매칭하고, 점수 ≥ AUTO인 후보가 1개일 때만 자동 선택(`main:llm/entities.py`) | 과목·교수 **이름과 ID 목록을 LLM 입력에 넣는다**(`gemini.py` `_payload`) |
| 질문·미지원 | `ambiguities`(기본 해석), `entity_candidates` | `questions`(선택지 포함), `unsupported` 목록, 처리 전에는 확인 불가 |
| fixture/데모 | 없음. LLM이 꺼져 있으면 503 `llm_disabled`, JSON 수동 편집 안내 | `ENABLE_DEMO_FIXTURES=1`이면 fixture 모드, 화면에 "데모 해석" 배지 |
| 실패 처리 | 429/502/503 코드 매핑 | 502 `LLM_HTTP_ERROR` 등, 수동 입력 안내(E2E로 재현) |
| live 검증 | 문서상 D-e에서 확인했다고 적혀 있음(ADR 0004). 이번에는 미실행 | 합성 카탈로그로 live 4건 200(PROGRESS). 실데이터 live는 미실시 |
| /explain | 템플릿 + LLM 재서술. 재서술에 나온 시각·학점·과목명이 facts에 있을 때만 채택(`main:llm/explain.py`) | 없음. facts 템플릿만 사용(CLAUDE.md "설명은 facts 템플릿", 아키텍처 §7 "/explain 만들지 않음") |

결함·주의
- main: 사용자 문장을 포함한 LLM 응답을 서버 디스크 `llm_cache/`에 저장한다(gitignore). 일일 호출 상한은 프로세스 메모리에만 있어 재시작하면 초기화된다(코드 주석에 명시).
- 현재: `gemini.py` 문서 문자열에 "실제 키로 호출 검증은 아직 하지 않았다"가 남아 있어, live 4건 성공으로 기록한 PROGRESS와 맞지 않는다(문서 갱신 누락).
- 현재: 실데이터 엔티티(과목 511, 교수 287)를 LLM에 보낼 때의 크기·비용은 측정하지 않았다(PROGRESS).

**제안: 조합 필요.**
- 현재의 provider 인터페이스, fixture, 질문·미지원 흐름은 유지한다.
- main의 "LLM에는 분류만, 엔티티는 서버에서 매칭" 방식은 토큰 비용과 노출 범위를 줄이므로 채택 후보다.
- Gemini 호출 방식(SDK vs Interactions REST)은 하나로 정해야 한다(§5).
- `/explain` LLM 재서술은 P0 범위 밖이므로 들여오지 않는 것이 CLAUDE.md와 맞다. 들여올지는 사용자 결정 항목이다.

### 2.6 이수내역·개인정보 처리

| 항목 | main | 현재 |
|---|---|---|
| 이수내역 입력 | UI 없음. API `profile.taken`(과목 ID)으로 서버에 보낸다. `/profile/parse`(501)는 `consent: true`와 최소 열(과목명·코드·학점)을 서버/LLM으로 보내는 설계 | 브라우저에서 파싱(`features/profile/transcript.ts`), 학번·이름·성적 열을 즉시 제거, 서버에는 `allowed_section_ids`만 보냄. E2E에서 요청 본문에 학번·이름·성적이 없음을 확인(PROGRESS ④) |
| 저장 | localStorage에 catalog·pool·제약 저장 | IndexedDB에 정규화 이수내역만 저장, "내 데이터 삭제" 제공 |
| 로그 | 요청 메서드·경로·상태·시간만(`main:backend/app/main.py`), 검증 오류는 입력값을 되돌려 주지 않음(`main:docs/API.md`) | `request_id` 중심 로그, 자식 프로세스 오류도 타입명만 전달(`runner.py`). 서버 로그에 키 없음 확인(PROGRESS) |
| 서버 측 사용자 텍스트 보관 | `llm_cache/`에 디스크 캐시 | 없음(코드상 저장 경로 확인 못 함) |

**제안: 현재 유지.** `/profile/parse` LLM 경로는 CLAUDE.md "이수내역 원문을 서버/외부 LLM으로 보내지 않음" 조항과 충돌하므로 들여오지 않는다. main의 로그 최소화 원칙은 두 구현이 같다.

### 2.7 충돌 진단·수정안

| 항목 | main | 현재 |
|---|---|---|
| core | CP-SAT sufficient assumptions → **deletion filter로 최소화**, docstring에 "minimal set" (`main:solver/solve.py` `_core`) | assumption core, 응답에 `core_is_minimal: false` 고정(`contracts.py`), 배경 hard만으로 불가능한지 `background_infeasible` 구분 |
| 최소성 주장 | deadline을 넘기면 filter가 도중에 멈춘다. 시간 초과로 판정이 안 된 경우(`infeasible()`가 False 반환)에는 원소를 남기므로, 그때는 최소가 아닐 수 있는데 API에는 그 구분이 없다 | 최소라고 주장하지 않음 |
| 수정안 | core가 5개 이하면 core 원소 하나를 **삭제(drop)** 하고 재풀이해 `feasible`, `objective_delta`만 보고. 재풀이 해를 검증기로 확인하지 않고 반환하지도 않음(`_relaxations`) | 조건 **수정**(학점 하한/상한 조정, hard→soft weight 5) → 재풀이 → 독립 검증 → `verified_candidate` 포함(`engine.py` `_proposal_changes`, `application/solve.py`) |
| hard credit_range | drop 대상이 될 수 있다(빈 시간표 허용 위험. 아키텍처 §6.5는 금지) | 양수 하한을 가진 새 범위만 제안 |
| 사용자 확인 | "이 조건 빼고 다시 풀기" 버튼(사용자가 클릭하면 실행) | 미리보기 → "확인하고 적용" → 새 revision으로 재풀이 |
| 범위 | 단일 drop | 단일 조건 수정(복수 조합은 미구현, UI에 안내) |

**제안: 현재 유지.** main의 deletion filter는 "시간 안에 끝났을 때만 minimal 표시"처럼 조건을 붙이면 현재 core 품질을 높이는 보강 후보다.

### 2.8 테스트와 실행·배포 설정

| 항목 | main | 현재 |
|---|---|---|
| 백엔드 테스트 | 180개 수집. 실측 결과는 §1(UTF-8 모드 179 passed / 1 failed / 1 skipped). property(hypothesis), 계약, 시드 골든 테스트 포함 | 164 passed. 소규모 oracle과 반례(`tests/test_solver.py`, `test_domain.py`) |
| 프론트 테스트 | Vitest 14 (testing-library/jsdom) | Vitest 51, Playwright 10 passed(메인 세션 실행) |
| eval | `main:backend/eval/compare.py`: LLM이 직접 고른 시간표 vs 솔버를 같은 검증기·목적함수로 채점. 결과 `docs/eval/compare_gemini-3.5-flash-lite.json`(이번 미실행·미검증). LLM 코드 실행 방식(B)은 제외 | 없음(비교 실험은 범위 밖, PROGRESS) |
| 데이터 | 합성 카탈로그 50/200/500, 불가능 시나리오, 라벨 40, 설문 양식(`main:data/`) | `fixtures/catalogs/{tiny7.json,demo-campus-2026-2.csv,synthetic-portal-export.xls}`, `fixtures/profile/` |
| CI | `.github/workflows/ci.yml`: py3.13 ruff/pytest/openapi --check, node22 typecheck/test/build | 없음 |
| 배포 | `render.yaml`(rootDir backend, PYTHON_VERSION 3.13.5, `pip install -r requirements.txt`), `frontend/vercel.json`(SPA rewrite) | 없음(공개 배포는 범위 밖) |
| Supabase | `supabase/migrations/0001_catalog.sql`: semesters/catalogs jsonb, anon **읽기 공개 RLS**(합성 데이터 전용이라는 주석). 앱 코드에서 쓰는 곳은 찾지 못함 | 없음(CLAUDE.md "P0에 DB 추가 안 함") |
| 의존성 고정 | `requirements*.txt`에서 `==` 고정, lockfile 없음(pip). `package.json`은 `^` 범위 + package-lock | `uv.lock` + pyproject `>=`, `package.json`은 정확한 버전 + package-lock |
| env | pydantic-settings가 **저장소 루트 `.env`와 `backend/.env`를 자동 로드**(`main:core/config.py` `ENV_FILES`) | `os.environ` 직접 읽기, `uvicorn --env-file .env`(services/api/.env, README) |

**제안: 조합 필요.**
- main의 CI는 경로·명령만 바꾸면 현재 구조에 쓸 수 있다.
- property 테스트와 eval 하네스는 별도 격리 폴더에 두는 것을 검토한다.
- 배포 설정과 Supabase를 범위에 넣을지는 사용자 결정 항목이다.

---

## 3. 충돌 가능성

| 구분 | main | 현재 | 충돌 내용 |
|---|---|---|---|
| 폴더 | `backend/`, `frontend/`, `data/`, `docs/adr/` | `services/api/`, `apps/web/`, `packages/contracts/`, `fixtures/`, `docs/decisions/` | 같은 역할이 서로 다른 트리에 있다. 단순 병합하면 백엔드와 프론트가 두 벌 생긴다. 공유 파일 `README.md`, `.gitignore`, `.env.example`, `CLAUDE.md`(main에는 CLAUDE.md 없음)는 텍스트 충돌이 확실하다 |
| API 경로 | `/solve`, `/constraints/parse`, `/catalog/validate`, `/explain`, `/profile/parse` | `/solve`, `/constraints/parse`, `/catalog/validate`, `/diagnose`, `/ready`, `/capabilities` | 같은 경로인데 모양이 다르다(§2.3). 프론트 생성 타입도 서로 호환되지 않는다 |
| 데이터 형식 | `"HH:MM"`, credit float, 분반 ID `CODE-01`, Day Mon–Sat | 정수 분, credit_units, `2026-2:CODE:01`, Day Mon–Sun | main 합성 카탈로그 JSON(`data/synthetic/*.json`)은 현재 `/catalog/validate`에 그대로 넣을 수 없다. 변환기가 필요하다 |
| Python | 3.13(CI, render, ruff py313) | `.python-version` 3.12, `requires-python >=3.12`, ruff py312 | 3.13 문법을 쓰면 3.12에서 깨질 수 있다. 버전을 정해야 한다 |
| FastAPI/OR-Tools | fastapi==0.162.2, ortools==9.15.6755, pydantic==2.14.3, pydantic-settings, google-genai==3.0.0 | fastapi>=0.162.2, ortools>=9.15.6755, httpx, uv.lock 고정 | 코어 버전은 같다. main만 pydantic-settings와 google-genai에 의존한다 |
| Node 쪽 | react ^19.3.1, react-router-dom ^7.18.5, vite ^8.3.6, vitest ^5.1.0, TS ^5.9.3, testing-library, jsdom | react 19.3.1, vite 8.3.7, vitest 5.1.0, TS 5.9.3, @playwright/test 1.65.0 | 큰 버전 차이는 없다. main은 범위 지정, 현재는 정확한 버전 고정 |
| env 이름 | `LLM_API_KEY`, `ALLOWED_ORIGINS`, `ALLOWED_ORIGIN_REGEX`, `SOLVER_TIME_LIMIT_S`, `MAX_INPUT_CHARS`, `DAILY_LLM_CALL_LIMIT`, `LOG_LEVEL`, `LLM_PROVIDER`(gemini/none), `LLM_MODEL` | `GEMINI_API_KEY`, `CORS_ORIGINS`, `ENABLE_DEMO_FIXTURES`, `SOLVER_CONCURRENCY`, `APP_ENV`, `LLM_PROVIDER`(gemini/fixture), `LLM_MODEL` | 키 변수 이름이 다르다. `LLM_PROVIDER` 값의 의미도 다르다(`none` vs `fixture`) |
| .env 위치 | 루트 `.env` + `backend/.env` 자동 로드 | `services/api/.env`를 `--env-file`로 명시 | main 방식이 루트 `.env`를 자동으로 읽으므로, 통합 후 의도하지 않은 키가 로드되거나 테스트에 섞일 위험이 있다(main conftest는 `LLM_PROVIDER=none`으로 막고 있음) |
| ADR 번호 | `docs/adr/0001–0004`(PHASE_D_DESIGN은 0005를 언급하지만 파일은 없음) | `docs/decisions/0006-llm-provider.md` | 번호 체계와 위치가 다르다 |
| Gemini 호출 | SDK generate_content | REST Interactions API | 같은 모델 ID(`gemini-3.5-flash-lite`)를 다른 API 형식으로 호출한다 |

---

## 4. 권장 통합 순서와 단계별 검증 (지금 실행하지 않음)

1. **결정 확정**(§5)
   - 교시표 출처, 정본 계약, 폴더 구조, Python 버전, Gemini 호출 방식, 범위(Supabase·배포·/explain·pool·P1 제약)를 정한다.
   - 검증: 결정 내용을 `docs/decisions/`에 기록.
2. **통합 브랜치 생성**: 현재 브랜치에서 분기하고 main은 참조만 한다. 미커밋 파일을 먼저 커밋해 기준점을 고정한다.
   - 검증: `uv run pytest -q` 164, `npm test` 51, `npm run typecheck`, `npm run e2e`를 다시 돌려 기준값을 기록.
3. **교시 규칙 단일화**
   - 확정된 교시표를 테스트 사례로 고정한다: 월1, 수1, 수3, 화3+화4, 2학점 월5, 0.5학점, 토요일.
   - 검증: adapter 단위 테스트, 합성 portal .xls 회귀, 실데이터 집계(분반·Meeting 수)를 PROGRESS 값과 비교.
4. **데이터 변환기**
   - main 합성 카탈로그(`data/synthetic/catalog_{50,200,500}.json`, `infeasible_scenarios.json`)를 현재 Catalog 형식(분·credit_units·새 ID)으로 바꾸는 스크립트를 만든다.
   - 검증: `/catalog/validate` 통과, 왕복 시 개수 보존. 500분반으로 처음 성능을 측정.
5. **보강 기능 이식(하나씩, 각각 별도 커밋)**
   - (a) 서버 측 엔티티 매칭(difflib)으로 LLM 입력을 축소한다. 검증: fixture 회귀, LLM payload에 이름 목록이 없는지 확인하는 테스트.
   - (b) core deletion filter를 "완료 시에만 minimal" 조건부로 넣는다. 검증: 작은 전수조사 oracle과 최소성 비교, deadline 초과 사례.
   - (c) 결정된 경우 pool·우선순위 또는 P1 제약을 넣는다. 검증: 검증기 먼저 구현, 솔버와 검증기 대조 property 테스트(main `test_solver_property.py` 방식), penalty 일치 검사.
6. **테스트 자산 이식**: main property 테스트, 시드 골든, 라벨 검증을 새 계약에 맞게 옮긴다.
   - 검증: 이식 전후 실패 테스트를 삭제하거나 기준을 약화하지 않았는지 diff로 확인. Windows에서는 `encoding="utf-8"`을 명시(이번 main 실행에서 CP949 실패 확인).
7. **CI 도입**: main `ci.yml`을 `services/api`/`apps/web` 경로와 uv로 바꾼다.
   - 검증: ruff, pytest, OpenAPI 재생성 diff 0, typecheck, test, build, e2e(fixture 모드, 외부 LLM 0회).
8. **(범위 결정 시) 배포·DB**: render.yaml(rootDir, uv, Python 버전), vercel.json, Supabase RLS. 실데이터를 넣기 전에는 RLS를 서버 전용으로 바꾼다(main SQL 주석).
   - 검증: 번들에 키 문자열 0건, CORS 실제 origin만 허용, 호출 상한 동작.
9. **eval(선택)**: main `eval/compare.py`를 제품 코드와 분리된 폴더로 옮기고 비용 상한을 둔 뒤 실행한다.
   - 검증: 측정값을 PROGRESS에 원자료와 함께 기록.

---

## 5. 사용자 결정이 필요한 항목

1. **교시표 출처**
   - 사용자 제공 표(요일별, 수요일 08:30 시작, 모든 교시 75분, 연속 교시 분리, 토·일 없음)와 main [S7] 규칙(모든 요일 09:00+90분, 3학점 75분/그 외 50분, 연속 교시 병합, 토요일 동일 시각)이 충돌한다(§2.2 표).
   - 현재 구현은 사용자 제공 표를 따른다. 어느 쪽이 공식인지 확인이 필요하다.
2. **분반마다 학점·이수구분이 다른 과목 7개**: 현재처럼 제외할지, main처럼 분반별 덮어쓰기로 포함할지(포함하면 현재 계약의 Section에 필드를 추가해야 함).
3. **토요일 분반 10개**: 표가 없으니 미지원으로 둘지, 시각을 확인해 넣을지.
4. **정본 API 계약**: 현재(`packages/contracts/openapi.json`, 분·credit_units·revision) vs main(`backend/openapi.json`, HH:MM·float·pool).
5. **폴더 구조**: `services/api`+`apps/web` vs `backend`+`frontend`.
6. **Python 버전**: 3.12 vs 3.13.
7. **목적함수 의미**: 현재 이진 soft(CLAUDE.md P0) vs main 우선순위 보상과 위반량 비례 비용. pool(관심 과목) 도입 여부.
8. **P1 제약(점심·최장 공강·연강) 범위 포함 여부**: main에는 구현돼 있고, 현재는 범위 밖.
9. **Gemini 호출 방식**: google-genai SDK `generate_content`(main) vs REST Interactions API(현재), 그리고 키 변수 이름(`LLM_API_KEY` vs `GEMINI_API_KEY`).
10. **LLM에 과목·교수 이름 목록을 보낼지**(현재) **아니면 분류만 보내고 서버에서 매칭할지**(main).
11. **`/explain` LLM 재서술 도입 여부**: CLAUDE.md와 아키텍처 §7은 P0·P1에서 제외한다고 명시.
12. **`/profile/parse`(이수내역을 LLM으로 파싱, 동의 기반)**: CLAUDE.md 전송 경계와 충돌. 폐기할지.
13. **Supabase 카탈로그 DB, render.yaml/vercel.json 배포, CI**: 범위에 넣을지(CLAUDE.md는 P0에서 DB 제외).
14. **서버 측 LLM 응답 디스크 캐시(`llm_cache/`)**: 허용할지(사용자 문장이 서버 디스크에 남음).
15. **main 테스트 실패 1건**(`test_readme_hash_table_is_current`): → 6.1에서 환경 문제로 확인(해결).

## 6. 보완 조사 (2026-11-09, 사용자 요청 후속)

### 6.1 main 테스트 실패 원인 — 환경 문제(기능 결함 아님)

| 실패 | 재현 근거 | 분류 |
|---|---|---|
| `tests/test_data_card.py::test_readme_hash_table_is_current` | 이 저장소는 `core.autocrlf=true`이고 main에 `.gitattributes`가 없다. `git archive`가 내보낼 때 텍스트 파일을 CRLF로 바꿨다. `data/synthetic/*.json`, `data/eval/seed_labels.jsonl` 5개 모두 **git blob 해시 = main README 표**, 내보낸 파일 해시만 다르고 CR 포함(예: catalog_500.json 10,685줄). `git -c core.autocrlf=false archive`로 다시 내보내 실행하면 **통과**. | 비교 환경 문제(내보내기 줄바꿈 변환). main 데이터·README는 일치 |
| `tests/test_validate_labels.py` 2건(PYTHONUTF8 없이) | 테스트 도우미 `_write`가 `p.write_text(...)`를 encoding 없이 호출 → Windows에서 CP949로 기록, 제품 코드 `scripts/validate_labels.py`는 `encoding="utf-8"`로 읽어 `UnicodeDecodeError`. `PYTHONUTF8=1`이면 통과. | **테스트 코드의 Windows 이식성 결함**(제품 기능 결함 아님) |

- LF 내보내기 + `PYTHONUTF8=1`: main 백엔드 **180 passed, 1 skipped, 0 failed** (Python 3.13.13, LLM 끔, .env 없음).
- 통합 시 권장: `.gitattributes`에 `data/** -text` 또는 `*.json text eol=lf`, `*.jsonl text eol=lf` 추가, 테스트 도우미에 `encoding="utf-8"` 명시. 협업자에게는 결과만 공유하면 되고 추가 확인은 불필요.

### 6.2 main 점심·공강·연강의 의미 — 명세와 다름(반례 테스트로 확인)

반례 파일: `docs/evidence/main_p1_semantics_counterexamples.py` (main 사본에서 main의 `validation.validator.check`를 직접 호출, 명세 §4.5 참조 구현과 대조). 실행 결과 **7 passed**(6개 반례 + 1개 일치 대조).

| 조건 | main 정의(근거) | 명세 §4.5 | 반례 | 명세 | main |
|---|---|---|---|---|---|
| lunch_free | 창 안 **빈 시간 합** ≥ 최소, `days` 파라미터 없음, 수업 있는 모든 날(`validator.py` lunch_free) | 지정일마다 창 안 **연속** 빈 구간 ≥ 최소 | 창 11:00-14:00·60분, 수업 11:30-12:15·12:45-13:30 (합 90분, 최장 연속 30분) | 위반 | 충족 |
| lunch_free | 〃 | 지정일만 | `days:["Mon"]` 입력 | 표현 가능 | 스키마가 거절 |
| max_gap | 90분 교시 격자의 빈 **교시 수**, `(분-15)//90`(`core/periods.py`) | 인접 수업 사이 최장 빈 **분** ≤ 상한 | 09:00-09:50 → 10:30-11:45 (40분), 상한 30 | 위반 | 충족 |
| max_consecutive | 연속 점유 **교시 수** ≤ `분//75`, reset 개념 없음 | 쉬는 시간 < reset(20)이면 체인 연결, 체인 시작~끝 분 ≤ 상한 | 09:00-10:15·10:30-11:45(쉬는 15분, 체인 165분), 상한 150 | 위반 | 충족 |
| max_consecutive | 〃 | 단일 긴 수업도 상한 초과 가능 | 09:00-12:00 단일(180분), 상한 150 | 위반 | 충족 |
| max_consecutive | 〃 | 쉬는 시간 정확히 20분이면 체인 끊김 | 09:00-10:15·10:35-11:50, 상한 100 | 충족 | 위반 |

- main의 솔버(`solver/model.py`)도 같은 `periods.py` 함수를 써서 같은 의미로 보이나 **솔버 쪽은 실행하지 않았다**(검증기만 실행).
- 결론: main의 P1 조건은 "교시 격자 근사"이며 명세의 분 단위 정의와 다르다. 도입한다면 명세 의미로 다시 구현하거나 명세를 바꾸는 결정이 먼저 필요하다. 특히 사용자 교시표는 수요일이 30분 앞당겨져 있어 main의 단일 90분 격자와 정렬되지 않는다.

### 6.3 교시표 충돌의 실제 규모(실데이터 집계, 내용 미커밋)

main 규칙(09:00+90분, 3학점 75분/그 외 50분, 연속 교시 병합, 토요일 동일)과 사용자 제공 표는 **월·화·목·금의 3학점 수업 시각은 같다**. 다른 곳:

| 차이 | 영향 분반(시간 있는 666 중) |
|---|---|
| 수요일 1~3교시(사용자 표가 30분 이름) | 43 |
| 3학점 미만 수업 길이(main 50분 / 사용자 표 75분) | 121 |
| 연속 교시(main 병합·쉬는 시간 포함 / 현재 교시별 분리) | 189 |
| 토요일(main 평일 시각 / 현재 제외) | 10 |
| 하나라도 해당 | **277** |

### 6.4 결정 사항 15개 — 세 갈래로 정리

**A. 코드·테스트 근거로 권고하는 기술 선택**

| # | 항목 | 권장 | 이유(근거) |
|---|---|---|---|
| 4 | 정본 API 계약 | **현재 계약 유지**, main의 분반 override만 흡수(0008) | strict·정수 분·credit_units·revision/확인·stale 차단이 CLAUDE.md 계약과 일치, 백엔드 164·E2E 11로 검증. main은 HH:MM 문자열·float 학점(부동소수 오차 위험)·revision 없음, `/catalog/validate`·`/profile/parse` 501 스텁 |
| 5 | 폴더 구조 | **`services/api` + `apps/web` 유지**, main 모듈을 기능 단위로 이식 | 아키텍처 문서 §3과 일치, 생성 타입 경로·E2E 설정이 이 구조에 묶여 있음 |
| 6 | Python 버전 | `requires-python >=3.12` 유지 + **3.12·3.13 둘 다 테스트** | 현재 3.12, main 3.13에서 main 테스트 통과. 하한을 올릴 이유 없음 |
| 7a | 목적함수 의미 | **현재 이진 soft 유지**(P0) | CLAUDE.md "P0 soft 비용은 Σ weight*binary_violation". main의 위반량 비례·우선순위 보상은 v2 정규화 합의 후 |
| 8a | P1 조건을 넣는다면 | **명세 의미로 재구현**(main 코드 그대로 채택 금지) | 6.2 반례 6건 |
| 9 | Gemini 호출 방식·키 이름 | **현재 REST Interactions + `GEMINI_API_KEY` 유지** | 실제 키로 live 호출 5회 성공·오류 경로 확인, SDK 의존성 불필요. main SDK 경로는 이번에 미실행 |
| 10 | LLM에 보낼 엔티티 | **조합**: main의 서버 측 후보 좁히기(이름 매칭)로 관련 엔티티만 보내고, 현재의 ID 검증 경계 유지 | 실데이터에서 과목 511·교수 287 전체 이름을 매번 보냄(최소 전송 원칙 §9.1). 서버 매칭은 결과를 다시 검증 가능 |
| 14 | 서버 LLM 응답 디스크 캐시 | **기본 비활성(제거 또는 개발 전용 옵트인)** | 사용자 문장이 서버 디스크에 남음 — §9.1 "요청 본문·LLM 원문 응답 기본 로깅 안 함" |
| 15 | main 테스트 실패 | **해결: 환경 문제**(6.1). `.gitattributes`·encoding 명시로 예방 | 재현 근거 6.1 |
| — | 솔버 실행·진단 | **현재 프로세스 격리·수정안 재검증 유지**, main의 조건부 core 최소화는 "최소" 표기 조건(시간 내 완료) 붙여 흡수 | main은 요청 처리 안에서 CP-SAT 실행, 수정안 검증기 미통과, hard 학점 범위 제거 가능(§2.4·2.7) |

**B. 학교 규칙 확인이 필요한 사항**

| # | 항목 | 현재 처리 | 필요한 정보 |
|---|---|---|---|
| 1 | 교시표(수요일·3학점 미만 길이·연속 교시·토요일) | 사용자 제공 표 | 공식 공지 원문 또는 학사 안내 — 277분반이 달라짐(6.3) |
| 2 | 분반별 학점·이수구분 차이 7과목 | 과목째 제외(명세 §4.2) | 가변 학점·분반별 이수구분을 학교가 어떻게 인정하는지. 모델 변경 자체는 0008(C안) 권장 |
| 3 | 토요일 교시 시각 | 10분반 제외 | 토요일 교시표 |
| — | 내 전공 인정 기준 | 사용자 확인 과목 목록(0007), 확인 전 차단 | 주전공 명칭·교육과정, 복수/부전공, 타 학부 과목 인정 규칙 |
| — | 시간 미정 117분반 | 미지원(비동기로 간주 안 함) | 수업방식(비대면·개별지도 등)과 실제 시간 |

**C. 사용자가 정할 제품 범위**(권장 포함)

| # | 항목 | 권장 |
|---|---|---|
| 7b | 관심 과목 pool | 나중(P1). 현재 must_include·이수내역으로 대부분 표현 가능 |
| 8b | 점심·최장 공강·연강 포함 시점 | 통합 후 별도 단계, 명세 의미로 구현 |
| 11 | `/explain` LLM 재서술 | 넣지 않음(CLAUDE.md P0·P1 제외). facts 템플릿 유지 |
| 12 | `/profile/parse`(이수내역 LLM 파싱) | **폐기 권장** — 이수내역 원문을 서버·LLM으로 보내지 않는 경계와 충돌 |
| 13 | Supabase·배포(render/vercel)·CI | **CI는 지금 도입 권장**(Windows+Linux, Python 3.12/3.13), Supabase·공개 배포는 나중 |
