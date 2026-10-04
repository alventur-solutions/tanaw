import json

import pytest
from fastapi.testclient import TestClient

from api.db import get_session
from api.main import app

CROSSINGS = [
    {
        "bridge_osm_id": 2,
        "waterway_osm_id": 1,
        "road_name": "Main Bridge",
        "highway": "primary",
        "waterway": "river",
        "waterway_name": "Marikina River",
        "lon": 121.0123456,
        "lat": 14.1234567,
    },
    {
        "bridge_osm_id": 3,
        "waterway_osm_id": 9,
        "road_name": None,
        "highway": "residential",
        "waterway": "canal",
        "waterway_name": None,
        "lon": 121.02,
        "lat": 14.13,
    },
    {
        "bridge_osm_id": 4,
        "waterway_osm_id": 10,
        "road_name": None,
        "highway": "track",
        "waterway": "stream",
        "waterway_name": None,
        "lon": 121.03,
        "lat": 14.14,
    },
]


class _Result:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def mappings(self) -> "_Result":
        return self

    def first(self) -> dict | None:
        return self._rows[0] if self._rows else None

    def all(self) -> list[dict]:
        return self._rows

    def scalar_one(self):
        return self._rows[0]["present"]


class FakeSession:
    present = True
    meta: dict | None = {"fetched_on": "2026-10-03", "attribution": "OSM attribution"}
    params: list = []

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "SELECT area_id FROM study_areas" in sql:
            return _Result(
                [{"area_id": params["area_id"]}] if params["area_id"] != "nowhere" else []
            )
        if "to_regclass" in sql:
            return _Result([{"present": self.present}])
        if "FROM osm_meta" in sql:
            return _Result([self.meta] if self.meta else [])
        assert "ST_Intersects(a.geom, c.geom)" in sql
        self.params.append(params)
        return _Result([r for r in CROSSINGS if r["waterway"] in params["waterways"]])


@pytest.fixture(autouse=True)
def session():
    FakeSession.present = True
    FakeSession.meta = {"fetched_on": "2026-10-03", "attribution": "OSM attribution"}
    FakeSession.params = []

    async def override():
        yield FakeSession()

    app.dependency_overrides[get_session] = override
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def test_default_filter_is_river_and_canal() -> None:
    response = client.get("/areas/quezon-city/crossings")
    body = response.json()
    assert response.headers["cache-control"] == "public, max-age=60"
    assert body["type"] == "FeatureCollection"
    assert (body["area_id"], body["loaded"], body["fetched_on"]) == (
        "quezon-city",
        True,
        "2026-10-03",
    )
    assert [f["properties"]["waterway"] for f in body["features"]] == ["river", "canal"]
    assert FakeSession.params[0]["waterways"] == ["river", "canal"]


def test_points_are_rounded_and_properties_are_the_documented_ones() -> None:
    feature = client.get("/areas/quezon-city/crossings").json()["features"][0]
    assert feature["geometry"] == {"type": "Point", "coordinates": [121.01235, 14.12346]}
    assert set(feature["properties"]) == {
        "bridge_osm_id",
        "waterway_osm_id",
        "road_name",
        "highway",
        "waterway",
        "waterway_name",
    }


@pytest.mark.parametrize(
    "query", ["waterway=stream", "waterway=river&waterway=stream", "waterway=river,stream"]
)
def test_stream_filter(query: str) -> None:
    body = client.get(f"/areas/quezon-city/crossings?{query}").json()
    assert "stream" in {f["properties"]["waterway"] for f in body["features"]}
    assert set(FakeSession.params[0]["waterways"]) <= {"river", "stream"}


def test_unknown_waterway_class_is_422() -> None:
    assert client.get("/areas/quezon-city/crossings?waterway=ditch").status_code == 422


def test_not_loaded_when_the_tables_are_missing() -> None:
    FakeSession.present = False
    body = client.get("/areas/quezon-city/crossings").json()
    assert body["loaded"] is False
    assert body["features"] == [] and body["fetched_on"] is None
    assert body["attribution"]


def test_not_loaded_when_the_tables_are_empty() -> None:
    FakeSession.meta = None
    body = client.get("/areas/quezon-city/crossings").json()
    assert body["loaded"] is False and body["features"] == []


def test_notes_and_attribution() -> None:
    body = client.get("/areas/quezon-city/crossings").json()
    text = " ".join(body["notes"])
    assert "not a recommendation" in text
    assert "less complete in rural areas" in text
    assert "overlap" in text
    assert "—" not in json.dumps(body, ensure_ascii=False)


def test_unknown_area_is_404() -> None:
    assert client.get("/areas/nowhere/crossings").status_code == 404
