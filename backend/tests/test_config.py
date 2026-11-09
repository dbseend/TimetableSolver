import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _no_env_override(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)  # conftest pins it to "none"


def make(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def test_default_provider_is_gemini_and_disabled_without_key():
    s = make()
    assert s.llm_provider == "gemini"
    assert not s.llm_enabled


def test_enabled_with_gemini_and_key():
    assert make(llm_api_key="test-key").llm_enabled


def test_none_provider_disables_even_with_key():
    assert not make(llm_provider="none", llm_api_key="test-key").llm_enabled


def test_provider_is_case_insensitive():
    assert make(llm_provider=" Gemini ").llm_provider == "gemini"


def test_unknown_provider_rejected():
    with pytest.raises(ValidationError):
        make(llm_provider="openai")


def test_blank_key_counts_as_missing():
    assert not make(llm_api_key="  ").llm_enabled


def test_server_starts_without_key():
    r = TestClient(create_app(make())).get("/health")
    assert r.status_code == 200
