"""Synthetic course catalog generator (Phase C6).

All names are obviously fictional ("가상과목 알파 1", "SYN101", "가상교수 A01") so they can never be
confused with real courses. Output is validated with the backend `Catalog` model.

    python data/synthetic/generator.py --sections 50 --seed 50 --out data/synthetic/catalog_50.json

Same arguments -> byte-identical output.
"""

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.time_slots import format_hhmm, parse_hhmm  # noqa: E402
from app.domain.models import Catalog  # noqa: E402

GREEK = ["알파", "베타", "감마", "델타", "엡실론", "제타", "에타", "세타", "이오타", "카파"]
CATEGORIES = ["전필", "전선", "교양", "기타"]
CATEGORY_WEIGHTS = [0.25, 0.35, 0.3, 0.1]
CREDIT_WEIGHTS = {3: 0.7, 2: 0.2, 1: 0.1}

# 75-minute twice-weekly slots (the dominant pattern)
TWICE_STARTS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"]
TWICE_DAYS = [("Mon", "Wed"), ("Tue", "Thu")]
BLOCK_STARTS = ["09:00", "13:00", "14:00"]  # 3-hour single block
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu"]


def _m(day: str, start: str, minutes: int) -> dict:
    return {"day": day, "start": start, "end": format_hhmm(parse_hhmm(start) + minutes)}


def _meetings(rng: random.Random, credit: int) -> list[dict]:
    r = rng.random()
    if credit == 3:
        if r < 0.75:
            start = rng.choice(TWICE_STARTS)
            return [_m(d, start, 75) for d in rng.choice(TWICE_DAYS)]
        if r < 0.88:
            return [_m(rng.choice(WEEKDAYS), rng.choice(BLOCK_STARTS), 165)]
        if r < 0.94:
            return [_m(rng.choice(WEEKDAYS), "19:00", 165)]  # night
        return [_m("Fri", rng.choice(["09:00", "13:00"]), 165)]  # Friday only
    if credit == 2:
        if r < 0.6:
            return [_m(rng.choice(WEEKDAYS), rng.choice(TWICE_STARTS), 100)]
        if r < 0.8:
            return [_m(rng.choice(WEEKDAYS), "19:00", 100)]
        return [_m("Fri", rng.choice(["10:00", "14:00"]), 100)]
    day = rng.choice(WEEKDAYS + ["Fri"])
    return [_m(day, rng.choice(["09:00", "13:00", "16:00", "18:00"]), 50)]


def generate(n_sections: int, seed: int) -> dict:
    rng = random.Random(seed)
    # course -> number of sections (1 mostly, some 2-3)
    counts: list[int] = []
    while sum(counts) < n_sections:
        counts.append(min(rng.choices([1, 2, 3], [0.7, 0.2, 0.1])[0], n_sections - sum(counts)))
    n_instructors = max(3, round(n_sections / 2.5))  # fewer instructors than sections -> overlap
    instructors = [f"가상교수 {chr(65 + i // 99)}{i % 99 + 1:02d}" for i in range(n_instructors)]

    courses, sections = [], []
    for i, count in enumerate(counts):
        cid = f"SYN{101 + i}"
        credit = rng.choices(list(CREDIT_WEIGHTS), list(CREDIT_WEIGHTS.values()))[0]
        courses.append(
            {
                "id": cid,
                "name": f"가상과목 {GREEK[i % len(GREEK)]} {i // len(GREEK) + 1}",
                "credit": credit,
                "category": rng.choices(CATEGORIES, CATEGORY_WEIGHTS)[0],
                "prerequisites": [],
            }
        )
        for k in range(count):
            sections.append(
                {
                    "id": f"{cid}-{k + 1:02d}",
                    "course_id": cid,
                    "meetings": _meetings(rng, credit),
                    "instructor": rng.choice(instructors),
                    "capacity": rng.choice([20, 30, 40, 60]),
                }
            )
    # a few prerequisites on later courses, always pointing at earlier ones
    for i, c in enumerate(courses[5:], start=5):
        if rng.random() < 0.1:
            c["prerequisites"] = [rng.choice(courses[:i])["id"]]

    catalog = {"courses": courses, "sections": sections}
    Catalog.model_validate(catalog)
    return catalog


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sections", type=int, required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    catalog = generate(a.sections, a.seed)
    a.out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {a.out}: {len(catalog['courses'])} courses, {len(catalog['sections'])} sections")


if __name__ == "__main__":
    main()
