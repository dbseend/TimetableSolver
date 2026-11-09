# Phase D 설계 (구현)

작성 2026-11-09. 기준: `docs/DEVELOPMENT_PLAN.md` D 섹션, `docs/PLAN.md` §8, Phase C 결과(PR #1).
이 문서는 D 섹션을 **실데이터와 스파이크 결과에 맞게 고친 실행 설계**다. 충돌하면 이 문서가 우선한다.

## 0. Phase C 이후 바뀐 전제

| 항목 | 원래 계획 | 현재 |
|---|---|---|
| 개설강좌 | 사용자가 매번 업로드 | 2026-2 전체(819분반)를 **Supabase에 적재**, 학기 선택으로 사용. 업로드는 보조 |
| 저장소 | 서버 stateless, 클라이언트 IndexedDB | **Supabase(Postgres)** 도입 — 공개 카탈로그 + 동의된 익명 로그. 이수내역은 계속 로컬(ADR 0002 유지) |
| 이수내역(C4) | 파서 + 확인 화면 | **범위 제외**. `Profile`은 빈 값 기본. 이수 과목은 UI에서 수동 체크(선택) |
| 설문(C8) | 설문 100문장으로 평가 | **범위 제외**. NL 평가셋은 작성자 문장만 → 평가 결과에 "작성자 문장, 일반화 한계" 명시 |
| 선수과목 | 사전 필터 | 실데이터에 선수과목 열 없음 → 필터 코드만 두고 데이터 없음 |
| 시간 | 30분 슬롯 | 실데이터는 **교시 정렬**(09:00 + 90분 간격, 75/50분). §2 DD3 참고 |

## 1. 스파이크 결과 (실데이터 819분반, OR-Tools 9.15, 커밋 안 함)

| 실험 | 결과 | 의미 |
|---|---|---|
| 전체 카탈로그, 학점 15–18 최대화 | OPTIMAL **24ms** | 성능 걱정 없음. 시간 제한 5s는 넉넉 |
| top-3 + no-good cut(k=2) | 각 20ms | 다양성 순차 풀이 가능 |
| 단일 분반 필수 과목 2개 겹침 + 방해 제약 3개 | INFEASIBLE 26ms, core = `[m1, m2]` | assumption core가 정확. `num_workers=1`에서 사용 |
| **학점만으로 선택** | 18학점을 **12–16개 분반**(0·1학점 과목 다수)으로 채움 | **관심 과목 풀이 없으면 결과가 무의미** → DD1 |
| 연속 2교시(09:00–10:15, 10:30–11:45)를 30분 슬롯으로 | 180분 연속으로 계산(실제 수업 150분) | "연강 2시간 반까지 괜찮아"가 오판 → DD3 |

## 2. 핵심 설계 결정

### DD1. 관심 과목 풀 (API 변경) — **결정: 도입 (2026-11-09)**
솔버는 "어떤 과목을 들을지"가 아니라 "**관심 과목 중 무엇을, 어느 분반으로**"를 고른다.
- `SolveRequest.pool: list[PoolItem]`, `PoolItem = {course_id, priority: 1–5 (기본 3)}`. 최소 1개.
- `must_include` 과목은 자동으로 풀에 포함. 풀 밖 과목은 후보가 아니다.
- 목적함수에 우선순위 보상 항 추가: 선택된 과목마다 `priority × P_PRI`.
- UI: 데이터 준비 화면에서 과목 검색 → 장바구니(풀). 우선순위는 별 1–5.
- 계약 반영 완료: `SolveRequest.pool`(최소 1개, 과목 중복 금지, 카탈로그에 없는 과목이면 422). `must_include` 대상이 카탈로그에 없으면 422가 아니라 진단(INFEASIBLE)으로 보고한다.
- 기각한 대안: 풀 없이 전체 카탈로그에서 카테고리·학점만으로 선택 → 스파이크처럼 무의미한 조합.

### DD2. 학점은 ×2 정수
`credit_and_category(section)`으로 읽고 `round(credit*2)`로 모델에 넣는다. `credit_range`, `category_min`의 경계도 ×2. 결과 보고 시 ÷2.

### DD3. 시간 표현: 정확한 분 구간 + 교시 점유 (30분 슬롯 대체)
- **충돌**: 분 단위 구간으로 정확히 판정. 같은 요일의 각 meeting 시작 시각마다 "그 시각을 덮는 meeting 집합"을 하나의 `add_at_most_one`으로 만든다(구간 그래프의 모든 겹침은 늦게 시작한 쪽 시작점에서 잡힌다). 슬롯 반올림 오차 0.
- **time_avoid / time_prefer / day_off**: 분반별로 겹치는 분을 미리 계산(상수) → 선형 항.
- **연강·공강·점심**: 요일×교시 점유 `p[k,n]`(1–10교시, 토요일 포함). 교시 정렬이 아닌 meeting은 겹치는 교시를 모두 점유(보수적).
  - `max_consecutive(M분)` → 허용 연속 교시 `R = floor(M/75)` (150→2, 180→2, 225→3). 50분(2학점) 교시도 75분으로 세므로 2학점 3연강(150분)은 보수적으로 위반 처리된다.
  - `max_gap(M분)` → 허용 연속 빈 교시 `g = floor((M−15)/90)` (빈 교시 1개 = 공강 105분).
  - `lunch_free(window, F)` → 창과 겹치는 교시 집합에서 비어야 하는 교시 수로 환산(12:00–13:00, 60분 → 3교시 비움).
- `time_slots.meeting_slots`(30분)는 **UI 그리드 표시용**으로만 남긴다.
- 합성 생성기의 교시 비정렬 시각(13:00, 14:00, 16:00 시작)은 교시 정렬로 바꾼다(C6 재생성, 해시 갱신).

### DD4. hard는 assumption literal, 기본 제약은 항상
- 항상: 과목당 ≤1분반, 시간 충돌 없음, 풀 밖 과목 0.
- 사용자 hard 제약마다 `a_i`를 만들고 `only_enforce_if(a_i)` + `add_assumptions`.
- 진단(INFEASIBLE): `num_workers=1`로 다시 풀어 `sufficient_assumptions_for_infeasibility()` → `Diagnosis.core`. 최소성은 보장하지 않음(충분 집합).
- 완화안(D21): core의 각 제약을 하나씩 끄고 재풀이 → `Relaxation{drop, feasible, objective_delta}`. core 크기 ≤ 5일 때만, 전체 시간 제한 안에서.

### DD5. 목적함수 스케일
`max Σ_course priority·100·sel − Σ_soft w_j·v_j·S_type + Σ_soft w_j·100·u_j`
- `v_j`: 위반량을 타입별 정규 단위로(`S_type` 표). `u_j`: 보상형 제약(must_include soft, time_prefer, instructor_prefer) 충족.
- 정수 계수만 사용. 가중치 1–10 그대로.

| 타입 | soft 위반/보상 단위 | S_type |
|---|---|---|
| credit_range | 범위 밖 반학점 수 | 50 |
| day_off | 수업 있는 금지 요일 수 | 100 |
| time_avoid | 창과 겹치는 수업 분 / 15 | 10 |
| time_prefer | 창 안 수업 분 / 15 (보상) | 10 |
| max_gap | 허용 초과 빈 교시 수 | 60 |
| lunch_free | 점심 창에 수업 있는 날 수 | 100 |
| max_consecutive | 허용 초과 연속 교시 수 | 60 |
| max_days_on_campus | 초과 등교일 수 | 100 |
| category_min | 부족 반학점 수 | 50 |
| must_include / must_exclude | 위반 1/0 | 100 |
| instructor_avoid / prefer | 해당 교수 분반 수 | 100 |

`S_type`는 D19에서 C7 시나리오·시드 문장으로 튜닝하고 표를 갱신한다.

### DD6. 후보 다양성
top-N 순차 풀이. 해 `S*`마다 `Σ_{s∈S*} x_s ≤ |S*| − k` (`diversity_k`, 기본 1). 시간 제한은 후보 수로 나눠 배분.

### DD7. Supabase 역할 (ADR 0005 신규)
| 저장 | 테이블 | 접근 |
|---|---|---|
| 개설강좌(공개 정보) | `semesters`, `courses`, `sections`, `meetings` | 백엔드만 읽기. 적재는 관리자 CLI(service role) |
| 실험·평가 로그(동의 시) | `solve_logs`(solve_ms, status, n_sections, 제약 타입 개수 — **문장 원문 없음**) | 백엔드만 쓰기 |
| 이수내역·선호 문장 원문 | **저장 안 함** | ADR 0002 유지 |
| 저장된 시간표(선택, P2) | `saved_timetables` + Supabase Auth | 사용자 본인만(RLS) |

- 프론트는 Supabase에 직접 붙지 않는다. 계약은 지금처럼 FastAPI 하나(`openapi.json`).
- 백엔드 env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(서버 전용). 없으면 DB 기능만 꺼지고 업로드 경로로 동작(LLM과 같은 패턴).
- 스키마는 `supabase/migrations/*.sql`로 레포에서 관리. 모든 테이블 RLS 활성, anon 정책 없음(백엔드가 service role로 접근).
- 접근 라이브러리: `httpx`(이미 의존성)로 PostgREST 호출 → 의존성 추가 없음. 복잡해지면 `supabase-py` 검토.
- 새 API: `GET /semesters`, `GET /catalog?semester=2026-2`(캐시 헤더). `POST /catalog/import`(관리자, 토큰 필요)는 CLI로 대체 가능하면 만들지 않는다.
- **확인 필요**: 학교 개설강좌를 외부 DB에 올려 서비스하는 것이 학교 정책상 괜찮은지(C2와 같은 질문). 결론 전에는 DB를 비공개로 두고 데모용으로만 쓴다.
- 무료 플랜은 7일 비활성 시 일시정지 → 데모 전 확인 항목에 추가.

### DD8. LLM (Gemini)
- `google-genai` SDK 추가. `response_mime_type="application/json"` + 스키마.
- **위험**: pydantic 스키마의 `$defs`·판별 유니온을 Gemini가 그대로 받지 못할 수 있음 → D13 첫 작업으로 스파이크. 안 되면 LLM용 평탄 스키마(`type` enum + 모든 params 필드 optional)로 받고 서버에서 `constraints_adapter`로 재검증.
- 재시도 최대 2회(검증 오류 메시지 포함). 디스크 캐시 키 = `sha256(model, prompt_version, text, catalog_summary)`, `**/llm_cache/`(gitignore).
- `DAILY_LLM_CALL_LIMIT` 카운터는 Supabase 없이 프로세스 메모리(재시작 시 초기화, 무료 플랜 규모에 충분). shortcut 주석으로 표시.

### DD9. 엔티티 매칭
정확 일치 → 정규화(공백·괄호 영문 제거) 일치 → `difflib.SequenceMatcher` ≥ 0.6. 후보 2개 이상 또는 최고점 < 0.85면 자동 확정하지 않고 `entity_candidates` 반환. 임베딩은 하지 않는다(의존성·비용 대비 이득 작음).

## 3. 모듈 구조

```
backend/app/
  solver/
    prepare.py        # 풀·필터·분반별 상수(학점×2, 교시 점유, 창 겹침 분) 계산
    model.py          # CP-SAT 변수·기본 제약·목적함수 조립
    constraints/      # 타입별 1파일: encode_hard(ctx, c, lit), encode_soft(ctx, c) -> 항
    solve.py          # top-N, 진단, 완화안, SolveResult 조립
  validation/
    validator.py      # 솔버를 import하지 않는 순수 Python 판정기 (C7 테스트 검사기를 승격)
  catalog/
    repository.py     # Supabase 읽기/쓰기 (httpx)
  llm/
    provider.py  cache.py  parse_constraints.py  explain.py
  matching/
    entities.py
  loaders/hisnet.py   # (기존)
supabase/migrations/0001_catalog.sql, 0002_logs.sql
backend/scripts/load_catalog.py   # data/private/*.json -> Supabase (관리자)
frontend/src/
  components/ TimetableGrid, CoursePicker(풀), ConstraintChip, CandidateCard, DiagnosisPanel
  api/ (생성 타입 기반 클라이언트)  mocks/ (MSW)
```

## 4. API 변경 요약 (D 진행 중 계약 갱신, `openapi.json`·`api.d.ts` 재생성)

| 변경 | 내용 |
|---|---|
| 추가 | `GET /semesters`, `GET /catalog?semester=` |
| 변경 | `SolveRequest.pool` 필수 (**반영됨**). `catalog` 대신 `semester`로 지정하는 방식은 D-a에서 추가 |
| 변경 | `SolveResult.candidates[].total_credits`(number), `Candidate.objective_breakdown`(선택) |
| 유지 | `/constraints/parse`, `/explain`, `/catalog/validate` |

## 5. 검증 전략

1. **독립 검증기** `validation/validator.py`: 분 단위 구간으로 hard 위반·soft 위반량을 계산. 솔버 코드 import 금지(테스트로 강제: 모듈 import 그래프 검사).
2. **C7 시나리오**: 솔버 status = INFEASIBLE, `expected_conflict_ids ⊆ core`.
3. **property test**(hypothesis, 이미 dev 의존성): 랜덤 소형 카탈로그·제약 → 솔버 해는 검증기 위반 0, soft 위반량 일치.
4. **실데이터 스모크**: `data/private/` 카탈로그가 있으면 실행, 없으면 skip(CI는 합성만).
5. **LLM 골든**: 캐시된 응답으로 시드 40문장 결과 고정 비교(네트워크 없이 CI 통과).
6. **벤치마크**: 합성 50/200/500 + 실데이터 p50/p95를 `docs/bench.md`에 기록.

## 6. 마일스톤 (PR 단위)

| PR | 범위 | 게이트 |
|---|---|---|
| D-a | Supabase 스키마·적재 CLI·`GET /semesters,/catalog`, ADR 0005 | 2026-2 카탈로그를 API로 조회 |
| D-b | MSW 목 + 시간표 그리드 + 과목 풀 선택 UI + 수동 분반 선택 충돌 표시 | **GD1-a**: 학기 선택 → 풀 담기 → 수동 충돌 확인 |
| D-c | solver hard(기본 + 13타입 hard) + validator + property test + C7 | **GD1-b**: JSON 제약으로 후보 3개, 위반 0, C7 core 일치 |
| D-d | `/solve` 연결 + 후보 카드 UI + 진단 패널(완화안 포함) | 실데이터로 end-to-end |
| D-e | Gemini 스키마 스파이크 → `/constraints/parse` + 캐시 + 엔티티 매칭 + 칩 UI | **GD2**: 문장 → 칩 → 후보 |
| D-f | soft 목적함수 튜닝 + 충족도 리포트 + `/explain`(후검증) | 시드 문장 soft 결과 수동 점검 |
| D-g | 평가 하네스(NL P/R/F1, 3-way 비교, 벤치) + 동의 로그 | 결과 리포트 초안 |

솔버(D-c)와 UI(D-b)는 서로 독립이라 병렬 가능. D-a는 D-b의 학기 선택에만 필요하므로 D-b는 목 데이터로 먼저 시작할 수 있다.

**범위 축소 순서**(막힐 때): 저장된 시간표(P2) → 완화안 재풀이 → `/explain` LLM(템플릿만) → 3-way의 (B). **검증기·property test·칩 UI는 끝까지 유지.**

## 7. 위험

| 위험 | 대응 |
|---|---|
| 풀(DD1) 없이는 결과가 무의미 | 계약 확정·반영 완료 |
| Gemini가 판별 유니온 스키마를 거부 | D-e 첫날 스파이크, 평탄 스키마 대안 |
| 학교 데이터 외부 DB 게시 정책 | 확인 전 비공개·데모 한정 |
| Supabase 무료 일시정지, Render 콜드 스타트 | 데모 전 워밍 체크리스트 |
| 1·0·4학점 수업 길이 가정 | 실데이터 확인 시 `period_len`만 수정 |
| NL 평가셋이 작성자 문장뿐 | 보고서에 한계 명시, 가능하면 지인 몇 명 문장만 추가 |

## 8. 결정 필요

1. 학교 개설강좌를 Supabase에 올려 서비스해도 되는지(정책 확인).
2. Supabase 프로젝트 생성 주체·리전(서울 `ap-northeast-2` 권장)과 무료/유료.
3. 마감일 — 마일스톤 일정 배치용.
