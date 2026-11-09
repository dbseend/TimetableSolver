"""Resolve course / instructor mentions to catalog values (docs/PHASE_D_DESIGN.md DD9).

Never auto-confirms an ambiguous match: exact id/name -> 1.0, mention inside a name -> 0.9,
otherwise difflib similarity. Auto-pick only when exactly one candidate scores >= AUTO.
"""

import re
from difflib import SequenceMatcher

AUTO = 0.9
SHOW = 0.6
MAX_CANDIDATES = 5


def normalize(text: str) -> str:
    """Lowercase, drop "(English name)" suffixes and whitespace."""
    return re.sub(r"\(.*?\)|\s", "", text).lower()


def score(mention: str, name: str) -> float:
    m, n = normalize(mention), normalize(name)
    if not m or not n:
        return 0.0
    if m == n:
        return 1.0
    if len(m) >= 2 and m in n:
        return AUTO
    return SequenceMatcher(None, m, n).ratio()


def match(mention: str, options: dict[str, str]) -> tuple[str | None, list[tuple[str, str, float]]]:
    """options: id -> display name. Returns (auto-picked id or None, ranked candidates)."""
    if mention in options:
        return mention, [(mention, options[mention], 1.0)]
    ranked = sorted(
        (
            (oid, name, max(score(mention, name), score(mention, oid)))
            for oid, name in options.items()
        ),
        key=lambda t: -t[2],
    )
    ranked = [t for t in ranked if t[2] >= SHOW][:MAX_CANDIDATES]
    sure = [t for t in ranked if t[2] >= AUTO]
    if len(sure) == 1 and (len(ranked) == 1 or ranked[1][2] < AUTO):
        return sure[0][0], ranked
    return None, ranked
