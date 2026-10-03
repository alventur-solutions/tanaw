import pytest
from fastapi.testclient import TestClient

from api import layers
from api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fake_earth_engine(monkeypatch):
    """No test reaches Earth Engine. Calls are counted so the cache can be checked."""
    calls: list[int] = []

    def fake(year: int) -> str:
        calls.append(year)
        return f"https://example.test/{year}/{{z}}/{{x}}/{{y}}"

    monkeypatch.setattr(layers, "greenery_tile_url", fake)
    layers._cache.clear()
    return calls


def test_greenery_returns_tiles_legend_and_caveat() -> None:
    body = client.get("/layers/greenery?year=2024").json()
    assert body["year"] == 2024
    assert body["window"] == "2024-01-01 to 2024-05-31"
    assert body["tile_url"].startswith("https://example.test/2024/")
    assert [item["name"] for item in body["legend"]][0] == "Trees"
    assert all(item["color"].startswith("#") for item in body["legend"])
    assert body["caveat"]


def test_greenery_caches_the_tile_url(fake_earth_engine) -> None:
    client.get("/layers/greenery?year=2024")
    client.get("/layers/greenery?year=2024")
    assert fake_earth_engine == [2024]


@pytest.mark.parametrize("year", [2015, 2999])
def test_greenery_rejects_years_without_data(year: int) -> None:
    assert client.get(f"/layers/greenery?year={year}").status_code == 422


def test_greenery_reports_earth_engine_failure(monkeypatch) -> None:
    def broken(year: int) -> str:
        raise RuntimeError("not signed in")

    monkeypatch.setattr(layers, "greenery_tile_url", broken)
    response = client.get("/layers/greenery?year=2024")
    assert response.status_code == 503
    assert "Earth Engine is not available" in response.json()["detail"]
