# 0006. 자연어 해석 provider: Gemini Interactions API(REST) + fixture 데모 해석기

- 상태: 채택 (2026-11-09, 실제 키로 live 호출 검증)
- 관련 코드: `services/api/app/llm/gemini.py`, `app/llm/fixture.py`, `app/application/parse.py`
- 관련 명세: `docs/02-architecture.md` §5, §7, §9

## 결정

1. LLM은 선호 문장을 **제약 초안**으로 바꾸는 데만 쓴다. 분반 선택은 CP-SAT, 확정은 사용자 확인 단계가 한다.
2. provider는 환경 변수로 고른다.
   - `LLM_PROVIDER=gemini` + `GEMINI_API_KEY` + `LLM_MODEL`이 모두 있으면 live(`GeminiProvider`).
   - 아니면 `ENABLE_DEMO_FIXTURES=1`(기본)일 때 규칙 기반 `FixtureProvider`(UI에 "데모 해석" 표시).
   - 둘 다 아니면 `/constraints/parse`는 503 `PARSER_UNAVAILABLE`, 수동 입력은 그대로 사용.
3. SDK를 쓰지 않고 `httpx`로 REST를 직접 호출한다(의존성 최소화, mock transport로 오류 경로 테스트).
4. 모델 ID는 코드에 하드코딩하지 않고 `LLM_MODEL`로만 주입한다. 유료 모델로 자동 전환하지 않는다.

## 호출 형식 (현재 구현)

```text
POST https://generativelanguage.googleapis.com/v1beta/interactions
headers: x-goog-api-key: <GEMINI_API_KEY>, Api-Revision: 2026-05-20, Content-Type: application/json
body: {
  model: <LLM_MODEL>,
  input: "[카탈로그 엔티티: 데이터]\n<JSON>\n\n[사용자 선호 문장: 데이터]\n<text>",
  system_instruction: <서비스 내부 프롬프트, docs/02 §5.4 기반>,
  response_format: { type: "text", mime_type: "application/json", schema: RESPONSE_SCHEMA }
}
응답: status == "completed" → steps[] 중 type=="model_output"의 content[].text를 JSON으로 파싱
```

- `status: incomplete` → `TRUNCATED`, `failed|cancelled` → `REFUSED`, 그 밖 → `BAD_RESPONSE`.
- JSON 파싱 실패를 느슨한 문자열 추출로 억지 성공 처리하지 않는다.
- 재시도: 같은 16초 총 deadline 안에서 최대 1회(타임아웃·429·5xx). 그 밖 4xx는 즉시 실패.
- HTTP 매핑: TIMEOUT→504, RATE_LIMITED→429, 그 밖→502 (`LLM_<code>`). 오류 메시지에 키·원문을 넣지 않는다.

## 출력 검증 경계

`provider DTO → GeminiProvider._read → application/parse.build_response(_check_draft)`.

- type별 params 키만 남기고, 누락·null인 필수 키는 null로 유지해 `unresolved_fields`로 표시한다
  (2026-11-09 수정: 이전에는 null 키를 지워 미해결 초안이 해결된 것처럼 보였다. 회귀 테스트 `test_gemini_null_required_param_stays_unresolved`).
- 카탈로그에 없는 ID, 범위 밖 값, 미지원 type은 초안을 거절하고 `unsupported_requests`에 이유와 함께 드러낸다.
- 모델의 자유 질문은 선택지 없는 질문(`field="free"`)으로 전달하고 UI가 그대로 보여 준다.

## 전송 데이터

- 보냄: 선호 문장, 카탈로그 과목 ID·이름·분류, 교수 ID·이름·담당 과목, 분류 그룹, 기존 조건의 ID·type·표시 라벨.
- 보내지 않음: 이수내역(원문·정규화 결과 모두), 성적·학번, 허용 분반 목록, 키(헤더로만 Google에 전송).
- 서버 로그에는 요청 ID·경로·상태·시간·크기만 남긴다. 2026-11-09 live 검증 후 서버 로그에 키 문자열이 없음을 확인했다.

## 2026-11-09 확인 사항

- `GET /v1beta/models/gemini-3.5-flash-lite` → 200 (`Gemini 3.5 Flash Lite`, version `3.5-flash-lite-07-2026`).
- 가격 페이지(<https://aistudio.google.com/docs/pricing>, 2026-11-09 조회): Gemini 3.5 Flash-Lite는 Standard 무료 등급에서 입력·출력 "Free of charge"이며,
  무료 등급 데이터는 "Used to improve our products: Yes". 사용자의 프로젝트가 실제로 무료 등급인지(결제 연결 여부)는 이 앱에서 확인할 수 없다.
- 합성 샘플 카탈로그로 live 호출 4건: 모두 HTTP 200, `provider_mode=live`, 화면 배지 "Gemini 해석"(데모 배지·문구 없음), 응답 4.0~5.5초.
- 잘못된 키로 실제 호출: Google 400 → API 502 `LLM_HTTP_ERROR`, 수동 입력 안내 유지.

## 알려진 한계

- live 모델이 명세 §5.2 강도 정책과 다르게 제안할 수 있다(관찰: "전공 12학점 이상" → soft, "아침 수업은 싫어" → 질문 대신 미지원).
  초안은 사용자 확인 없이 적용되지 않으며 칩에서 강도를 바꿀 수 있다. 평가셋 기반 정확도 측정은 미실시.
- `Api-Revision` 값과 Interactions 응답 형식이 바뀌면 `_read`가 `BAD_RESPONSE`로 실패한다(조용한 성공 없음). 변경 시 이 문서와 테스트를 갱신한다.
