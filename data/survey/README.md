# survey/

- `survey_form.md`: 구글 폼 문안(동의·사전 설문·선호 문장).
- `responses_template.csv`: 응답 시트 열 정의(헤더만). **응답 원본은 `data/private/survey_raw/`에만**.

| 열 | 문항 | 값 |
|---|---|---|
| response_id | – | `r001`… 무작위 재부여 |
| consent_collect | Q0-1 | `yes` (no면 행 삭제) |
| consent_public_example | Q0-2 | `yes` / `no` |
| grade | Q1-1 | `1`/`2`/`3`/`4+`/`na` |
| time_spent | Q1-2 | `<30m`/`30m-1h`/`1-2h`/`2-4h`/`4h+`/`unknown` |
| pain_points | Q1-3 | 선택지 `;` 구분 |
| tools | Q1-4 | 선택지 `;` 구분 |
| chatbot_experience | Q1-5 | 자유 텍스트 |
| tool_intent | Q1-6 | 1–5 |
| pref_1 … pref_5 | Q2-1…Q2-5 | 선호 문장(라벨링 입력) |
| strength_note | Q2-6 | 자유 텍스트 |
| wishes | Q3-1 | 자유 텍스트 |
