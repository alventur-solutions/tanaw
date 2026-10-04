"""Read only OpenStreetMap crossings: places where a bridge road crosses a waterway.

A crossing is a place a monitoring station could be mounted, not a recommendation. The rows come
from `python -m pipeline.osm load`. Until they are loaded the response says loaded=false.
"""

import json
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import text

from api.areas import BROWSER_CACHE, Session, _require_area
from api.funding import OVERLAP_NOTE

router = APIRouter(prefix="/areas")

ATTRIBUTION = "Map data from OpenStreetMap contributors, ODbL"
WATERWAY_CLASSES = ("river", "canal", "stream")
DEFAULT_WATERWAYS = ("river", "canal")
NOTES = [
    "A mapped crossing is a place a station could be mounted, not a recommendation.",
    "OpenStreetMap is volunteer mapped and is less complete in rural areas, so a place with "
    "no mapped crossing may still have a bridge.",
    OVERLAP_NOTE,
]

# to_regclass is null for a table that does not exist, so a database without the OSM tables
# answers loaded=false instead of an error.
SELECT_TABLES = text(
    "SELECT to_regclass('osm_meta') IS NOT NULL AND to_regclass('osm_crossings') IS NOT NULL "
    "AS present"
)
SELECT_META = text("SELECT CAST(fetched_on AS text) AS fetched_on, attribution FROM osm_meta")
SELECT_CROSSINGS = text(
    "SELECT c.bridge_osm_id, c.waterway_osm_id, c.road_name, c.highway, c.waterway, "
    "c.waterway_name, ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat "
    "FROM study_areas a "
    "JOIN osm_crossings c ON ST_Intersects(a.geom, c.geom) "
    "WHERE a.area_id = :area_id AND c.waterway = ANY(CAST(:waterways AS text[])) "
    "ORDER BY c.waterway, c.bridge_osm_id, c.waterway_osm_id"
)


def parse_waterways(values: list[str] | None) -> list[str]:
    """Repeated or comma separated values. Defaults to river and canal."""
    if not values:
        return list(DEFAULT_WATERWAYS)
    parsed = [part.strip() for value in values for part in value.split(",") if part.strip()]
    unknown = [p for p in parsed if p not in WATERWAY_CLASSES]
    if unknown or not parsed:
        raise HTTPException(
            status_code=422, detail=f"waterway must be one of {', '.join(WATERWAY_CLASSES)}"
        )
    return [c for c in WATERWAY_CLASSES if c in parsed]


@router.get("/{area_id}/crossings")
async def area_crossings(
    session: Session,
    area_id: str,
    waterway: Annotated[list[str] | None, Query()] = None,
) -> Response:
    """Mapped bridge crossings over waterways inside one area or zone, as GeoJSON points.

    waterway: river, canal, stream, repeated or comma separated. Default river and canal.
    """
    classes = parse_waterways(waterway)
    await _require_area(session, area_id)
    present = (await session.execute(SELECT_TABLES)).scalar_one()
    meta = None
    if present:
        meta = (await session.execute(SELECT_META)).mappings().first()
    features: list[dict[str, Any]] = []
    if meta is not None:
        result = await session.execute(SELECT_CROSSINGS, {"area_id": area_id, "waterways": classes})
        for row in result.mappings().all():
            properties = {k: v for k, v in row.items() if k not in ("lon", "lat")}
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(row["lon"], 5), round(row["lat"], 5)],
                    },
                }
            )
    body = {
        "type": "FeatureCollection",
        "area_id": area_id,
        "loaded": meta is not None,
        "waterway": classes,
        "fetched_on": meta["fetched_on"] if meta is not None else None,
        "attribution": meta["attribution"] if meta is not None else ATTRIBUTION,
        "notes": NOTES,
        "features": features,
    }
    return Response(
        json.dumps(body, separators=(",", ":")),
        media_type="application/json",
        headers={"Cache-Control": BROWSER_CACHE},
    )
