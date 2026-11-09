# 선별 통합 기록 (origin/main → feat/timetable-integration)

- 날짜: 2026-11-09 · 기준: `docs/MAIN_COMPARISON.md`(main 72ef34e)와 사용자 결정
- 방식: **main 전체 merge 없음.** 아이디어·설계만 선별해 현재 구조(`services/api` + `apps/web`)에 다시 구현했다. main 코드 파일을 복사하지 않았다.
- 브랜치: `feat/timetable-mvp`의 체크포인트 커밋 `a294ccb`에서 `feat/timetable-integration` 생성. 원격 push·main 병합·rebase 없음.

## 1. main에서 가져온 것

| 항목 | main 근거 | 현재 구현 | 검증 |
|---|---|---|---|
| 분반별 학점·이수구분 | `backend/app/domain/models.py` Section.credit/category override, `Catalog.credit_and_category` | 계약 `Section.credit_units/category_ids`(선택, null=상속), 유효값 규칙, 어댑터 보존, 내 전공 분반 단위 적용 — `docs/decisions/0008-section-level-credit-category.md` | `services/api/tests/test_section_overrides.py` 10개(oracle 대조 포함), 프론트 단위·E2E |
| 엔티티 후보 축소(서버 측 매칭) | `backend/app/llm/entities.py`(difflib 매칭) | `services/api/app/llm/entities.py` — 정확한 과목 코드 일치 최우선, 이름 포함·bigram 겹침으로 재현율 우선, 교수→담당 과목 확장, 150과목 이하는 축소 안 함. **보내는 목록에만 적용**, ID 검증은 전체 목록 | `services/api/tests/test_entities.py` 9개: 모든 과목 이름·코드·교수 전수 재현, 동명이인 둘 다 유지, 규칙 해석기 결과의 상위집합, 실제 축소, 축소 후에도 없는 ID 거절 |
| Windows 인코딩·줄바꿈 교훈 | main 테스트 실패 원인(§6.1) | `.gitattributes`(LF 고정, `*.xls`/`*.png` binary), subprocess 출력 UTF-8 명시 | 백엔드 Python 3.12·3.13에서 `PYTHONUTF8` 없이 통과 |
| CI 아이디어 | main `.github/workflows` | `.github/workflows/ci.yml` — 현재 구조 기준(백엔드 Ubuntu/Windows × 3.12/3.13, 계약 드리프트, 프론트 Ubuntu/Windows, E2E) | **로컬에서 실행 불가 — GitHub에서 미실행**. YAML 구조만 확인 |

## 2. 현재 구현을 유지한 것

API 계약(정수 분·credit_units·strict·revision/확인·stale 차단), 폴더 구조, UI, 솔버 프로세스 격리, OR-Tools 독립 검증기, 수정안 재풀이·재검증, 이진 soft 목적함수, 사용자 제공 교시표(요일별, 수요일 1~3교시 별도, 교시별 구간, 토·일 없음), fixture 데모 해석기, REST Interactions Gemini 어댑터와 `GEMINI_API_KEY`, 이수내역 로컬 처리.

- 교시표: main의 학점별 수업 길이(3학점 75분/그 외 50분)·연속 교시 병합·토요일 평일 시각은 **가져오지 않았다**(근거 부족). 사용자 표는 "변경 후" 기준이라는 사용자 확인만 있고, **적용 학기 범위와 예외(실습·계절학기 등)는 미확인**이다.

## 3. 이번에 제외한 것

`/profile/parse`와 이수내역의 서버·LLM 전송, 서버 디스크 LLM 응답 캐시, main 솔버 전체 교체, 점심·최장 공강·연강(의미 차이: `docs/evidence/main_p1_semantics_counterexamples.py`), 관심 과목 pool, `/explain`, Supabase, render/vercel 배포, eval 하네스, main의 데이터 카드 파일 해시.

## 4. 해시의 목적과 기준

| 해시 | 목적 | 입력 | 줄바꿈 영향 |
|---|---|---|---|
| `catalog_revision` | 확인한 조건이 어떤 카탈로그 **내용**에 대한 것인지 식별, 서버가 재계산해 대조 | 서버가 검증·정규화한 Catalog 모델의 정렬 JSON(분반 선택 필드가 null이면 제외) | 없음 — 파일 바이트가 아니라 모델을 해시. LF/CRLF/BOM 같은 CSV가 같은 Catalog가 되는 것을 테스트(`adapter.test.ts`) |
| `request_hash` | 같은 문제(카탈로그·허용 분반·조건)의 진단·수정안 대조 | revision + 정렬된 허용 분반 + 조건 JSON | 없음 |
| (main) 데이터 카드 파일 해시 | 데이터 파일 출처·변경 감지 | 파일 바이트 | 있음 — main 실패의 원인. **도입하지 않음.** 도입한다면 기준은 git blob(LF, `.gitattributes`로 고정) 바이트이며, 기대 해시를 바꿔 통과시키지 않는다 |

## 5. 호환성

- 기존 클라이언트·카탈로그 JSON(새 필드 없음): 그대로 유효, revision 동일.
- 브라우저 저장: `profile.v1`(정규화 이수내역)만 저장 — 모델 변경과 무관. 카탈로그·조건 초안은 저장하지 않아 마이그레이션 대상 없음(매 세션 다시 가져오기).
- 이전 버전 백엔드는 새 필드를 거절(strict)하므로 프론트·백엔드를 같이 배포해야 한다(현재 로컬 실행만).

## 6. 남은 미확인

- 교시표 적용 학기·예외 규칙, 토요일 교시, 시간 미정 153분반의 실제 수업방식, 내 전공 인정 규칙, 분반별 이수구분의 학교 인정 방식(데이터는 보존하되 해석은 학교 확인 필요).
- 엔티티 축소의 실데이터 효과(Gemini 호출 없이 `select_entities`만 로컬 실행, 결과 수치만 기록): 과목 518·교수 242 기준, 과목 이름/코드 문장 1,036개와 교수 문장 242개에서 **정답 누락 0건**. 문장당 보내는 과목 수 중앙값 1, 95% 16, 최대 26(전체 518 대신). 과목명이 없는 문장(공강·등교일·시간대)은 과목·교수를 보내지 않는다.
- 축소 후 실제 Gemini 3회(2026-11-09 최종 검증): 보낸 과목 1·8·1개, 정답 과목은 3회 모두 목록에 포함. 교수 분반 제한 누락은 축소가 아니라 교수 `section_ids` 미전송 때문(기존 결함). 3회는 표본 확인일 뿐 정확도 평가가 아니다.
