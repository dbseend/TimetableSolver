"""Golden test: replay recorded Gemini answers for the 40 author seeds (no network).

Seeds are the development set the prompt was tuned on, so these numbers guard against
regressions; they are not an evaluation result (docs/labeling_guide.md).
Re-record after changing the prompt: python scripts/record_seed_llm.py
"""

import json
import sys
from collections import Counter
from pathlib import Path

from app.domain.constraints import constraints_adapter
from app.llm.parse_constraints import parse_constraints, prompt_fingerprint

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from record_seed_llm import OUT, SEEDS, seed_summary  # noqa: E402

FIXTURE = json.loads(OUT.read_text(encoding="utf-8"))
ROWS = [json.loads(line) for line in SEEDS.read_text(encoding="utf-8").splitlines()]


class Replay:
    model = "replay"

    def generate_json(self, system: str, user: str, schema: dict) -> str:
        return FIXTURE["responses"][user.split("선호 문장:\n", 1)[1]]


def test_fixture_matches_current_prompt():
    assert FIXTURE["prompt"] == prompt_fingerprint(), "prompt changed: re-record the fixture"
    assert {r["text"] for r in ROWS} <= set(FIXTURE["responses"])


def test_seed_parses_stay_accurate():
    summary = seed_summary()
    tp = fp = fn = exact = 0
    for row in ROWS:
        gold = constraints_adapter.validate_python(row["constraints"])
        got = parse_constraints(row["text"], summary, Replay()).constraints
        g, p = Counter(c.type for c in gold), Counter(c.type for c in got)
        hit = sum((g & p).values())
        tp, fp, fn = tp + hit, fp + sum(p.values()) - hit, fn + sum(g.values()) - hit

        def norm(cs):
            return sorted((c.type, c.strength, json.dumps(c.params.model_dump())) for c in cs)

        exact += norm(got) == norm(gold)
    precision, recall = tp / (tp + fp), tp / (tp + fn)
    # 2026-11-09 with gemini-3.5-flash-lite: P 1.00, R 0.98, exact 37/40
    assert precision >= 0.95 and recall >= 0.95
    assert exact >= 35
