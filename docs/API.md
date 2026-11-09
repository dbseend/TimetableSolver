# API 계약 (스텁 단계)

원본: `backend/openapi.json` (코드에서 생성). 모든 오류는 `{"error": {"code", "message", "details?"}}`.

| Method | Path | 상태 | 설명 |
|---|---|---|---|
| GET | /health | 동작 | `{status, version}` |
| POST | /catalog/validate | 501 | 카탈로그 검증, 행 단위 오류 |
| POST | /profile/parse | 501 | 이수내역 LLM 폴백 파싱. `consent: true` 필수, 최소 컬럼 |
| POST | /constraints/parse | 501 | 자연어 → 제약 JSON. 길이 > `MAX_INPUT_CHARS` → 422 `input_too_long` |
| POST | /solve | 501 | 후보 N개, 진단. 제약 id 중복 불가 |
| POST | /explain | 501 | 결과 설명. 요청에 catalog + constraints + result 포함 |

## 오류 코드
`validation_error`(422, loc/msg/type만 반환·입력값 에코 없음), `input_too_long`(422), `not_found`(404), `method_not_allowed`(405), `not_implemented`(501), `internal_error`(500).

## 제약 타입 (13)
credit_range, must_include, must_exclude, day_off, time_avoid, time_prefer, max_gap, lunch_free, max_consecutive, max_days_on_campus, category_min, instructor_avoid, instructor_prefer.
공통: `id`, `strength`(hard|soft), `weight`(1–10, 기본 5), `source_text`. 알 수 없는 필드는 거부.

## 시간 격자
월–금, 08:00–22:00, 30분 슬롯 28개. 시작은 내림, 종료는 올림.
