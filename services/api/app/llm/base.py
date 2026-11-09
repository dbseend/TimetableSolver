"""LLM provider 인터페이스. provider는 '초안'만 만든다. 분반 선택·코드 실행을 하지 않는다."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.contracts import ParseRequest


@dataclass
class ProviderOutput:
    drafts: list[dict] = field(default_factory=list)  # DraftConstraint 형태의 dict
    questions: list[dict] = field(default_factory=list)
    unsupported: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class ProviderError(Exception):
    """provider 실패. code: TIMEOUT | RATE_LIMITED | BAD_RESPONSE | REFUSED | TRUNCATED | HTTP_ERROR."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class LLMProvider(Protocol):
    mode: str  # "live" | "fixture"

    def parse(self, req: ParseRequest) -> ProviderOutput: ...
