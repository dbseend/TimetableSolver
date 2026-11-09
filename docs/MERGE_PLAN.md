# main 병합 계획 (실행 전 계획 — 아직 아무것도 삭제·병합하지 않음)

- 작성: 2026-11-09 · 대상: `origin/main`(72ef34e) ← `feat/timetable-integration`
- 최종 실행 구조: **`services/api` + `apps/web` 하나.** main의 `backend/`·`frontend/`는 실행·빌드·CI·배포 경로에서 빠진다.
- 원칙: main 이력을 보존하는 **일반 병합(merge commit)**. 강제 교체(force push, `-s ours`로 main 내용 무시, main 브랜치 재생성)는 하지 않는다. squash 병합도 하지 않는다(main의 21개 커밋을 남기기 위해).
- 근거 조사: `docs/MAIN_COMPARISON.md`, `docs/INTEGRATION.md`, main 사본 파일 목록·경로 참조 조사(2026-11-09).

## 0. 사전 확인 (병합 전에 반드시)

1. **배포 연결 확인**: 저장소가 Render(`render.yaml`, `rootDir: backend`)나 Vercel(`frontend/vercel.json`)에 연결돼 있으면, main에 병합하는 순간 main 구현이 다시 배포되거나 빌드가 실패할 수 있다. 연결돼 있으면 병합 전에 자동 배포를 끄거나 대상을 바꾼다. 이 작업은 저장소 관리자(사용자·협업자)가 대시보드에서 해야 한다.
2. **협업자 합의**: main의 `backend/`·`frontend/`를 실행 경로에서 빼는 것과 아래 자료 보존 방식에 협업자가 동의해야 한다.
3. **보존 태그**: 병합 전 `git tag main-phase-d-final 72ef34e`(main 최종 상태)와 `git tag integration-pre-merge <통합 브랜치 HEAD>`를 만들어 push한다. main에만 있던 코드는 이 태그와 이력으로 언제든 복원할 수 있다.
4. 사용자 결정 대기 항목(§7)이 이 계획의 기본값과 다르면 계획을 먼저 고친다.

## 1. 병합 절차 (권장 순서)

모든 단계는 `feat/timetable-integration`(또는 거기서 딴 `merge/main-into-integration`)에서 수행하고, 마지막에 PR로 main에 반영한다.

| 단계 | 작업 | 커밋 | 확인 |
|---|---|---|---|
| M1 | `git merge --no-ff origin/main` — 충돌 4개 파일만 §2 방향으로 해결. main 폴더(`backend/` 등)는 **아직 그대로 둔다** | merge commit | 두 구현의 자체 테스트가 각각 그대로 통과하는지(병합 자체가 무엇도 망가뜨리지 않았는지) |
| M2 | main 자료 이관(§3 "이관"): `git mv`로 옮겨 이력 추적 유지 | 1커밋 | 옮긴 자료를 쓰는 테스트(데이터 카드 해시 등)를 현재 구조로 포팅해 통과 |
| M3 | main 문서에 "이전 구현 기준" 표시, 충돌 내용 주석(§4) | 1커밋 | 문서 링크 점검 |
| M4 | 실행 경로 제거(§3 "제거"): `git rm -r backend frontend supabase render.yaml` 등 | 1커밋 | §5 참조 점검, 전체 검증(§6) |
| M5 | PR(통합 브랜치 → main), CI 녹색 확인 후 **merge commit**으로 병합 | PR merge | main에서 CI 다시 녹색 |

단계를 나누는 이유: 단계마다 되돌리기(`git revert <커밋>`)가 쉽고, 리뷰어가 "충돌 해결"과 "삭제"를 따로 확인할 수 있다.

## 2. 충돌 파일의 최종 내용 방향

