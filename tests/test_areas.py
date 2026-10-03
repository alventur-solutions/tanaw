import json

import pytest
from fastapi.testclient import TestClient

from api.db import get_session
from api.funding import FIRST_FULL_YEAR, LAST_FULL_YEAR
from api.main import app

AREAS = [
    {
        "area_id": "quezon-city",
        "name": "Quezon City",
        "study_type": "urban",
        "zone": None,
        "area_ha": 16249.0,
        "geometry": json.dumps(
            {
                "type": "Polygon",
                "coordinates": [[[121, 14.6], [121.1, 14.6], [121.1, 14.7], [121, 14.6]]],
            }
        ),
    }
]
METRICS = [
    {
        "area_id": "quezon-city",
        "year": year,
        "metric": "tree_cover_loss",
        "value": float(year - 2000),
        "quality_flag": "ok",
        "source_version": "UMD/hansen/global_forest_change_2025_v1_13",
    }
    for year in (2021, 2022)
]
PROJECTS = [
    {
        "component_id": f"C{year}",
        "year": year,
        "category": "drainage",
        "type_of_work": "Construction of Drainage Structure",
        "amount_php": 100.0,
        "municipality": "Quezon City",
        "contractor": "Sample Builders",
        "completion_date": "2023-01-15",
        "lon": 121.05,
        "lat": 14.65,
    }
    for year in (2019, 2022)
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


class FakeSession:
    """Answers the queries in api.areas from the rows above."""

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "FROM satellite_metrics" in sql:
            return _Result([r for r in METRICS if params["metric"] in (None, r["metric"])])
        if "FROM funding_project_areas" in sql:
            return _Result(
                [
                    r
                    for r in PROJECTS
                    if (params["min_year"] is None or r["year"] >= params["min_year"])
                    and (params["max_year"] is None or r["year"] <= params["max_year"])
                ]
            )
        assert "FROM study_areas" in sql
        if params is None:
            return _Result(AREAS)
        return _Result([a for a in AREAS if a["area_id"] == params["area_id"]])


@pytest.fixture(autouse=True)
def session():
    async def override():
        yield FakeSession()

    app.dependency_overrides[get_session] = override
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def test_areas_are_geojson_features() -> None:
    body = client.get("/areas").json()
    assert body["type"] == "FeatureCollection"
    feature = body["features"][0]
    assert feature["id"] == "quezon-city"
    assert feature["properties"]["study_type"] == "urban"
    assert "geometry" not in feature["properties"]
    assert feature["geometry"]["type"] == "Polygon"


def test_metrics_carry_quality_flag_and_source() -> None:
    body = client.get("/areas/quezon-city/metrics?metric=tree_cover_loss").json()
    assert [r["year"] for r in body["rows"]] == [2021, 2022]
    assert all(r["quality_flag"] == "ok" and r["source_version"] for r in body["rows"])


def test_metrics_filter_by_metric() -> None:
    assert client.get("/areas/quezon-city/metrics?metric=rainfall").json()["rows"] == []


def test_projects_default_to_full_coverage_years() -> None:
    body = client.get("/areas/quezon-city/projects").json()
    assert (body["min_year"], body["max_year"]) == (FIRST_FULL_YEAR, LAST_FULL_YEAR)
    assert body["caveat"] is None
    assert [f["properties"]["year"] for f in body["features"]] == [2022]
    assert body["features"][0]["geometry"] == {"type": "Point", "coordinates": [121.05, 14.65]}
    assert any("project site" in note for note in body["notes"])


def test_projects_partial_years_add_the_caveat() -> None:
    body = client.get("/areas/quezon-city/projects?include_partial_years=true").json()
    assert [f["properties"]["year"] for f in body["features"]] == [2019, 2022]
    assert body["caveat"]


@pytest.mark.parametrize("path", ["metrics", "projects"])
def test_unknown_area_is_404(path: str) -> None:
    assert client.get(f"/areas/nowhere/{path}").status_code == 404
