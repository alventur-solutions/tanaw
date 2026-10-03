import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from api import analyze
from api.db import get_session
from api.main import app

AREA = "quezon-city"


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
    """Answers the queries in api.analyze from in-memory state."""

    def __init__(self) -> None:
        self.areas = {AREA}
        self.metrics: list[dict] = []
        self.jobs: list[dict] = []
        self.commits = 0

    def add_metric(self, year: int, metric: str, value: float = 1.0) -> None:
        self.metrics.append(
            {
                "area_id": AREA,
                "year": year,
                "metric": metric,
                "value": value,
                "quality_flag": "ok",
            }
        )

    def add_job(self, status: str = "queued", **overrides) -> dict:
        job = {
            "id": uuid4(),
            "area_id": AREA,
            "metrics": ["tree_cover_loss"],
            "years": [2021, 2022],
            "status": status,
            "error": None,
            "missing": [{"year": 2021, "metric": "tree_cover_loss"}],
            "created_at": datetime.now(UTC),
            "started_at": None,
            "finished_at": None,
        }
        job.update(overrides)
        self.jobs.append(job)
        return job

    async def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}
        if "FROM study_areas" in sql:
            return _Result([{"area_id": a} for a in self.areas if a == params["area_id"]])
        if "FROM satellite_metrics" in sql:
            return _Result(
                [
                    r
                    for r in self.metrics
                    if r["area_id"] == params["area_id"]
                    and r["year"] in params["years"]
                    and r["metric"] in params["metrics"]
                ]
            )
        if "'timed out'" in sql:
            now = datetime.now(UTC)
            clock = {"running": "started_at", "queued": "created_at"}
            for job in self.jobs:
                since = job[clock[job["status"]]] if job["status"] in clock else None
                if since is not None and since < now - timedelta(minutes=15):
                    job.update(status="failed", error="timed out", finished_at=now)
            return _Result([])
        if "INSERT INTO analysis_jobs" in sql:
            job = self.add_job(
                area_id=params["area_id"],
                metrics=params["metrics"],
                years=params["years"],
                missing=json.loads(params["missing"]),
            )
            return _Result([job])
        if "FROM analysis_jobs WHERE id" in sql:
            return _Result([j for j in self.jobs if j["id"] == params["job_id"]])
        if "FROM analysis_jobs" in sql:
            return _Result(
                [
                    j
                    for j in self.jobs
                    if j["area_id"] == params["area_id"]
                    and j["metrics"] == params["metrics"]
                    and j["years"] == params["years"]
                    and j["status"] in ("queued", "running")
                ]
            )
        raise AssertionError(f"Unexpected SQL: {sql}")

    async def commit(self) -> None:
        self.commits += 1


@pytest.fixture
def session():
    fake = FakeSession()

    async def override():
        yield fake

    app.dependency_overrides[get_session] = override
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def enqueued(monkeypatch):
    calls: list[UUID] = []
    monkeypatch.setattr(analyze, "enqueue_job", lambda tasks, job_id: calls.append(job_id))
    return calls


def post(body: dict):
    return TestClient(app).post("/analyze", json=body)


BODY = {"area_id": AREA, "metrics": ["tree_cover_loss"], "year_start": 2021, "year_end": 2022}


def test_full_cache_hit_returns_rows_without_job(session, enqueued):
    session.add_metric(2021, "tree_cover_loss", 12.5)
    session.add_metric(2022, "tree_cover_loss", 8.0)

    response = post(BODY)

    assert response.status_code == 200
    data = response.json()
    assert data["cache_hit"] is True
    assert data["status"] == "cached"
    assert data["job_id"] is None
    assert [r["value"] for r in data["rows"]] == [12.5, 8.0]
    assert data["rows"][0]["quality_flag"] == "ok"
    assert session.jobs == []
    assert enqueued == []


def test_partial_miss_creates_job_and_returns_cached_rows(session, enqueued):
    session.add_metric(2021, "tree_cover_loss")

    response = post(BODY)

    assert response.status_code == 202
    data = response.json()
    assert data["cache_hit"] is False
    assert data["status"] == "queued"
    assert data["missing"] == [{"year": 2022, "metric": "tree_cover_loss"}]
    assert len(data["rows"]) == 1
    assert data["poll_url"] == f"/jobs/{data['job_id']}"
    assert len(session.jobs) == 1
    assert session.commits == 1
    assert enqueued == [session.jobs[0]["id"]]


def test_complete_miss_lists_every_combination(session, enqueued, monkeypatch):
    monkeypatch.setattr(analyze, "IMPLEMENTED_METRICS", ("rainfall", "tree_cover_loss"))
    body = {**BODY, "metrics": ["tree_cover_loss", "rainfall"]}

    response = post(body)

    assert response.status_code == 202
    data = response.json()
    assert len(data["missing"]) == 4
    assert data["rows"] == []
    assert session.jobs[0]["metrics"] == ["rainfall", "tree_cover_loss"]


