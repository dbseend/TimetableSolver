import json
import sys
from pathlib import Path

from app.domain.constraints import CONSTRAINT_TYPES

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from validate_labels import main, validate  # noqa: E402

SEED = Path(__file__).resolve().parents[2] / "data" / "eval" / "seed_labels.jsonl"


def test_seed_labels_valid_and_complete():
    r = validate(SEED)
    assert r["errors"] == []
    assert r["rows"] == 40
    assert r["difficulty"] == {"single": 12, "compound": 16, "ambiguous": 8, "contradictory": 4}
    assert r["sources"] == {"author": 40}
    assert r["missing_types"] == [] and set(r["types"]) == set(CONSTRAINT_TYPES)


def _write(tmp_path, rows):
    p = tmp_path / "labels.jsonl"
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n\n")
    return p


GOOD = {
    "id": "r1",
    "text": "금요일 공강",
    "difficulty": "single",
    "source": "survey",
    "constraints": [
        {"id": "c1", "type": "day_off", "params": {"days": ["Fri"]}, "strength": "soft"}
    ],
}


def test_detects_bad_rows(tmp_path):
    bad_schema = {**GOOD, "id": "r2", "constraints": [{**GOOD["constraints"][0], "x": 1}]}
    bad_diff = {**GOOD, "id": "r3", "difficulty": "hard"}
    missing = {"id": "r4"}
    dup_cid = {**GOOD, "id": "r5", "constraints": GOOD["constraints"] * 2}
    p = _write(tmp_path, [GOOD, GOOD, bad_schema, bad_diff, missing, dup_cid])
    errs = "\n".join(validate(p)["errors"])
    assert "duplicate id 'r1'" in errs
    assert "line 3 (r2)" in errs and "line 4" in errs and "line 5: missing" in errs
    assert "line 6 (r5): duplicate constraint id" in errs
    assert "금요일" not in errs  # no echo of label text
    assert main([str(p)]) == 1


def test_valid_file_exits_zero(tmp_path, capsys):
    assert main([str(_write(tmp_path, [GOOD]))]) == 0
    assert "missing types" in capsys.readouterr().out
