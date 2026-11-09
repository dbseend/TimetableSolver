"""카탈로그 의미 검증, revision 해시, 인덱스. OR-Tools·FastAPI에 의존하지 않는다."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.contracts import Catalog, Meeting, RowIssue, Section


class CreditParseError(ValueError):
    pass


def credit_to_units(text: str) -> int:
    """'1.5' -> 150. Decimal로 엄밀히 변환, 0.01 학점보다 세밀하면 오류(자동 반올림 금지)."""
    try:
        d = Decimal(text.strip())
    except (InvalidOperation, AttributeError) as e:
        raise CreditParseError("CREDIT_NOT_NUMBER") from e
    if not d.is_finite() or d < 0:
        raise CreditParseError("CREDIT_INVALID")
    units = d * 100
    if units != units.to_integral_value():
        raise CreditParseError("CREDIT_PRECISION_UNSUPPORTED")
    return int(units)


def parse_hhmm(text: str, *, is_end: bool) -> int:
    """'09:10' -> 550. '24:00'은 종료 시각에만 허용."""
    t = text.strip()
    parts = t.split(":")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit() or len(parts[1]) != 2:
        raise ValueError("TIME_FORMAT")
    h, m = int(parts[0]), int(parts[1])
    if m >= 60:
        raise ValueError("TIME_RANGE")
    total = h * 60 + m
    if total > 1440 or (total == 1440 and not is_end):
        raise ValueError("TIME_RANGE")
    return total


def overlaps(a: Meeting, b: Meeting) -> bool:
    """[start,end) 겹침. 같은 요일만."""
    return a.day == b.day and a.start_minute < b.end_minute and b.start_minute < a.end_minute


def sections_conflict(a: Section, b: Section) -> bool:
    """모든 Meeting 쌍을 검사한다(첫 Meeting만 보지 않는다)."""
    return any(overlaps(ma, mb) for ma in a.meetings for mb in b.meetings)


def canonical_json(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def catalog_revision(catalog: Catalog) -> str:
    return hashlib.sha256(canonical_json(catalog.model_dump(mode="json")).encode("utf-8")).hexdigest()


@dataclass
class CatalogIndex:
    catalog: Catalog
    course_by_id: dict = field(default_factory=dict)
    section_by_id: dict = field(default_factory=dict)
    instructor_ids: set = field(default_factory=set)
    category_ids: set = field(default_factory=set)
    sections_by_course: dict = field(default_factory=dict)

    @classmethod
    def build(cls, catalog: Catalog) -> CatalogIndex:
        idx = cls(catalog)
        for c in catalog.courses:
            idx.course_by_id[c.id] = c
            idx.category_ids.update(c.category_ids)
        for cats in catalog.category_groups.values():
            idx.category_ids.update(cats)
        for i in catalog.instructors:
            idx.instructor_ids.add(i.id)
        for s in catalog.sections:
            idx.section_by_id[s.id] = s
            idx.sections_by_course.setdefault(s.course_id, []).append(s)
        return idx

    def units_of(self, section_id: str) -> int:
        return self.course_by_id[self.section_by_id[section_id].course_id].credit_units


def validate_catalog_semantics(catalog: Catalog) -> tuple[list[RowIssue], list[RowIssue]]:
    """구조(Pydantic) 이후의 참조·의미 검증. (errors, warnings)."""
    errors: list[RowIssue] = []
    warnings: list[RowIssue] = []

    def err(path: str, code: str, msg: str) -> None:
        errors.append(RowIssue(path=path, code=code, message=msg))

    seen: set[str] = set()
    for i, c in enumerate(catalog.courses):
        if c.id in seen:
            err(f"courses[{i}].id", "DUPLICATE_COURSE_ID", f"중복 과목 ID: {c.id}")
        seen.add(c.id)
    inst_seen: set[str] = set()
    for i, ins in enumerate(catalog.instructors):
        if ins.id in inst_seen:
            err(f"instructors[{i}].id", "DUPLICATE_INSTRUCTOR_ID", f"중복 교수 ID: {ins.id}")
        inst_seen.add(ins.id)
    sec_seen: set[str] = set()
    for i, s in enumerate(catalog.sections):
        p = f"sections[{i}]"
        if s.id in sec_seen:
            err(f"{p}.id", "DUPLICATE_SECTION_ID", f"중복 분반 ID: {s.id}")
        sec_seen.add(s.id)
        if s.course_id not in seen:
            err(f"{p}.course_id", "UNKNOWN_COURSE", f"존재하지 않는 과목 참조: {s.course_id}")
        for iid in s.instructor_ids:
            if iid not in inst_seen:
                err(f"{p}.instructor_ids", "UNKNOWN_INSTRUCTOR", f"존재하지 않는 교수 참조: {iid}")
        if s.support_status == "unsupported":
            if not s.issue_codes:
                err(f"{p}.issue_codes", "UNSUPPORTED_WITHOUT_REASON", "미지원 분반에는 문제 코드가 필요합니다")
            continue
        if s.issue_codes:
            err(f"{p}.issue_codes", "SUPPORTED_WITH_ISSUES", "문제 코드가 있는 분반은 unsupported여야 합니다")
        if s.delivery_mode in ("in_person", "online_sync") and not s.meetings:
            err(f"{p}.meetings", "MEETINGS_REQUIRED", "대면/동기 수업은 최소 1개 Meeting이 필요합니다(시간 미정이면 unsupported)")
        if s.delivery_mode == "online_async" and s.meetings:
            err(f"{p}.meetings", "ASYNC_WITH_MEETINGS", "비동기 수업은 meetings=[] 이어야 합니다")
        for j, m in enumerate(s.meetings):
            if s.delivery_mode == "online_sync" and m.campus_required:
                warnings.append(RowIssue(path=f"{p}.meetings[{j}]", code="SYNC_CAMPUS_REQUIRED", message="동기 온라인 수업이 등교 필요로 표시됨"))
        for j in range(len(s.meetings)):
            for k in range(j + 1, len(s.meetings)):
                if overlaps(s.meetings[j], s.meetings[k]):
                    err(f"{p}.meetings[{k}]", "INTRA_SECTION_OVERLAP", f"분반 {s.id} 내부 Meeting이 겹칩니다")
    for g, cats in catalog.category_groups.items():
        if not cats:
            err(f"category_groups.{g}", "EMPTY_GROUP", "빈 카테고리 그룹")
    return errors, warnings