| 파일 | 최종 방향 | 세부 |
|---|---|---|
| `.env.example` | **현재 파일 기준** + main의 설명 일부 | 변수: `APP_ENV`, `CORS_ORIGINS`, `LLM_PROVIDER`(fixture\|gemini), `GEMINI_API_KEY`, `LLM_MODEL`, `ENABLE_DEMO_FIXTURES`, `SOLVER_CONCURRENCY`. main의 "실제 값 커밋 금지", 모델 문서 링크·확인 날짜 주석은 가져온다. main 전용 `LLM_API_KEY`→`GEMINI_API_KEY`, `ALLOWED_ORIGINS`→`CORS_ORIGINS`로 이름이 바뀌었다고 주석으로 남긴다. main의 `ALLOWED_ORIGIN_REGEX`, `SOLVER_TIME_LIMIT_S`, `MAX_INPUT_CHARS`, `DAILY_LLM_CALL_LIMIT`, `LOG_LEVEL`은 현재 서버가 읽지 않으므로 **넣지 않는다**(넣으면 동작하는 것처럼 오해한다). `DAILY_LLM_CALL_LIMIT`(LLM 비용 상한)은 공개 배포 전에 필요한 기능으로 §7에 남긴다. 위치 안내: 현재 서버는 `services/api/.env`를 `--env-file`로만 읽는다(main은 저장소 루트 `.env`를 자동 로드했음) |
| `.github/workflows/ci.yml` | **현재 파일 기준** | 현재 CI가 main CI의 검사(ruff·pytest·OpenAPI 드리프트·typecheck·test·build)를 모두 포함하고 Windows·Python 3.13·E2E를 더한다. main CI에서 가져올 것: `push: branches: [main]` 형태는 필요 없음(현재는 모든 브랜치). pip 캐시는 uv 캐시로 대체 |
| `.github/pull_request_template.md` | main 파일 유지(충돌 아님) + 경로 갱신(M3) | 체크리스트를 `services/api`(uv·ruff·pytest), `apps/web`(typecheck·test·build·e2e), `packages/contracts/openapi.json`·`apps/web/src/generated/api-types.ts` 재생성, 실데이터·키 미커밋으로 바꾼다 |
| `.gitignore` | **합집합** | 현재 항목 + main의 `venv/`, `.mypy_cache/`, `coverage/`, `.vercel/`, `data/private/`, `data/raw/`, `data/**/*.xls(x)`, `**/llm_cache/`(기능은 제외했지만 실수로 생겨도 커밋되지 않게), `.idea/`, `.vscode/`. `local-data/`·`*.tsbuildinfo`·Playwright 결과 유지 |
| `README.md` | **현재 파일 기준** | main의 실행 방법(`backend`, `frontend`, Render/Vercel)은 지운다. 끝에 "이전 구현(main Phase C/D) 자료" 절을 두고 태그 `main-phase-d-final`, 이관된 자료 위치(§3), main 문서 목록을 링크한다 |

## 3. main 전용 폴더·파일 처리

| 경로 | 처리 | 이유 | 보존 방법 |
|---|---|---|---|
| `backend/` (65개) | **제거**(M4) | 실행 구현이 `services/api` 하나여야 한다. 필요한 설계는 이미 재구현: 분반 override(0008), 엔티티 축소(`app/llm/entities.py`), 포털 파일 읽기(`apps/web/src/features/catalog/htmlTable.ts`·adapter, main `loaders/hisnet.py` 대체) | 태그 `main-phase-d-final`·이력. 가치가 있지만 아직 포팅하지 않은 것: `tests/test_solver_property.py`(Hypothesis 속성 테스트 아이디어), `tests/test_hisnet_loader.py`의 표기 사례(합성 사례만 `apps/web/tests/unit/portal.test.ts`로 옮길 후보), `eval/compare.py`(LLM 직접 vs 솔버 비교) — 후속 작업 목록에 남긴다 |
| `backend/openapi.json` | 제거 | 계약 원본은 `packages/contracts/openapi.json` | 이력 |
| `backend/app/core/periods.py` | 제거(채택 안 함) | 교시 규칙이 사용자 제공 표와 충돌(277분반 차이, §6.3 of MAIN_COMPARISON) | 이력 + `docs/academic_rules.md`에 충돌 주석(M3) |
| `backend/app/api/profile.py`, `llm/explain.py`, `llm_cache` 관련 | 제거(제외 기능) | 이수내역 서버·LLM 전송, `/explain`, 디스크 캐시는 범위 밖·경계 위반 | 이력 |
| `frontend/` (24개) | **제거**(M4) | UI는 `apps/web` 하나. main 전용 화면(관심 과목 pool 선택, 선호 칩, 설명)은 제외 기능 | 태그·이력. `vercel.json`의 SPA rewrite는 배포 시 `apps/web`에 다시 만든다(§4) |
| `frontend/.env.example` (`VITE_API_BASE_URL`) | 제거 | 현재는 Vite 프록시. 배포 시 API 주소 주입 방식은 배포 단계에서 결정 | 이력 |
| `data/synthetic/` (catalog_50/200/500, infeasible_scenarios, generator.py) | **이관**(M2) → `evals/main-phase-c/synthetic/` | 500분반 성능 측정·불가능 시나리오에 쓸 가치가 있다. 단 **main 스키마**(HH:MM 문자열, float 학점)라 현재 API에 바로 넣을 수 없다 → README에 스키마 차이와 변환 필요를 적는다 | 파일 자체 보존 |
| `data/eval/seed_labels.jsonl` (40개 라벨) | **이관**(M2) → `evals/main-phase-c/seed_labels.jsonl` | 자연어 해석 정확도 평가의 시작점(현재 미실시 항목). 라벨 형식은 main 조건 DSL이라 변환 필요 | 파일 보존 |
| `data/hash_files.py`, `data/README.md`(데이터 카드) | **이관**(M2) → `evals/main-phase-c/` | 데이터 출처·무결성 기록. 해시 기준은 **git blob(LF) 바이트**이며 `.gitattributes`로 고정됨 | `services/api/tests/test_legacy_data_card.py`로 해시 표 검사 포팅(기대 해시를 바꾸지 않고 통과해야 함 — 이관은 내용 불변) |
| `data/survey/` (동의서·설문 양식·응답 템플릿) | **이관**(M2) → `docs/research/survey/` | 사용자 조사 자료. 실제 응답은 원래부터 미커밋 | 파일 보존 |
| `supabase/migrations/0001_catalog.sql` | **제거**(M4), 사본을 `docs/archive/supabase-0001_catalog.sql`로 | Supabase는 이번 범위 밖. `supabase/` 폴더가 남아 있으면 CLI가 마이그레이션으로 인식할 수 있다. 공개 읽기 RLS(`using (true)`)라 실데이터를 넣으면 노출 위험. 참조하는 `docs/adr/0005`가 main에 없다 | 문서 사본 + 이력 |
| `render.yaml` | **제거**(M4) | `rootDir: backend`, `LLM_API_KEY`로 main 구현을 배포한다. 남기면 배포가 다른 구현을 가리킨다. 공개 배포는 이번 범위 밖 | 이력. 배포를 다시 할 때 `services/api` 기준으로 새로 작성 |
| `docs/*` (main 13개: PLAN, PHASE_D_DESIGN, API, academic_rules, DATA_COLLECTION, DEVELOPMENT_PLAN, labeling_guide, adr/0001~0004, eval/, prompts/) | **유지** + M3에서 머리말 표시 | 파일명 충돌 없음. 다만 `API.md`(main 계약)·`academic_rules.md`(교시 [S7])·`adr/0003-vercel-render.md`는 현재와 다르다 | 문서 보존. 각 파일 맨 위에 "이전 구현(main) 기준 — 현재 계약은 `packages/contracts/openapi.json`, 교시표는 `apps/web/src/features/catalog/presets.ts`(사용자 제공)" 표시 |
| `.github/pull_request_template.md` | 유지·갱신 | §2 | — |

