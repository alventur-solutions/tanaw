from uuid import uuid4

import pytest
from fastapi import BackgroundTasks

from api import jobs

AREA = "quezon-city"
ROW = {
    "area_id": AREA,
    "year": 2021,
    "metric": "tree_cover_loss",
    "value": 1.5,
    "quality_flag": "ok",
}


class _Result:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    def mappings(self) -> "_Result":
        return self

    def first(self) -> dict | None:
        return self._rows[0] if self._rows else None


class FakeDb:
    """One analysis_jobs row and the satellite_metrics rows written for it."""

    def __init__(self) -> None:
        self.job = {
            "area_id": AREA,
            "status": "queued",
            "error": None,
            "missing": '[{"year": 2021, "metric": "tree_cover_loss"}]',
        }
        self.statuses = ["queued"]
        self.metrics: list[dict] = []
        self.stale_checks = 0
        self.commits = 0

    def __call__(self) -> "FakeDb":
        return self

    async def __aenter__(self) -> "FakeDb":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "'timed out'" in sql:
            self.stale_checks += 1
        elif "SET status = 'running'" in sql:
            if self.job["status"] != "queued":
                return _Result([])
            self._set("running")
            return _Result([self.job])
        elif "INSERT INTO satellite_metrics" in sql:
            self.metrics.append(params)
        elif "SET status = 'done'" in sql:
            self._set("done")
        elif "SET status = 'failed'" in sql:
            self._set("failed")
            self.job["error"] = params["error"]
        else:
            raise AssertionError(f"Unexpected SQL: {sql}")
        return _Result([])

    def _set(self, status: str) -> None:
        self.job["status"] = status
        self.statuses.append(status)

    async def commit(self) -> None:
        self.commits += 1


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(jobs, "SessionLocal", fake)
    return fake


def test_enqueue_job_adds_the_worker_as_a_background_task():
    tasks = BackgroundTasks()
    job_id = uuid4()

    jobs.enqueue_job(tasks, job_id)

    assert [(t.func, t.args) for t in tasks.tasks] == [(jobs.run_job, (job_id,))]


def test_missing_by_metric_groups_years():
    missing = [
        {"year": 2022, "metric": "tree_cover_loss"},
        {"year": 2021, "metric": "tree_cover_loss"},
        {"year": 2021, "metric": "rainfall"},
    ]
    assert jobs.missing_by_metric(missing) == {"tree_cover_loss": [2021, 2022], "rainfall": [2021]}


async def test_run_job_writes_rows_and_marks_done(db, monkeypatch):
    calls = []

    def compute(area_id, metric, years):
        calls.append((area_id, metric, years))
        return [ROW]

    monkeypatch.setattr(jobs, "compute_metric", compute)

    await jobs.run_job(uuid4())

    assert calls == [(AREA, "tree_cover_loss", [2021])]
    assert db.statuses == ["queued", "running", "done"]
    assert db.metrics == [ROW]
    assert db.job["error"] is None


async def test_run_job_records_the_error_when_compute_fails(db, monkeypatch):
    def compute(area_id, metric, years):
        raise RuntimeError("Earth Engine request timed out")

    monkeypatch.setattr(jobs, "compute_metric", compute)

    await jobs.run_job(uuid4())

    assert db.statuses == ["queued", "running", "failed"]
    assert db.job["error"] == "RuntimeError: Earth Engine request timed out"
    assert db.metrics == []


async def test_run_job_skips_a_job_that_is_not_queued(db, monkeypatch):
    db.job["status"] = "running"
    monkeypatch.setattr(jobs, "compute_metric", lambda *args: pytest.fail("must not compute"))

    await jobs.run_job(uuid4())

    assert db.statuses == ["queued"]


def test_stale_job_rule_is_fifteen_minutes_and_times_out():
    sql = str(jobs.FAIL_STALE_JOBS)
    assert "SET status = 'failed', error = 'timed out'" in sql
    assert "status = 'running' AND started_at < now() - interval '15 minutes'" in sql
    assert "status = 'queued' AND created_at < now() - interval '15 minutes'" in sql


async def test_fail_stale_jobs_runs_the_rule_and_commits(db):
    await jobs.fail_stale_jobs()
    assert (db.stale_checks, db.commits) == (1, 1)


def test_finish_and_fail_leave_a_timed_out_job_alone():
    assert "AND status = 'running'" in str(jobs.FINISH_JOB)
    assert "AND status = 'running'" in str(jobs.FAIL_JOB)


def test_compute_metric_rejects_a_metric_without_a_module():
    with pytest.raises(ValueError, match="not implemented yet: rainfall"):
        jobs.compute_metric(AREA, "rainfall", [2021])
