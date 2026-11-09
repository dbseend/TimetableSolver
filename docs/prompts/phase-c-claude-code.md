# Claude Code 프롬프트 — Phase C (1차)

사용: 레포 루트에서 Claude Code 실행 후 아래 블록 전체를 붙여넣기.
선행: `git checkout main && git pull` (PR 머지 후) 또는 `setup/phase-a-b` 브랜치에서 시작.

```
너는 dbseend/TimetableSolver 레포의 Phase C(데이터 수집) 1차 작업을 한다.
먼저 docs/PLAN.md, docs/DEVELOPMENT_PLAN.md(C 섹션), docs/DATA_COLLECTION.md, docs/API.md,
backend/app/domain/*.py, backend/app/core/*.py 를 읽어라.

## 제약
- 새 브랜치 `data/phase-c-1` 에서 작업. main 직접 수정 금지. 커밋은 작업 단위로 나누고 푸시까지. 머지는 하지 않는다.
- 이 레포는 공개다. 실제 강좌·이수내역·설문 원문·API 키를 만들거나 커밋하지 마라. data/private/ 는 비어 있어도 된다.
- 학교 시스템 크롤링, 로그인 자동화, 외부 사이트 스크래핑 금지.
- 실제 한동 과목명·교수명을 지어내지 마라. 합성 데이터는 명백히 가상(예: "가상과목 알파", 코드 SYN101)으로.
- 작업 시작 전에 TaskCreate로 체크리스트를 만들고, 끝나면 ruff, pytest, 프론트 typecheck/test가 통과함을 확인한다.
- 불확실한 학사 규칙은 추측하지 말고 docs/academic_rules.md 에 `[사용자 확인 필요]`로 남겨라.

## 작업
C0. Gemini 설정
- .env.example: LLM_PROVIDER=gemini, LLM_MODEL=(공식 문서에서 현재 사용 가능한 저비용 모델명을 확인해 기입. 확인 못 하면 빈칸+주석), LLM_API_KEY 유지.
- backend/app/core/config.py: provider 허용값을 gemini | none 으로 검증. 키가 없으면 LLM 기능만 비활성(서버 기동은 정상).
- render.yaml 의 LLM_PROVIDER 기본값을 gemini 로. docs/adr/0004-gemini.md 작성(선택 이유: 키 보유·무료 티어, 제약: 레이트리밋, 구조화 출력 사용 계획).
- LLM 호출 구현은 하지 않는다(Phase D). 설정과 테스트만.

C1. data/README.md 를 갱신: 데이터 요구사항 표(데이터별 용도·형식·개인정보 여부·확보 방법·대체 수단), 취급 규칙.

C3. docs/academic_rules.md 템플릿: 시간 체계(교시 vs 분), 학점 상한/하한, 카테고리 체계, 선수과목 표기, 재수강/F/P 표기 — 각 항목 빈칸 + 사용자가 어디서 확인할지 안내.

C6. data/synthetic/generator.py
- CLI: `python data/synthetic/generator.py --sections 50|200|500 --seed N --out data/synthetic/catalog_<n>.json`
- 출력은 backend의 Catalog 모델로 검증 가능해야 한다(생성 후 Catalog.model_validate 호출). 같은 seed → 같은 출력.
- 현실적 분포: 주 2회 75분(화목/월수) 위주 + 일부 3시간 연강 + 소수 야간/금요일 단독. 학점 1–3, 카테고리(전필/전선/교양/기타), 일부 과목은 분반 여러 개, 일부 교수 중복.
- 커밋 대상: catalog_50/200/500.json 3개(seed 고정). 테스트: 결정성, 모델 검증 통과, 시간 격자 범위 내, 분반 수 일치.

C7. data/synthetic/infeasible_scenarios.json + 테스트
- catalog_50 위에서 알려진 불가능 시나리오 5종 이상. 항목: id, 설명, constraints(제약 JSON 배열, backend 스키마로 검증), expected_conflict_ids(최소 충돌 집합), expected_status.
- 예: 금요일 공강 + 금요일에만 열리는 must_include, 학점 하한 > 가능 최대, 두 필수 과목의 단일 분반 시간 겹침, lunch_free + 점심시간 필수 과목, category_min 초과 요구.
- 아직 솔버가 없으므로 시나리오 자체의 스키마 검증과, 충돌이 실제로 존재함을 확인하는 간단한 순수 파이썬 브루트포스/겹침 검증(작은 케이스용) 테스트를 작성한다.

C8/C9. data/survey/
- survey_form.md: 설문 문안(동의 문구: 수집 목적, 보관, 공개 범위, 식별정보 기입 금지 / 선호 문장 작성 가이드와 난이도별 예시 / 사전 설문: 시간표 구성 소요시간, 불편 요인, 현재 사용 도구).
- responses_template.csv: 열 정의(id, sentence, difficulty_self_rated 등).
- 구글 폼에 그대로 옮길 수 있게 문항 번호와 선택지를 명시.

C10. 라벨링
- docs/labeling_guide.md: 강도(hard/soft) 판별 규칙, 기본 해석(예: 아침=09:00 이전, 오전, 점심=12–13시), 모호 문장 처리(ambiguities 사용), 모순 문장 처리, 부록 A 예시 포함.
- data/eval/seed_labels.jsonl: 네가 직접 쓴 시드 문장 40개(단일 12 / 복합 16 / 모호 8 / 모순 4) + 정답 제약 JSON. 각 줄에 "source":"author" 필드. 13개 제약 타입을 모두 최소 1회 사용.
- backend/scripts/validate_labels.py: jsonl 각 줄을 constraints_adapter 로 검증, id 중복·타입 커버리지·난이도 분포를 출력. 테스트 포함. 비공개 라벨 경로(data/private/labels/)도 같은 스크립트로 검증 가능하게 인자로 받는다.
- 주의: 시드 라벨은 개발용이며 평가셋이 아니다. 문서에 명시.

C11. data/README.md 에 데이터 카드 초안(출처, 수집일, 비식별 방법, 사용 범위, 파일 해시 sha256 표). 해시 계산 스크립트 data/hash_files.py.

## 완료 기준
- ruff, pytest 통과, git status에 data/private·raw가 없음, 커밋된 파일 중 실제 개인정보 없음(마지막에 `git diff main --stat` 와 grep 으로 자체 점검).
- 변경이 API 스키마에 영향을 주면 openapi.json 과 frontend api.d.ts 를 재생성해 함께 커밋.
- 마지막에 보고: 만든 파일 목록, 사용자가 해야 할 일(C2·C4·C3 채우기·C8 배포·C10 검수) 체크리스트, 막힌 점.
```

