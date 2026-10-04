# Design: Dashboard API

Status: draft
Traces: requirements.md (FR1-FR9, NFR1-NFR4)

## Overview

A FastAPI app (`api/main.py`) mounts routers for areas, analyze, funding, ingest,
and layers, plus `/health`. It reads from Neon via an async SQLAlchemy engine
(`api/db.py`). Analysis is a cache-then-job flow; map layers are Earth Engine tile
URLs.

## Routers

- `areas.py`: `GET /areas`, `GET /areas/{id}/metrics`, `GET /areas/{id}/projects`.
  Areas are returned with `ST_SimplifyPreserveTopology(geom, 0.0002)` for display;
  metrics full geometry is untouched. Projects join through
  `funding_project_areas` with the shared `year_window`.
- `analyze.py`: `POST /analyze`, `GET /jobs/{id}`.
- `jobs.py`: the worker (`run_job`, `enqueue_job`, `fail_stale_jobs`).
- `layers.py`: `GET /layers/greenery`.
- `funding.py`: `GET /funding/totals` (covered by the funding-ingest spec).

## Analyze flow (analyze.py + jobs.py)

```
POST /analyze
  validate (area exists, metrics in IMPLEMENTED_METRICS, year bounds, <= 500 pairs)
  fetch cached rows from satellite_metrics
  missing = requested (year, metric) not in cache
  if none missing          -> 200 cache_hit, rows
  else fail stale jobs; find active identical job or INSERT a queued job
       -> 202 { job_id, poll_url, missing, rows that exist }
       enqueue_job -> BackgroundTasks -> run_job

run_job(job_id)
  CLAIM_JOB (queued -> running)        # only a queued job can be claimed (NFR4)
  for metric, years in missing:        # compute_metric in a thread (blocking EE)
      compute_rows via pipeline
  save_rows + FINISH_JOB (-> done)
  on error: FAIL_JOB (-> failed, truncated error)
```

Stale handling: `FAIL_STALE_JOBS` fails jobs stuck running or queued past
`STALE_AFTER_MINUTES` (15), run on startup (`lifespan`) and before reusing a job.

## Request validation (AnalyzeRequest)

- Give `years` or (`year_start`, `year_end`), not both; resolve to sorted unique
  years; bound to `MIN_YEAR=1985`..current year; metrics must be in
  `IMPLEMENTED_METRICS`; at most `MAX_COMBINATIONS=500` year-metric pairs.

## Layers (layers.py)

- `greenery_tile_url(year)` builds a Dynamic World dry-season mode image of the
  vegetation classes and returns `getMapId(...)["tile_fetcher"].url_format`.
- Cached per year for `CACHE_SECONDS=3600`. Year bounded to `FIRST_YEAR=2016`..latest
  full dry season. Earth Engine failure -> 503.

## Database access (db.py, config.py)

- `create_async_engine` on the pooled URL with `statement_cache_size=0` and
  `prepared_statement_cache_size=0` (PgBouncer), `pool_pre_ping`, pool size 5 + 5
  overflow (NFR1).
- `config.py` converts the Neon libpq URL to asyncpg and strips `channel_binding`.

## Decisions

- D1: Cache-then-job keeps reads instant and defers only genuinely missing work.
- D2: Compute in a thread (`asyncio.to_thread`) because Earth Engine `getInfo` is
  blocking; keeps the event loop responsive.
- D3: Local pipeline/EE imports so the API boots without Earth Engine (NFR3).
- D4: `run_job` takes only the job id so it can move to an external worker (arq)
  later without signature changes.

## Risks

- R1: BackgroundTasks runs in-process; if the server restarts mid-job the job is
  left running and later failed as stale (FR7). An external queue would remove this.
- R2: Tile URLs expire after hours; the short cache avoids serving a dead URL for
  long.