결정 기록 번호: 현재 `docs/decisions/0006~0008`은 main `docs/adr/0001~0004`(+참조만 있는 0005) 다음 번호다. 폴더를 하나로 합칠지는 문서 정리 때 결정(기본: 두 폴더 유지, `docs/decisions/README.md`에 adr 목록 링크).

## 4. 빌드·실행·CI·배포가 한 구현을 가리키게

| 경로 | 병합 후 기준 |
|---|---|
| 로컬 실행 | README의 `services/api`(uv + uvicorn), `apps/web`(npm, Vite 프록시)만 |
| 계약 | `services/api/app/contracts.py` → `packages/contracts/openapi.json` → `apps/web/src/generated/api-types.ts` (CI `contract` 잡이 드리프트 검사) |
| CI | `.github/workflows/ci.yml` 하나(백엔드 Ubuntu/Windows × 3.12/3.13, 계약, 프론트 Ubuntu/Windows, E2E) |
| 배포 | **없음**(범위 밖). Render/Vercel 연결이 있으면 해제하거나 `services/api`·`apps/web` 기준 새 설정으로 바꿀 때까지 끈다 |
| 환경 변수 | `services/api/.env`(Git 제외) + `--env-file`. 프론트 번들에는 비밀값 없음(CI가 번들 문자열 검사) |

## 5. 제거 대상을 참조하는 코드·설정 (M4 전후 점검)

main 사본에서 확인한 참조(2026-11-09):

