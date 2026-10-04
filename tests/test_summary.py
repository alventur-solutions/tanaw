from datetime import date

import pytest
from fastapi.testclient import TestClient

import api.summary as summary_module
from api.db import get_session
from api.funding import FIRST_FULL_YEAR, LAST_FULL_YEAR
from api.main import app
from api.summary import NOT_STARTED_MIN_AGE_YEARS, ONGOING_MIN_AGE_YEARS, SELECT_SUMMARY

EMPTY = {
    "loss_window_ha": None,
    "loss_record_ha": None,
    "loss_from": None,
    "loss_to": None,
    "rain_mean_mm": None,
    "rain_years": None,
    "rain_from": None,
    "rain_to": None,
    "contracts": None,
    "contract_cost_php": None,
    "review_terminated": None,
    "review_ongoing_earlier": None,
    "review_not_started_earlier": None,
    "review_ongoing_full_progress": None,
    "review_any": None,
    "metrics_loaded": False,
    "projects_linked": False,
}

ROWS = [
    {
        **EMPTY,
        "area_id": "pasig-marikina-tullahan",
        "name": "Pasig-Marikina-Tullahan River Basin",
        "study_type": "river_basin",
        "area_ha": 83537.8,
        "loss_window_ha": 1048.0,
        "loss_record_ha": 2163.0,
        "loss_from": 2001,
        "loss_to": 2025,
        "rain_mean_mm": 2833.0,
        "rain_years": 25,
        "rain_from": 2001,
        "rain_to": 2025,
        "contracts": 2706,
        "contract_cost_php": 1.2417e11,
        "review_terminated": 46,
        "review_ongoing_earlier": 139,
        "review_not_started_earlier": 9,
        "review_ongoing_full_progress": 37,
        "review_any": 206,
        "metrics_loaded": True,
        "projects_linked": True,
    },
    # Linked, but no contract inside the funding window: counts are a measured zero.
    {
        **EMPTY,
        "area_id": "quezon-city",
        "name": "Quezon City",
        "study_type": "urban",
        "area_ha": 16248.5,
        "metrics_loaded": True,
        "projects_linked": True,
    },
    # Nothing loaded: every measure stays null, never zero.
    {
        **EMPTY,
        "area_id": "agusan-river-basin",
        "name": "Agusan River Basin",
        "study_type": "river_basin",
        "area_ha": 1194785.3,
    },
]


class _Result:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def mappings(self) -> "_Result":
        return self

    def all(self) -> list[dict]:
        return self._rows


class FakeSession:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, statement, params=None):
        self.calls.append((str(statement), params))
        return _Result(ROWS)


@pytest.fixture
def session():
    summary_module.clear_cache()
    fake = FakeSession()

    async def override():
        yield fake

    app.dependency_overrides[get_session] = override
    yield fake
    app.dependency_overrides.clear()
    summary_module.clear_cache()


def get():
    return TestClient(app).get("/areas/summary")


def test_summary_is_not_captured_by_the_area_id_routes(session):
    response = get()
    assert response.status_code == 200
    assert "rows" in response.json()


def test_summary_uses_the_funding_window_and_the_current_year(session):
    data = get().json()
    assert (data["min_year"], data["max_year"]) == (FIRST_FULL_YEAR, LAST_FULL_YEAR)
    assert data["current_year"] == date.today().year
    _, params = session.calls[0]
    assert params["min_year"] == FIRST_FULL_YEAR
    assert params["max_year"] == LAST_FULL_YEAR
    year = date.today().year
    assert params["ongoing_max_year"] == year - ONGOING_MIN_AGE_YEARS
    assert params["not_started_max_year"] == year - NOT_STARTED_MIN_AGE_YEARS


def test_summary_query_is_per_area_and_read_only():
    sql = " ".join(str(SELECT_SUMMARY).split())
    assert "FROM funding_project_areas l JOIN funding_projects p USING (component_id)" in sql
    assert "GROUP BY l.area_id" in sql
    assert "WHERE a.zone IS NULL" in sql
    assert "quality_flag <> 'partial_year'" in sql
    upper = sql.upper()
    for word in ("INSERT", "UPDATE", "DELETE", "ROLLUP", "CUBE", "GROUPING SETS"):
        assert word not in upper


def test_review_rules_match_the_dashboard_definitions():
    sql = " ".join(str(SELECT_SUMMARY).split())
    assert "lower(trim(p.status)) = 'terminated'" in sql
    assert "p.year <= :ongoing_max_year" in sql
    assert "p.year <= :not_started_max_year" in sql
    assert "p.progress_pct = :full_progress" in sql
    assert ONGOING_MIN_AGE_YEARS == 2
    assert NOT_STARTED_MIN_AGE_YEARS == 1


def test_not_loaded_stays_null_and_linked_empty_is_zero(session):
    rows = {r["area_id"]: r for r in get().json()["rows"]}
    agusan = rows["agusan-river-basin"]
    assert agusan["contracts"] is None
    assert agusan["review_any"] is None
    assert agusan["loss_window_ha"] is None
    assert agusan["rain_mean_mm"] is None
    city = rows["quezon-city"]
    assert city["contracts"] == 0
    assert city["review_terminated"] == 0
    assert city["contract_cost_php"] is None
    basin = rows["pasig-marikina-tullahan"]
    assert basin["review_any"] == 206
    assert basin["contracts"] == 2706


def test_summary_carries_the_overlap_note_and_no_cross_area_total(session):
    data = get().json()
    assert "must not be added across areas" in data["note"]
    assert set(data) == {"min_year", "max_year", "current_year", "note", "rows"}


def test_summary_is_cached(session):
    get()
    get()
    assert len(session.calls) == 1
