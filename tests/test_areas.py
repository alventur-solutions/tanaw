import json

import pytest
from fastapi.testclient import TestClient

from api import areas as areas_module
from api.db import get_session
from api.funding import FIRST_FULL_YEAR, LAST_FULL_YEAR
from api.main import app


def _polygon(x: float) -> str:
    return json.dumps(
        {
            "type": "Polygon",
            "coordinates": [[[x, 14.6], [x + 0.1, 14.6], [x + 0.1, 14.7], [x, 14.6]]],
        }
    )


FLAGS = {"has_zones": False, "metrics_loaded": True, "projects_linked": True}
AREAS = [
    {
        "area_id": "quezon-city",
        "name": "Quezon City",
        "study_type": "urban",
        "zone": None,
        "area_ha": 16249.0,
        "geometry": _polygon(121),
        "bbox": [121, 14.6, 121.1, 14.7],
        **FLAGS,
    },
    {
        "area_id": "big-basin",
        "name": "Big basin (river basin)",
        "study_type": "river_basin",
        "zone": None,
        "area_ha": 500000.0,
        "geometry": _polygon(120),
        "bbox": [120, 14.6, 120.1, 14.7],
        "has_zones": True,
        "metrics_loaded": False,
        "projects_linked": False,
    },
]
ZONES = [
    {k: v for k, v in a.items() if k in ("area_id", "name", "study_type", "zone", "area_ha")}
    | {"geometry": _polygon(120)}
    for a in (
        AREAS[1],
        AREAS[1] | {"area_id": "big-basin__up", "zone": "up", "area_ha": 300000.0},
        AREAS[1] | {"area_id": "big-basin__down", "zone": "down", "area_ha": 200000.0},
    )
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
    for year in (2015, 2022)
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

    areas_params: list = []

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "FROM study_areas" in sql and "FROM satellite_metrics m" in sql:
            assert "WHERE a.zone IS NULL" in sql or "ORDER BY a.area_id" in sql
            self.areas_params.append(params)
            return _Result(AREAS if "WHERE a.zone IS NULL" in sql else AREAS + ZONES[1:])
        if "FROM study_areas" in sql:
            if "WHERE area_id = :area_id " in sql and "|| '__up'" in sql:
                self.areas_params.append(params)
                return _Result([z for z in ZONES if z["area_id"].startswith(params["area_id"])])
            return _Result([a for a in AREAS if a["area_id"] == params["area_id"]])
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


@pytest.fixture(autouse=True)
def session():
    areas_module.clear_cache()
    FakeSession.areas_params = []

    async def override():
        yield FakeSession()

    app.dependency_overrides[get_session] = override
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def test_areas_are_geojson_features() -> None:
    body = client.get("/areas").json()
    assert body["type"] == "FeatureCollection"
    feature = next(f for f in body["features"] if f["id"] == "big-basin")
    assert feature["properties"]["study_type"] == "river_basin"
    assert "geometry" not in feature["properties"]
    assert feature["geometry"]["type"] == "Polygon"


def test_overview_has_top_level_areas_with_flags_and_table_area() -> None:
    body = client.get("/areas").json()
    assert all(f["properties"]["zone"] is None for f in body["features"])
    basin = next(f for f in body["features"] if f["id"] == "big-basin")["properties"]
    assert basin["area_ha"] == 500000.0
    assert basin["bbox"] == [120.0, 14.6, 120.1, 14.7]
    assert (basin["has_zones"], basin["metrics_loaded"], basin["projects_linked"]) == (
        True,
        False,
        False,
    )
    assert FakeSession.areas_params[0]["tolerance"] == areas_module.OVERVIEW_TOLERANCE


def test_include_zones_returns_every_area_at_finer_tolerance() -> None:
    body = client.get("/areas?include_zones=true").json()
    assert {f["properties"]["zone"] for f in body["features"]} == {None, "up", "down"}
    assert FakeSession.areas_params[0]["tolerance"] == areas_module.FULL_TOLERANCE


def test_tolerance_is_bounded() -> None:
    assert client.get("/areas?tolerance=0.5").status_code == 422
    client.get("/areas?tolerance=0.004")
    assert FakeSession.areas_params[0]["tolerance"] == 0.004


def test_overview_is_cached() -> None:
    client.get("/areas")
    client.get("/areas")
    assert len(FakeSession.areas_params) == 1


def test_zones_of_one_area() -> None:
    body = client.get("/areas/big-basin/zones").json()
    assert [f["properties"]["area_id"] for f in body["features"]] == [
        "big-basin",
        "big-basin__up",
        "big-basin__down",
    ]
    params = FakeSession.areas_params[-1]
    assert params["tolerance"] == areas_module.ZONE_TOLERANCE
    assert params["outline_tolerance"] == areas_module.FULL_TOLERANCE


def test_zones_of_unknown_area_is_404() -> None:
    assert client.get("/areas/nowhere/zones").status_code == 404


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
    assert [f["properties"]["year"] for f in body["features"]] == [2015, 2022]
    assert body["caveat"]


@pytest.mark.parametrize("path", ["metrics", "projects"])
def test_unknown_area_is_404(path: str) -> None:
    assert client.get(f"/areas/nowhere/{path}").status_code == 404
