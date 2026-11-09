"""Convert a HISNet 개설시간표 table (pasted .tsv/.txt, or the downloaded .xls) into Catalog JSON.

python scripts/import_hisnet.py ../data/private/raw/<file>.tsv ../data/private/<file>.json
python scripts/import_hisnet.py ../data/private/raw/<file>.xls ../data/private/<file>.json

Input and output contain real course data: keep both under data/private/ (gitignored).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.loaders.hisnet import parse, parse_export  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    src = Path(argv[0])
    if src.suffix.lower() == ".xls":
        catalog, errors = parse_export(src.read_bytes())
    else:
        catalog, errors = parse(src.read_text(encoding="utf-8"))
    for e in errors:
        print(f"ERROR row {e.index}: {e.message}")
    if catalog is None:
        return 1
    Path(argv[1]).write_text(catalog.model_dump_json(indent=2) + "\n", encoding="utf-8")
    print(f"{len(catalog.courses)} courses, {len(catalog.sections)} sections -> {argv[1]}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
