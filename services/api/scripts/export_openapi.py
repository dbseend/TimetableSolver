"""Pydantic/FastAPI 계약 → packages/contracts/openapi.json (프론트 타입 생성 입력)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402

out = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "openapi.json"
out.parent.mkdir(parents=True, exist_ok=True)
# newline="\n": Windows에서도 LF로 기록(CI 계약 드리프트 비교가 줄바꿈 때문에 실패하지 않도록)
out.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
print(f"wrote {out}")
