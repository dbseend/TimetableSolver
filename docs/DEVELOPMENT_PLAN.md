# TimetableSolver 개발 계획서

- 버전: v0.2 (2026-11-09)
- 관계: `PLAN.md` = 기획(무엇을/왜), 이 문서 = 개발(어떤 순서로/어떻게)
- 대체: 이전 `IMPLEMENTATION_PLAN.md`(주차·시간 기준)를 대체한다. 기술 지침은 §8–§13에 통합했다.
- 원칙: **날짜·기간·시간 추정 없이 작업 단위와 순서만 정의한다.** 각 단계는 게이트(통과 조건)를 만족해야 다음 단계로 간다.
- 표기: `[가정]` 아래 기본값으로 진행 / `[확인 필요]` 외부 정보·설정 확인 필요

---

## 0. 진행 순서와 배포 구성

```
A. 깃 레포 개설  →  B. 기본 구성  →  C. 데이터 수집  →  D. 구현
  (게이트 GA)        (게이트 GB)       (게이트 GC)        (게이트 GD1~GD3)
```

| 항목 | 결정 |
|---|---|
| 프론트 배포 | Vercel (React + Vite + TS) |
| 백엔드 배포 | Render (FastAPI + OR-Tools) |
| 저장소 | GitHub 모노레포 `dbseend/TimetableSolver` |
| 개인정보 | 이수내역 원본은 브라우저 로컬(IndexedDB)에만 저장 |

**디렉터리 → 배포 대상 매핑**
- `frontend/` → Vercel 프로젝트 (Root Directory = `frontend`)
- `backend/` → Render 웹 서비스 (Root Directory = `backend`)
- `eval/`, `data/`, `docs/` → 배포하지 않음

---

## A. 깃 레포 개설

목표: 모든 이후 작업이 이슈 → 브랜치 → PR 흐름으로 쌓이는 빈 저장소를 만든다.

