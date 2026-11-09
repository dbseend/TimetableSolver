# data/

이 저장소는 **공개**다. 커밋 가능한 것은 합성 데이터(`synthetic/`)와 작성자 시드 라벨(`eval/seed_labels.jsonl`)뿐이다.

## 1. 데이터 요구사항 (C1)

| 데이터 | 용도 | 형식 | 개인정보 | 확보 방법 | 대체 수단 |
|---|---|---|---|---|---|
| 개설강좌 (C2) | 솔버 입력 카탈로그, 로더·파서 형식 확정 | HISNet 공개 개설시간표 조회 결과 표 복사 텍스트(형식: `docs/academic_rules.md` §6) → `Catalog` JSON | 없음(교수명은 공개 정보지만 커밋하지 않음) | **사용자가 직접** 학부별로 복사. HISNet robots.txt가 자동 접근을 금지하므로 크롤링·스크립트 수집 금지 | `synthetic/catalog_{50,200,500}.json` |
| 학사 규칙 (C3) | 학점 상·하한, 시간 격자, 카테고리 체계 | `docs/academic_rules.md` | 없음 | 공개 학사규정·학사안내에서 확인(2026-11-09). 교시→시각표만 미확인 | 현재 기본값(30분 격자, 08:00–22:00) |
| 이수내역 샘플 (C4) | 이수내역 파서 명세(열·구분자·재수강/F/P 표기) | 붙여넣기 원문 텍스트 | **있음**(이름·학번·성적) | 본인 것만, 사용자가 `data/private/`에 저장. 식별정보 마스킹 후 형식만 분석 | 형식 명세만 문서화, 가상 샘플로 테스트 |
| 선호 문장 (C8) | NL→제약 평가셋 | 설문 응답 → JSONL | 낮음(자유 서술에 식별정보가 섞일 수 있음) | 지인 5–8명 설문 + 동의 | `eval/seed_labels.jsonl`(개발용만) |
| 사전 설문 (C9) | 문제 가설(시간 소요·불편 요인) 검증 | 설문 응답 csv | 낮음 | C8 폼에 포함 | 없음(미확보 시 "가설 미검증" 명시) |
| 정답 라벨 (C10) | NL→제약 정답 | JSONL (`docs/labeling_guide.md`) | 설문 문장 포함 시 낮음 | CC 초안 → 사용자 검수 | 시드 라벨 40개 |
| 불가능 시나리오 (C7) | 진단(최소 충돌 집합) 테스트 | `synthetic/infeasible_scenarios.json` | 없음 | 합성 | – |

## 2. 취급 규칙

- 실데이터(개설강좌 원본, 이수내역, 설문 원문·라벨)는 `data/private/`(또는 `data/raw/`)에만 둔다. 둘 다 gitignore, `*.xlsx|xls`도 무시된다.
- 커밋 전 `git status`에 `data/private`, `data/raw`가 없는지 확인한다.
- 합성 데이터는 명백히 가상 이름만 쓴다: 과목 `SYN101`/"가상과목 알파 1", 교수 "가상교수 A01". 실제 과목·교수명을 쓰지 않는다.
- 평가 보고서·발표에는 집계 결과와 비식별 예시만 쓴다.
- 이수내역 원문은 서버로 보내지 않는다(ADR 0002). LLM 무료 등급에 실데이터 원문을 넣지 않는다(ADR 0004).
- 실데이터를 못 구하면 합성만으로 진행하고 문서·발표에 **"실데이터 검증 없음"**을 명시한다.

## 3. 디렉터리

```
data/
  synthetic/generator.py           # python data/synthetic/generator.py --sections 50 --seed 50 --out data/synthetic/catalog_50.json
  synthetic/catalog_{50,200,500}.json   # seed = 섹션 수
  synthetic/infeasible_scenarios.json   # catalog_50 기준
  eval/seed_labels.jsonl           # 작성자 시드 40개 (개발용, 평가셋 아님)
  survey/                          # 설문 문안·응답 템플릿 (응답 원본은 private)
  hash_files.py                    # 아래 해시 표 갱신
  private/  raw/                   # gitignore
```

## 4. 데이터 카드 (C11, 초안)

| 항목 | 내용 |
|---|---|
| 출처 | 합성 카탈로그·시나리오: `generator.py`로 생성. 시드 라벨: 프로젝트 작성자 직접 작성. 실데이터: 사용자가 HISNet에서 직접 받은 전체 개설시간표 1건(`data/private/raw/`, 비공개) |
| 수집일 | 합성·시드·개설강좌: 2026-11-09. 설문: 미수집 |
| 비식별 방법 | 합성은 해당 없음. 설문: 식별정보 기입 금지 안내 + 응답 ID는 무작위 `r###` 부여, 연락처 미수집. 이수내역: 이름·학번·성적 제거 후 형식만 사용, 원문 미커밋 |
| 사용 범위 | 합성·시드: 개발·테스트·공개 가능. 설문 문장·라벨: 동의 범위(본 프로젝트 평가) 안에서만, 공개 여부는 동의 문구에 따라 결정(기본 private) |
| 한계 | 합성 카탈로그의 분포(주 2회 75분 위주 등)는 가정이며 실데이터로 검증되지 않았다. 시드 라벨은 작성자가 스키마를 알고 쓴 문장이라 평가에 쓰지 않는다 |
| 재현 | `python data/synthetic/generator.py --sections N --seed N --out …` 결과가 아래 해시와 같아야 한다 |

### 파일 해시

`python data/hash_files.py --write`로 갱신, `--check`로 확인(테스트에서도 검사).

<!-- hashes:start -->
| 파일 | sha256 |
|---|---|
| `eval/seed_labels.jsonl` | `93f9899627855a12f6773d3be5c1f5948cf7c010dcf3b0cc2cddf44656d96599` |
| `synthetic/catalog_200.json` | `b9273ff592da5561ae21b1d46a8f5a510a1a4622c9a75953261cd92092446bb6` |
| `synthetic/catalog_50.json` | `d07e87abecb2a96c38b8e80ba317657306a1648f099f6185c0854651994af035` |
| `synthetic/catalog_500.json` | `674ad49f2888761f62fac2976710b5f5a34bb4c8dd2c4ae635eabb8c5185ba38` |
| `synthetic/infeasible_scenarios.json` | `7db6581ea85d4f1639f5165d025b160dc98901e1747eb77b45bd566eb8e4bf5d` |
<!-- hashes:end -->
