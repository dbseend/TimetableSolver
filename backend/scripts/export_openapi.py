"""Write (or verify) backend/openapi.json, the contract the frontend types are generated from.

python scripts/export_openapi.py          # regenerate
python scripts/export_openapi.py --check  # exit 1 if the committed file is stale (CI)
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

OUT = ROOT / "openapi.json"


def render() -> str:
    schema = create_app(Settings(_env_file=None)).openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("openapi.json is out of date. Run: python scripts/export_openapi.py")
            return 1
        print("openapi.json is up to date")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
