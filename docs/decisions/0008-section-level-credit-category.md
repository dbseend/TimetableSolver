# 0008. 분반별 학점·이수구분 보존

- 상태: **채택·구현** (2026-11-09, 브랜치 `feat/timetable-integration`). 처음 작성 시점에는 제안이었고 아래 영향 범위를 확인한 뒤 구현했다.
- 테스트: `services/api/tests/test_section_overrides.py`(유효 학점·분류, 분반 1개 규칙, Meeting 중복 없음, oracle 대조, revision 호환, API 왕복), `apps/web/tests/unit/{adapter,major}.test.ts`, E2E "분반별 학점·이수구분 보존"

## 구현 결과(요약)

- 계약: `Section.credit_units: int|null`, `Section.category_ids: string[]|null` (추가 필드, 기본 null). `schema_version`은 하위 호환이라 "1.0" 유지.
- 유효값: 서버 `CatalogIndex.units_of / categories_of`, 프론트 `lib/catalog.ts`의 `sectionUnits / sectionCategories` — 같은 규칙. 검증기 category_min·학점 합, 솔버 학점 계수·category_min, facts가 모두 유효값 사용. 진단의 학점 범위 수정은 학점 값을 쓰지 않아 변경 없음.
- **catalog_revision 호환**: 새 필드가 null이면 직렬화에서 제외 → 분반 값이 없는 기존 카탈로그 revision 불변(테스트로 확인). 값이 있으면 revision에 반영.
- 어댑터: 과목 대표값 = 분반 값의 최빈값(동률이면 먼저 나온 분반), 대표값과 다른 분반만 분반 값을 가진다. 과목명이 다르면 여전히 `COURSE_INCONSISTENT`로 제외. 같은 분반의 여러 행끼리 학점·이수구분이 다르면 `SECTION_VALUE_INCONSISTENT`로 그 분반만 미지원.
- 내 전공(0007)과의 관계: `내전공` 분류는 **분반 단위**로 붙인다(유효 이수구분이 선택한 전공 유형인 분반만). 과목 대표값만 바꾸면 분반 값이 있는 분반에서 빠지거나 교선 분반까지 전공이 되는 충돌을 막는다.
- 저장 데이터: 브라우저에 저장하는 것은 정규화된 이수내역(`profile.v1`, 과목코드·상태)뿐이며 이 변경과 무관하다. 카탈로그·조건 초안은 저장하지 않으므로(세션마다 다시 가져오기) 마이그레이션 대상이 없다. 새 필드가 없는 이전 형식 카탈로그 JSON은 그대로 유효(필드 선택)하다.
- 실제 파일 재가져오기: 과목 511→518, 분반 778→819, 정상 분반 651→656(시간 있는 5분반 복구), 미지원 127→163(가변 학점 36분반 포함 — 시간 미정이라 미지원 유지, 비동기로 간주 안 함), Meeting 1,293→1,303, 분반 값 보존 15분반(학점 13, 이수구분 2).


## 조사 결과: 제외된 7과목(41분반)

| 과목 | 분반 | 차이 | 시간 | 판단 |
|---|---|---|---|---|
| CCE40108 전공창의학습1 | 10 | 학점 4/5/6/7/8 | 모두 없음 | 가변 학점 과목(PF). 분반=지도교수별 학점 선택으로 보임 |
| CCE40110 창의학습1 | 2 | 학점 2/6 | 없음 | 같음 |
| CCC40101 개별연구 3 | 3 | 학점 1/3, PF병행 Y/N | 없음 | 같음 |
| OJT50003 현장실습3 | 5 | 학점 2/6 | 없음 | 현장실습 학점 선택 |
| OJT50007 전공현장실습3 | 16 | 학점 6/7/8 | 없음 | 같음 |
| UIL20013 Legal Research and Writing | 3 | 이수구분 전선(01) / 전필(02·03), 학점 동일 3 | **있음** | 분반별 수강 대상에 따른 구분으로 보임 |
| CUE10004 공간학입문 | 2 | 이수구분 전선(01) / 교선(02), 학점 동일 3 | **있음** | 같음 |