| ID | 작업 | 산출물 / 완료 기준 |
|---|---|---|
| A1 | GitHub 저장소 생성 `dbseend/TimetableSolver` | 기본 브랜치 `main`. 공개 범위는 **private**으로 시작 `[가정]`. 이유: 실데이터를 다루고, 코드 IP 정책을 정하기 전이다. 공개 전환은 GD3 이후 판단 |
| A2 | 로컬 초기화와 첫 커밋 | `git init`, 원격 연결. 현재 `docs/`, `data/`, `backend/`, 빈 디렉터리 구조 커밋 |
| A3 | `.gitignore` | `.env*`(`.env.example` 제외), `.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `node_modules/`, `dist/`, **`data/private/`**, **`data/raw/`**, `eval/**/llm_cache/` |
| A4 | 데이터 반입 규칙 문서화 | `data/README.md`: **실제 개설강좌·이수내역·설문 원본은 저장소에 커밋하지 않는다.** 커밋 대상은 합성 데이터와 비식별·동의된 평가셋뿐이다 |
| A5 | 보안 설정 | GitHub secret scanning과 push protection 활성화. `.env.example`만 커밋. 키는 어디에도 평문으로 두지 않는다 |
| A6 | 협업 장치 | `.github/pull_request_template.md`(변경 요약, 테스트, 체크리스트), 라벨 `phase:A..D`·`type:feat/fix/docs/data`, 마일스톤 `GA, GB, GC, GD1, GD2, GD3`(**마감일 없음**) |
| A7 | 브랜치·커밋 규칙 | 브랜치 `feat/<작업ID>-<slug>`, Conventional Commits, `main` 직접 푸시 금지 `[가정]`(단독 개발이어도 PR 기록을 남김) |
| A8 | 작업 이슈 일괄 등록 | 이 문서의 B·C·D 작업을 이슈로 등록하고 마일스톤에 연결 |
| A9 | 문서 반입 | `docs/PLAN.md`, `docs/DEVELOPMENT_PLAN.md`를 `main`에 커밋. 결정 기록용 `docs/adr/` 디렉터리 |

**초기화 명령 (참고)**
```bash
cd timetable-solver
git init -b main
git add . && git commit -m "chore: initial import of docs and structure"
gh repo create <owner>/timetable-solver --private --source=. --remote=origin --push
```

**게이트 GA**: 원격에 `main`이 존재하고, secret scanning이 켜져 있으며, 이슈 목록이 마일스톤에 연결돼 있다.

---

## B. 기본 구성

목표: 비어 있는 앱이라도 **Vercel 프론트에서 Render 백엔드를 호출하는 배포 파이프라인이 끝까지 동작**하게 만든다. 도메인 계약(스키마)을 먼저 고정한다.

### B-1. 백엔드 뼈대
| ID | 작업 | 완료 기준 |
|---|---|---|
| B1 | `backend/` 프로젝트 구성: `requirements.txt`, `requirements-dev.txt`, `app/main.py`, `core/config.py`(환경변수 로딩) | `uvicorn app.main:app` 실행, `GET /health` → 200 |
| B2 | CORS 설정 | `ALLOWED_ORIGINS`(쉼표 목록)와 `ALLOWED_ORIGIN_REGEX`(Vercel Preview용)를 환경변수로 받는다. 기본값은 로컬 개발 주소만 허용 |
| B3 | 로깅·오류 형식 | 구조화 로그, 선호 문장 원문은 로그에 남기지 않는다(해시/길이만). 오류 응답 JSON 형식 통일 |

### B-2. 프론트 뼈대
| ID | 작업 | 완료 기준 |
|---|---|---|
| B4 | `frontend/` Vite + React + TS, 라우팅(`/prepare`, `/preferences`, `/results`), 빈 페이지 | `npm run dev`, `npm run build` 성공 |
| B5 | API 클라이언트와 `VITE_API_BASE_URL` | 환경변수로 백엔드 주소 주입. **비밀 값은 `VITE_` 변수에 절대 넣지 않는다**(클라이언트 번들에 노출됨) |
| B6 | 상태 확인 컴포넌트 | 화면에서 `/health` 호출 결과 표시. 응답 지연 시 "서버 깨우는 중" 안내(Render 콜드 스타트 대비) |

### B-3. 계약 우선(Contract-first)
| ID | 작업 | 완료 기준 |
|---|---|---|
| B7 | 도메인 모델 `domain/models.py`: Course, Section, Meeting, Profile | pydantic v2, 단위 테스트 |
| B8 | 제약 스키마 `domain/constraints.py`: discriminated union 13종 | JSON Schema 추출, 부록 A 예시 라운드트립 테스트 |
| B9 | 시간 슬롯 유틸 `core/time_slots.py` | `"HH:MM"` ↔ 슬롯 변환, 경계값 테스트. 시작 시각·슬롯 길이는 설정화 |
| B10 | OpenAPI → TS 타입 생성 | `openapi-typescript`로 `frontend/src/types` 생성 스크립트. 수동 타입 복제 금지 |
| B11 | 계약 문서 `docs/API.md` | §9의 요청/응답 스키마를 코드와 일치시킨다 |

### B-4. 품질 도구와 CI
| ID | 작업 | 완료 기준 |
|---|---|---|
| B12 | 린트·테스트 도구 | `ruff`, `pytest`, `hypothesis`, `tsc`, `vitest` 설정 |
| B13 | GitHub Actions | PR마다 ruff, pytest(LLM 호출 없음), tsc, vitest 실행 |

### B-5. 배포 구성
| ID | 작업 | 완료 기준 |
|---|---|---|
| B14 | Render 서비스 생성 | §7.1 설정으로 웹 서비스 생성. 배포 성공, `/health` 200 |
| B15 | Vercel 프로젝트 생성 | §7.2 설정으로 프로젝트 생성. 프로덕션과 PR Preview 배포 확인 |
| B16 | 환경변수 연결 | Vercel `VITE_API_BASE_URL` → Render URL. Render `ALLOWED_ORIGINS`에 Vercel 도메인 등록 |
| B17 | 종단 확인 | 배포된 프론트에서 배포된 백엔드 `/health` 호출 성공 (콜드 스타트 후 포함) |

### B-6. 결정 기록
| ID | 작업 | 완료 기준 |
|---|---|---|
| B18 | ADR 작성 | `adr/0001-python-ortools.md`, `0002-local-profile.md`, `0003-vercel-render.md` (각 문맥·결정·결과·대안) |

**게이트 GB**: (1) 로컬과 CI에서 빈 테스트가 통과한다. (2) Vercel 배포본이 Render 배포본의 `/health`를 호출해 화면에 표시한다. (3) 도메인 모델·제약 스키마·OpenAPI 타입이 코드로 존재한다.

---

## C. 데이터 수집

목표: 구현이 가정이 아니라 **실제 데이터 형식**에 맞춰지도록, 필요한 데이터를 확보·정리하고 스키마를 확정한다. 확보하지 못하는 데이터는 합성으로 대체하고 그 사실을 기록한다.

| ID | 작업 | 산출물 / 완료 기준 |
|---|---|---|
| C1 | 데이터 요구사항 표 작성 | 필요 데이터별 용도·형식·개인정보 여부·확보 방법·대체 수단. `data/README.md`에 기록 |
| C2 | 한동 개설강좌 확보 | 수강신청 시스템에서 **사용자가 직접 내려받거나 복사한** 파일. 로그인 자동화·크롤링은 하지 않는다. 사용 목적(개인 개발·평가)이 학교 약관/정책에 맞는지 확인 `[확인 필요]`. 저장은 `data/private/`만 |
| C3 | 학사 규칙 정리 | 시간 체계(교시/분 단위), 신청 가능 학점 상한·하한, 카테고리 체계(전필/전선/교양 영역), 선수과목 표기 방식. 공개 학칙·공지에서 수동 확인 `[확인 필요]` |
| C4 | 이수내역 샘플 확보 | 본인 이수내역을 붙여넣은 원문. **이름·학번·성적을 제거**한 뒤 형식만 분석. 파서 명세서 작성(열 구성, 구분자, 재수강·F/P 표기, 학기 표기) |
| C5 | 스키마 확정 | C2–C4 결과로 B7–B9의 모델·슬롯 설정 수정, `docs/API.md` 갱신 |
| C6 | 합성 카탈로그 생성기 | `data/synthetic/generator.py`. C2의 구조 통계(분반 수 분포, 시간 패턴, 학점 분포)를 파라미터로 사용. `--sections 50|200|500 --seed N`. 가상 과목명·코드를 사용해 실제 과목과 혼동되지 않게 한다 |
| C7 | 불가능 시나리오 세트 | 합성 카탈로그 위에 알려진 충돌 케이스 5종 이상 (예: 공강 요일 + 그 요일에만 개설된 필수 과목). 기대 충돌 제약 집합을 함께 기록 |
| C8 | 선호 문장 수집 | 설문 폼으로 지인 5–8명 + 직접 작성. 목표 100문장, 난이도 분포 단일 30 / 복합 40 / 모호 20 / 모순 10. 안내: 실명·학번 등 식별 정보 쓰지 않기. 동의 문구 포함(수집 목적, 보관, 공개 범위) |
| C9 | 사전 설문 | 시간표 구성에 걸리는 시간과 불편 요인(기획서 §2.1 가설 검증). 평가 단계의 비교 기준으로 사용 |
| C10 | 정답 라벨링 | 선호 문장별 정답 제약 JSON. `docs/labeling_guide.md`에 강도 판별 규칙, 기본 해석(예: "아침"=09:00 이전), 모호 문장 처리 기준 명시. 20%는 시간 간격을 두고 재라벨링해 일치도 확인 |
| C11 | 데이터 카드·버전 | `data/README.md`: 출처, 수집일, 비식별 방법, 사용 범위, 파일 해시. 평가셋은 동의 범위에 따라 private/public 결정 |

**데이터 취급 규칙**
- 실데이터(개설강좌 원본, 이수내역, 설문 원문)는 `data/private/`에만 두고 커밋하지 않는다.
- 평가 보고서에는 집계 결과와 비식별 예시만 쓴다.
- C2·C4를 확보하지 못하면 합성만으로 진행하고, 로더를 어댑터 구조로 만들어 두었다가 확보 시 어댑터만 추가한다. 이 경우 문서와 발표에서 "실데이터 검증 없음"을 명시한다.

**게이트 GC**: (1) 로더가 읽을 입력 형식이 확정됐다. (2) 합성 카탈로그 3종과 불가능 시나리오 세트가 있다. (3) 선호 문장과 정답 JSON이 구축돼 있다. (4) 스키마 변경이 `docs/API.md`와 코드에 반영됐다.

---

## D. 구현

순서 원칙: **UI를 먼저 세우고(목 API), 솔버의 hard 제약을 검증한 뒤, LLM 입력을 붙이고, 마지막에 soft·진단·설명·평가**를 올린다. 각 작업은 테스트와 함께 PR로 머지한다.

### D-1. 입력과 화면 (UI 먼저)
| ID | 작업 | 완료 기준 |
|---|---|---|
| D1 | 카탈로그 로더 (CSV/xlsx) + 검증 리포트 | 오류 행 번호·사유 출력. 합성·실데이터 어댑터 분리 |
| D2 | MSW 목 서버 | B11 계약대로 5개 엔드포인트 목 응답. 프론트가 솔버 없이 흐름 확인 |
| D3 | 시간표 그리드 컴포넌트 | 5열 × 슬롯 그리드, 분반 블록, 충돌 시 강조. vitest로 겹침 표시 검증 |
| D4 | 데이터 준비 화면 | 개설강좌 업로드, 열 매핑, 분반 목록 표시 |
| D5 | 이수내역 입력 | C4 명세 기반 결정론적 파서 + 열 매핑 + 확인 화면. IndexedDB 저장·삭제 버튼 |

**게이트 GD1-a**: 합성 카탈로그를 올리고, 이수내역을 붙여넣고, 분반을 수동 선택해 충돌을 볼 수 있다.

### D-2. 솔버 (hard 제약)
| ID | 작업 | 완료 기준 |
|---|---|---|
| D6 | 후보 필터 | 이수·선수 미충족·`must_exclude`·요일상 불가능 분반 제거. 필터 전후 분반 수 반환 |
| D7 | `model_builder` 기본 | 과목당 1분반, 슬롯 충돌, 학점 범위. 사용자 hard 제약은 assumption literal로 래핑 |
| D8 | 독립 검증기 `validator.py` | 솔버 코드를 import하지 않는 순수 Python. 알려진 위반 사례 탐지 테스트 |
| D9 | property test | 랜덤 카탈로그·제약에서 솔버가 낸 해는 모두 검증기 통과 |
| D10 | top-N + no-good cut | 후보 간 서로 다른 분반 ≥ k. 다양성 테스트 |
| D11 | `/solve` API와 후보 카드 UI | 목 → 실제 API 전환. 후보 3개를 카드로 표시 |
| D12 | 솔버 벤치마크 | 합성 50/200/500에서 p50/p95 측정. 시간 제한 값 결정 |

**게이트 GD1-b**: 수동 작성 JSON 제약으로 후보 3개를 생성하고, 검증기 위반이 0이다.

### D-3. LLM 입력
| ID | 작업 | 완료 기준 |
|---|---|---|
| D13 | LLM provider 추상화 + 디스크 캐시 | 캐시 히트 시 외부 호출 0. 키는 서버 환경변수로만 |
| D14 | `parse_constraints` | C8·C10의 문장으로 스키마 강제 출력, 검증 실패 시 오류 내용을 포함해 최대 2회 재요청 |
| D15 | 엔티티 매칭 | 정확 일치 → fuzzy. 모호하면 후보 목록 반환(자동 확정 금지) |
| D16 | 해석 칩 UI + "다시 풀기" | 강도 토글, 가중치, 삭제·추가, `source_text` 표시. 확정한 칩만 `/solve`로 전달 |
| D17 | 골든 테스트 | 캐시된 응답 기준으로 대표 문장의 제약 JSON을 고정 비교 |

**게이트 GD2**: 문장 입력 → 칩 확인 → 후보 생성이 배포 환경에서 end-to-end로 동작한다.

### D-4. soft 제약, 진단, 설명
| ID | 작업 | 완료 기준 |
|---|---|---|
| D18 | soft 제약 모듈 | `time_prefer`, `day_off`, `max_gap`, `lunch_free`, `max_consecutive`, `max_days_on_campus`, `instructor_*`. 제약 타입당 1파일, 단위 테스트, 검증기와 결과 일치 |
| D19 | 목적함수와 충족도 리포트 | 정수 가중치 스케일. 후보별 satisfied/violated 목록 |
| D20 | 불가능 진단 | assumption core로 충돌 집합 반환. C7 시나리오에서 기대 충돌 제약이 core에 포함되는지 확인 |
| D21 | 완화안 재풀이 | 충돌 제약을 하나씩 해제해 재풀이, 목적함수 변화량 반환 |
| D22 | 진단 패널 UI | 충돌 제약 강조, 완화안 적용 → 재풀이 |
| D23 | 설명 생성 | 입력은 솔버 사실만. 후검증(과목·요일·시각 토큰이 결과에 존재) 실패 시 템플릿 설명으로 대체 |

### D-5. 평가
| ID | 작업 | 완료 기준 |
|---|---|---|
| D24 | NL→제약 평가 | 정규화 JSON 기준 constraint-level P/R/F1, hard/soft 구분 정확도, 엔티티 매칭 정확도. 프롬프트 버전별 결과 기록 |
| D25 | 3-way 비교 하네스 | (A) LLM 직접 생성 (B) LLM+코드 실행 (C) 본 시스템. 모든 결과를 독립 검증기로 채점. 규모 50/200/500 |
| D26 | 사용자 평가 | 수동 구성 vs 도구, 5–8명. 서버 측 `solve_ms`를 별도 기록(콜드 스타트가 체감 시간을 왜곡하므로) |
| D27 | 결과 리포트 | 표·그래프·한계 서술. 가설이 틀린 경우 그대로 보고 |

### D-6. 마감
| ID | 작업 | 완료 기준 |
|---|---|---|
| D28 | 배포 점검 | 프로덕션에서 데모 시나리오(PLAN 부록 B) 전체 동작. 콜드 스타트 대응 확인 |
| D29 | 문서 | README(실행법, 아키텍처), AI 활용 내역(PLAN §15 갱신), 데이터 카드 최종화 |
| D30 | 데모 영상·발표 자료 | 3분 시나리오 녹화 |

**게이트 GD3**: 완료 정의(§14)의 모든 항목을 만족한다.

**범위 축소 순서** (진행이 막힐 때 아래부터 제외): 내보내기(F9) → 강의계획서 추출(F8) → 실험 로깅(F10) → D21 완화안 재풀이 → 이수내역 LLM fallback. **D8–D9(검증기, property test)와 D16(칩 UI)은 마지막까지 지킨다.**

---

## 7. 배포 설정

### 7.1 Render (백엔드)
- 유형: Web Service, 런타임 Python, Root Directory `backend`.
- 빌드: `pip install -r requirements.txt`
- 시작: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- 헬스체크: `/health` (가볍게 유지)
- **Python 버전을 반드시 고정**한다. 환경변수 `PYTHON_VERSION`에 `3.13.5`처럼 **완전한 버전**을 넣어야 한다. 고정하지 않으면 생성일에 따라 기본 버전이 정해지며, 2024-12-16 이후 생성 서비스의 기본은 3.11.11이다.
- 플랜: 무료로 시작 `[가정]`. 무료 웹 서비스는 15분간 인바운드 트래픽이 없으면 스핀다운되고, 다음 요청에서 콜드 스타트가 발생한다(수십 초 이상 걸릴 수 있음).

```yaml
# render.yaml (참고 스케치, rootDir/runtime 속성명은 Render Blueprint 스펙으로 최종 확인)
services:
  - type: web
    name: timetable-solver-api
    runtime: python
    rootDir: backend
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: 3.13.5
      - key: LLM_PROVIDER
        value: gemini
      - key: LLM_API_KEY
        sync: false          # 대시보드에서 직접 입력
      - key: ALLOWED_ORIGINS
        sync: false
      - key: ALLOWED_ORIGIN_REGEX
        sync: false
