"""LLM access: one JSON-returning call, a disk cache, and a daily call cap (ADR 0004).

Prompts and responses can contain user text: the cache lives under a gitignored `llm_cache/`
directory and nothing here is logged.
"""

import datetime
import hashlib
import json
import threading
from pathlib import Path
from typing import Protocol


class LLMError(Exception):
    """The provider failed or refused; `code` maps to the API error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class Provider(Protocol):
    model: str

    def generate_json(self, system: str, user: str, schema: dict) -> str: ...


class GeminiProvider:
    def __init__(self, api_key: str, model: str) -> None:
        from google import genai  # imported lazily: only needed when the LLM is enabled

        self._client = genai.Client(api_key=api_key)
        self.model = model

    def generate_json(self, system: str, user: str, schema: dict) -> str:
        from google.genai import errors, types

        try:
            response = self._client.models.generate_content(
                model=self.model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_json_schema=schema,
                    temperature=0,
                ),
            )
        except errors.APIError as e:
            code = "llm_rate_limited" if e.code == 429 else "llm_unavailable"
            raise LLMError(code, f"LLM provider error {e.code}") from None
        if not response.text:
            raise LLMError("llm_unavailable", "LLM returned no content")
        return response.text


class CachedProvider:
    """Disk cache keyed by (model, system, user, schema) plus a per-process daily cap on misses.

    shortcut: the counter is in memory, so a restart resets it; fine for one free-tier instance,
    move it to the database if the backend ever runs several workers.
    """

    def __init__(self, inner: Provider, cache_dir: Path, daily_limit: int) -> None:
        self.inner = inner
        self.model = inner.model
        self.cache_dir = cache_dir
        self.daily_limit = daily_limit
        self._lock = threading.Lock()
        self._day = datetime.date.today()
        self._calls = 0

    def _key(self, system: str, user: str, schema: dict) -> str:
        blob = json.dumps([self.model, system, user, schema], ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()

    def generate_json(self, system: str, user: str, schema: dict) -> str:
        path = self.cache_dir / f"{self._key(system, user, schema)}.json"
        if path.exists():
            return path.read_text(encoding="utf-8")
        with self._lock:
            today = datetime.date.today()
            if today != self._day:
                self._day, self._calls = today, 0
            if self._calls >= self.daily_limit:
                raise LLMError("llm_daily_limit", "daily LLM call limit reached")
            self._calls += 1
        text = self.inner.generate_json(system, user, schema)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return text
