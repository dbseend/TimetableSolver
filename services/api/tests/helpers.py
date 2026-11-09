"""테스트 헬퍼와 전수조사 oracle(테스트 전용, 운영 solver로 사용하지 않음)."""

from __future__ import annotations

import itertools
import json
from pathlib import Path

from pydantic import TypeAdapter

from app.contracts import Catalog, Constraint, SolveRequest
from app.domain.catalog import CatalogIndex, catalog_revision
from app.domain.validator import validate_selection

ROOT = Path(__file__).resolve().parents[3]
_constraint_ta = TypeAdapter(Constraint)


def load_catalog(name: str = "tiny7.json") -> Catalog:
    return Catalog.model_validate(json.loads((ROOT / "fixtures" / "catalogs" / name).read_text(encoding="utf-8")))


def con(cid: str, type_: str, strength: str = "hard", weight: int | None = None, **params):
    if strength == "soft" and weight is None:
        weight = 5
    return _constraint_ta.validate_python({"id": cid, "type": type_, "strength": strength, "weight": weight, "params": params})


def credit(lo: int, hi: int, cid: str = "credits", strength: str = "hard", weight=None):
    return con(cid, "credit_range", strength, weight, min_units=lo, max_units=hi)


def tiny_base() -> list:
    return [credit(600, 600), con("incA", "must_include", course_id="A"), con("incB", "must_include", course_id="B")]


def make_request(catalog: Catalog, constraints: list, allowed: list[str] | None = None, **options) -> SolveRequest:
    allowed = [s.id for s in catalog.sections] if allowed is None else allowed
    return SolveRequest.model_validate(
        {
            "catalog": catalog.model_dump(mode="json"),
            "catalog_revision": catalog_revision(catalog),
            "allowed_section_ids": allowed,
            "constraints": [c.model_dump(mode="json") for c in constraints],
            "confirmation": {"input_revision": 1, "confirmed_revision": 1},
            "options": options,
        }
    )


def oracle(catalog: Catalog, allowed: list[str], constraints: list) -> tuple[set[frozenset], int | None]:
    """모든 부분집합을 열거해 hard-valid 집합과 최소 penalty를 반환."""
    idx = CatalogIndex.build(catalog)
    ids = [s.id for s in catalog.sections]
    assert len(ids) <= 14, "oracle은 작은 문제 전용"
    valid: set[frozenset] = set()
    best: int | None = None
    for r in range(len(ids) + 1):
        for combo in itertools.combinations(ids, r):
            v = validate_selection(idx, allowed, constraints, list(combo))
            if v.hard_ok:
                valid.add(frozenset(combo))
                best = v.penalty if best is None else min(best, v.penalty)
    return valid, best