| 참조하는 곳 | 가리키는 대상 | M4 후 상태 |
|---|---|---|
| `backend/tests/test_data_card.py`, `test_synthetic_data.py`, `test_validate_labels.py`, `test_solver.py`(`data/private/...` 실데이터, 없으면 skip) | `data/` | `backend/`와 함께 제거. 데이터 카드 검사는 포팅(§3) |
| `backend/eval/compare.py`, `scripts/record_seed_llm.py`, `scripts/validate_labels.py`, `scripts/import_hisnet.py` | `data/` | `backend/`와 함께 제거 |
| `frontend/src/pages/Prepare.tsx` | `../../../data/synthetic/catalog_50.json`, `catalog_200.json` | `frontend/`와 함께 제거 |
| `.github/workflows/ci.yml`(main) | `backend/`, `frontend/` | 현재 CI로 대체됨(M1) |
| `render.yaml` | `backend` | 제거 |
| `frontend/package.json`, `backend/app/core/config.py`, `backend/scripts/export_openapi.py`, `backend/tests/test_cors.py` | 서로의 경로 | 함께 제거 |
| `README.md`(main), `docs/*`(API, academic_rules, adr/0003, DATA_COLLECTION, DEVELOPMENT_PLAN, labeling_guide, PHASE_D_DESIGN, prompts) | `backend/`·`frontend/`·`render`·`supabase`·`vercel` 경로 문자열 | README는 대체. 문서는 "이전 구현 기준" 표시(실행 경로가 아니라 기록) |
| `supabase/migrations/0001_catalog.sql` | `docs/adr/0005`(없음) | 사본 머리말에 "참조 문서 없음" 표시 |
| 현재 구현(`services/`, `apps/`, `packages/`, `fixtures/`, CI) | main 경로 | **실행 참조 없음**(2026-11-09 `git grep` 확인). 유일한 일치는 출처를 밝힌 docstring `services/api/app/llm/entities.py` 1행 |

M4 직후 자동 점검 명령(남은 참조가 있으면 실패해야 함):

```bash
git grep -nE "(^|[^A-Za-z_])(backend|frontend|supabase)/|render\.yaml|data/(synthetic|eval|private|raw)" \
  -- ':!docs/MAIN_COMPARISON.md' ':!docs/INTEGRATION.md' ':!docs/MERGE_PLAN.md' ':!docs/archive/**' \
     ':!docs/adr/**' ':!docs/PLAN.md' ':!docs/PHASE_D_DESIGN.md' ':!docs/API.md' ':!docs/academic_rules.md' \
     ':!docs/DATA_COLLECTION.md' ':!docs/DEVELOPMENT_PLAN.md' ':!docs/labeling_guide.md' ':!docs/prompts/**' \
     ':!docs/research/**' ':!evals/main-phase-c/README.md' ':!.gitignore' ':!services/api/app/llm/entities.py'
```

## 6. 병합 후 검증과 복구

**검증**(M1·M4 후, 그리고 main 병합 후 CI에서)

1. `services/api`: `uv sync --frozen`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest -q`(Python 3.12·3.13).
2. 계약: `uv run python scripts/export_openapi.py` → `npm run gen:api` → `git diff --exit-code`.
3. `apps/web`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`(번들 비밀 문자열 0), `npm run e2e`.
4. M2 이관 검사: 포팅한 데이터 카드 테스트 통과(기대 해시 변경 없이).
5. §5 `git grep` 점검 결과 0건(허용 목록 제외).
6. 로컬 실데이터 스모크(Git 밖 `local-data/`): 가져오기 518과목·819분반·정상 656분반, 생성 후보·학점 일치.
7. 배포 연결이 있었다면: 자동 배포가 꺼졌거나 새 대상인지 확인.

**복구**

| 시점 | 방법 |
|---|---|
| M1 병합 중 충돌 해결이 꼬임 | `git merge --abort` |
| M1~M4 로컬 커밋 후, push 전 | 해당 커밋 `git revert`(권장) 또는 브랜치를 `integration-pre-merge` 태그에서 새로 따서 다시 진행(기존 브랜치는 보존) |
| PR 병합 후 main에서 문제 | `git revert -m 1 <merge-commit>`으로 병합 전 main 상태 복귀(이력 보존). main 전용 코드가 필요하면 `git checkout main-phase-d-final -- <경로>`로 해당 파일만 복원 |
| 특정 단계만 문제(예: M4 삭제) | 그 커밋만 `git revert` — 단계별 커밋이라 가능 |

금지: `git push --force` to main, main 브랜치 삭제·재생성, `git merge -s ours`(main 변경을 기록상 무시), 히스토리 재작성.

## 7. 병합 전 사용자·협업자 결정이 필요한 항목

1. Render/Vercel 연결 여부와 처리(§0-1).
2. `data/` 이관 위치(`evals/main-phase-c/` 기본)와 main 스키마 자료 변환 여부(성능 측정·자연어 평가에 쓰려면 변환기 필요).
3. main 문서 폴더(`docs/adr/`)와 `docs/decisions/` 통합 여부.
4. LLM 일일 호출 상한(main `DAILY_LLM_CALL_LIMIT`)을 공개 배포 전 구현할지.
5. 교시표 공식 근거(현재 사용자 제공 표 유지, main [S7]과 충돌) — `docs/academic_rules.md` 주석 문구 확정.
