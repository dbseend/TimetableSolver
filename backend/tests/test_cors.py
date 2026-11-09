from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def make_client(**kw) -> TestClient:
    return TestClient(create_app(Settings(_env_file=None, **kw)))


def test_allowed_origin_gets_cors_header():
    c = make_client(allowed_origins="https://app.example.com")
    r = c.get("/health", headers={"Origin": "https://app.example.com"})
    assert r.headers.get("access-control-allow-origin") == "https://app.example.com"


def test_other_origin_gets_no_cors_header():
    c = make_client(allowed_origins="https://app.example.com")
    r = c.get("/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in r.headers


def test_preview_regex_allows_project_prefix_only():
    c = make_client(
        allowed_origins="https://app.example.com",
        allowed_origin_regex=r"^https://timetablesolver-[a-z0-9-]+\.vercel\.app$",
    )
    ok = c.get("/health", headers={"Origin": "https://timetablesolver-git-feat-x.vercel.app"})
    assert ok.headers.get("access-control-allow-origin")
    other = c.get("/health", headers={"Origin": "https://someone-else.vercel.app"})
    assert "access-control-allow-origin" not in other.headers


def test_preflight():
    c = make_client(allowed_origins="https://app.example.com")
    r = c.options(
        "/solve",
        headers={
            "Origin": "https://app.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://app.example.com"


def test_empty_env_values_become_none():
    s = Settings(_env_file=None, allowed_origin_regex="", llm_api_key="", llm_model="")
    assert s.allowed_origin_regex is None
    assert s.llm_api_key is None
    assert s.llm_model is None
