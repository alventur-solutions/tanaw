# Design: Satellite Metrics Pipeline

Status: draft
Traces: requirements.md (FR1-FR8, NFR1-NFR4)

## Overview

The pipeline computes a satellite metric for study areas over a year range in
Earth Engine, prints the rows on a dry run, and upserts them into the Neon
`satellite_metrics` table on confirmation. The API reads from that table.

## Flow

```
study_areas (geojson) --> select_features(area) --> compute_rows(metric, years)
   |                                                       |
 read_features                                     Earth Engine compute()
                                                           |
                               dry-run: print rows    confirmed: upsert satellite_metrics (Neon)
```

## CLI (pipeline/run.py)

- `parse_years("2021-2022")` -> inclusive list of years; backwards ranges error.
- `select_features(area)` returns all features, or one area plus its zones
  (`<area_id>__up`, `<area_id>__down`).
- `compute_rows` builds an `ee.FeatureCollection` of areas, calls the metric's
  `compute` per year in batches of `YEARS_PER_REQUEST` (4), flattens, and checks
  the row schema in `to_rows`.
- `save` upserts with the `UPSERT` statement using the async engine from
  `api/db.py`.

## Metric contract (pipeline/metrics/<metric>.py)

Each module exports: `METRIC`, `UNIT`, `DATASET`, `FIRST_YEAR`, `LAST_YEAR`, and
`compute(year, areas) -> ee.FeatureCollection`. It is registered in
`pipeline/registry.py` as a `Metric` dataclass. `IMPLEMENTED_METRICS` in
`pipeline/metrics/__init__.py` lists what the API's `/analyze` will accept.

## Reference implementation: tree_cover_loss

- Dataset: `UMD/hansen/global_forest_change_2025_v1_13`, 2001 to 2025.
- Forest = `treecover2000 >= 30`. Value = hectares of forest whose first loss was
  detected that year (`pixelArea / 1e4`).
- `valid` band from `datamask != 0`; quality_flag is `low_coverage` when the valid
  fraction is below 0.95, `storm_year` for 2009 and 2020, else `ok`.
- Years outside range return `no_data`.

## Data model (db/migrations/versions/0001_init.py)

`satellite_metrics(area_id FK, year, metric, value, quality_flag NOT NULL,
source_version, computed_at, PK(area_id, year, metric))`.

## Decisions

- D1: One module per metric with a uniform `compute(year, areas)` contract, so
  adding a metric is a local change plus a registry entry.
- D2: Dry run and confirmed are mutually exclusive and one is required, so a write
  can never happen by accident. A Bash guard hook enforces this at the tool level.
- D3: Batch years (4 per request) to stay under Earth Engine aggregation limits.
- D4: Store `source_version` = dataset id so rows from an older dataset version can
  be told apart.

## Risks

- R1: Mixing sensors without harmonization skews multi-year comparisons. NDVI must
  use multi-year windows and harmonize Landsat 7 to 8/9 (see OQ1).
- R2: Loss in storm years can be natural. Flag it (`storm_year`), never present it
  as human clearing.
- R3: Low valid-pixel coverage produces misleading values; flag `low_coverage`.
