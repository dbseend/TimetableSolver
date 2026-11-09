# ADR 0001: 백엔드 Python + OR-Tools CP-SAT
- 상태: 채택
- 맥락: 하드/소프트 제약, 불가능 진단(assumption literal), 후보 다양화 필요.
- 결정: FastAPI + OR-Tools CP-SAT. 제약은 닫힌 스키마(13 타입)로만 솔버에 전달.
- 결과: LLM은 파싱만 담당, 해 검증은 코드. Render 무료 플랜 콜드스타트는 UI에서 안내.
