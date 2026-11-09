# 라벨링 가이드 (C10)

선호 문장 → 정답 제약 JSON을 사람이 만들 때의 기준. 스키마는 `backend/app/domain/constraints.py`(13개 타입)가 원본이다.

> **시드 라벨(`data/eval/seed_labels.jsonl`, `"source":"author"`)은 개발용이다. 평가셋이 아니다.**
> 작성자가 스키마를 알고 쓴 문장이라 난이도가 실제보다 낮고 모델 튜닝에 이미 노출된다. 평가 수치에는 설문으로 모은 문장(`source: survey`)만 쓴다.

## 0. 파일 형식

한 줄 = 한 문장. JSONL.

```json
{"id":"s01","difficulty":"single","source":"author","text":"…","constraints":[…],"notes":"…"}
```

| 필드 | 값 |
|---|---|
| `id` | 파일 안에서 유일 |
| `difficulty` | `single`(제약 1개) / `compound`(2개 이상, 서로 독립) / `ambiguous`(기본 해석이 필요) / `contradictory`(같은 대상에 상반되거나 함께 만족 불가) |
| `source` | `author`(시드) / `survey`(설문, private) |
| `constraints` | 제약 배열. 각 제약 `id`는 문장 안에서 `c1, c2, …` |
| `notes` | 선택. 해석 근거, 표현 불가 부분 |

검증: `cd backend && python scripts/validate_labels.py <path>` (id 중복·스키마·타입 커버리지·난이도 분포 출력).

## 1. 강도(hard/soft) 판별

| 판정 | 단서 | weight |
|---|---|---|
| hard | 꼭, 반드시, 무조건, 절대, ~해야 해/돼, ~면 안 돼, 특정 과목을 명시적으로 넣거나 빼라는 요청("빼줘", "넣어줘"는 과목 지정 시 hard) | 10 |
| soft (강) | 웬만하면, 가능하면, 되도록, ~하고 싶어(강조 동반) | 7 |
| soft (기본) | ~면 좋겠다, ~하고 싶어, ~싫어, 단서 없음 | 5 |
| soft (약) | ~면 더 좋아, 적당히, 좀 | 3 |

- "최대", "이상", "이하"는 **범위 표현**일 뿐 강도 단서가 아니다.
- 단서가 없으면 soft(5). 앱에서는 칩으로 사용자가 조정한다.

## 2. 기본 해석

| 표현 | 해석 |
|---|---|
| 아침 / 아침 일찍 | 09:00 이전 → `time_avoid` 08:00–09:00 |
| "9시 수업" (시각 명시) | 해당 시각부터 1시간 → 09:00–10:00 |
| 오전 | 08:00–12:00 |
| 점심 | 12:00–13:00, 시간 미명시 시 `min_free_minutes` 60 |
| 오후 | 13:00–18:00 |
| 저녁 / 밤 / 야간 | 18:00–22:00 |
| 요일 미명시 | 월–금 전체 |
| 공강(하루 단위) | `day_off` |
| 수업 사이 빈 시간 | `max_gap` (분) |
| 연강 N시간 | `max_consecutive` N×60 |
| 학교 N일만 / 덜 가고 싶어 | `max_days_on_campus` N / 4 |
| 학점 N~M | `credit_range` (상한 미명시 시 max 40, 하한 미명시 시 min 0) |
| 학점 적당히 | 15–18 (학칙상 신청 범위 0.5–22, `docs/academic_rules.md` §2) |

시간 격자는 08:00–22:00, 30분 단위다(`app/core/time_slots.py`). 경계 밖 시간은 격자 끝으로 자른다.

## 3. 모호 문장

1. 위 기본 해석으로 라벨링하고 `difficulty: "ambiguous"`.
2. `notes`에 어떤 해석을 골랐고 다른 해석이 무엇인지 적는다.
3. 엔티티 모호성(예: "알파 과목" → 후보가 여럿): 첫 후보로 임시 라벨, `notes`에 후보 명시. 평가 시 엔티티 매칭은 별도 지표로 본다.
4. 카테고리 별칭("전공" → 전필+전선?): 문장 그대로 `category` 값에 넣고 `notes`에 매핑 확인 필요라고 적는다.
5. 스키마로 표현할 수 없는 부분(카테고리 단위 제외, 과목별 예외 등)은 **라벨에서 생략**하고 `notes`에 기록한다. 억지로 비슷한 타입에 끼워 넣지 않는다.

## 4. 모순 문장

1. 상반된 제약을 **둘 다** 라벨링한다. 하나를 임의로 지우지 않는다.
2. `difficulty: "contradictory"`, `notes`에 모순 종류를 적는다.
   - 논리 모순: 같은 대상에 avoid + prefer
   - 수치 모순: `credit_range.max` < `category_min.credits`
   - 카탈로그 모순: 금요일 공강 + 금요일에만 열리는 필수 과목 (카탈로그를 봐야 드러남)
3. 해석에 따라 모순이 아닐 수 있으면(예: "아침"에 9시가 포함되는지) 기본 해석대로 라벨링하고 `notes`에 남긴다.

## 5. 검수와 일치도

- LLM 초안은 쓸 수 있지만 **정답 확정은 사람**이 한다.
- 전체의 20%는 1주 이상 간격을 두고 다시 라벨링해 타입·params·강도 일치율을 기록한다.
- 설문 문장 라벨은 `data/private/labels/`에만 둔다(커밋 금지).

## 부록 A. 예시 (PLAN.md 부록 A와 동일 해석)

**입력**: "금요일엔 수업 없었으면 좋겠고, 아침 9시 수업은 절대 싫어. 점심은 꼭 비워줘."

```json
[
 {"id":"c1","type":"day_off","params":{"days":["Fri"]},"strength":"soft","weight":5,"source_text":"금요일엔 수업 없었으면 좋겠고"},
 {"id":"c2","type":"time_avoid","params":{"days":["Mon","Tue","Wed","Thu","Fri"],"start":"09:00","end":"10:00"},"strength":"hard","weight":10,"source_text":"아침 9시 수업은 절대 싫어"},
 {"id":"c3","type":"lunch_free","params":{"start":"12:00","end":"13:00","min_free_minutes":60},"strength":"hard","weight":10,"source_text":"점심은 꼭 비워줘"}
]
```
- "9시"를 시각으로 명시했으므로 "아침=09:00 이전"이 아니라 09:00–10:00으로 본다.
- "~면 좋겠고"는 기본 soft(5). PLAN.md 부록 A는 weight 7로 적었지만 이 가이드 기준을 따른다.
- 시드 라벨 `m02`가 이 예시다.
