"""GET /areas/summary: one row per top-level study area, for the dashboard's all-areas story.

Read only. Every figure is per area_id. Study areas overlap, so the rows must never be added
together, and nothing here returns a total across areas. A measure with no rows is null, so the
dashboard can say "not loaded" instead of showing zero.
"""

import time
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_session
from api.funding import OVERLAP_NOTE, year_window

router = APIRouter(prefix="/areas")

Session = Annotated[AsyncSession, Depends(get_session)]

CACHE_SECONDS = 300

# The four reported-status review lists, with the same definitions and thresholds as
# dashboard/src/review.ts. Status is compared without case or outer spaces.
ONGOING_MIN_AGE_YEARS = 2
NOT_STARTED_MIN_AGE_YEARS = 1
FULL_PROGRESS_PCT = 100

_STATUS = "lower(trim(p.status))"
TERMINATED = f"{_STATUS} = 'terminated'"
# The cutoff years are computed in Python, so each parameter is typed by the column it meets.
ONGOING_EARLIER = f"({_STATUS} = 'on-going' AND p.year <= :ongoing_max_year)"
NOT_STARTED_EARLIER = f"({_STATUS} = 'not yet started' AND p.year <= :not_started_max_year)"
ONGOING_FULL = f"({_STATUS} = 'on-going' AND p.progress_pct = :full_progress)"

# :min_year and :max_year are the funding window from api.funding.year_window. Tree cover loss
# is also given for that window, so it can sit next to the contract figures.
SELECT_SUMMARY = text(
    "WITH loss AS ("
    " SELECT area_id,"
    " sum(value) FILTER (WHERE year BETWEEN :min_year AND :max_year) AS loss_window_ha,"
    " sum(value) AS loss_record_ha, min(year) AS loss_from, max(year) AS loss_to"
    " FROM satellite_metrics"
    " WHERE metric = 'tree_cover_loss' AND value IS NOT NULL GROUP BY area_id"
    "), rain AS ("
    " SELECT area_id, avg(value) AS rain_mean_mm, count(*) AS rain_years,"
    " min(year) AS rain_from, max(year) AS rain_to"
    " FROM satellite_metrics"
    " WHERE metric = 'rainfall_total' AND value IS NOT NULL AND quality_flag <> 'partial_year'"
    " GROUP BY area_id"
    "), money AS ("
    " SELECT l.area_id, count(*) AS contracts,"
    " CAST(sum(p.amount_php) AS double precision) AS contract_cost_php,"
    f" count(*) FILTER (WHERE {TERMINATED}) AS review_terminated,"
    f" count(*) FILTER (WHERE {ONGOING_EARLIER}) AS review_ongoing_earlier,"
    f" count(*) FILTER (WHERE {NOT_STARTED_EARLIER}) AS review_not_started_earlier,"
    f" count(*) FILTER (WHERE {ONGOING_FULL}) AS review_ongoing_full_progress,"
    f" count(*) FILTER (WHERE {TERMINATED} OR {ONGOING_EARLIER} OR {NOT_STARTED_EARLIER}"
    f" OR {ONGOING_FULL}) AS review_any"
    " FROM funding_project_areas l JOIN funding_projects p USING (component_id)"
    " WHERE p.year BETWEEN :min_year AND :max_year"
    " GROUP BY l.area_id"
    ") "
    "SELECT a.area_id, a.name, a.study_type, a.area_ha,"
    " CAST(loss.loss_window_ha AS double precision) AS loss_window_ha,"
    " CAST(loss.loss_record_ha AS double precision) AS loss_record_ha,"
    " loss.loss_from, loss.loss_to,"
    " CAST(rain.rain_mean_mm AS double precision) AS rain_mean_mm,"
    " rain.rain_years, rain.rain_from, rain.rain_to,"
    " money.contracts, money.contract_cost_php,"
    " money.review_terminated, money.review_ongoing_earlier,"
    " money.review_not_started_earlier, money.review_ongoing_full_progress, money.review_any,"
    " EXISTS (SELECT 1 FROM satellite_metrics m WHERE m.area_id = a.area_id) AS metrics_loaded,"
    " EXISTS (SELECT 1 FROM funding_project_areas f WHERE f.area_id = a.area_id)"
    " AS projects_linked "
    "FROM study_areas a"
    " LEFT JOIN loss USING (area_id) LEFT JOIN rain USING (area_id)"
    " LEFT JOIN money USING (area_id) "
    "WHERE a.zone IS NULL ORDER BY a.area_id"
)

# Counts that are a measured zero once the area is linked, and unknown (null) before that.
_LINKED_COUNTS = (
    "contracts",
    "review_terminated",
    "review_ongoing_earlier",
    "review_not_started_earlier",
    "review_ongoing_full_progress",
    "review_any",
)


class AreaSummary(BaseModel):
    area_id: str
    name: str
    study_type: str
    area_ha: float
    loss_window_ha: float | None
    loss_record_ha: float | None
    loss_from: int | None
    loss_to: int | None
    rain_mean_mm: float | None
    rain_years: int | None
    rain_from: int | None
    rain_to: int | None
    contracts: int | None
    contract_cost_php: float | None
    review_terminated: int | None
    review_ongoing_earlier: int | None
    review_not_started_earlier: int | None
    review_ongoing_full_progress: int | None
    review_any: int | None
    metrics_loaded: bool
    projects_linked: bool


class SummaryResponse(BaseModel):
    min_year: int
    max_year: int
    current_year: int
    note: str = OVERLAP_NOTE
    rows: list[AreaSummary]


_cache: dict[int, tuple[float, SummaryResponse]] = {}


def clear_cache() -> None:
    _cache.clear()


def _row(row: dict) -> AreaSummary:
    values = dict(row)
    for key in _LINKED_COUNTS:
        if values[key] is None and values["projects_linked"]:
            values[key] = 0
    return AreaSummary(**values)


@router.get("/summary", response_model=SummaryResponse)
async def area_summary(session: Session) -> SummaryResponse:
    """Land, rainfall, and DPWH contract figures per top-level area. Never added across areas."""
    current_year = date.today().year
    hit = _cache.get(current_year)
    if hit is not None and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    min_year, max_year = year_window(False)
    assert min_year is not None and max_year is not None
    result = await session.execute(
        SELECT_SUMMARY,
        {
            "min_year": min_year,
            "max_year": max_year,
            "ongoing_max_year": current_year - ONGOING_MIN_AGE_YEARS,
            "not_started_max_year": current_year - NOT_STARTED_MIN_AGE_YEARS,
            "full_progress": FULL_PROGRESS_PCT,
        },
    )
    body = SummaryResponse(
        min_year=min_year,
        max_year=max_year,
        current_year=current_year,
        rows=[_row(row) for row in result.mappings().all()],
    )
    _cache[current_year] = (time.monotonic(), body)
    return body
