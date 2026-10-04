# Tasks: Dashboard API

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers.

## Task 1: Areas, metrics, and projects endpoints
- [x] `GET /areas`, `/areas/{id}/metrics`, `/areas/{id}/projects`.
- Covers: FR1, FR2, FR3, NFR2
- Files: `api/areas.py`
- Demo: `GET /areas` returns a FeatureCollection; metrics and projects per area.
- Status: implemented; covered by `tests/test_areas.py`.

## Task 2: Analyze endpoint (cache then enqueue)
- [x] Validate, return cached rows, or 202 with poll_url and missing.
- Covers: FR4, NFR4
- Files: `api/analyze.py`
- Demo: all-cached -> cache_hit; missing -> 202 with poll_url.
- Status: implemented; covered by `tests/test_analyze.py`.

## Task 3: Job worker
- [x] Claim queued job, compute via pipeline in a thread, save, done/failed.
- Covers: FR5, NFR3
- Files: `api/jobs.py`
- Demo: a queued job runs and ends `done` with rows, or `failed` with an error.
- Status: implemented; covered by `tests/test_jobs.py`.

## Task 4: Job polling and stale handling
- [x] `GET /jobs/{id}`; fail stale jobs on startup and before reuse.
- Covers: FR6, FR7
- Files: `api/analyze.py`, `api/jobs.py`, `api/main.py`
- Demo: polling returns status/rows; a stale job is failed, not reused.
- Status: implemented.

## Task 5: Greenery map layer
- [x] `GET /layers/greenery` returns a Dynamic World tile URL, cached.
- Covers: FR8
- Files: `api/layers.py`
- Demo: returns a tile_url and legend; 422 on bad year; 503 if EE is down.
- Status: implemented; covered by `tests/test_layers.py`.

## Task 6: Health and pooled DB access
- [x] `GET /health` checks PostGIS; pooled asyncpg engine with caches off.
- Covers: FR9, NFR1
- Files: `api/main.py`, `api/db.py`, `api/config.py`
- Demo: `GET /health` returns the PostGIS version.
- Status: implemented; verified against Neon earlier.

## Task 7: Move the worker to an external queue (future)
- [ ] Replace BackgroundTasks with an arq (or similar) worker.
- Covers: R1 mitigation
- Files: `api/jobs.py` (run_job already takes only the job id)
- Demo: jobs survive an API restart.
- Status: pending; out of current scope.
