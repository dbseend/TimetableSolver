from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from environment variables (and an optional .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # CORS
    allowed_origins: str = "http://localhost:5173"
    allowed_origin_regex: str | None = None

    # Solver / limits
    solver_time_limit_s: float = Field(default=5.0, gt=0)
    max_input_chars: int = Field(default=2000, gt=0)
    daily_llm_call_limit: int = Field(default=200, ge=0)

    # LLM (server-side only; never expose to the client)
    llm_provider: Literal["gemini", "none"] = "gemini"
    llm_model: str | None = None
    llm_api_key: SecretStr | None = None

    log_level: str = "INFO"

    @field_validator("allowed_origin_regex", "llm_model", mode="before")
    @classmethod
    def _empty_to_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("llm_api_key", mode="before")
    @classmethod
    def _empty_key_to_none(cls, v: object) -> object:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("llm_provider", mode="before")
    @classmethod
    def _normalize_provider(cls, v: object) -> object:
        return v.strip().lower() if isinstance(v, str) else v

    @property
    def llm_enabled(self) -> bool:
        """LLM features need a provider and a key; the server starts either way."""
        return self.llm_provider != "none" and self.llm_api_key is not None

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
