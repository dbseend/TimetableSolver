# API 계약 (스텁 단계)

원본: `backend/openapi.json` (코드에서 생성). 모든 오류는 `{"error": {"code", "message", "details?"}}`.

| Method | Path | 상태 | 설명 |
|---|---|---|---|
| GET | /health | 동작 | `{status, version}` |
| POST | /catalog/validate | 501 | 카탈로그 검증, 행 단위 오류 |
| POST | /profile/parse | 501 | 이수내역 LLM 폴백 파싱. `consent: true` 필수, 최소 컬럼 |
| POST | /constraints/parse | 동작 | 자연어 → 제약 JSON + 모호성 + 엔티티 후보. 길이 > `MAX_INPUT_CHARS` → 422 `input_too_long`. LLM 꺼짐 503 `llm_disabled`, 한도 429 `llm_daily_limit`/`llm_rate_limited`, 실패 502 `llm_unavailable`/`llm_invalid_output` |
| POST | /solve | 동작 | 후보 N개, 불가능 시 최소 충돌 집합 + 완화안. 제약 id 중복 불가. 시간 제한은 `SOLVER_TIME_LIMIT_S`로 상한 |
| POST | /explain | 501 | 결과 설명. 요청에 catalog + constraints + result 포함 |

## 오류 코드
`validation_error`(422, loc/msg/type만 반환·입력값 에코 없음), `input_too_long`(422), `not_found`(404), `method_not_allowed`(405), `not_implemented`(501), `internal_error`(500).

## 제약 타입 (13)
credit_range, must_include, must_exclude, day_off, time_avoid, time_prefer, max_gap, lunch_free, max_consecutive, max_days_on_campus, category_min, instructor_avoid, instructor_prefer.
공통: `id`, `strength`(hard|soft), `weight`(1–10, 기본 5), `source_text`. 알 수 없는 필드는 거부.

## 시간 격자
월–토, 08:00–24:00, 30분 슬롯 32개. 시작은 내림, 종료는 올림. (2026-2 실데이터: 1교시 09:00, 10교시 22:30–23:45, 토요일 수업 있음)

## 카탈로그 값
- `Course.credit`: 0–10, 0.5 단위 (0.5학점 과목 존재). 솔버는 ×2 정수로 다룬다.
- `Section.credit`, `Section.category`: 같은 과목인데 분반마다 다른 경우의 덮어쓰기. `null`이면 과목 값. 유효값은 `Catalog.credit_and_category(section)`.
- `max_days_on_campus.max_days`: 0–6.

## /solve 요청
- `pool`: 관심 과목 `[{course_id, priority 1–5(기본 3)}]`, 최소 1개, 중복·미등록 과목이면 422. 솔버는 풀(+`must_include` 대상) 안에서만 과목을 고른다. 설계: `docs/PHASE_D_DESIGN.md` DD1.
