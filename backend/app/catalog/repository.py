"""Supabase catalog repository (reads semesters and catalogs via PostgREST)."""

import logging

import httpx

from app.core.errors import ApiError
from app.domain.api_models import Semester
from app.domain.models import Catalog

logger = logging.getLogger(__name__)


class CatalogRepository:
    def __init__(
        self,
        supabase_url: str | None,
        supabase_key: str | None,
        client: httpx.Client | None = None,
    ) -> None:
        self.url = (supabase_url or "").rstrip("/")
        self.key = supabase_key or ""
        self._client = client
        self._cache: dict[str, Catalog] = {}

    @property
    def is_enabled(self) -> bool:
        return bool(self.url and self.key)

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        }

    def _get(self, path: str) -> httpx.Response:
        url = f"{self.url}{path}"
        headers = self._headers()
        if self._client:
            return self._client.get(url, headers=headers)
        with httpx.Client(timeout=15.0) as client:
            return client.get(url, headers=headers)

    def list_semesters(self) -> list[Semester]:
        if not self.is_enabled:
            raise ApiError(503, "db_disabled", "database is not configured")

        try:
            res = self._get("/rest/v1/semesters?select=id,label,is_synthetic&order=created_at.asc")
        except httpx.HTTPError as e:
            logger.warning("Supabase request failed: %s", e)
            raise ApiError(502, "db_unavailable", "database request failed") from e

        if not res.is_success:
            logger.warning("Supabase returned error %s: %s", res.status_code, res.text)
            raise ApiError(502, "db_unavailable", f"database returned status {res.status_code}")

        data = res.json()
        return [Semester.model_validate(row) for row in data]

    def get_catalog(self, semester_id: str) -> Catalog:
        if not self.is_enabled:
            raise ApiError(503, "db_disabled", "database is not configured")

        if semester_id in self._cache:
            return self._cache[semester_id]

        try:
            res = self._get(f"/rest/v1/catalogs?semester_id=eq.{semester_id}&select=data")
        except httpx.HTTPError as e:
            logger.warning("Supabase request failed: %s", e)
            raise ApiError(502, "db_unavailable", "database request failed") from e

        if not res.is_success:
            logger.warning("Supabase returned error %s: %s", res.status_code, res.text)
            raise ApiError(502, "db_unavailable", f"database returned status {res.status_code}")

        rows = res.json()
        if not rows or "data" not in rows[0]:
            raise ApiError(404, "not_found", f"catalog for semester '{semester_id}' not found")

        catalog = Catalog.model_validate(rows[0]["data"])
        self._cache[semester_id] = catalog
        return catalog
