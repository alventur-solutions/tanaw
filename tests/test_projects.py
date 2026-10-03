import pytest
from fastapi.testclient import TestClient

from api.db import get_session
from api.funding import FIRST_FULL_YEAR, LAST_FULL_YEAR
from api.main import app

POINTS = [
    {"component_id": "A", "category": "drainage", "year": 2015, "lon": 121.05, "lat": 14.65},
    {"component_id": "B", "category": "pumping", "year": 2022, "lon": 125.5, "lat": 7.1},
]
PROJECT = {
    "component_id": "B",
    "contract_id": "B",
    "year": 2022,
    "category": "pumping",
    "description": "Construction of Pumping Station",
    "status": "On-Going",
    "progress_pct": 40.0,
    "amount_php": 100.0,
    "lon": 125.5,
    "lat": 7.1,
}


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
    """Answers the queries in api.projects from the rows above."""

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "FROM funding_project_areas" in sql:
            return _Result([])
        if "WHERE p.component_id" in sql:
            return _Result([PROJECT] if params["component_id"] == "B" else [])
        assert "WHERE geom IS NOT NULL" in sql
        return _Result(
            [
                r
                for r in POINTS
                if (params["min_year"] is None or r["year"] >= params["min_year"])
                and (params["max_year"] is None or r["year"] <= params["max_year"])
            ]
        )


@pytest.fixture(autouse=True)
def session():
    async def override():
        yield FakeSession()

    app.dependency_overrides[get_session] = override
    yield
    app.dependency_overrides.clear()


client = TestClient(app)


def test_points_default_to_full_coverage_years_and_carry_only_map_fields() -> None:
    body = client.get("/projects/points").json()
    assert (body["min_year"], body["max_year"]) == (FIRST_FULL_YEAR, LAST_FULL_YEAR)
    assert [f["properties"] for f in body["features"]] == [
        {"component_id": "B", "category": "pumping", "year": 2022}
    ]
    assert body["features"][0]["geometry"] == {"type": "Point", "coordinates": [125.5, 7.1]}
    assert "project site" in body["note"]


def test_points_partial_years_add_the_caveat() -> None:
    body = client.get("/projects/points?include_partial_years=true").json()
    assert len(body["features"]) == 2
    assert body["caveat"]


def test_project_outside_every_study_area_is_still_returned() -> None:
    body = client.get("/projects/B").json()
    assert body["properties"]["status"] == "On-Going"
    assert "lon" not in body["properties"]
    assert body["geometry"]["coordinates"] == [125.5, 7.1]
    assert body["area_ids"] == []


def test_unknown_project_is_404() -> None:
    assert client.get("/projects/nope").status_code == 404
