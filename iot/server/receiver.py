"""TANAW IoT station receiver.

The FastAPI app accepts station readings and stores them in the shared Neon
database. ``handler`` adapts Lambda Function URL events; ``main`` runs the same
app locally over HTTPS.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import json
import subprocess
import sys
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

HERE = Path(__file__).resolve().parent
DEFAULT_CERT = HERE / "server.crt"
DEFAULT_KEY = HERE / "server.key"
MAX_BODY_BYTES = 8192

# Support both ``python iot/server/receiver.py`` locally and a zip with
# receiver.py and api/ at its root in Lambda.
if not (HERE / "api").is_dir():
    repo_root = HERE.parents[1]
    if (repo_root / "api").is_dir():
        sys.path.insert(0, str(repo_root))

router = APIRouter()


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """Load the shared database session lazily so cert generation needs no DB URL."""
    from api.db import get_session

    async for session in get_session():
        yield session


Session = Annotated[AsyncSession, Depends(get_db_session)]


class Reading(BaseModel):
    """One reading sent by an ESP32 station."""

    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(min_length=1, max_length=128)
    station_type: Literal["river", "street"]
    ts: datetime | None = None
    temp_c: float | None = None
    humidity_pct: float | None = None
    water_level_cm: float | None = None
    flood_depth_cm: float | None = None
    water_raw: int | None = None
    water_percent: int | None = Field(default=None, ge=0, le=100)
    status: str | None = Field(default=None, max_length=64)
    battery_v: float | None = None
    lon: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    dry_baseline_cm: float | None = None

    @model_validator(mode="after")
    def validate_station_fields(self) -> Reading:
        if (self.lon is None) != (self.lat is None):
            raise ValueError("lon and lat must be supplied together")
        if self.station_type == "river" and self.flood_depth_cm is not None:
            raise ValueError("river stations must use water_level_cm")
        if self.station_type == "street" and self.water_level_cm is not None:
            raise ValueError("street stations must use flood_depth_cm")
        return self


class IngestResponse(BaseModel):
    ok: bool
    station_id: str
    ts: datetime


CHECK_STATION = text("SELECT station_type FROM stations WHERE station_id = :station_id")

REGISTER_STATION = text(
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
        (station_id, ts, temp_c, humidity_pct, water_level_cm, flood_depth_cm,
         battery_v, water_raw, water_percent, sensor_status)
    VALUES
        (:station_id, :ts, :temp_c, :humidity_pct, :water_level_cm, :flood_depth_cm,
         :battery_v, :water_raw, :water_percent, :sensor_status)
    ON CONFLICT (station_id, ts) DO UPDATE SET
        temp_c = EXCLUDED.temp_c,
        humidity_pct = EXCLUDED.humidity_pct,
        water_level_cm = EXCLUDED.water_level_cm,
        flood_depth_cm = EXCLUDED.flood_depth_cm,
        battery_v = EXCLUDED.battery_v,
        water_raw = EXCLUDED.water_raw,
        water_percent = EXCLUDED.water_percent,
        sensor_status = EXCLUDED.sensor_status
    """
)


def _check_token(authorization: str | None) -> None:
    """Require a matching bearer token when one is configured."""
    from api.config import get_settings

    token = get_settings().station_token
    if token and authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="unauthorized")


@router.post("/ingest", response_model=IngestResponse, status_code=201)
async def ingest(
    reading: Reading,
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> IngestResponse:
    _check_token(authorization)

    station_result = await session.execute(CHECK_STATION, {"station_id": reading.station_id})
    station_type = station_result.scalar_one_or_none()
    if station_type is None:
        if reading.lon is None or reading.lat is None:
            raise HTTPException(
                status_code=422,
                detail="station is not registered; provide lon and lat to register it",
            )
        await session.execute(
            REGISTER_STATION,
            {
                "station_id": reading.station_id,
                "station_type": reading.station_type,
                "lon": reading.lon,
                "lat": reading.lat,
                "dry_baseline_cm": reading.dry_baseline_cm,
            },
        )
        station_result = await session.execute(CHECK_STATION, {"station_id": reading.station_id})
        station_type = station_result.scalar_one_or_none()

    if station_type != reading.station_type:
        raise HTTPException(status_code=422, detail="station_type does not match registration")

    ts = reading.ts or datetime.now(UTC)
    if ts.tzinfo is None or ts.utcoffset() is None:
        raise HTTPException(status_code=422, detail="ts must include a timezone")

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
            "water_raw": reading.water_raw,
            "water_percent": reading.water_percent,
            "sensor_status": reading.status,
        },
    )
    await session.commit()

    return IngestResponse(ok=True, station_id=reading.station_id, ts=ts)


