# Requirements: Dashboard API

Status: draft
Owner: TANAW
Related code: `api/main.py`, `api/areas.py`, `api/analyze.py`, `api/jobs.py`,
`api/layers.py`, `api/db.py`, `api/config.py`, `api/funding.py`,
`db/migrations/versions/0001_init.py` and `0002_analysis_jobs_progress.py`

## Problem statement

The dashboard and client need a backend that serves study areas, their satellite
metric rows, DPWH projects per area, and on-demand analysis for metrics not yet
computed. Map layers come from Earth Engine tiles, not the database. The API reads
from Neon (pooled) and must present honest, per-area data with caveats.

## Goals

- Serve study areas and zones as GeoJSON for the map.
- Serve satellite metric rows and DPWH projects per area.
- Compute missing metrics on demand through a cached, polled job flow.
- Serve Earth Engine map tiles (greenery) without exporting or writing.

## Non-goals

- Writing satellite metrics directly from a request (that is the pipeline's job;
  the API enqueues a job that calls the pipeline).
- Summing totals across overlapping areas.
- Serving raster data from the database.

## User stories

1. As a dashboard, I want `GET /areas` so I can draw every study area on the map.
2. As a dashboard, I want `GET /areas/{id}/metrics` and `/projects` so I can show
   land history and funding for one area.
3. As a user, I want `POST /analyze` to return cached rows instantly, or start a
   job and give me a URL to poll when some metrics are missing.
4. As a dashboard, I want `GET /layers/greenery` to return a tile URL for the
   vegetation layer.

## Functional requirements

- FR1: `GET /areas` SHALL return all areas and zones as a GeoJSON FeatureCollection,
  geometry simplified for display only.
- FR2: `GET /areas/{id}/metrics?metric=` SHALL return metric rows for one area, each
  with its `quality_flag`; unknown area returns 404.
- FR3: `GET /areas/{id}/projects?include_partial_years=` SHALL return DPWH projects
  linked to the area as GeoJSON points, defaulting to the full-year window, with the
  overlap and site-location notes.
- FR4: `POST /analyze` SHALL validate the request (known area, implemented metrics,
  year bounds, size limit), return `cache_hit` with rows when all combinations exist,
  else enqueue (or reuse) a job and return 202 with a `poll_url` and the rows that do
  exist.
- FR5: The job worker SHALL claim only a `queued` job, compute the missing metrics
  via the pipeline in a thread, upsert the rows, and mark the job `done`; on error it
  SHALL mark the job `failed` with a truncated error.
- FR6: `GET /jobs/{id}` SHALL return job status and, when `done`, the computed rows;
  unknown id returns 404.
- FR7: Stale jobs (running or queued past the stale window) SHALL be failed on API
  start and before reusing an active job.
- FR8: `GET /layers/greenery?year=` SHALL return a Dynamic World tile URL for the dry
  season composite, cached briefly; out-of-range year returns 422; Earth Engine
  unavailable returns 503.
- FR9: `GET /health` SHALL confirm the database and PostGIS are reachable.

## Non-functional requirements

- NFR1 (pooling): The engine SHALL use the Neon pooled URL with prepared-statement
  caches disabled (PgBouncer transaction mode).
- NFR2 (honesty): Project responses SHALL carry the overlap note and the "coordinates
  are the project site" note; funding windows SHALL carry the partial-years caveat.
- NFR3 (no EE at import): Importing the API SHALL NOT require Earth Engine; pipeline
  and EE imports are local to the functions that need them.
- NFR4 (idempotent jobs): A job SHALL never run twice; only a queued job can be
  claimed, and an identical active job is reused.

## Acceptance criteria

- AC1: `GET /areas` returns a FeatureCollection with one feature per area/zone.
- AC2: `GET /areas/{id}/metrics` returns rows with quality flags; unknown area 404.
- AC3: `POST /analyze` with all metrics cached returns `cache_hit=true` and rows.
- AC4: `POST /analyze` with missing metrics returns 202 with a `poll_url`; polling
  `GET /jobs/{id}` eventually returns `done` with rows (or `failed` with an error).
- AC5: `GET /layers/greenery` returns a tile URL, or 503 if Earth Engine is down.
- AC6: `GET /health` returns the PostGIS version when the database is reachable.
