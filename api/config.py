"""Settings read from the environment (and from .env in local development)."""

from functools import lru_cache
from urllib.parse import parse_qsl, urlencode

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ASYNC_SCHEME = "postgresql+asyncpg://"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Neon pooled URL (host has -pooler). Used by the app.
    database_url: str
    # Neon direct URL (no -pooler). Used only by Alembic migrations.
    database_url_direct: str | None = None
    # Earth Engine project. The pipeline reads it from the environment first.
    ee_project: str | None = None

    @field_validator("database_url", "database_url_direct")
    @classmethod
    def _to_asyncpg_url(cls, value: str | None) -> str | None:
        """Accept the URL as Neon shows it (libpq style) and convert it for asyncpg."""
        if value is None:
            return None
        scheme, _, rest = value.strip().partition("://")
        if scheme not in ("postgresql", "postgres", "postgresql+asyncpg") or not rest:
            raise ValueError("must be a postgresql:// or postgresql+asyncpg:// URL")
        base, _, query = rest.partition("?")
        params = []
        for key, val in parse_qsl(query, keep_blank_values=True):
            if key == "channel_binding":  # libpq only, asyncpg rejects it
                continue
            params.append(("ssl" if key == "sslmode" else key, val))
        url = ASYNC_SCHEME + base
        return f"{url}?{urlencode(params)}" if params else url


@lru_cache
def get_settings() -> Settings:
    return Settings()