# Claude Code 프롬프트 — Phase C (2차, 실데이터 도착 후)

선행: C2 파일이 `data/private/raw/`, C4 원문이 `data/private/transcript_sample.txt`에 있음.

```
Phase C 2차. docs/DATA_COLLECTION.md 의 C2·C4·C5 를 수행한다. 실데이터 원문은 절대 커밋/출력 로그에 남기지 마라(통계와 형식 설명만).
1) data/private/raw/ 의 파일 형식을 분석해 열 구성·시간 표기·학점/카테고리 표기·특이 케이스를 docs/data_format_notes.md 에 비식별 요약으로 작성.
2) backend/app/adapters/ 에 강좌 로더 어댑터(원본→Catalog)를 구현하고, 실데이터가 없어도 도는 합성 픽스처 테스트를 작성. 파싱 실패 행은 행 번호+사유만 반환(내용 에코 금지).
3) data/private/transcript_sample.txt 형식을 분석해 결정적 파서 명세(docs/transcript_parser_spec.md)와 구현·테스트(합성 샘플 사용)를 작성. LLM 폴백은 구현하지 않는다.
4) 실데이터 구조 통계(분반 수 분포, 시간 패턴, 학점 분포)를 JSON으로 뽑아 generator 파라미터에 반영(통계만 커밋).
5) 모델/슬롯 설정 수정이 필요하면 수정 후 docs/API.md, openapi.json, api.d.ts 갱신. 전체 테스트 통과 확인 후 커밋·푸시.
```
