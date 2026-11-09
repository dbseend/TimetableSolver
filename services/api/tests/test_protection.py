"""배포 보호 장치: 접근 비밀번호, IP별 요청 제한, live LLM 일일 상한, 정적 프론트 제공."""

import base64
import importlib
import subprocess
import sys
import textwrap

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.protection import RateLimiter, limiter
from tests.test_parse import ENTITIES

PARSE_BODY = {"text": "금요일 공강", "catalog_revision": "a" * 64, "input_revision": 1, "entities": ENTITIES}


@pytest.fixture
def client(monkeypatch):
    for k in ("ACCESS_PASSWORD", "ACCESS_USER", "PARSE_PER_MIN", "SOLVE_PER_MIN", "LLM_DAILY_LIMIT", "TRUST_PROXY"):
        monkeypatch.delenv(k, raising=False)
    limiter.reset()
    yield TestClient(main_module.app)
    limiter.reset()


def basic(user, pw):
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode()}


def test_no_password_means_open(client):
    assert client.get("/api/v1/capabilities").status_code == 200


def test_basic_auth_required_except_health(client, monkeypatch):
    monkeypatch.setenv("ACCESS_PASSWORD", "s3cret-pw")
    assert client.get("/api/v1/health").status_code == 200  # 플랫폼 health check
    r = client.get("/api/v1/capabilities")
    assert r.status_code == 401 and r.headers["www-authenticate"].startswith("Basic")
    assert "s3cret-pw" not in r.text
    assert client.get("/api/v1/capabilities", headers=basic("student", "wrong")).status_code == 401
    assert client.get("/api/v1/capabilities", headers=basic("other", "s3cret-pw")).status_code == 401
    assert client.get("/api/v1/capabilities", headers={"Authorization": "Basic !!!"}).status_code == 401
    assert client.get("/api/v1/capabilities", headers=basic("student", "s3cret-pw")).status_code == 200
    monkeypatch.setenv("ACCESS_USER", "team")
    assert client.get("/api/v1/capabilities", headers=basic("team", "s3cret-pw")).status_code == 200


def test_parse_rate_limit_429_with_korean_message(client, monkeypatch):
    monkeypatch.setenv("PARSE_PER_MIN", "2")
    codes = [client.post("/api/v1/constraints/parse", json=PARSE_BODY).status_code for _ in range(3)]
    assert codes[:2] == [200, 200] and codes[2] == 429
    r = client.post("/api/v1/constraints/parse", json=PARSE_BODY)
    j = r.json()["error"]
    assert j["code"] == "RATE_LIMITED" and "직접 조건 추가" in j["message"] and r.headers["retry-after"] == "60"
    # 다른 경로(조회)는 영향 없음
    assert client.get("/api/v1/capabilities").status_code == 200


def test_solve_limit_per_ip_and_trust_proxy(client, monkeypatch):
    monkeypatch.setenv("SOLVE_PER_MIN", "1")
    monkeypatch.setenv("TRUST_PROXY", "1")
    # 본문이 잘못돼도(422) 요청 제한은 먼저 센다 — 계산 비용이 드는 경로 보호
    a = {"X-Forwarded-For": "203.0.113.1"}
    b = {"X-Forwarded-For": "203.0.113.2, 10.0.0.1"}
    assert client.post("/api/v1/solve", json={}, headers=a).status_code == 422
    assert client.post("/api/v1/solve", json={}, headers=a).status_code == 429
    assert client.post("/api/v1/diagnose", json={}, headers=a).status_code == 429  # 같은 계산 버킷
    assert client.post("/api/v1/solve", json={}, headers=b).status_code == 422


def test_limits_off_by_default_in_code(client):
    assert all(client.post("/api/v1/solve", json={}).status_code == 422 for _ in range(30))


def test_sliding_window_and_llm_daily_counter():
    rl = RateLimiter()
    assert rl.allow("p", "ip", 2, now=0) and rl.allow("p", "ip", 2, now=1)
    assert not rl.allow("p", "ip", 2, now=59)
    assert rl.allow("p", "ip", 2, now=60.5)  # 첫 요청이 창 밖으로
    assert rl.take_llm_call(2, today="2026-11-09") and rl.take_llm_call(2, today="2026-11-09")
    assert not rl.take_llm_call(2, today="2026-11-09")
    assert rl.take_llm_call(2, today="2026-11-10")  # 날짜가 바뀌면 초기화
    assert rl.take_llm_call(0)  # 0=무제한


class _LiveProvider:
    mode = "live"

    def __init__(self):
        self.calls = 0

    def parse(self, body):
        self.calls += 1
        raise AssertionError("상한 테스트에서는 호출 여부만 센다")


def test_llm_daily_limit_blocks_live_calls_before_calling(client, monkeypatch):
    p = _LiveProvider()
    monkeypatch.setattr(main_module, "provider_from_env", lambda: p)
    monkeypatch.setenv("LLM_DAILY_LIMIT", "1")
    limiter.take_llm_call(1)  # 오늘 한도 소진
    r = client.post("/api/v1/constraints/parse", json=PARSE_BODY)
    assert r.status_code == 429 and r.json()["error"]["code"] == "LLM_DAILY_LIMIT"
    assert "직접 조건 추가" in r.json()["error"]["message"]
    assert p.calls == 0


def test_fixture_mode_does_not_consume_llm_quota(client, monkeypatch):
    monkeypatch.setenv("LLM_DAILY_LIMIT", "1")
    for _ in range(3):
        assert client.post("/api/v1/constraints/parse", json=PARSE_BODY).status_code == 200


def test_web_dist_served_same_origin_api_first(tmp_path):
    """WEB_DIST 설정 시 프론트를 같은 주소에서 제공하고 API 경로가 우선한다(별도 프로세스에서 import)."""
    (tmp_path / "index.html").write_text("<!doctype html><title>tt</title>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    code = textwrap.dedent(
        """
        import os, sys
        os.environ["WEB_DIST"] = sys.argv[1]
        from fastapi.testclient import TestClient
        from app.main import app
        c = TestClient(app)
        assert c.get("/").status_code == 200 and "<title>tt</title>" in c.get("/").text
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/api/v1/health").json() == {"status": "ok"}
        assert c.get("/api/v1/nope").status_code == 404
        print("static-ok")
        """
    )
    out = subprocess.run([sys.executable, "-c", code, str(tmp_path)], capture_output=True, text=True, timeout=60)
    assert "static-ok" in out.stdout, out.stderr


def test_without_web_dist_no_static_mount():
    importlib.import_module("app.main")
    assert not any(getattr(r, "name", "") == "web" for r in main_module.app.routes)
