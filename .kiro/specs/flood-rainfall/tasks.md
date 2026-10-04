# Tasks: Flood Extent and Rainfall

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers.

## Task 1: CHIRPS shared helper
- [x] `daily_collection`, `daily_area_series`, `compute_rainfall` with flags.
- Covers: FR4, FR6; D1
- Files: `pipeline/metrics/chirps.py`
- Demo: a dry run returns a daily area-mean series summarized to a value.
- Status: implemented; covered by `tests/metrics/test_rainfall.py`.

## Task 2: Rainfall metrics
- [x] `rainfall_total`, `rainfall_wet_season`, `rainfall_max_1day`,
  `heavy_rain_days`.
- Covers: FR4, FR5, NFR4
- Files: the four modules
- Demo: each dry-runs and returns mm (or day count) per area with a flag.
- Status: implemented and registered; in `IMPLEMENTED_METRICS` (POST /analyze).

## Task 3: Sentinel-1 flood helper
- [x] `sar_flood.py`: orbit choice, dry baseline, change detection, exclusions,
  footprint, flags.
- Covers: FR1, FR2, FR3, FR7, NFR2
- Files: `pipeline/metrics/sar_flood.py`
- Demo: `scene_events` returns per-day flood_ha and coverage; flags resolve by
  priority.
- Status: implemented; covered by `tests/metrics/test_flood.py`.

## Task 4: flood_extent metric
- [x] `max_flood_ha` as the yearly value; `no_data` before 2015.
- Covers: FR1, FR6, NFR1
- Files: `pipeline/metrics/flood_extent.py`
- Demo: dry run returns per-area hectares with flags; `no_data` before 2015.
- Status: implemented and registered; currently `CLI_ONLY_METRICS`.

## Task 5: Shared wet-season window (the dependency)
- [x] Flood scenes and `rainfall_wet_season` use `chirps.wet_season_window`.
- Covers: FR4, AC2; D1
- Files: `pipeline/metrics/chirps.py`, `sar_flood.py`, `rainfall_wet_season.py`
- Demo: both metrics cover Jun 1 to Nov 30 for the same area and year.
- Status: implemented.

## Task 6: Expose flood_extent to POST /analyze
- [ ] After a dry run and geospatial review, move `flood_extent` from
  `CLI_ONLY_METRICS` to `IMPLEMENTED_METRICS`.
- Covers: AC1; readiness
- Files: `pipeline/metrics/__init__.py`
- Demo: `POST /analyze` accepts `flood_extent` and a job computes it.
- Status: pending review; CLI-only for now.

## Task 7: Compute and store for the demo areas
- [ ] Dry-run then `--confirmed` flood and rainfall for the three demo areas over
  2015+ and store in `satellite_metrics`.
- Covers: AC1, AC3
- Files: operational, uses `pipeline/run.py`
- Demo: rows for flood and rainfall appear in Neon for the demo areas.
- Status: pending an Earth Engine run.

## Task 8: Dashboard pairing
- [ ] Show flood extent next to wet-season rainfall per area and year, with the
  lower-bound and urban caveats.
- Covers: NFR2, user story 2
- Files: `dashboard/`, `client/`
- Demo: an area page shows flood extent and wet-season rainfall on the same years.
- Status: pending.
