from datetime import UTC, datetime

from fastapi.testclient import TestClient

from api.db import get_session
from api.main import app

TS = datetime(2026, 10, 4, 8, 30, tzinfo=UTC)


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class _Session:
    def __init__(self, *results):
        self.results = list(results)

    async def execute(self, statement, params=None):
        return _Result(self.results.pop(0))


def _client(session):
    async def override():
        yield session

    app.dependency_overrides[get_session] = override
    return TestClient(app)


def _station(**reading):
    row = {
        "station_id": "qc-street-01",
        "station_type": "street",
        "area_id": "quezon-city",
        "lon": 121.09325,
        "lat": 14.636,
        "dry_baseline_cm": 120.0,
        "ts": None,
        "temp_c": None,
        "humidity_pct": None,
        "water_level_cm": None,
        "flood_depth_cm": None,
        "battery_v": None,
    }
    row.update(reading)
    return row


def test_stations_returns_latest_reading_as_geojson():
    session = _Session([_station(ts=TS, temp_c=23.1, humidity_pct=58.4, flood_depth_cm=0.0)])
    try:
        response = _client(session).get("/stations")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    feature = response.json()["features"][0]
    assert feature["geometry"]["coordinates"] == [121.09325, 14.636]
    latest = feature["properties"]["latest"]
    assert latest["ts"] == TS.isoformat()
    assert latest["temp_c"] == 23.1
    assert latest["flood_depth_cm"] == 0.0


def test_station_without_readings_has_null_latest():
    session = _Session([_station()])
    try:
        response = _client(session).get("/stations")
    finally:
        app.dependency_overrides.clear()

    assert response.json()["features"][0]["properties"]["latest"] is None


def test_readings_for_unknown_station_is_404():
    session = _Session([])
    try:
        response = _client(session).get("/stations/nope/readings")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


def test_readings_rejects_hours_out_of_range():
    try:
        response = _client(_Session()).get("/stations/qc-street-01/readings?hours=0")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
