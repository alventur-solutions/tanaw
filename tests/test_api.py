import io
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.config import Settings
from api.db import engine, get_session
from api.main import app

ROOT = Path(__file__).resolve().parents[1]

TABLES = [
    "study_areas",
    "satellite_metrics",
    "analysis_jobs",
    "funding_projects",
    "funding_project_areas",
    "stations",
    "station_readings",
]


def test_settings_convert_neon_libpq_url_for_asyncpg():
    settings = Settings(
        database_url="postgresql://user:p%40ss@host/db?sslmode=require&channel_binding=require"
    )
    assert settings.database_url == "postgresql+asyncpg://user:p%40ss@host/db?ssl=require"


def test_settings_reject_non_postgres_url():
    with pytest.raises(ValidationError):
        Settings(database_url="mysql://user:pass@host/db")


def test_engine_is_configured_for_pgbouncer():
    assert "-pooler" in engine.url.host
    assert engine.pool.size() == 5
    assert engine.pool._max_overflow == 5
    assert engine.pool._pre_ping is True


class _FakeResult:
    def scalar_one(self) -> str:
        return "3.5 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"


class _FakeSession:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement):
        self.statements.append(str(statement))
        return _FakeResult()


def test_health_queries_postgis_version():
    session = _FakeSession()

    async def override():
        yield session

    app.dependency_overrides[get_session] = override
    try:
        response = TestClient(app).get("/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["postgis_version"].startswith("3.5")
    assert session.statements == ["SELECT postgis_version()"]


def test_first_migration_renders_offline():
    """alembic upgrade head --sql: checks the migration compiles, without a database."""
    buffer = io.StringIO()
    config = Config(str(ROOT / "alembic.ini"), output_buffer=buffer)
    config.set_main_option("script_location", str(ROOT / "db" / "migrations"))
    command.upgrade(config, "head", sql=True)
    sql = buffer.getvalue()

    assert "CREATE EXTENSION IF NOT EXISTS postgis" in sql
    for table in TABLES:
        assert f"CREATE TABLE {table} " in sql
    assert "geometry(MULTIPOLYGON,4326)" in sql
    assert "geometry(POINT,4326)" in sql
    assert sql.count("USING gist") == 3 + 3  # 0001 study_areas, funding, stations; 0006 OSM
