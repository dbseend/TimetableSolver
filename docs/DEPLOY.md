# 배포 (통합 브랜치 미리보기)

`feat/timetable-integration`을 **단일 Docker 컨테이너**로 배포한다. 프론트(`apps/web` 빌드 결과)와 API(`services/api`)를 같은 주소에서 제공한다.

- main의 `render.yaml`(서비스 `timetablesolver-api`, `backend/`)과는 **별개 서비스**다. 같은 이름을 쓰지 않는다.
- 루트에 `render.yaml`을 두지 않는다(main과 충돌). Render 대시보드에서 수동으로 만든다.

## 구조

| 항목 | 방식 |
|---|---|
| 프론트 → API 주소 | 상대 경로 `/api/v1`(같은 주소). 번들에 localhost 없음. 배포 빌드의 네트워크 오류 문구도 localhost를 안내하지 않음 |
| CORS | 같은 주소라 필요 없음. `CORS_ORIGINS`에 배포 주소만 넣어 둔다(다른 출처 차단) |
| HTTPS | 플랫폼(Render)이 TLS 종료. 앱은 `--proxy-headers`로 실행 |
| Gemini 키 | 서버 환경 변수 `GEMINI_API_KEY`에만. 이미지·저장소·프론트 번들에 없음 |
| 학교 카탈로그 | 이미지에 넣지 않음(`.dockerignore`의 `local-data`). 플랫폼 **Secret Files**로 `CATALOG_DIR`에 제공 → 재시작·재배포 후에도 유지 |
| 접근 제한 | `ACCESS_PASSWORD`가 있으면 전체에 HTTP Basic 인증(`/api/v1/health` 제외). 사용자명은 `ACCESS_USER`(기본 `student`) |
| 요청 제한 | IP별 분당 횟수: 자연어 해석 `PARSE_PER_MIN=6`, 계산(solve·diagnose) `SOLVE_PER_MIN=20`. 초과하면 429와 한국어 안내 |
| Gemini 남용 방지 | live 호출 일일 총 상한 `LLM_DAILY_LIMIT=200`(UTC 날짜 기준). 초과하면 429, 직접 조건 추가는 계속 사용 가능 |
| Health check | `GET /api/v1/health` → `{"status":"ok"}` |

## Render 설정(무료 플랜)

1. **New → Web Service → Public Git Repository**: `https://github.com/dbseend/TimetableSolver`, 브랜치 `feat/timetable-integration`.
   - 저장소 연결 권한이 있으면 GitHub 연결로 해도 된다.
2. Runtime **Docker**, Dockerfile 경로 `./Dockerfile`, Root Directory 비움. Instance type **Free**.
3. 서비스 이름은 `timetable-solver-preview`처럼 main 서비스와 다르게 한다.
4. Health Check Path: `/api/v1/health`.
5. **Environment** 탭에서 다음을 넣는다. 값은 대시보드에서만 입력하고 채팅이나 저장소에 남기지 않는다.
   - `ACCESS_PASSWORD`: 접근 제한 배포일 때
   - `TRUST_PROXY` = `1`: Render 프록시 뒤라 X-Forwarded-For로 IP별 제한
   - `CORS_ORIGINS` = `https://<서비스>.onrender.com`
   - (선택) live 해석을 쓰려면 `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `LLM_MODEL`. 없으면 데모 해석기(fixture)로 동작한다.
6. **Secret Files**에 다음 두 파일을 올린다. 내용은 로컬 `local-data/catalogs/`에 있는 같은 이름 파일의 내용이다.
   - `school-2026-2.catalog.json`
   - `school-2026-2.meta.json`
7. Environment에 `CATALOG_DIR` = `/etc/secrets`를 추가한다. Render는 Secret Files를 이 경로에 둔다.

Render 무료 플랜의 Secret Files 크기 제한 등 세부 조건은 대시보드에서 확인한다. 카탈로그는 약 390 KB다.

## 확인

```bash
cd apps/web
DEPLOY_URL=https://<서비스>.onrender.com ACCESS_PASSWORD=<대시보드 값> npx playwright test -c playwright.deploy.config.ts
```

이 명령은 다음을 확인한다.

- health와 HTTPS
- 기본 카탈로그 목록
- 흐름: 첫 접속 → 기본 데이터 → 조건 → 생성 → 브라우저 뒤로 → 조건 수정('다시 생성' 안내) → 재생성 → 조건 수정하기
- API가 같은 주소에서 호출되는지

Gemini는 호출하지 않는다.

## 로컬 컨테이너

```bash
docker build -t timetable-solver:local .
docker run --rm -p 8090:8000 -e ACCESS_PASSWORD=<임의값> \
  -v "$PWD/local-data/catalogs:/app/catalogs:ro" timetable-solver:local
```

## 운영 주의

- **학교 자료 공개 범위**: 개설시간표의 외부 공개 가능 여부는 확인되지 않았다. 확인 전에는 `ACCESS_PASSWORD`로 접근을 제한하거나, 학교 카탈로그 없이 배포한다. 학교 카탈로그가 없으면 첫 화면에서 학교 데이터가 없다고 안내하고, 표시가 붙은 샘플(demo)이나 직접 업로드로 시작한다.
- 요청 제한과 LLM 일일 상한은 **프로세스 메모리 기반**이다. 재시작하면 초기화되고, 인스턴스를 늘리면 인스턴스별로 따로 센다.
- 무료 플랜은 유휴 시 잠들어 첫 요청이 느리다(수십 초). 프론트는 502/503/504에 "서버가 시작 중…" 안내를 보여 준다.
- solver는 동시 실행 1개다. 동시에 몰리면 `SOLVER_BUSY`(잠시 뒤 재시도) 안내가 나간다.
- 카탈로그를 갱신하려면 Secret Files 내용을 바꾸고 재배포한다. 서버는 파일 변경을 감지해 다시 읽는다.
- 이수내역 원문은 브라우저에서만 처리하며 서버로 보내지 않는다(기존 계약 그대로).
