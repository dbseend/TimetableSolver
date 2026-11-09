"""API 계약·오류 형식·개인정보 비노출·실제 자식 프로세스 runner 테스트."""

import asyncio
import json
import logging
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.solver.runner import ProcessRunner, SolverBusy, SolverTimeout
from tests.helpers import con, credit, load_catalog, make_request, tiny_base


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def body(constraints, **kw):
    return json.loads(make_request(load_catalog(), constraints, **kw).model_dump_json())


def test_health_ready_capabilities(client):
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    r = client.get("/api/v1/ready").json()
    assert r["solver"] is True and r["manual_mode_available"] is True
    cap = client.get("/api/v1/capabilities").json()
    assert "lunch_free" in cap["unsupported_constraint_types"]
    assert cap["features"]["xlsx_import"] == "not_implemented"
    assert cap["features"]["diagnose_multi_change"] == "not_implemented"


def test_solve_end_to_end_subprocess(client):
    r = client.post("/api/v1/solve", json=body(tiny_base() + [con("fri", "day_off", days=["Fri"])]))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "optimal" and j["search"]["returned_count"] == 2
    assert j["search"]["termination_reason"] == "exhausted_under_diversity"
    assert j["timing"]["process_ms"] is not None
    assert len(j["request_hash"]) == 64


def test_infeasible_is_200(client):
    r = client.post("/api/v1/solve", json=body([credit(600, 600), con("d", "must_include", course_id="D"), con("f", "day_off", days=["Fri"])]))
    assert r.status_code == 200 and r.json()["status"] == "infeasible"


def test_S05_unknown_course_422(client):
    r = client.post("/api/v1/solve", json=body([credit(300, 600), con("x", "must_include", course_id="NOPE")]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "REFERENCE_ERROR"


def test_S09_missing_hard_range_422(client):
    r = client.post("/api/v1/solve", json=body([con("x", "must_include", course_id="A")]))
    assert r.status_code == 422 and r.json()["error"]["code"] == "HARD_CREDIT_RANGE_REQUIRED"


def test_S12_revision_409(client):
    b = body(tiny_base())
    b["catalog_revision"] = "f" * 64
    assert client.post("/api/v1/solve", json=b).status_code == 409
    b = body(tiny_base())
    b["confirmation"]["confirmed_revision"] = 0
    assert client.post("/api/v1/solve", json=b).json()["error"]["code"] == "STALE_CONFIRMATION"


def test_unsupported_constraint_type(client):
    b = body(tiny_base())
    b["constraints"].append(
        {
            "id": "l",
            "type": "lunch_free",
            "strength": "soft",
            "weight": 3,
            "params": {"days": ["Mon"], "window_start": 720, "window_end": 840, "min_free_minutes": 60},
        }
    )
    r = client.post("/api/v1/solve", json=b)
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_CONSTRAINT"


def test_P02_error_does_not_echo_input(client, caplog):
    secret = "학번20261234-성적A+-SECRETVALUE"
    b = body(tiny_base())
    b["catalog"]["catalog_id"] = 12345  # 타입 오류 유발
    b["constraints"][0]["id"] = secret
    b["unexpected_field"] = secret
    with caplog.at_level(logging.INFO):
        r = client.post("/api/v1/solve", json=b)
    assert r.status_code == 422
    assert secret not in r.text
    assert secret not in caplog.text


def test_P05_payload_too_large(client):
    big = b"{" + b" " * (5 * 1024 * 1024 + 10) + b"}"
    r = client.post("/api/v1/solve", content=big, headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_catalog_validate(client):
    cat = load_catalog().model_dump(mode="json")
    r = client.post("/api/v1/catalog/validate", json={"catalog": cat}).json()
    assert r["valid"] and len(r["catalog_revision"]) == 64
    cat["sections"][1]["id"] = cat["sections"][0]["id"]
    r = client.post("/api/v1/catalog/validate", json={"catalog": cat}).json()
    assert not r["valid"] and r["catalog_revision"] is None
    assert any(e["code"] == "DUPLICATE_SECTION_ID" for e in r["errors"])


def test_diagnose_api(client):
    b = body([credit(300, 900), con("incD", "must_include", course_id="D"), con("fri", "day_off", days=["Fri"])])
    r = client.post("/api/v1/diagnose", json=b)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "diagnosed" and j["core_is_minimal"] is False
    assert j["proposals"] and all(p["verification_status"] == "passed" for p in j["proposals"])
    assert all(p["base_request_hash"] == j["request_hash"] for p in j["proposals"])


# ---------------------------------------------------------------- runner (실제 자식 프로세스)
def test_P08_deadline_kills_child():
    runner = ProcessRunner(1)

    async def go():
        with pytest.raises(SolverTimeout):
            await runner.run("sleep", {"seconds": 30}, hard_deadline_s=1.5)
        assert runner.active_pids == set()
        assert not runner.busy()

    t0 = time.perf_counter()
    asyncio.run(go())
    assert time.perf_counter() - t0 < 10


def test_P07_concurrency_limit_429():
    runner = ProcessRunner(1)

    async def go():
        t = asyncio.create_task(runner.run("sleep", {"seconds": 2}, hard_deadline_s=10))
        await asyncio.sleep(0.2)
        with pytest.raises(SolverBusy):
            await runner.run("sleep", {"seconds": 1}, hard_deadline_s=10)
        await t
        assert not runner.busy()

    asyncio.run(go())


def test_P08_cancel_reaps_child():
    runner = ProcessRunner(1)
    from app.solver.runner import SolverCancelled

    async def go():
        flag = {"n": 0}

        async def cancelled():
            flag["n"] += 1
            return flag["n"] > 10

        with pytest.raises(SolverCancelled):
            await runner.run("sleep", {"seconds": 30}, hard_deadline_s=30, is_cancelled=cancelled)
        assert runner.active_pids == set()

    asyncio.run(go())


def test_P09_health_responsive_during_solve():
    async def go():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
            solve_task = asyncio.create_task(ac.post("/api/v1/solve", json=body(tiny_base())))
            await asyncio.sleep(0.3)
            t0 = time.perf_counter()
            h = await ac.get("/api/v1/health")
            dt = time.perf_counter() - t0
            r = await solve_task
            return h.status_code, dt, r.status_code

    hs, dt, ss = asyncio.run(go())
    assert hs == 200 and dt < 0.5 and ss == 200
