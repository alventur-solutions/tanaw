# Requirements: Satellite Metrics Pipeline

Status: draft
Owner: TANAW
Related code: `pipeline/run.py`, `pipeline/registry.py`, `pipeline/metrics/`,
`pipeline/study_areas.py`, `db/migrations/versions/0001_init.py`,
`tests/metrics/`, `docs/metrics.md`

## Problem statement

TANAW needs a per study area, per year history of the land from satellite data
(tree cover loss, built-up area, green space, rainfall, flood extent, night
lights). Each metric must be computed in Earth Engine, carry a quality flag, and
be stored in Neon so the dashboard and insight text can compare land change with
funding. Exports cost quota and time, so a dry run must always precede a write.

## Goals

- Compute any registered metric for one area or all areas over a year range.
- Produce uniform rows `(area_id, year, metric, value, quality_flag)` with a
  `source_version` recording the dataset.
- Never write to the database without a dry run first.
- Make adding a new metric a small, repeatable change (one module plus a registry
  entry plus a schema test).

## Non-goals

- Serving map tiles (those come from Earth Engine `getMapId`, not this pipeline).
- Funding ingest (see the DPWH skill and `funding/`).
- Real-time or sub-daily data.

## User stories

1. As a pipeline engineer, I want to dry-run a metric on a short year range and
   see the rows before anything is written.
2. As a reviewer, I want every row to carry a quality flag so I can tell solid
   values from low-coverage or storm-year values.
3. As the platform, I want metric values in `satellite_metrics` keyed by
   `(area_id, year, metric)` so the API can read them.

## Functional requirements

- FR1: The CLI SHALL accept `--metric` (a registered name), optional `--area`
  (an `area_id`, zones included), and `--years` (`2021` or `2021-2022`).
- FR2: The CLI SHALL require exactly one of `--dry-run` or `--confirmed`.
- FR3: `--dry-run` SHALL compute and print rows and write nothing.
- FR4: `--confirmed` SHALL upsert rows into `satellite_metrics` on the key
  `(area_id, year, metric)`, updating value, quality_flag, source_version, and
  computed_at on conflict.
- FR5: Each metric module SHALL expose `compute(year, areas) -> ee.FeatureCollection`
  returning features with `area_id, year, metric, value, quality_flag`.
- FR6: A metric SHALL return a `no_data` row for years outside its coverage rather
  than failing.
- FR7: The pipeline SHALL batch requests by a few years each to avoid Earth Engine
  "Too many concurrent aggregations" errors.
- FR8: Rows SHALL record `source_version` set to the metric's dataset id.

## Non-functional requirements

- NFR1 (honesty): Hansen loss SHALL be labeled "tree cover loss", never
  "deforestation". Storm years SHALL be flagged, not silently reported.
- NFR2 (correctness): Hectares SHALL use `pixelArea / 1e4`. Forest SHALL be
  `treecover2000 >= 30`. Scale SHALL be 30 m for Landsat and Hansen.
- NFR3 (safety): A real export SHALL never run without a prior dry run. The Bash
  guard hook blocks `pipeline.run` without `--dry-run` or `--confirmed`.
- NFR4 (quality flag): Every row SHALL carry a quality_flag (`ok`, `storm_year`,
  `low_coverage`, `no_data`).

## Acceptance criteria

- AC1: `python -m pipeline.run --metric tree_cover_loss --area quezon-city
  --years 2021-2022 --dry-run` prints rows and writes nothing.
- AC2: The same command with `--confirmed` upserts rows into `satellite_metrics`.
- AC3: A year outside a metric's range yields a `no_data` row, not an error.
- AC4: Each metric has a `tests/metrics/test_<metric>.py` asserting the output
  schema `(area_id, year, metric, value, quality_flag)`.
- AC5: No row is written without a dry run having been possible first (CLI
  requires one of `--dry-run` / `--confirmed`; hook enforces it).

## Open questions

- OQ1: Harmonization order for Landsat 7 to 8/9 before any NDVI window, and the
  exact multi-year windows (e.g. 2009-2011 vs 2022-2024).
- OQ2: GHSL epochs vs yearly values for built-up; report as epochs, do not
  interpolate silently.
- OQ3: Which metrics are the headline per `study_type` on the dashboard.