```

**콜드 스타트 대응**
- 프론트: 첫 호출이 지연되면 "서버를 깨우는 중" 표시(B6).
- 데모·사용자 평가 직전: `/health`를 먼저 호출해 워밍업한다.
- 시간 측정: 솔버 성능은 서버가 응답에 담는 `solve_ms`로 기록한다. 종단 응답 시간으로 비교하면 콜드 스타트가 섞인다.
- 상시 유지가 필요하면 유료 플랜 또는 주기적 핑을 검토한다 `[결정 필요]`. 핑은 평가 기간에만 사용한다.

### 7.2 Vercel (프론트)
- Root Directory `frontend`, 프레임워크 Vite(자동 감지), 빌드 `npm run build`, 출력 `dist`.
- 환경변수 `VITE_API_BASE_URL`: Production과 Preview에 설정. `VITE_` 접두사 변수는 클라이언트에 노출되므로 **비밀 값 금지**.
- 클라이언트 라우팅을 쓰므로 모든 경로를 `index.html`로 되돌리는 rewrite를 둔다.
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```
- Git 연동 시 PR마다 Preview URL이 생성된다. Preview 도메인은 배포마다 달라지므로 백엔드 CORS에서 `ALLOWED_ORIGIN_REGEX`로 **프로젝트 접두사에 한정**해 허용한다(`*.vercel.app` 전체 허용 금지). 정규식은 프로젝트 생성 후 실제 도메인으로 확정한다 `[확인 필요]`.
- Preview에 배포 보호가 켜져 있으면 외부 호출이 막힐 수 있으므로 설정을 확인한다.

