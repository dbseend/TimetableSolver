import httpx
import pytest
from fastapi.testclient import TestClient

from app.catalog.repository import CatalogRepository
from app.core.config import Settings
from app.core.errors import ApiError
from app.domain.models import Catalog
from app.main import create_app

SAMPLE_CATALOG_DATA = {
    "courses": [
        {"id": "SYN101", "name": "과목 A", "credit": 3.0, "category": "교양", "prerequisites": []}
    ],
    "sections": [
        {
            "id": "SYN101-01",
            "course_id": "SYN101",
            "meetings": [{"day": "Mon", "start": "09:00", "end": "10:15"}],
        }
    ],
}


def test_config_supabase_settings():
    s_disabled = Settings(_env_file=None)
    assert not s_disabled.db_enabled

    s_enabled = Settings(
        _env_file=None,
        supabase_url="https://test.supabase.co",
        supabase_key="test-key",
    )
    assert s_enabled.db_enabled
    assert s_enabled.supabase_url == "https://test.supabase.co"
    assert s_enabled.supabase_key.get_secret_value() == "test-key"

    s_blank = Settings(_env_file=None, supabase_url="  ", supabase_key="  ")
    assert not s_blank.db_enabled


def test_repo_disabled_raises_503():
    repo = CatalogRepository(None, None)
    assert not repo.is_enabled
    with pytest.raises(ApiError) as exc:
        repo.list_semesters()
    assert exc.value.status_code == 503
    assert exc.value.code == "db_disabled"

    with pytest.raises(ApiError) as exc:
        repo.get_catalog("synthetic-50")
    assert exc.value.status_code == 503
    assert exc.value.code == "db_disabled"


def test_repo_list_semesters_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["apikey"] == "secret"
        assert request.headers["authorization"] == "Bearer secret"
        assert "/rest/v1/semesters" in str(request.url)
        return httpx.Response(
            200,
            json=[
                {"id": "synthetic-50", "label": "합성 50분반", "is_synthetic": True},
                {"id": "2026-2", "label": "2026년 2학기", "is_synthetic": False},
            ],
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    repo = CatalogRepository("https://test.supabase.co", "secret", client=client)
    assert repo.is_enabled
    semesters = repo.list_semesters()
    assert len(semesters) == 2
    assert semesters[0].id == "synthetic-50"
    assert semesters[0].is_synthetic is True
    assert semesters[1].id == "2026-2"


def test_repo_get_catalog_success_and_caching():
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        assert "semester_id=eq.synthetic-50" in str(request.url)
        return httpx.Response(200, json=[{"data": SAMPLE_CATALOG_DATA}])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    repo = CatalogRepository("https://test.supabase.co", "secret", client=client)
    cat1 = repo.get_catalog("synthetic-50")
    assert isinstance(cat1, Catalog)
    assert len(cat1.courses) == 1
    assert cat1.courses[0].id == "SYN101"
    assert call_count == 1

    # Second call should use in-memory cache
    cat2 = repo.get_catalog("synthetic-50")
    assert cat2 is cat1
    assert call_count == 1


def test_repo_get_catalog_not_found():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    repo = CatalogRepository("https://test.supabase.co", "secret", client=client)
    with pytest.raises(ApiError) as exc:
        repo.get_catalog("non-existent")
    assert exc.value.status_code == 404
    assert exc.value.code == "not_found"


def test_repo_http_error_handling():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal DB error")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    repo = CatalogRepository("https://test.supabase.co", "secret", client=client)
    with pytest.raises(ApiError) as exc:
        repo.list_semesters()
    assert exc.value.status_code == 502
    assert exc.value.code == "db_unavailable"


def test_api_semesters_and_catalog_endpoints():
    def handler(request: httpx.Request) -> httpx.Response:
        if "/rest/v1/semesters" in str(request.url):
            return httpx.Response(
                200,
                json=[{"id": "synthetic-50", "label": "합성 50분반", "is_synthetic": True}],
            )
        if "semester_id=eq.synthetic-50" in str(request.url):
            return httpx.Response(200, json=[{"data": SAMPLE_CATALOG_DATA}])
        return httpx.Response(200, json=[])

    settings = Settings(
        _env_file=None,
        supabase_url="https://test.supabase.co",
        supabase_key="secret",
    )
    app = create_app(settings)
    app.state.catalog_repo = CatalogRepository(
        "https://test.supabase.co",
        "secret",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    client = TestClient(app)

    # GET /semesters
    r = client.get("/semesters")
    assert r.status_code == 200
    data = r.json()
    assert "semesters" in data
    assert len(data["semesters"]) == 1
    assert data["semesters"][0]["id"] == "synthetic-50"

    # GET /catalog/synthetic-50
    r_cat = client.get("/catalog/synthetic-50")
    assert r_cat.status_code == 200
    assert r_cat.headers.get("cache-control") == "public, max-age=3600"
    cat_data = r_cat.json()
    assert len(cat_data["courses"]) == 1
    assert cat_data["courses"][0]["id"] == "SYN101"

    # GET /catalog?semester=synthetic-50
    r_cat_q = client.get("/catalog?semester=synthetic-50")
    assert r_cat_q.status_code == 200
    assert r_cat_q.json() == cat_data

    # GET /catalog/unknown -> 404
    r_404 = client.get("/catalog/unknown")
    assert r_404.status_code == 404
    assert r_404.json()["error"]["code"] == "not_found"


def test_api_endpoints_disabled_when_no_repo():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    client = TestClient(app)

    r = client.get("/semesters")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "db_disabled"

    r = client.get("/catalog/synthetic-50")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "db_disabled"
