"""Funding queries: GET /funding/totals.

Every total is per area_id, through the link table funding_project_areas. Study areas
overlap, so no query here adds totals across areas.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_session

router = APIRouter(prefix="/funding")

Session = Annotated[AsyncSession, Depends(get_session)]

# DPWH coverage is mostly 2021 to 2024. Years outside hold only a few projects.
FIRST_FULL_YEAR = 2021
LAST_FULL_YEAR = 2024

PARTIAL_YEARS_CAVEAT = (
    f"Years outside {FIRST_FULL_YEAR} to {LAST_FULL_YEAR} are included. The source covers "
    "them only in part, so their totals are not a spending trend."
)
OVERLAP_NOTE = (
    "Study areas overlap. A project counts in every area it falls in, so totals are per "
    "area and must not be added across areas."
)

# :min_year and :max_year are NULL when partial years are included.
SELECT_TOTALS = text(
    "SELECT l.area_id, p.year, count(*) AS projects, sum(p.amount_php) AS amount_php "
    "FROM funding_project_areas l "
    "JOIN funding_projects p USING (component_id) "
    "WHERE (CAST(:area_id AS text) IS NULL OR l.area_id = :area_id) "
    "AND (CAST(:min_year AS integer) IS NULL OR p.year >= :min_year) "
    "AND (CAST(:max_year AS integer) IS NULL OR p.year <= :max_year) "
    "GROUP BY l.area_id, p.year ORDER BY l.area_id, p.year"
)


class FundingTotal(BaseModel):
    area_id: str
    year: int | None
    projects: int
    amount_php: float | None


class FundingTotalsResponse(BaseModel):
    include_partial_years: bool
    min_year: int | None
    max_year: int | None
    partial_years: bool
    caveat: str | None
    note: str = OVERLAP_NOTE
    rows: list[FundingTotal]


def year_window(include_partial_years: bool) -> tuple[int | None, int | None]:
    """First and last year a funding query returns. Every funding query uses this default."""
    if include_partial_years:
        return None, None
    return FIRST_FULL_YEAR, LAST_FULL_YEAR


@router.get("/totals", response_model=FundingTotalsResponse)
async def funding_totals(
    session: Session, area_id: str | None = None, include_partial_years: bool = False
) -> FundingTotalsResponse:
    """Projects and PHP (nominal) per area_id per year. Never a total across areas."""
    if area_id is not None:
        area = await session.execute(
            text("SELECT area_id FROM study_areas WHERE area_id = :area_id"),
            {"area_id": area_id},
        )
        if area.mappings().first() is None:
            raise HTTPException(status_code=404, detail=f"Unknown area_id: {area_id}")

    min_year, max_year = year_window(include_partial_years)
    result = await session.execute(
        SELECT_TOTALS, {"area_id": area_id, "min_year": min_year, "max_year": max_year}
    )
    return FundingTotalsResponse(
        include_partial_years=include_partial_years,
        min_year=min_year,
        max_year=max_year,
        partial_years=include_partial_years,
        caveat=PARTIAL_YEARS_CAVEAT if include_partial_years else None,
        rows=[FundingTotal(**row) for row in result.mappings().all()],
    )