### 7.3 환경변수 표
| 변수 | 위치 | 설명 |
|---|---|---|
| `PYTHON_VERSION` | Render | 완전한 버전 문자열 |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` | Render, 로컬 `.env` | 서버에서만 사용 |
| `ALLOWED_ORIGINS`, `ALLOWED_ORIGIN_REGEX` | Render | CORS |
| `SOLVER_TIME_LIMIT_S` | Render | 기본값은 D12 결과로 결정 |
| `MAX_INPUT_CHARS`, `DAILY_LLM_CALL_LIMIT` | Render | 비용·남용 방지 |
| `VITE_API_BASE_URL` | Vercel, 로컬 `.env` | 백엔드 주소(공개 값) |

---

## 8. 리포 구조

```
timetable-solver/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ api/            # catalog, profile, constraints, solve, explain
│  │  ├─ domain/         # models.py, constraints.py
│  │  ├─ core/           # config.py, time_slots.py, logging.py
│  │  ├─ catalog/        # loader.py, normalize.py, report.py
│  │  ├─ matching/       # entity.py
│  │  ├─ solver/         # model_builder.py, constraints/, diversify.py, diagnose.py, validator.py
│  │  └─ llm/            # provider.py, cache.py, parse_constraints.py, explain.py, prompts/
│  ├─ tests/ { unit, property, integration, fixtures }
│  ├─ requirements.txt, requirements-dev.txt
├─ frontend/ (src/{api,types,state,components/{Timetable,Chips,Diagnosis},pages})
├─ eval/ { nl2constraint, threeway, solver_bench }
├─ data/ { synthetic/, private/(gitignore), README.md }
├─ docs/ { PLAN.md, DEVELOPMENT_PLAN.md, API.md, labeling_guide.md, adr/ }
├─ .github/ { workflows/ci.yml, pull_request_template.md }
├─ render.yaml
└─ .env.example
```

---

## 9. 핵심 인터페이스

**API**
| 엔드포인트 | 요청 | 응답 |
|---|---|---|
| `GET /health` | — | `{status:"ok"}` |
| `POST /catalog/validate` | 파싱된 courses, sections | 정규화 카탈로그 + 오류 행 리포트 |
| `POST /constraints/parse` | `{text, catalog_summary}` | `{constraints[], ambiguities[], entity_candidates[]}` |
| `POST /solve` | `{catalog, profile, constraints, n, diversity_k, time_limit_s}` | SolveResult |
| `POST /explain` | SolveResult | `{candidate_explanations[], diagnosis_text}` |
| `POST /profile/parse` (fallback) | 동의 + 최소 열 | `{rows[], unmatched[]}` |

**SolveResult**
```json
{
  "status": "OPTIMAL | FEASIBLE | INFEASIBLE | UNKNOWN",
  "candidates": [{"sections": ["..."], "objective": 123,
                  "satisfied": ["c1"], "violated": [{"id":"c2","amount":2}]}],
  "diagnosis": {"core": ["c5","c1"],
                "relaxations": [{"drop":"c1","feasible":true,"objective_delta":-15}]},
  "stats": {"solve_ms": 480, "n_sections_after_filter": 212}
}
```

**제약 공통 필드**: `id, type, params, strength(hard|soft), weight(1–10), source_text`.

---

## 10. 솔버 지침

- 구성 순서: 변수(`x[s]`, `occ[d,t]`) → 구조 제약(과목당 1분반, 슬롯 충돌, 학점) → 사용자 hard 제약(literal + `only_enforce_if` + `add_assumptions`) → soft(슬랙/지시변수 + 목적함수) → top-N(no-good cut 반복).
- 구조 제약에는 assumption을 붙이지 않는다. 충돌 집합에는 사용자 제약만 나온다.
- 하루 공강 슬롯은 `first/last` 변수로 모델링한다. 검증기가 풀이 결과로 실제 gap을 다시 계산해 확인한다.
- `UNKNOWN`(시간 초과)은 `INFEASIBLE`과 구분해 응답한다.
- 평가·테스트에서는 재현성을 위해 워커 수 1, 시드 고정을 사용한다(파라미터 이름은 설치 버전에서 확인).
- 불가능 진단은 충분 집합이며 최소 집합이 아닐 수 있음을 문서화한다. 완화안은 개별 제약 해제 재풀이로 직접 검증한다.
- 환경 확인 결과: Python 3.13 + `ortools 9.15`에서 가정 기반 불가능 진단이 동작함을 확인했다(모순 가정 2개 → `INFEASIBLE` + 충돌 가정 2개 반환).

## 11. LLM 지침

- `generate_structured(prompt, schema, **opts) -> dict` 인터페이스, 온도 0, 타임아웃, 재시도 상한.
- 캐시 키 `(provider, model, prompt_version, input)`. 테스트·평가는 캐시를 사용하고, 끄는 플래그를 둔다.
- 프롬프트는 `prompts/v1.md`처럼 버전 파일로 관리하고 평가 결과에 버전을 기록한다.
- 설명 생성은 솔버 사실만 입력으로 받고, 후검증에 실패하면 템플릿으로 대체한다.
- 키는 서버 환경변수에만 둔다. 요청당 입력 길이 상한과 일일 호출 상한을 둔다. 선호 문장이 외부 LLM으로 전송됨을 UI에 고지한다.
- 이수내역은 결정론적 파서가 기본이다. LLM fallback은 동의 후 과목코드·과목명·학점 열만 전송한다.

## 12. 프론트 지침

- 목 API(MSW)로 화면 흐름을 먼저 완성한 뒤 실제 API로 전환한다.
- 서버 응답과 사용자 편집(칩)을 분리한다. "다시 풀기"를 눌렀을 때만 `/solve`를 호출한다.
- 칩에는 `source_text`를 표시한다. 시간표 블록에는 요일·시간·과목의 텍스트 대체를 둔다.
- 개인 데이터는 IndexedDB에만 저장하고 삭제 버튼을 제공한다.

## 13. 테스트 전략

- 단위: 시간 변환, 로더, 제약 모듈, 엔티티 매칭.
- Property(hypothesis): 임의 카탈로그·제약에서 솔버의 해는 항상 검증기 통과.
- Golden(LLM): 캐시된 응답으로 대표 문장의 제약 JSON을 고정 비교. 프롬프트 버전 변경 시 diff 리뷰.
- 통합: FastAPI TestClient로 `/solve` 전 경로.
- 프론트: vitest(그리드 충돌, 칩 상태), 스모크 e2e 1개.
- CI: LLM 실호출 없이 캐시로 실행. 실호출 테스트는 수동 마커로 분리.

---

## 14. 완료 정의 (GD3)

- [ ] 합성 카탈로그(50/200/500)와 이수내역으로 end-to-end 동작
- [ ] 후보의 hard 제약 위반이 독립 검증기 기준 0 (property test 통과)
- [ ] 불가능 조건에서 충돌 제약과 완화안 2개 이상 제시
- [ ] 설명 문장이 후검증을 통과하거나 템플릿으로 대체됨
- [ ] NL 평가와 3-way 비교 결과가 `eval/`에서 재현 가능
- [ ] Vercel 프로덕션에서 Render 프로덕션을 호출해 데모 시나리오 전체 동작
- [ ] README, AI 활용 내역, 데이터 카드 정리
- [ ] 실데이터가 저장소 이력에 포함되지 않았음을 확인

## 15. 리스크

| 리스크 | 대응 |
|---|---|
| Render 무료 플랜 콜드 스타트 | 첫 호출 안내 UI, 데모·평가 직전 워밍업, `solve_ms`는 서버 측 측정 |
| Python 버전 불일치(로컬 3.13 vs Render 기본) | `PYTHON_VERSION`을 완전한 버전으로 고정, CI도 같은 버전 사용 |
| Preview 도메인 CORS | 프로젝트 접두사에 한정한 정규식, 확정 후 갱신 |
| 실데이터 미확보 | 합성으로 진행, 어댑터 구조 유지, 한계 명시 |
| 실데이터 유출 | `data/private/` ignore, secret scanning, 커밋 전 점검 체크리스트 |
| LLM 비결정성·비용 | 온도 0, 캐시, 입력·호출 상한 |
| gap/연강 모델링 성능 | 사전 필터링, 타임리밋, 슬롯 해상도 설정화, D12 벤치로 조기 확인 |
| 평가셋 편향 | 지인 작성분 포함, 재라벨링 일치도 보고, 한계 명시 |

## 16. 결정 필요

1. 저장소 소유자(개인 계정 vs 조직)와 공개 범위 (기본 private).
2. 한동 개설강좌 확보 경로와 사용 허가 여부.
3. LLM provider와 키 (기본 Gemini).
4. Render 플랜 (무료 vs 유료/핑).
5. 서비스명 확정.

---

## 부록 A. 선호 문장 → 제약 예시

입력: "금요일엔 수업 없었으면 좋겠고, 아침 9시 수업은 절대 싫어. 전공은 12학점 이상. 점심은 꼭 비워줘."
```json
[
 {"id":"c1","type":"day_off","params":{"days":["Fri"]},"strength":"soft","weight":7,
  "source_text":"금요일엔 수업 없었으면 좋겠고"},
 {"id":"c2","type":"time_avoid","params":{"days":["Mon","Tue","Wed","Thu","Fri"],"start":"09:00","end":"10:00"},
  "strength":"hard","weight":10,"source_text":"아침 9시 수업은 절대 싫어"},
 {"id":"c3","type":"category_min","params":{"category":"전공","credits":12},
  "strength":"hard","weight":10,"source_text":"전공은 12학점 이상"},
 {"id":"c4","type":"lunch_free","params":{"start":"12:00","end":"13:00","min_free_minutes":60},
  "strength":"hard","weight":10,"source_text":"점심은 꼭 비워줘"}
]
```

## 부록 B. 근거 자료

- Render 무료 웹 서비스 스핀다운: https://render.com/docs/free
- Render Python 버전 설정: https://render.com/docs/python-version
- Render FastAPI 배포: https://render.com/docs/deploy-fastapi
- Vercel Vite 가이드: https://vercel.com/docs/frameworks/frontend/vite
- Vercel 모노레포: https://vercel.com/docs/monorepos
