"""Read only station feed for the public live sensors page.

GET /stations returns every registered station with its latest reading. GET
/stations/{station_id}/readings returns the readings of the last hours, oldest
first, so the page can tell whether the water is rising or falling.

Readings are as the device sent them. A station that has not reported for a while
still appears, with the time of its last reading, so the page can say it is stale.
"""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from api.areas import Session

router = APIRouter(prefix="/stations")

SELECT_LATEST = text(
    "SELECT s.station_id, s.station_type, s.area_id, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, "
    "s.dry_baseline_cm, r.ts, r.temp_c, r.humidity_pct, r.water_level_cm, r.flood_depth_cm, "
    "r.battery_v "
    "FROM stations s "
    "LEFT JOIN LATERAL ("
    "  SELECT * FROM station_readings sr WHERE sr.station_id = s.station_id "
    "  ORDER BY sr.ts DESC LIMIT 1"
    ") r ON true "
    "ORDER BY s.station_id"
)
SELECT_STATION = text("SELECT 1 FROM stations WHERE station_id = :station_id")
SELECT_READINGS = text(
    "SELECT ts, temp_c, humidity_pct, water_level_cm, flood_depth_cm, battery_v "
    "FROM station_readings "
    "WHERE station_id = :station_id AND ts >= now() - make_interval(hours => :hours) "
    "ORDER BY ts"
)

READING_FIELDS = ("temp_c", "humidity_pct", "water_level_cm", "flood_depth_cm", "battery_v")


def _reading(row: Any) -> dict[str, Any] | None:
    if row["ts"] is None:
        return None
    return {"ts": row["ts"].isoformat(), **{k: row[k] for k in READING_FIELDS}}


@router.get("")
async def stations(session: Session) -> dict[str, Any]:
    """Every station as a GeoJSON point, with its latest reading (null before the first one)."""
    result = await session.execute(SELECT_LATEST)
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
            "properties": {
                "station_id": row["station_id"],
                "station_type": row["station_type"],
                "area_id": row["area_id"],
                "dry_baseline_cm": row["dry_baseline_cm"],
                "latest": _reading(row),
            },
        }
        for row in result.mappings().all()
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/{station_id}/readings")
async def station_readings(
    session: Session,
    station_id: str,
    hours: Annotated[int, Query(ge=1, le=168)] = 24,
) -> dict[str, Any]:
    """Readings from the last `hours` hours, oldest first."""
    if (await session.execute(SELECT_STATION, {"station_id": station_id})).first() is None:
        raise HTTPException(status_code=404, detail=f"unknown station_id {station_id}")
    result = await session.execute(SELECT_READINGS, {"station_id": station_id, "hours": hours})
    return {
        "station_id": station_id,
        "hours": hours,
        "readings": [_reading(row) for row in result.mappings().all()],
    }
