# Design: Flood Extent and Rainfall

Status: draft
Traces: requirements.md (FR1-FR7, NFR1-NFR4)

## Overview

Two shared helper modules back these metrics: `chirps.py` (CHIRPS daily rainfall)
and `sar_flood.py` (Sentinel-1 flood). The flood metric reuses the CHIRPS
wet-season window, which is the dependency between flood and rainfall. All metrics
emit the uniform row and plug into `pipeline/registry.py`.

## The flood-rainfall link

```
chirps.wet_season_window(year)  == (Jun 1, Nov 30)
        |                                   |
   rainfall_wet_season                 sar_flood scenes (wet season)
        |                                   |
   wet-season total mm                 flood_extent max day ha
        \__________ same window, same area, same years __________/
                     read together on the dashboard
```

No division: `flood_ha_per_mm` was removed because detected area did not follow
rain (documented in `sar_flood.py`).

## Rainfall (chirps.py + 4 metrics)

- `daily_collection(window)` and `daily_area_series(collection, geometry)` produce
  the CHIRPS daily area-mean series (mm), read on the native 0.05 degree grid via
  `crsTransform` (no resampling).
- `compute_rainfall(year, areas, metric, window, summarize)` wraps the series with
  flags and the uniform row.
- Metrics: `rainfall_total` (year sum), `rainfall_wet_season` (Jun-Nov sum, FR4),
  `rainfall_max_1day` (year max), `heavy_rain_days` (count >= 50 mm, FR5).
- Flags: `no_data`, `partial_year` (window not fully published), `small_area`
  (area smaller than one pixel), `ok`.

## Flood extent (sar_flood.py + flood_extent.py)

- Orbit: one direction per area, fixed as the direction with more images in
  2017-2024 (ties DESCENDING).
- Baseline: median of filtered Jan 1 to Apr 30 of the same year and direction (FR2).
- Flood pixel: VV < -16 dB AND (baseline - scene) > 3 dB (FR1).
- Exclusions: GSW permanent water occurrence > 80; SRTM slope > 5 degrees. An area
  more than half steep gets `steep_terrain`.
- Scenes mosaicked per UTC day; a "scene" is an acquisition day. Flood counted only
  inside each day's footprint; days under `MIN_DAY_COVERAGE` (0.10) dropped (FR3).
- Value: `max_flood_ha` = largest single-day flooded hectares in the wet season
  (one event, not a season union).
- Scale: 10 m for areas <= 100,000 ha, else 30 m (memory) (FR3).
- Flag priority (first match): `no_data`, `urban_unreliable`, `steep_terrain`,
  `partial_year`, `sparse_acquisitions` (< MIN_SCENES=6 days or < MIN_BASELINE=3
  baseline images), `partial_footprint` (top day covers < 50%), else `ok` (FR7).

## Registry and exposure

- `registry.py` registers tree_cover_loss plus rainfall_total, rainfall_wet_season,
  rainfall_max_1day, heavy_rain_days, flood_extent.
- `metrics/__init__.py`: `IMPLEMENTED_METRICS` (accepted by `POST /analyze`)
  includes the four rainfall metrics and tree_cover_loss; `flood_extent` is in
  `CLI_ONLY_METRICS` (runnable via `pipeline.run`, not yet exposed to `/analyze`).

## Decisions

- D1: One wet-season window in `chirps.py`, reused by flood, so the two are always
  comparable (the dependency).
- D2: Flood is a single-event maximum, not a ratio to rain; the ratio was removed on
  evidence (NFR3).
- D3: Change detection against a dry baseline, not a bare threshold, to reduce false
  water from always-dark surfaces.
- D4: Urban flood extent is kept but flagged `urban_unreliable` as a lower bound
  (NFR2).

## Risks

- R1: Partial acquisition footprints make a value a lower bound; `partial_footprint`
  signals it. Compare an area with itself over years before comparing areas.
- R2: Two flood scales (10 m / 30 m) are not exactly comparable across very different
  area sizes; documented.
- R3: CHIRPS lag means recent windows are incomplete; `partial_year` signals it.