- 형식 오류·중복·오타 흔적은 없다(과목명·개설 소속·교수 형식 정상). **원본 오류보다는 정상적인 분반별 차이로 보이며**, 제외 원인은 현재 `Course`가 학점·이수구분을 과목 단위로만 갖는 **모델 제약**이다.
- 다만 학교가 이 차이를 어떻게 인정하는지(예: UIL20013 01분반이 누구에게 전선인지)는 **미확인**이다.
- 실제 영향: 가변 학점 5과목(36분반)은 시간이 없어 보존해도 `TIME_TBD`로 생성 대상이 아니다. **시간이 있는 정상 분반 5개(UIL20013 3, CUE10004 2)**는 모델 제약 때문에 잃고 있다.
- 명세 `docs/02-architecture.md` §4.2는 "동일 과목의 학점·분류가 분반마다 다르면 P0는 가져오기 오류로 보여 주고 학교 어댑터 설계 전까지 자동 병합하지 않는다"고 규정한다. 현재 동작은 이 규정과 일치하며, 변경하려면 명세도 고쳐야 한다.

## 제안 모델

```text
Section (추가 필드, 모두 선택):
  credit_units: int | null      # null이면 Course.credit_units 상속
  category_ids: string[] | null # null이면 Course.category_ids 상속
유효 학점(section) = section.credit_units ?? course.credit_units
유효 분류(section) = section.category_ids ?? course.category_ids
```

- 같은 과목에서 분반 간 값이 다를 때만 어댑터가 Section 필드를 채운다(같으면 null 유지 → 기존 카탈로그 의미 불변).
- `Course` 값은 "대표값"이 되며, 표시·검색용으로만 쓰고 계산에는 항상 유효값을 쓴다.
- 과목당 최대 1분반·`must_include`·`equivalence_group_id` 의미는 그대로(과목 단위).
- main(`backend/app/domain/models.py`)도 같은 방식(Section.credit/category override, `Catalog.credit_and_category`)이라 통합 방향과도 맞다.

## API·코드 영향 범위 (구현 전 승인 필요)

| 영역 | 변경 |
|---|---|
| 계약 `services/api/app/contracts.py` | `Section`에 선택 필드 2개. strict/extra=forbid 유지. `schema_version`은 하위 호환(추가 필드, 기본 null)이라 "1.0" 유지 또는 "1.1" 상향 중 결정 필요 |
| `catalog_revision` | `model_dump`에 null 필드가 추가돼 **같은 카탈로그도 해시가 바뀐다**(서버 재계산이라 기능 영향 없음, 저장된 revision 비교 무효) |
| 검증기 `domain/validator.py`, `domain/catalog.py`(`units_of`), facts | 유효 학점·분류 사용 |
| 솔버 `solver/model.py` | 학점 계수·category_min 대상 분반을 유효값으로 |
| 진단 `solver/engine.py` | 학점 범위 수정안 계산에 유효 학점 |
| 의미 검증 | 분반 학점이 0.01 단위·범위 안인지, 분류 참조 검증 |
| OpenAPI·TS 생성 타입 | 재생성. 프론트 `lib/types.ts` 좁힌 타입에 두 필드 추가 |
| 프론트 | 어댑터(불일치 시 오류 대신 Section 필드), 그리드 상세·목록·비교표·내 전공 후보(유효 분류 기준) |
| 테스트 | 백엔드 oracle 대조(분반별 학점 반례), 프론트 합성 반례를 '보존' 기대값으로 변경 |

## 대안

- A. 현행 유지(과목째 제외) — 시간 있는 5분반 손실, 명세 그대로.
- B. 분반별로 다른 과목 ID로 쪼갬(`UIL20013#전필`) — 계약 변경은 없지만 "과목당 1분반" 의미가 깨져 같은 과목 2분반 동시 선택이 가능해진다. **권하지 않음.**
- C. 제안 모델(Section override) — **권장.** main과 방향이 같고, 같은 과목 중복 선택 방지를 유지한다.
