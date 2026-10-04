# Requirements: IoT Station Ingest

Status: draft
Owner: TANAW
Related code: `api/ingest.py`, `iot/firmware/`, `infra/lambdas.tf`, `db/migrations/versions/0001_init.py`

## Problem statement

TANAW field stations (ESP32) measure river water level and street flood depth,
plus temperature and humidity. These readings must reach the same Neon Postgres
database the dashboard reads from, so live sensor data appears alongside the
satellite and funding layers. The path must be reachable from devices on any
network and must be cost-efficient to run.

## Goals

- A station can send a reading to one public endpoint and have it stored in Neon
  `station_readings`.
- A newly flashed station works without a manual database insert.
- The ingest cost (serverless invocations, database writes) stays low.
- No device credentials or database secrets are committed to the repository.

## Non-goals

- Real-time streaming or sub-second latency.
- Historical backfill of readings taken before a station is online.
- Changing the satellite pipeline or funding ingest.

## User stories

1. As a DRRM operator, I want new station readings to show on the dashboard so I
   can see current river and street conditions per study area.
2. As a field technician, I want to flash a station and have it start reporting
   without editing the database by hand.
3. As the platform owner, I want the ingest to be inexpensive at the expected
   reading volume.

## Functional requirements

- FR1: The system SHALL accept a reading over HTTPS as JSON with fields
  `station_id`, `station_type` (`river` or `street`), and the measurement for its
  type (`water_level_cm` for river, `flood_depth_cm` for street), plus optional
  `temp_c`, `humidity_pct`, `battery_v`, and `ts`.
- FR2: The system SHALL store each accepted reading in the Neon `station_readings`
  table keyed by (`station_id`, `ts`).
- FR3: The system SHALL auto-register an unknown `station_id` in the `stations`
  table on first contact, using the device-provided location if present.
- FR4: When no `ts` is supplied, the system SHALL stamp the reading with the
  current UTC time.
- FR5: The system SHALL support an optional shared bearer token; when configured,
  requests without a matching token SHALL be rejected with HTTP 401.
- FR6: Re-sending a reading with the same (`station_id`, `ts`) SHALL update that
  row rather than create a duplicate.

## Non-functional requirements

- NFR1 (cost): At the configured reading interval, serverless invocations and
  database writes SHALL stay within the free or low-cost tier.
- NFR2 (security): Database credentials and device tokens SHALL live only in
  gitignored files or environment variables, never in version control.
- NFR3 (reachability): The endpoint SHALL be reachable from a device on a
  different network than the server (public HTTPS).
- NFR4 (reliability): A failed upload SHALL NOT crash or reset the station; the
  device continues sensing and retries on the next interval.

## Acceptance criteria

- AC1: Posting a valid river reading returns HTTP 201 and the row is present in
  Neon `station_readings`.
- AC2: Posting with an unknown `station_id` creates a row in `stations`.
- AC3: With a token configured, a wrong or missing token returns HTTP 401.
- AC4: Posting the same (`station_id`, `ts`) twice yields one row, updated.
- AC5: No secrets appear in `git status` / committed files.

## Open questions

- OQ1: Is the public endpoint the FastAPI app (`/ingest` on the API Lambda or a
  host) or a dedicated IoT Lambda handler? The repo currently implements `/ingest`
  as a FastAPI route; `infra/lambdas.tf` defines a separate IoT Lambda with no
  handler code yet.
- OQ2: Upload cadence. Current firmware uploads every 60 s. Confirm the target
  interval against the cost budget.
- OQ3: Should the standalone `iot/server/receiver.py` (SQLite) be kept as an
  offline fallback or removed to avoid two ingest paths?
