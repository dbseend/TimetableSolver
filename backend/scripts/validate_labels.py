"""Validate a labels JSONL file (seed or private) against the constraint schema.

python scripts/validate_labels.py ../data/eval/seed_labels.jsonl
python scripts/validate_labels.py ../data/private/labels/labels.jsonl

Each line: {"id", "text", "difficulty", "source", "constraints": [...], "notes"?}.
Exit 1 if any line is invalid or an id repeats. Coverage and distribution are printed only.
"""

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pydantic import ValidationError  # noqa: E402

from app.domain.constraints import CONSTRAINT_TYPES, constraints_adapter  # noqa: E402

DIFFICULTIES = ("single", "compound", "ambiguous", "contradictory")
REQUIRED = {"id", "text", "difficulty", "source", "constraints"}


def validate(path: Path) -> dict:
    errors: list[str] = []
    ids: Counter[str] = Counter()
    types: Counter[str] = Counter()
    difficulty: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            errors.append(f"line {n}: invalid JSON ({e.msg})")
            continue
        if missing := REQUIRED - row.keys():
            errors.append(f"line {n}: missing {sorted(missing)}")
            continue
        ids[row["id"]] += 1
        if row["difficulty"] not in DIFFICULTIES:
            errors.append(f"line {n}: difficulty {row['difficulty']!r} not in {DIFFICULTIES}")
        difficulty[row["difficulty"]] += 1
        sources[row["source"]] += 1
        try:
            cons = constraints_adapter.validate_python(row["constraints"])
        except ValidationError as e:
            # loc/msg only: never echo the label text (it may come from private survey data)
            for err in e.errors():
                errors.append(f"line {n} ({row['id']}): {err['loc']} {err['msg']}")
            continue
        cids = [c.id for c in cons]
        if len(set(cids)) != len(cids):
            errors.append(f"line {n} ({row['id']}): duplicate constraint id")
        types.update(c.type for c in cons)
    errors += [f"duplicate id {i!r} ({k} times)" for i, k in ids.items() if k > 1]
    return {
        "errors": errors,
        "rows": sum(ids.values()),
        "difficulty": dict(difficulty),
        "sources": dict(sources),
        "types": dict(types),
        "missing_types": [t for t in CONSTRAINT_TYPES if t not in types],
    }


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    report = validate(Path(argv[0]))
    print(f"rows: {report['rows']}")
    print(f"difficulty: {report['difficulty']}")
    print(f"sources: {report['sources']}")
    print("type coverage:")
    for t in CONSTRAINT_TYPES:
        print(f"  {t:20s} {report['types'].get(t, 0)}")
    if report["missing_types"]:
        print(f"missing types: {report['missing_types']}")
    for e in report["errors"]:
        print(f"ERROR {e}")
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
