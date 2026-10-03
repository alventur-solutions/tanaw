"""On demand analysis: POST /analyze (cache check, enqueue on miss) and GET /jobs/{id}."""

import json
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_session
from api.jobs import FAIL_STALE_JOBS, enqueue_job
from pipeline.metrics import IMPLEMENTED_METRICS

router = APIRouter()

MIN_YEAR = 1985
MAX_COMBINATIONS = 500

Session = Annotated[AsyncSession, Depends(get_session)]


class AnalyzeRequest(BaseModel):
    area_id: str = Field(min_length=1)
    metrics: list[str] = Field(min_length=1)
    years: list[int] | None = None
    year_start: int | None = None
    year_end: int | None = None

    @model_validator(mode="after")
    def normalise(self) -> "AnalyzeRequest":
        """Resolve to sorted, unique years and metrics. Give years or a start and end."""
        has_range = self.year_start is not None or self.year_end is not None
        if self.years is not None and has_range:
            raise ValueError("Give either years or year_start and year_end, not both.")
        if self.years is None:
            if self.year_start is None or self.year_end is None:
                raise ValueError("Give years, or both year_start and year_end.")
            if self.year_end < self.year_start:
                raise ValueError("year_end must not be before year_start.")
            self.years = list(range(self.year_start, self.year_end + 1))
        self.years = sorted(set(self.years))
        if not self.years:
            raise ValueError("At least one year is required.")
        max_year = datetime.now(UTC).year
        if self.years[0] < MIN_YEAR or self.years[-1] > max_year:
            raise ValueError(f"Years must be between {MIN_YEAR} and {max_year}.")
        unknown = sorted(set(self.metrics) - set(IMPLEMENTED_METRICS))
        if unknown:
            implemented = ", ".join(IMPLEMENTED_METRICS)
            raise ValueError(
                f"Metric(s) not available: {', '.join(unknown)}. "
                f"Implemented metrics: {implemented}."
            )
        self.metrics = sorted(set(self.metrics))
        if len(self.years) * len(self.metrics) > MAX_COMBINATIONS:
            raise ValueError(
                f"Request is too large. Limit is {MAX_COMBINATIONS} year-metric pairs."
            )
        return self


class MetricRow(BaseModel):
    area_id: str
    year: int
    metric: str
    value: float | None
    quality_flag: str
    source_version: str | None = None


class Combination(BaseModel):
    year: int
    metric: str


class AnalyzeResponse(BaseModel):
    cache_hit: bool
    job_id: UUID | None = None
    status: str
    poll_url: str | None = None
    missing: list[Combination] = []
    rows: list[MetricRow]


class JobResponse(BaseModel):
    job_id: UUID
    area_id: str
    metrics: list[str]
    years: list[int]
    status: str
    missing: list[Combination]
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    rows: list[MetricRow]


JOB_COLUMNS = (
    "id, area_id, metrics, years, status, error, missing, created_at, started_at, finished_at"
)

SELECT_ROWS = text(
    "SELECT area_id, year, metric, value, quality_flag, source_version "
    "FROM satellite_metrics "
    "WHERE area_id = :area_id AND year = ANY(CAST(:years AS integer[])) "
    "AND metric = ANY(CAST(:metrics AS text[])) ORDER BY year, metric"
)

SELECT_ACTIVE_JOB = text(
    f"SELECT {JOB_COLUMNS} FROM analysis_jobs "
    "WHERE area_id = :area_id AND metrics = CAST(:metrics AS text[]) "
    "AND years = CAST(:years AS integer[]) AND status IN ('queued', 'running') "
    "ORDER BY created_at LIMIT 1"
)

INSERT_JOB = text(
    "INSERT INTO analysis_jobs (area_id, metrics, years, status, missing) "
    "VALUES (:area_id, CAST(:metrics AS text[]), CAST(:years AS integer[]), 'queued', "
    f"CAST(:missing AS jsonb)) RETURNING {JOB_COLUMNS}"
)

SELECT_JOB = text(f"SELECT {JOB_COLUMNS} FROM analysis_jobs WHERE id = :job_id")


def poll_url(job_id: UUID) -> str:
    return f"/jobs/{job_id}"


def missing_of(job: Any) -> list[Combination]:
    value = job["missing"]
    if isinstance(value, str):
        value = json.loads(value)
    return [Combination(**item) for item in value or []]


async def fetch_rows(
    session: AsyncSession, area_id: str, years: list[int], metrics: list[str]
) -> list[MetricRow]:
    result = await session.execute(
        SELECT_ROWS, {"area_id": area_id, "years": years, "metrics": metrics}
    )
    return [MetricRow(**row) for row in result.mappings().all()]


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    body: AnalyzeRequest, response: Response, session: Session, background_tasks: BackgroundTasks
) -> AnalyzeResponse:
    assert body.years is not None
    area = await session.execute(
        text("SELECT area_id FROM study_areas WHERE area_id = :area_id"),
        {"area_id": body.area_id},
    )
    if area.mappings().first() is None:
        raise HTTPException(status_code=404, detail=f"Unknown area_id: {body.area_id}")

    rows = await fetch_rows(session, body.area_id, body.years, body.metrics)
    have = {(r.year, r.metric) for r in rows}
    missing = [
        Combination(year=y, metric=m)
        for y in body.years
        for m in body.metrics
        if (y, m) not in have
    ]
    if not missing:
        return AnalyzeResponse(cache_hit=True, status="cached", rows=rows)

    params = {"area_id": body.area_id, "metrics": body.metrics, "years": body.years}
    # A stale job must not be reused: fail it first, then look for an active one.
    await session.execute(FAIL_STALE_JOBS)
    job = (await session.execute(SELECT_ACTIVE_JOB, params)).mappings().first()
    created = job is None
    if created:
        missing_json = json.dumps([m.model_dump() for m in missing])
        inserted = await session.execute(INSERT_JOB, {**params, "missing": missing_json})
        job = inserted.mappings().first()
    await session.commit()
    if created:
        enqueue_job(background_tasks, job["id"])

    response.status_code = 202
    return AnalyzeResponse(
        cache_hit=False,
        job_id=job["id"],
        status=job["status"],
        poll_url=poll_url(job["id"]),
        missing=missing_of(job),
        rows=rows,
    )


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: UUID, session: Session) -> JobResponse:
    job = (await session.execute(SELECT_JOB, {"job_id": job_id})).mappings().first()
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job id: {job_id}")
    rows: list[MetricRow] = []
    if job["status"] == "done":
        rows = await fetch_rows(session, job["area_id"], list(job["years"]), list(job["metrics"]))
    return JobResponse(
        job_id=job["id"],
        area_id=job["area_id"],
        metrics=list(job["metrics"]),
        years=list(job["years"]),
        status=job["status"],
        missing=missing_of(job),
        error=job["error"],
        created_at=job["created_at"],
        started_at=job["started_at"],
        finished_at=job["finished_at"],
        rows=rows,
    )