def test_duplicate_request_reuses_active_job(session, enqueued):
    first = post(BODY).json()
    second = post({**BODY, "years": None, "year_start": 2021, "year_end": 2022})
    assert second.status_code == 202
    assert second.json()["job_id"] == first["job_id"]
    assert len(session.jobs) == 1
    assert len(enqueued) == 1


def test_finished_job_does_not_block_new_job(session, enqueued):
    first = post(BODY).json()
    session.jobs[0]["status"] = "failed"

    second = post(BODY).json()

    assert second["job_id"] != first["job_id"]
    assert len(session.jobs) == 2


def minutes_ago(minutes: int) -> datetime:
    return datetime.now(UTC) - timedelta(minutes=minutes)


def test_stale_running_job_is_failed_and_replaced(session, enqueued):
    stale = session.add_job("running", created_at=minutes_ago(21), started_at=minutes_ago(20))

    response = post(BODY)

    assert response.status_code == 202
    assert response.json()["job_id"] != str(stale["id"])
    assert response.json()["status"] == "queued"
    assert (stale["status"], stale["error"]) == ("failed", "timed out")
    assert stale["finished_at"] is not None
    assert len(session.jobs) == 2
    assert enqueued == [session.jobs[1]["id"]]


def test_stale_queued_job_is_failed_and_replaced(session, enqueued):
    stale = session.add_job("queued", created_at=minutes_ago(16))

    response = post(BODY)

    assert response.json()["job_id"] != str(stale["id"])
    assert (stale["status"], stale["error"]) == ("failed", "timed out")


def test_running_job_within_the_time_limit_is_reused(session, enqueued):
    running = session.add_job("running", created_at=minutes_ago(11), started_at=minutes_ago(10))

    response = post(BODY)

    assert response.json()["job_id"] == str(running["id"])
    assert response.json()["status"] == "running"
    assert running["error"] is None
    assert len(session.jobs) == 1
    assert enqueued == []


def test_years_list_is_accepted(session, enqueued):
    body = {"area_id": AREA, "metrics": ["tree_cover_loss"], "years": [2023, 2021, 2021]}
    response = post(body)
    assert response.status_code == 202
    assert session.jobs[0]["years"] == [2021, 2023]


def test_get_job_queued_has_no_rows(session):
    job = session.add_job()
    session.add_metric(2021, "tree_cover_loss")

    response = TestClient(app).get(f"/jobs/{job['id']}")

    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == str(job["id"])
    assert data["status"] == "queued"
    assert data["area_id"] == AREA
    assert data["years"] == [2021, 2022]
    assert data["missing"] == [{"year": 2021, "metric": "tree_cover_loss"}]
    assert data["error"] is None
    assert data["rows"] == []


def test_get_job_done_returns_result_rows(session):
    job = session.add_job("done", finished_at=datetime(2026, 10, 4, 1, tzinfo=UTC))
    session.add_metric(2021, "tree_cover_loss", 3.0)
    session.add_metric(2022, "tree_cover_loss", 4.0)

    data = TestClient(app).get(f"/jobs/{job['id']}").json()

    assert data["status"] == "done"
    assert [r["value"] for r in data["rows"]] == [3.0, 4.0]
    assert data["finished_at"] is not None


def test_get_job_failed_shows_error(session):
    job = session.add_job("failed", error="Earth Engine request timed out")

    data = TestClient(app).get(f"/jobs/{job['id']}").json()

    assert data["status"] == "failed"
    assert data["error"] == "Earth Engine request timed out"
    assert data["rows"] == []


def test_unknown_job_is_404(session):
    response = TestClient(app).get(f"/jobs/{uuid4()}")
    assert response.status_code == 404


def test_malformed_job_id_is_422(session):
    assert TestClient(app).get("/jobs/not-a-uuid").status_code == 422


def test_unknown_area_is_404(session):
    response = post({**BODY, "area_id": "atlantis"})
    assert response.status_code == 404
    assert "atlantis" in response.json()["detail"]


def test_unknown_metric_is_422_and_names_it(session):
    response = post({**BODY, "metrics": ["deforestation"]})
    assert response.status_code == 422
    assert "deforestation" in response.text
    assert "tree_cover_loss" in response.text


def test_metric_without_a_module_is_422_and_lists_implemented(session, enqueued):
    response = post({**BODY, "metrics": ["rainfall", "tree_cover_loss"]})

    assert response.status_code == 422
    assert "Metric(s) not available: rainfall." in response.text
    assert "Implemented metrics: tree_cover_loss, rainfall_total" in response.text
    assert session.jobs == []
    assert enqueued == []


@pytest.mark.parametrize(
    "patch",
    [
        {"year_start": None, "year_end": None},
        {"year_end": 2020},
        {"years": [2021], "year_start": 2021},
        {"year_start": 1900},
        {"year_end": 2999},
        {"metrics": []},
        {"area_id": ""},
    ],
)
def test_invalid_requests_are_422(session, patch):
    assert post({**BODY, **patch}).status_code == 422
    assert session.jobs == []


def test_oversized_request_is_422(session, monkeypatch):
    monkeypatch.setattr(analyze, "MAX_COMBINATIONS", 1)
    assert post(BODY).status_code == 422
