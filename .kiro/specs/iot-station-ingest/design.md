# Design: IoT Station Ingest

Status: draft
Traces: requirements.md (FR1-FR6, NFR1-NFR4)

## Overview

A station posts one JSON reading over HTTPS to a single ingest endpoint. The
endpoint validates the payload, auto-registers the station if new, and writes the
reading to the Neon `station_readings` table. The dashboard reads from the same
database, so readings appear in the live sensor view.

## Architecture

```
ESP32 station  --HTTPS POST /ingest-->  Ingest endpoint  --asyncpg-->  Neon Postgres
 (firmware)        JSON body             (FastAPI route)                station_readings
                                                                        stations
                                              |
                                        validate + auth
                                        auto-register station
```

Decision D1 (endpoint): Use the FastAPI `/ingest` route as the single ingest
surface. It already connects to Neon via `api/db.py` and reuses config, pooling,
and auth. A separate IoT Lambda handler would duplicate the Neon connection and
validation. If serverless hosting is required, the FastAPI app is packaged as the
API Lambda container (see `infra/lambdas.tf`), keeping one codebase.

Decision D2 (scheme): The endpoint is HTTPS only. Lambda Function URLs are HTTPS
by default. The firmware selects a TLS client for `https://` URLs and a plain
client for `http://`, so both local testing and public HTTPS work.

Decision D3 (cost): The station uploads on a fixed interval (currently 60 s) with
one reading per request. This keeps invocations and writes low (about 1,440 per
day per station). Batching is deferred unless volume grows.

## Data model

Existing tables (from `db/migrations/versions/0001_init.py`), unchanged:

- `stations(station_id PK, station_type, area_id, geom NOT NULL, mount_height_cm,
  dry_baseline_cm)` with `station_type IN ('river','street')`.
- `station_readings(station_id FK, ts, temp_c, humidity_pct, water_level_cm,
  flood_depth_cm, battery_v, PK(station_id, ts))`.

Because `station_readings.station_id` references `stations`, a reading can only be
inserted for a known station. The ingest therefore upserts the station first.

## API contract

Request:
```
POST /ingest
Content-Type: application/json
Authorization: Bearer <token>        # only when a token is configured

{
  "station_id": "river-marikina-bridge-01",
  "station_type": "river",
  "ts": "2026-10-04T00:00:00Z",       # optional; server stamps if absent
  "temp_c": 30.2,                      # optional
  "humidity_pct": 80.5,                # optional
  "water_level_cm": 42.0,              # river
  "flood_depth_cm": null,              # street
  "battery_v": 3.9,                    # optional
  "lon": 121.08, "lat": 14.65,         # optional, used on first contact
  "dry_baseline_cm": 120.0             # optional, street calibration
}
```

Responses:
- 201: `{ "ok": true, "station_id": "...", "ts": "..." }`
- 401: `{ "error": "unauthorized" }` when token is required and does not match
- 422: validation error (missing required fields, bad `station_type`)

## Behavior

1. Validate the body against the `Reading` model (FR1).
2. If a token is configured, require a matching bearer header (FR5).
3. Resolve `ts` to the provided value or now-UTC (FR4).
4. Upsert `stations` with `ON CONFLICT (station_id) DO NOTHING`, using provided
   `lon`/`lat` or a default point since `geom` is NOT NULL (FR3).
5. Insert into `station_readings` with
   `ON CONFLICT (station_id, ts) DO UPDATE` (FR2, FR6).
6. Commit and return 201.

## Firmware mapping

- The analog water reading (0-100%) is converted to centimeters using
  `WATER_FULL_SCALE_CM`, then sent as `water_level_cm` (river) or
  `flood_depth_cm` (street).
- GPIO34 (ADC1) is used for the water sensor so reads work while WiFi is active.
- Upload uses a plain client for `http://` and TLS for `https://`, with connect
  and read timeouts so a failed POST never blocks the loop (NFR4).

## Security

- `DATABASE_URL` and the optional `station_token` live in `.env` (gitignored).
- Firmware WiFi and server values live in `iot/firmware/src/config.h` (gitignored);
  a committed `config.example.h` documents the fields (NFR2).

## Risks

- R1: Function URLs with `authorization_type = NONE` are public. Mitigate with the
  shared bearer token (FR5) and server-side validation.
- R2: Default location on auto-register is a placeholder until an operator sets
  real coordinates; dashboards should show the station only after location is set
  or clearly mark it as unlocated.
