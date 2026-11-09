"""SHA-256 table of the committed data files for the data card in data/README.md.

python data/hash_files.py          # print the table
python data/hash_files.py --write  # replace the table between the markers in data/README.md
python data/hash_files.py --check  # exit 1 if README is stale
"""

import hashlib
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
README = DATA / "README.md"
PATTERNS = ["synthetic/*.json", "eval/*.jsonl"]
START, END = "<!-- hashes:start -->", "<!-- hashes:end -->"


def table() -> str:
    files = sorted(p for pat in PATTERNS for p in DATA.glob(pat))
    rows = [
        f"| `{p.relative_to(DATA).as_posix()}` | `{hashlib.sha256(p.read_bytes()).hexdigest()}` |"
        for p in files
    ]
    return "\n".join(["| 파일 | sha256 |", "|---|---|", *rows])


def render(readme: str) -> str:
    head, rest = readme.split(START, 1)
    _, tail = rest.split(END, 1)
    return f"{head}{START}\n{table()}\n{END}{tail}"


def main(argv: list[str]) -> int:
    if not argv:
        print(table())
        return 0
    current = README.read_text(encoding="utf-8")
    if argv == ["--write"]:
        README.write_text(render(current), encoding="utf-8")
        return 0
    if argv == ["--check"]:
        stale = render(current) != current
        if stale:
            print("data/README.md hash table is stale: run python data/hash_files.py --write")
        return 1 if stale else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
