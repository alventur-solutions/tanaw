"""Funding projects for the map: GET /projects/points and GET /projects/{component_id}.

/projects/points returns every project that has a site, inside a study area or not, with
only the fields the map needs. The full record of one project comes from /projects/{id}.
These are map points. Totals still come per area_id from /funding/totals and
/areas/{area_id}/projects.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.areas import PROJECT_FIELDS, SITE_NOTE
from api.db import get_session
from api.funding import PARTIAL_YEARS_CAVEAT, year_window

router = APIRouter(prefix="/projects")

Session = Annotated[AsyncSession, Depends(get_session)]

# :min_year and :max_year are NULL when partial years are included.
SELECT_POINTS = text(
    "SELECT component_id, category, year, "
    "round(ST_X(geom)::numeric, 5) AS lon, round(ST_Y(geom)::numeric, 5) AS lat "
    "FROM funding_projects "
    "WHERE geom IS NOT NULL "
    "AND (CAST(:min_year AS integer) IS NULL OR year >= :min_year) "
    "AND (CAST(:max_year AS integer) IS NULL OR year <= :max_year) "
    "ORDER BY component_id"
)
SELECT_PROJECT = text(
    f"SELECT {PROJECT_FIELDS} FROM funding_projects p WHERE p.component_id = :component_id"
)
SELECT_PROJECT_AREAS = text(
    "SELECT area_id FROM funding_project_areas WHERE component_id = :component_id ORDER BY area_id"
)


class PointsResponse(BaseModel):
    type: str = "FeatureCollection"
    min_year: int | None
    max_year: int | None
    caveat: str | None
    note: str = SITE_NOTE
    features: list[dict[str, Any]]


class ProjectResponse(BaseModel):
    type: str = "Feature"
    properties: dict[str, Any]
    geometry: dict[str, Any] | None
    # Study areas the site falls in. Empty when it is outside every study area.
    area_ids: list[str]
    note: str = SITE_NOTE


@router.get("/points", response_model=PointsResponse)
async def project_points(session: Session, include_partial_years: bool = False) -> PointsResponse:
    """Every project site as a GeoJSON point. Projects without coordinates are not listed."""
    min_year, max_year = year_window(include_partial_years)
    result = await session.execute(SELECT_POINTS, {"min_year": min_year, "max_year": max_year})
    features = [
        {
            "type": "Feature",
            "properties": {
                "component_id": row["component_id"],
                "category": row["category"],
                "year": row["year"],
            },
            "geometry": {"type": "Point", "coordinates": [float(row["lon"]), float(row["lat"])]},
        }
        for row in result.mappings().all()
    ]
    return PointsResponse(
        min_year=min_year,
        max_year=max_year,
        caveat=PARTIAL_YEARS_CAVEAT if include_partial_years else None,
        features=features,
    )


@router.get("/{component_id}", response_model=ProjectResponse)
async def project(session: Session, component_id: str) -> ProjectResponse:
    """The full record of one project."""
    result = await session.execute(SELECT_PROJECT, {"component_id": component_id})
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unknown project: {component_id}")
    areas = await session.execute(SELECT_PROJECT_AREAS, {"component_id": component_id})
    has_point = row["lon"] is not None and row["lat"] is not None
    return ProjectResponse(
        properties={key: value for key, value in row.items() if key not in ("lon", "lat")},
        geometry={"type": "Point", "coordinates": [row["lon"], row["lat"]]} if has_point else None,
        area_ids=[r["area_id"] for r in areas.mappings().all()],
    )
