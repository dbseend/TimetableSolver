"""기본 학교 카탈로그 제공 API. 합성 픽스처(fixtures/default-catalogs)와 임시 폴더만 사용(실데이터 없음)."""

from __future__ import annotations

import asyncio
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from app.application import default_catalogs
from app.contracts import SolveRequest
from app.domain.catalog import catalog_revision
from app.main import app
from app.solver.runner import make_runner
from tests.helpers import ROOT

FIX = ROOT / "fixtures" / "default-catalogs"


@pytest.fixture
def client(monkeypatch, tmp_path):
    d = tmp_path / "catalogs"
    shutil.copytree(FIX, d)
    monkeypatch.setenv("CATALOG_DIR", str(d))
    default_catalogs._cache.clear()
    return TestClient(app), d


def test_list_shows_term_as_of_counts_and_reasons(client):
    c, _ = client
    body = c.get("/api/v1/catalogs").json()
    [s] = body["catalogs"]
    assert s["id"] == "synthetic-2026-2" and s["term_id"] == "2026-2" and s["as_of"] == "2026-11-09" and s["valid"]
    assert s["stats"] == {"courses": 4, "sections": 4, "supported_sections": 2, "unsupported_sections": 2}
    assert s["exclusion_reasons"] == {"PERIOD_TABLE_MISSING_FOR_DAY": 1, "TIME_TBD": 1}


def test_get_returns_server_validated_catalog_with_revision_and_local_meta(client):
    c, _ = client
    r = c.get("/api/v1/catalogs/synthetic-2026-2").json()
    assert r["catalog_revision"] == catalog_revision(default_catalogs.Catalog.model_validate(r["catalog"]))
    assert r["major_type_categories"] == ["전필", "전선"]
    assert r["course_orgs"]["SYN101"] == "가상학부 주간"
    # 업로드 경로와 같은 검증 엔드포인트도 같은 revision
    v = c.post("/api/v1/catalog/validate", json={"catalog": r["catalog"]}).json()
    assert v["valid"] and v["catalog_revision"] == r["catalog_revision"]


def test_default_catalog_solves_with_same_solver(client):
    from app.application.solve import solve

    c, _ = client
    r = c.get("/api/v1/catalogs/synthetic-2026-2").json()
    allowed = [s["id"] for s in r["catalog"]["sections"] if s["support_status"] == "supported"]
    req = SolveRequest.model_validate(
        {
            "catalog": r["catalog"],
            "catalog_revision": r["catalog_revision"],
            "allowed_section_ids": allowed,
            "constraints": [{"id": "cr", "type": "credit_range", "strength": "hard", "weight": None, "params": {"min_units": 300, "max_units": 400}}],
            "confirmation": {"input_revision": 1, "confirmed_revision": 1},
        }
    )
    res = asyncio.run(solve(req, make_runner(), "rid"))
    assert res.status == "optimal" and res.candidates and all(cand.hard_validation == "passed" for cand in res.candidates)


def test_invalid_file_listed_but_not_served(client):
    c, d = client
    bad = json.loads((d / "synthetic-2026-2.catalog.json").read_text(encoding="utf-8"))
    bad["sections"][0]["course_id"] = "NOPE"  # 의미 검증 실패(없는 과목 참조)
    (d / "broken.catalog.json").write_text(json.dumps(bad), encoding="utf-8")
    listed = {s["id"]: s for s in c.get("/api/v1/catalogs").json()["catalogs"]}
    assert listed["broken"]["valid"] is False and listed["broken"]["stats"] == {}
    assert c.get("/api/v1/catalogs/broken").status_code == 404


def test_reload_on_file_change(client):
    c, d = client
    meta = json.loads((d / "synthetic-2026-2.meta.json").read_text(encoding="utf-8"))
    meta["as_of"] = "2026-12-01"
    (d / "synthetic-2026-2.meta.json").write_text(json.dumps(meta), encoding="utf-8")
    assert c.get("/api/v1/catalogs").json()["catalogs"][0]["as_of"] == "2026-12-01"


def test_ids_cannot_escape_directory_and_missing_dir_is_empty(client, monkeypatch, tmp_path):
    c, _ = client
    for bad in ["..%2F..%2Fetc", "nope", "a b", "x" * 80]:
        assert c.get(f"/api/v1/catalogs/{bad}").status_code == 404
    monkeypatch.setenv("CATALOG_DIR", str(tmp_path / "does-not-exist"))
    assert c.get("/api/v1/catalogs").json() == {"catalogs": []}


def test_default_dir_is_repo_relative_not_absolute(monkeypatch):
    monkeypatch.delenv("CATALOG_DIR", raising=False)
    assert default_catalogs.catalog_dir() == ROOT / "local-data" / "catalogs"
