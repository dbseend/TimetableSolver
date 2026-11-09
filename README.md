# TimetableSolver

자연어 선호 → 제약 JSON(LLM) → CP-SAT 솔버 → 검증된 시간표 후보 + 설명 + 불가능 진단.

- 기획: [docs/PLAN.md](docs/PLAN.md)
- 개발 계획: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- API 계약: [docs/API.md](docs/API.md), `backend/openapi.json`

> **공개 저장소.** 실제 수강 이력·성적표·설문 응답·API 키는 절대 커밋하지 않는다. 자세한 규칙은 [data/README.md](data/README.md).

## 구조
```
backend/   FastAPI + OR-Tools (Render)
frontend/  Vite + React + TS (Vercel)
data/      synthetic/ 만 커밋. private/ raw/ 는 gitignore
docs/      기획·계획·ADR
```

## 로컬 실행
Backend (Python 3.13)
```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp ../.env.example .env
uvicorn app.main:app --reload     # http://localhost:8000/docs
ruff check . && pytest -q
```

Frontend (Node 22)
```
cd frontend
cp .env.example .env.local
npm install
npm run dev                        # http://localhost:5173
npm run typecheck && npm test && npm run build
```

## API 변경 절차
1. 백엔드 모델 수정
2. `python backend/scripts/export_openapi.py`
3. `cd frontend && npm run gen:types`
4. 둘 다 커밋 (CI가 drift 검사)

## 현재 상태
Phase A(레포), B(기본 구성) 완료. `/health`만 동작하고 나머지 엔드포인트는 계약 스텁(501).
