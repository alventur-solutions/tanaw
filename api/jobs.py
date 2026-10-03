"""Analysis job worker.

run_job is a plain async function that takes only the job id, so it can move to an arq
worker later. For now enqueue_job hands it to FastAPI BackgroundTasks.
"""

import asyncio
import json
import logging
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy import text

from api.db import SessionLocal

log = logging.getLogger("api.jobs")

MAX_ERROR_CHARS = 2000
STALE_AFTER_MINUTES = 15
TIMED_OUT = "timed out"

# Only a queued job can be claimed, so a job never runs twice.
CLAIM_JOB = text(
    "UPDATE analysis_jobs SET status = 'running', started_at = now() "
    "WHERE id = :job_id AND status = 'queued' RETURNING area_id, missing"
)
# Both only touch a running job, so a job already marked as timed out stays failed.
FINISH_JOB = text(
    "UPDATE analysis_jobs SET status = 'done', finished_at = now() "
    "WHERE id = :job_id AND status = 'running'"
)
FAIL_JOB = text(
    "UPDATE analysis_jobs SET status = 'failed', error = :error, finished_at = now() "
    "WHERE id = :job_id AND status = 'running'"
)
# A worker that died with the server leaves its job running, or queued and never started.
# Such a job would be reused forever, so it is failed and the next request starts a new one.
STALE = f"now() - interval '{STALE_AFTER_MINUTES} minutes'"
FAIL_STALE_JOBS = text(
    f"UPDATE analysis_jobs SET status = 'failed', error = '{TIMED_OUT}', finished_at = now() "
    f"WHERE (status = 'running' AND started_at < {STALE}) "
    f"OR (status = 'queued' AND created_at < {STALE})"
)


async def fail_stale_jobs() -> None:
    """Mark stale jobs as failed. Called once when the API starts."""
    async with SessionLocal() as session:
        await session.execute(FAIL_STALE_JOBS)
        await session.commit()


def enqueue_job(background_tasks: BackgroundTasks, job_id: UUID) -> None:
    """Hand a queued analysis job to the worker. It runs after the response is sent."""
    background_tasks.add_task(run_job, job_id)


def missing_by_metric(missing: str | list[dict]) -> dict[str, list[int]]:
    """Years to compute per metric, from the job's missing combinations."""
    if isinstance(missing, str):
        missing = json.loads(missing)
    grouped: dict[str, list[int]] = {}
    for item in missing:
        grouped.setdefault(item["metric"], []).append(item["year"])
    return {metric: sorted(years) for metric, years in grouped.items()}


def compute_metric(area_id: str, metric: str, years: list[int]) -> list[dict]:
    """Rows for one metric and area. Blocking (Earth Engine getInfo): run it in a thread.

    The pipeline imports are local so the API starts without loading Earth Engine.
    """
    from pipeline.registry import METRICS
    from pipeline.run import compute_rows
    from pipeline.study_areas import read_features

    if metric not in METRICS:
        raise ValueError(f"Metric is not implemented yet: {metric}")
    features = [f for f in read_features() if f["properties"]["area_id"] == area_id]
    if not features:
        raise ValueError(f"No boundary file in pipeline/areas for area_id: {area_id}")
    return compute_rows(metric, features, years)


async def save_rows(job_id: UUID, rows: list[dict]) -> None:
    """Write the rows and mark the job done in one transaction."""
    from pipeline.run import UPSERT

    async with SessionLocal() as session:
        for row in rows:
            await session.execute(text(UPSERT), row)
        await session.execute(FINISH_JOB, {"job_id": job_id})
        await session.commit()


async def run_job(job_id: UUID) -> None:
    """Run one analysis job: queued to running, then done or failed with the error."""
    async with SessionLocal() as session:
        job = (await session.execute(CLAIM_JOB, {"job_id": job_id})).mappings().first()
        await session.commit()
    if job is None:
        log.warning("job %s is not queued, skipped", job_id)
        return

    try:
        rows: list[dict] = []
        for metric, years in missing_by_metric(job["missing"]).items():
            rows += await asyncio.to_thread(compute_metric, job["area_id"], metric, years)
        await save_rows(job_id, rows)
    except (Exception, SystemExit) as exc:  # SystemExit: the pipeline's config errors
        log.exception("job %s failed", job_id)
        error = f"{type(exc).__name__}: {exc}"[:MAX_ERROR_CHARS]
        async with SessionLocal() as session:
            await session.execute(FAIL_JOB, {"job_id": job_id, "error": error})
            await session.commit()
