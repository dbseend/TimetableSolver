"""SolveRequest의 참조·의미 검증(스키마 이후). 위반은 422/409이며 INFEASIBLE로 위장하지 않는다."""

from __future__ import annotations

import hashlib

from app.contracts import SolveRequest
from app.domain.catalog import CatalogIndex, canonical_json, catalog_revision, validate_catalog_semantics


class RequestProblem(Exception):
    def __init__(self, status: int, code: str, message: str, fields: list[tuple[str, str]]):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields


def request_hash(req: SolveRequest) -> str:
    """같은 문제(카탈로그·허용 분반·제약)를 식별. confirmation/options는 제외."""
    body = {
        "catalog_revision": req.catalog_revision,
        "allowed_section_ids": sorted(req.allowed_section_ids),
        "constraints": [c.model_dump(mode="json") for c in req.constraints],
    }
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


def check_solve_request(req: SolveRequest) -> CatalogIndex:
    if req.confirmation.input_revision != req.confirmation.confirmed_revision:
        raise RequestProblem(
            409, "STALE_CONFIRMATION", "확인된 조건 revision과 현재 revision이 다릅니다. 다시 확인하세요.", [("confirmation", "revision_mismatch")]
        )
    if catalog_revision(req.catalog) != req.catalog_revision:
        raise RequestProblem(409, "CATALOG_REVISION_MISMATCH", "카탈로그 revision이 내용과 일치하지 않습니다.", [("catalog_revision", "hash_mismatch")])
    errors, _ = validate_catalog_semantics(req.catalog)
    if errors:
        raise RequestProblem(422, "INVALID_CATALOG", "카탈로그 검증 오류가 있습니다.", [(e.path, e.code) for e in errors[:50]])
    idx = CatalogIndex.build(req.catalog)
    fields: list[tuple[str, str]] = []

    if len(set(req.allowed_section_ids)) != len(req.allowed_section_ids):
        fields.append(("allowed_section_ids", "duplicate_id"))
    for i, sid in enumerate(req.allowed_section_ids):
        if sid not in idx.section_by_id:
            fields.append((f"allowed_section_ids[{i}]", "unknown_section"))

    ids = [c.id for c in req.constraints]
    if len(set(ids)) != len(ids):
        fields.append(("constraints", "duplicate_constraint_id"))

    hard_ranges = [c for c in req.constraints if c.type == "credit_range" and c.strength == "hard"]
    if len(hard_ranges) == 0:
        raise RequestProblem(
            422, "HARD_CREDIT_RANGE_REQUIRED", "사용자가 확인한 hard 학점 범위(최소 학점 > 0)가 필요합니다.", [("constraints", "missing_hard_credit_range")]
        )
    if len(hard_ranges) > 1:
        raise RequestProblem(
            422, "MULTIPLE_HARD_CREDIT_RANGES", "hard 학점 범위는 하나만 허용됩니다. 병합해 주세요.", [("constraints", "multiple_hard_credit_range")]
        )
    if hard_ranges[0].params.min_units <= 0:
        raise RequestProblem(422, "HARD_CREDIT_RANGE_REQUIRED", "hard 학점 범위의 최소 학점은 0보다 커야 합니다.", [("constraints", "non_positive_min_units")])

    for i, c in enumerate(req.constraints):
        p = f"constraints[{i}].params"
        if c.type in ("must_include", "must_exclude"):
            if c.params.course_id not in idx.course_by_id:
                fields.append((f"{p}.course_id", "unknown_course"))
            elif c.type == "must_include" and c.params.allowed_section_ids is not None:
                for j, sid in enumerate(c.params.allowed_section_ids):
                    s = idx.section_by_id.get(sid)
                    if s is None or s.course_id != c.params.course_id:
                        fields.append((f"{p}.allowed_section_ids[{j}]", "section_not_in_course"))
        elif c.type == "category_min":
            for j, cat in enumerate(c.params.category_ids):
                if cat not in idx.category_ids:
                    fields.append((f"{p}.category_ids[{j}]", "unknown_category"))
        elif c.type == "instructor_avoid":
            for j, iid in enumerate(c.params.instructor_ids):
                if iid not in idx.instructor_ids:
                    fields.append((f"{p}.instructor_ids[{j}]", "unknown_instructor"))
    if fields:
        raise RequestProblem(422, "REFERENCE_ERROR", "요청에 카탈로그에 없는 참조나 잘못된 값이 있습니다.", fields)
    return idx
