import pytest
from fastapi.testclient import TestClient

from api.db import get_session
from api.funding import FIRST_FULL_YEAR, LAST_FULL_YEAR, SELECT_TOTALS
from api.main import app

# quezon-city sits inside pasig-marikina-tullahan, so the 2022 project is linked to both.
LINKED = [
    {"area_id": "pasig-marikina-tullahan", "year": 2015, "projects": 1, "amount_php": 50.0},
    {"area_id": "pasig-marikina-tullahan", "year": 2022, "projects": 2, "amount_php": 300.0},
    {"area_id": "quezon-city", "year": 2022, "projects": 1, "amount_php": 100.0},
    {"area_id": "quezon-city", "year": 2026, "projects": 1, "amount_php": 70.0},
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
    """Answers the queries in api.funding from the LINKED rows."""

    def __init__(self) -> None:
        self.params: list[dict] = []

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "FROM study_areas" in sql:
            known = {r["area_id"] for r in LINKED}
            return _Result([{"area_id": a} for a in known if a == params["area_id"]])
        assert "FROM funding_project_areas" in sql
        self.params.append(params)
        return _Result(
            [
                r
                for r in LINKED
                if (params["area_id"] is None or r["area_id"] == params["area_id"])
                and (params["min_year"] is None or r["year"] >= params["min_year"])
                and (params["max_year"] is None or r["year"] <= params["max_year"])
            ]
        )


@pytest.fixture
def session():
    fake = FakeSession()

    async def override():
        yield fake

    app.dependency_overrides[get_session] = override
    yield fake
    app.dependency_overrides.clear()


def get(query: str = ""):
    return TestClient(app).get(f"/funding/totals{query}")


def test_totals_query_goes_through_the_link_table():
    sql = str(SELECT_TOTALS)
    assert "FROM funding_project_areas l JOIN funding_projects p USING (component_id)" in sql
    assert "GROUP BY l.area_id, p.year" in sql
    assert "ROLLUP" not in sql.upper()


def test_totals_default_to_full_coverage_years(session):
    data = get().json()

    window = {"min_year": FIRST_FULL_YEAR, "max_year": LAST_FULL_YEAR}
    assert session.params == [{"area_id": None, **window}]
    assert data["include_partial_years"] is False
    assert (data["min_year"], data["max_year"]) == (FIRST_FULL_YEAR, LAST_FULL_YEAR)
    assert data["partial_years"] is False
    assert data["caveat"] is None
    assert [r["year"] for r in data["rows"]] == [2022, 2022]


def test_include_partial_years_returns_caveat_flag(session):
    data = get("?include_partial_years=true").json()

    assert session.params == [{"area_id": None, "min_year": None, "max_year": None}]
    assert data["partial_years"] is True
    assert f"{FIRST_FULL_YEAR} to {LAST_FULL_YEAR}" in data["caveat"]
    assert (data["min_year"], data["max_year"]) == (None, None)
    assert [r["year"] for r in data["rows"]] == [2015, 2022, 2022, 2026]


def test_totals_stay_per_area_and_are_not_added_across_areas(session):
    data = get().json()

    # One row per area and year. Nothing in the response combines areas.
    assert set(data) == {
        "include_partial_years",
        "min_year",
        "max_year",
        "partial_years",
        "caveat",
        "note",
        "rows",
    }
    assert {r["area_id"] for r in data["rows"]} == {"pasig-marikina-tullahan", "quezon-city"}
    assert "must not be added across areas" in data["note"]


def test_area_filter_and_unknown_area(session):
    data = get("?area_id=quezon-city").json()
    assert [(r["area_id"], r["amount_php"]) for r in data["rows"]] == [("quezon-city", 100.0)]

    response = get("?area_id=atlantis")
    assert response.status_code == 404
    assert "atlantis" in response.json()["detail"]
