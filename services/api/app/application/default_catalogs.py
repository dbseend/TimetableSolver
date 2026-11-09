"""기본 학교 카탈로그 제공(관리자가 `apps/web/scripts/build-school-catalog.mjs`로 변환해 둔 파일).

- 위치: 환경 변수 `CATALOG_DIR`, 없으면 저장소 기준 `local-data/catalogs`(Git 제외). 개발 PC 절대경로를 코드에 두지 않는다.
- 파일: `<id>.catalog.json`(계약 Catalog) + `<id>.meta.json`(기준일·출처·제외 사유·개설 소속).
- 업로드 카탈로그와 **같은 검증**: Pydantic strict 모델 + `validate_catalog_semantics` + `catalog_revision`. 검증 실패 파일은
  목록에 `valid=false`로만 보이고 내려주지 않는다.
- 파일 변경(mtime·크기)을 감지해 다시 읽는다. ID는 파일 이름 규칙으로만 찾는다(경로 조작 차단).
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from app.contracts import Catalog, DefaultCatalogResponse, DefaultCatalogSummary
from app.domain.catalog import catalog_revision, validate_catalog_semantics

log = logging.getLogger("timetable.catalogs")
ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
REPO_ROOT = Path(__file__).resolve().parents[4]


def catalog_dir() -> Path:
    env = os.environ.get("CATALOG_DIR")
    if env:
        p = Path(env)
        return p if p.is_absolute() else (Path.cwd() / p).resolve()
    return REPO_ROOT / "local-data" / "catalogs"


@dataclass
class _Entry:
    key: tuple
    summary: DefaultCatalogSummary
    response: DefaultCatalogResponse | None


_cache: dict[str, _Entry] = {}


def _load(cid: str, cat_path: Path, meta_path: Path) -> _Entry:
    key = tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in (cat_path, meta_path))
    hit = _cache.get(cid)
    if hit and hit.key == key:
        return hit
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except ValueError:
            meta = {}
    summ = meta.get("import_summary") or {}
    base = {
        "id": cid,
        "term_id": str(meta.get("term_id") or ""),
        "label": str(meta.get("label") or cid),
        "as_of": meta.get("as_of"),
        "source_file": meta.get("source_file"),
        "generated_at": meta.get("generated_at"),
        "period_table_basis": meta.get("period_table_basis"),
        "excluded_courses": int(summ.get("excluded_courses") or 0),
    }
    try:
        catalog = Catalog.model_validate_json(cat_path.read_text(encoding="utf-8"))
        errors, _ = validate_catalog_semantics(catalog)
        if errors:
            raise ValueError(f"{len(errors)} semantic errors (first: {errors[0].code})")
    except Exception as e:  # noqa: BLE001  잘못된 파일은 목록에만 표시하고 내려주지 않는다
        log.warning("default catalog %s invalid: %s", cid, type(e).__name__)
        summary = DefaultCatalogSummary(**{**base, "valid": False, "error": "카탈로그 검증 실패", "stats": {}, "exclusion_reasons": {}})
        entry = _Entry(key, summary, None)
        _cache[cid] = entry
        return entry
    unsupported = [s for s in catalog.sections if s.support_status != "supported"]
    reasons: dict[str, int] = {}
    for s in unsupported:
        for code in s.issue_codes:
            reasons[code] = reasons.get(code, 0) + 1
    summary = DefaultCatalogSummary(
        **{
            **base,
            "term_id": base["term_id"] or catalog.term_id,
            "valid": True,
            "error": None,
            "stats": {
                "courses": len(catalog.courses),
                "sections": len(catalog.sections),
                "supported_sections": len(catalog.sections) - len(unsupported),
                "unsupported_sections": len(unsupported),
            },
            "exclusion_reasons": reasons,
        }
    )
    resp = DefaultCatalogResponse(
        summary=summary,
        catalog=catalog,
        catalog_revision=catalog_revision(catalog),
        course_orgs={k: str(v) for k, v in (meta.get("course_orgs") or {}).items()},
        major_type_categories=[str(x) for x in meta.get("major_type_categories") or []],
        import_issues=[i for i in meta.get("import_issues") or [] if isinstance(i, dict)],
    )
    entry = _Entry(key, summary, resp)
    _cache[cid] = entry
    return entry


def _files() -> dict[str, tuple[Path, Path]]:
    d = catalog_dir()
    if not d.is_dir():
        return {}
    out = {}
    for p in sorted(d.glob("*.catalog.json")):
        cid = p.name[: -len(".catalog.json")]
        if ID_RE.match(cid):
            out[cid] = (p, d / f"{cid}.meta.json")
    return out


def list_catalogs() -> list[DefaultCatalogSummary]:
    items = [_load(cid, c, m).summary for cid, (c, m) in _files().items()]
    return sorted(items, key=lambda s: (s.term_id, s.id), reverse=True)


def get_catalog(cid: str) -> DefaultCatalogResponse | None:
    if not ID_RE.match(cid):
        return None
    f = _files().get(cid)
    if f is None:
        return None
    return _load(cid, *f).response
