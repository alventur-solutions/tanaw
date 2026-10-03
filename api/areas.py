"""Read only data for the dashboard: study areas, their metric rows, and funding projects.

Funding projects are returned per area_id through funding_project_areas, with the same
year window as every other funding query.
"""

import json
import logging
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import SessionLocal, get_session
from api.funding import OVERLAP_NOTE, PARTIAL_YEARS_CAVEAT, year_window

router = APIRouter(prefix="/areas")
logger = logging.getLogger(__name__)

Session = Annotated[AsyncSession, Depends(get_session)]

SITE_NOTE = "Coordinates are the project site, not the area the project protects."

# Boundaries are simplified for display only, in degrees (0.002 is about 220 m). area_ha comes
# from the table and metrics use the full geometry, so neither depends on the simplified shape.
OVERVIEW_TOLERANCE = 0.002
FULL_TOLERANCE = 0.0002
ZONE_TOLERANCE = 0.0005
MAX_TOLERANCE = 0.01
# Study areas and the flags below change rarely, so a response is kept for a few minutes.
CACHE_SECONDS = 300
BROWSER_CACHE = "public, max-age=60"

# One row per area. bbox is taken from the full geometry. The three flags let the dashboard say
# "not loaded yet" instead of showing zero. A zone is named <area_id>__up or <area_id>__down.
_AREA_COLUMNS = (
    "SELECT a.area_id, a.name, a.study_type, a.zone, a.area_ha, "
    "ST_AsGeoJSON(ST_SimplifyPreserveTopology("
    "a.geom, CAST(:tolerance AS double precision)), 5) AS geometry, "
    "ARRAY[ST_XMin(a.geom), ST_YMin(a.geom), ST_XMax(a.geom), ST_YMax(a.geom)] AS bbox, "
    "EXISTS (SELECT 1 FROM study_areas z "
    "WHERE z.area_id IN (a.area_id || '__up', a.area_id || '__down')) AS has_zones, "
    "EXISTS (SELECT 1 FROM satellite_metrics m WHERE m.area_id = a.area_id) AS metrics_loaded, "
    "EXISTS (SELECT 1 FROM funding_project_areas l WHERE l.area_id = a.area_id) "
    "AS projects_linked "
    "FROM study_areas a "
)
SELECT_OVERVIEW = text(_AREA_COLUMNS + "WHERE a.zone IS NULL ORDER BY a.area_id")
SELECT_ALL_AREAS = text(_AREA_COLUMNS + "ORDER BY a.area_id")
SELECT_ZONES = text(
    "SELECT area_id, name, study_type, zone, area_ha, "
    "ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, "
    "CASE WHEN zone IS NULL THEN CAST(:outline_tolerance AS double precision) "
    "ELSE CAST(:tolerance AS double precision) END), 5) AS geometry "
    "FROM study_areas "
    "WHERE area_id = :area_id "
    "OR area_id IN (CAST(:area_id AS text) || '__up', CAST(:area_id AS text) || '__down') "
    "ORDER BY area_id"
)
SELECT_AREA = text("SELECT area_id FROM study_areas WHERE area_id = :area_id")
SELECT_METRICS = text(
    "SELECT area_id, year, metric, value, quality_flag, source_version "
    "FROM satellite_metrics "
    "WHERE area_id = :area_id AND (CAST(:metric AS text) IS NULL OR metric = :metric) "
    "ORDER BY metric, year"
)
# Columns of one funding project, for a query that names funding_projects as p.
PROJECT_FIELDS = (
    "p.component_id, p.project_id, p.contract_id, p.year, p.category, p.type_of_work, "
    "p.description, p.status, p.progress_pct, p.quality_flag, "
    "CAST(p.amount_php AS double precision) AS amount_php, "
    "CAST(p.abc_php AS double precision) AS abc_php, "
    "p.contractor, p.municipality, p.province, "
    "CAST(p.start_date AS text) AS start_date, "
    "CAST(p.completion_date AS text) AS completion_date, "
    "ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat"
)
# :min_year and :max_year are NULL when partial years are included.
SELECT_PROJECTS = text(
    f"SELECT {PROJECT_FIELDS} "
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


_cache: dict[tuple, tuple[float, bytes]] = {}


def clear_cache() -> None:
    _cache.clear()


def _feature(row: Any) -> dict[str, Any]:
    properties = {key: value for key, value in row.items() if key != "geometry"}
    if "bbox" in properties:
        properties["bbox"] = [float(v) for v in properties["bbox"]]
    return {
        "type": "Feature",
        "id": row["area_id"],
        "properties": properties,
        "geometry": json.loads(row["geometry"]),
    }


async def _cached(key: tuple, build: Any) -> bytes:
    """The encoded response for key, rebuilt after CACHE_SECONDS."""
    hit = _cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    body = json.dumps(
        {"type": "FeatureCollection", "features": await build()}, separators=(",", ":")
    ).encode()
    _cache[key] = (time.monotonic(), body)
    return body


def _json(body: bytes) -> Response:
    return Response(body, media_type="application/json", headers={"Cache-Control": BROWSER_CACHE})


async def _area_features(
    session: AsyncSession, include_zones: bool, tolerance: float
) -> list[dict[str, Any]]:
    statement = SELECT_ALL_AREAS if include_zones else SELECT_OVERVIEW
    result = await session.execute(statement, {"tolerance": tolerance})
    return [_feature(row) for row in result.mappings().all()]


async def warm_cache() -> None:
    """Fill the overview cache at startup. A database that does not answer is logged, not fatal."""
    try:
        async with SessionLocal() as session:
            key = (False, OVERVIEW_TOLERANCE)
            await _cached(key, lambda: _area_features(session, False, OVERVIEW_TOLERANCE))
    except Exception:
        logger.warning("Could not warm the /areas cache. It will fill on the first request.")


@router.get("", response_model=FeatureCollection)
async def list_areas(
    session: Session,
    include_zones: bool = False,
    tolerance: Annotated[float | None, Query(ge=0, le=MAX_TOLERANCE)] = None,
) -> Response:
    """Study areas as GeoJSON, simplified for display.

    By default only the top-level areas (zone is null) at 0.002 degrees. Each feature carries
    area_ha from the table, bbox, has_zones, metrics_loaded and projects_linked. Zone outlines
    come from /areas/{area_id}/zones. include_zones=true returns every area and zone, with
    0.0002 degrees unless tolerance is given.
    """
    if tolerance is None:
        tolerance = FULL_TOLERANCE if include_zones else OVERVIEW_TOLERANCE
    body = await _cached(
        (include_zones, tolerance), lambda: _area_features(session, include_zones, tolerance)
    )
    return _json(body)


@router.get("/{area_id}/zones", response_model=FeatureCollection)
async def area_zones(session: Session, area_id: str) -> Response:
    """The outline of one area (0.0002 degrees) and its up and down zones (0.0005 degrees)."""
    key = ("zones", area_id)

    async def build() -> list[dict[str, Any]]:
        await _require_area(session, area_id)
        result = await session.execute(
            SELECT_ZONES,
            {
                "area_id": area_id,
                "tolerance": ZONE_TOLERANCE,
                "outline_tolerance": FULL_TOLERANCE,
            },
        )
        return [_feature(row) for row in result.mappings().all()]

    return _json(await _cached(key, build))


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