app = FastAPI(title="TANAW IoT Receiver")
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


_lambda_loop: asyncio.AbstractEventLoop | None = None


def _lambda_response(status: int, body: dict[str, object]) -> dict[str, object]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


async def _dispatch_lambda_event(event: dict[str, object]) -> dict[str, object]:
    request_context = event.get("requestContext")
    if not isinstance(request_context, dict):
        return _lambda_response(400, {"detail": "invalid request context"})
    request = request_context.get("http")
    if not isinstance(request, dict):
        return _lambda_response(400, {"detail": "invalid request context"})
    method = str(request.get("method", "")).upper()
    path = event.get("rawPath", "")

    if method == "GET" and path == "/health":
        return _lambda_response(200, {"ok": True})
    if path != "/ingest":
        return _lambda_response(404, {"detail": "Not Found"})
    if method != "POST":
        return _lambda_response(405, {"detail": "Method Not Allowed"})

    body = event.get("body") or ""
    if not isinstance(body, str):
        return _lambda_response(400, {"detail": "invalid request body encoding"})
    is_base64_encoded = event.get("isBase64Encoded", False)
    if not isinstance(is_base64_encoded, bool):
        return _lambda_response(400, {"detail": "invalid request body encoding"})
    try:
        raw = (
            base64.b64decode(body, validate=True)
            if is_base64_encoded
            else body.encode()
        )
    except (binascii.Error, UnicodeEncodeError):
        return _lambda_response(400, {"detail": "invalid request body encoding"})
    if not raw or len(raw) > MAX_BODY_BYTES:
        return _lambda_response(413, {"detail": "body missing or too large"})

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _lambda_response(400, {"detail": "invalid json"})
    try:
        reading = Reading.model_validate(payload)
    except ValidationError as exc:
        details = [
            {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return _lambda_response(422, {"detail": details})

    event_headers = event.get("headers") or {}
    if not isinstance(event_headers, dict):
        return _lambda_response(400, {"detail": "invalid request headers"})
    headers = {
        str(name).lower(): str(value)
        for name, value in event_headers.items()
        if value is not None
    }
    authorization = headers.get("authorization")
    session_generator = get_db_session()
    session = await anext(session_generator)
    try:
        result = await ingest(reading, session, authorization)
    except HTTPException as exc:
        return _lambda_response(exc.status_code, {"detail": exc.detail})
    finally:
        await session_generator.aclose()

    return _lambda_response(201, result.model_dump(mode="json"))


def handler(event: dict[str, object], context: object) -> dict[str, object]:
    """Adapt an AWS Lambda Function URL event to the shared ingest endpoint."""
    global _lambda_loop
    if _lambda_loop is None or _lambda_loop.is_closed():
        _lambda_loop = asyncio.new_event_loop()
    return _lambda_loop.run_until_complete(_dispatch_lambda_event(event))


def gen_self_signed_cert(cert_path: Path, key_path: Path) -> None:
    """Generate a self-signed certificate for local development."""
    cmd = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(key_path),
        "-out",
        str(cert_path),
        "-days",
        "365",
        "-subj",
        "/CN=tanaw-iot-dev",
    ]
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        try:
            _gen_cert_cryptography(cert_path, key_path)
        except ImportError:
            sys.exit(
                "openssl and the optional 'cryptography' package are unavailable. "
                "Install one of them or provide --cert/--key."
            )
        print(f"Wrote {cert_path} and {key_path} (cryptography)")
        return
    except subprocess.CalledProcessError as exc:
        sys.exit(f"openssl failed: {exc}")
    print(f"Wrote {cert_path} and {key_path} (openssl)")


def _gen_cert_cryptography(cert_path: Path, key_path: Path) -> None:
    """Generate a self-signed certificate with the optional cryptography package."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "tanaw-iot-dev")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .sign(key, hashes.SHA256())
    )

    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TANAW IoT HTTPS receiver.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--cert", type=Path, default=DEFAULT_CERT)
    parser.add_argument("--key", type=Path, default=DEFAULT_KEY)
    parser.add_argument(
        "--gen-cert",
        action="store_true",
        help="Generate a self-signed cert/key (dev only) and exit.",
    )
    args = parser.parse_args(argv)

    if args.gen_cert:
        gen_self_signed_cert(args.cert, args.key)
        return 0

    if not args.cert.exists() or not args.key.exists():
        print(
            f"Missing cert/key ({args.cert}, {args.key}). "
            "Run with --gen-cert first, or pass --cert/--key.",
            file=sys.stderr,
        )
        return 1

    import uvicorn

    uvicorn.run(
        "iot.server.receiver:app",
        host=args.host,
        port=args.port,
        ssl_certfile=str(args.cert),
        ssl_keyfile=str(args.key),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
