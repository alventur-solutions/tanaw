"""Station ingest: POST /ingest.

Receives one reading from an IoT flood/climate station (ESP32) and writes it to
the Neon station_readings table. The station is auto-registered on first contact
so a freshly flashed device works without a manual DB insert.

Measurement model (see CLAUDE.md "IoT stations"):
- station_type = 'river'  -> reports water_level_cm (height of water on the sensor).
- station_type = 'street' -> reports flood_depth_cm = dry_baseline_cm - measured_cm.

Readings carry a timestamp (ts). If the device does not send one, the server
stamps it with the current UTC time.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import get_settings
from api.db import get_session

router = APIRouter()

Session = Annotated[AsyncSession, Depends(get_session)]

# Default location for an auto-registered station until an operator sets the real
# coordinates. geom is NOT NULL in the schema, so a point is required on insert.
DEFAULT_LON = 121.05
DEFAULT_LAT = 14.65


class Reading(BaseModel):
    """One reading POSTed by a station."""

    station_id: str = Field(min_length=1, max_length=128)
    station_type: Literal["river", "street"]
    ts: datetime | None = None
    temp_c: float | None = None
    humidity_pct: float | None = None
    water_level_cm: float | None = None
    flood_depth_cm: float | None = None
    battery_v: float | None = None
    # Optional: set the station location on first contact (auto-register).
    lon: float | None = None
    lat: float | None = None
    dry_baseline_cm: float | None = None


class IngestResponse(BaseModel):
    ok: bool
    station_id: str
    ts: datetime


# Insert the station if it is new; otherwise leave its stored config untouched.
UPSERT_STATION = text(
    """
    INSERT INTO stations (station_id, station_type, geom, dry_baseline_cm)
    VALUES (
        :station_id,
        :station_type,
        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
        :dry_baseline_cm
    )
    ON CONFLICT (station_id) DO NOTHING
    """
)

INSERT_READING = text(
    """
    INSERT INTO station_readings
        (station_id, ts, temp_c, humidity_pct, water_level_cm, flood_depth_cm, battery_v)
    VALUES
        (:station_id, :ts, :temp_c, :humidity_pct, :water_level_cm, :flood_depth_cm, :battery_v)
    ON CONFLICT (station_id, ts) DO UPDATE SET
        temp_c = EXCLUDED.temp_c,
        humidity_pct = EXCLUDED.humidity_pct,
        water_level_cm = EXCLUDED.water_level_cm,
        flood_depth_cm = EXCLUDED.flood_depth_cm,
        battery_v = EXCLUDED.battery_v
    """
)


def _check_token(authorization: str | None) -> None:
    """If TANAW_STATION_TOKEN is set, require a matching bearer token."""
    settings = get_settings()
    token = getattr(settings, "station_token", None)
    if not token:
        return
    if authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="unauthorized")


@router.post("/ingest", response_model=IngestResponse, status_code=201)
async def ingest(
    reading: Reading,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> IngestResponse:
    _check_token(authorization)

    ts = reading.ts or datetime.now(UTC)

    await session.execute(
        UPSERT_STATION,
        {
            "station_id": reading.station_id,
            "station_type": reading.station_type,
            "lon": reading.lon if reading.lon is not None else DEFAULT_LON,
            "lat": reading.lat if reading.lat is not None else DEFAULT_LAT,
            "dry_baseline_cm": reading.dry_baseline_cm,
        },
    )
    await session.execute(
        INSERT_READING,
        {
            "station_id": reading.station_id,
            "ts": ts,
            "temp_c": reading.temp_c,
            "humidity_pct": reading.humidity_pct,
            "water_level_cm": reading.water_level_cm,
            "flood_depth_cm": reading.flood_depth_cm,
            "battery_v": reading.battery_v,
        },
    )
    await session.commit()

    return IngestResponse(ok=True, station_id=reading.station_id, ts=ts)
