"""Read only data for the dashboard: study areas, their metric rows, and funding projects.

Funding projects are returned per area_id through funding_project_areas, with the same
year window as every other funding query.
"""

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_session
from api.funding import OVERLAP_NOTE, PARTIAL_YEARS_CAVEAT, year_window

router = APIRouter(prefix="/areas")

Session = Annotated[AsyncSession, Depends(get_session)]

SITE_NOTE = "Coordinates are the project site, not the area the project protects."

# Boundaries are simplified for display only (about 20 m). Metrics use the full geometry.
SELECT_AREAS = text(
    "SELECT area_id, name, study_type, zone, area_ha, "
    "ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0002), 5) AS geometry "
    "FROM study_areas ORDER BY area_id"
)
SELECT_AREA = text("SELECT area_id FROM study_areas WHERE area_id = :area_id")
SELECT_METRICS = text(
    "SELECT area_id, year, metric, value, quality_flag, source_version "
    "FROM satellite_metrics "
    "WHERE area_id = :area_id AND (CAST(:metric AS text) IS NULL OR metric = :metric) "
    "ORDER BY metric, year"
)
# :min_year and :max_year are NULL when partial years are included.
SELECT_PROJECTS = text(
    "SELECT p.component_id, p.year, p.category, p.type_of_work, "
    "CAST(p.amount_php AS double precision) AS amount_php, "
    "p.municipality, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat "
    "FROM funding_project_areas l "
    "JOIN funding_projects p USING (component_id) "
    "WHERE l.area_id = :area_id "
    "AND (CAST(:min_year AS integer) IS NULL OR p.year >= :min_year) "
    "AND (CAST(:max_year AS integer) IS NULL OR p.year <= :max_year) "
    "ORDER BY p.year, p.component_id"
)


class MetricRow(BaseModel):
    area_id: str
    year: int
    metric: str
    value: float | None
    quality_flag: str
    source_version: str | None = None


class MetricsResponse(BaseModel):
    area_id: str
    rows: list[MetricRow]


class FeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: list[dict[str, Any]]


class ProjectsResponse(FeatureCollection):
    area_id: str
    min_year: int | None
    max_year: int | None
    caveat: str | None
    notes: list[str] = [OVERLAP_NOTE, SITE_NOTE]


async def _require_area(session: AsyncSession, area_id: str) -> None:
    area = await session.execute(SELECT_AREA, {"area_id": area_id})
    if area.mappings().first() is None:
        raise HTTPException(status_code=404, detail=f"Unknown area_id: {area_id}")


@router.get("", response_model=FeatureCollection)
async def list_areas(session: Session) -> FeatureCollection:
    """Every study area and zone as GeoJSON."""
    result = await session.execute(SELECT_AREAS)
    features = []
    for row in result.mappings().all():
        properties = {key: value for key, value in row.items() if key != "geometry"}
        features.append(
            {
                "type": "Feature",
                "id": row["area_id"],
                "properties": properties,
                "geometry": json.loads(row["geometry"]),
            }
        )
    return FeatureCollection(features=features)


@router.get("/{area_id}/metrics", response_model=MetricsResponse)
async def area_metrics(
    session: Session, area_id: str, metric: str | None = None
) -> MetricsResponse:
    """Satellite metric rows for one area, each with its quality_flag."""
    await _require_area(session, area_id)
    result = await session.execute(SELECT_METRICS, {"area_id": area_id, "metric": metric})
    return MetricsResponse(
        area_id=area_id, rows=[MetricRow(**row) for row in result.mappings().all()]
    )


@router.get("/{area_id}/projects", response_model=ProjectsResponse)
async def area_projects(
    session: Session, area_id: str, include_partial_years: bool = False
) -> ProjectsResponse:
    """DPWH projects linked to one area, as GeoJSON points."""
    await _require_area(session, area_id)
    min_year, max_year = year_window(include_partial_years)
    result = await session.execute(
        SELECT_PROJECTS, {"area_id": area_id, "min_year": min_year, "max_year": max_year}
    )
    features = []
    for row in result.mappings().all():
        properties = {key: value for key, value in row.items() if key not in ("lon", "lat")}
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
            }
        )
    return ProjectsResponse(
        area_id=area_id,
        min_year=min_year,
        max_year=max_year,
        caveat=PARTIAL_YEARS_CAVEAT if include_partial_years else None,
        features=features,
    )
