"""Record real LLM responses for the author-written seed sentences into a test fixture.

python scripts/record_seed_llm.py   # needs LLM_API_KEY; seeds are public (source: author)

Only seed sentences go here, never survey text. Tests replay the fixture without network.
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.domain.api_models import CatalogSummary  # noqa: E402
from app.llm.parse_constraints import (  # noqa: E402
    SYSTEM,
    _user_prompt,
    llm_schema,
    prompt_fingerprint,
)
from app.llm.provider import LLMError  # noqa: E402
from app.main import make_llm  # noqa: E402

SEEDS = ROOT.parent / "data" / "eval" / "seed_labels.jsonl"
CATALOG = ROOT.parent / "data" / "synthetic" / "catalog_50.json"
OUT = ROOT / "tests" / "fixtures" / "seed_llm_responses.json"


def seed_summary() -> CatalogSummary:
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    return CatalogSummary(
        courses=[{"id": c["id"], "name": c["name"]} for c in cat["courses"]],
        instructors=sorted({s["instructor"] for s in cat["sections"] if s["instructor"]}),
        categories=sorted({c["category"] for c in cat["courses"]}),
    )


def main() -> int:
    provider = make_llm(get_settings())
    if provider is None:
        print("LLM is disabled: set LLM_PROVIDER=gemini and LLM_API_KEY")
        return 1
    summary = seed_summary()
    fixture = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    fresh = fixture.get("prompt") == prompt_fingerprint()
    recorded = fixture.get("responses", {}) if fresh else {}  # prompt changed: record again
    for line in SEEDS.read_text(encoding="utf-8").splitlines():
        text = json.loads(line)["text"]
        if text in recorded:
            continue
        for attempt in range(4):
            try:
                raw = provider.generate_json(SYSTEM, _user_prompt(text, summary), llm_schema())
                break
            except LLMError as e:  # 503 overload / 429: back off and retry
                if e.code == "llm_daily_limit" or attempt == 3:
                    raise
                time.sleep(15 * (attempt + 1))
        recorded[text] = raw
        fixture = {"prompt": prompt_fingerprint(), "responses": dict(sorted(recorded.items()))}
        OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("recorded:", json.loads(line)["id"])
        time.sleep(4)  # stay under free-tier requests per minute
    return 0


if __name__ == "__main__":
    sys.exit(main())
