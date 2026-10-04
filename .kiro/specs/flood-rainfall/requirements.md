# Requirements: Flood Extent and Rainfall

Status: draft
Owner: TANAW
Related code: `pipeline/metrics/sar_flood.py`, `flood_extent.py`, `chirps.py`,
`rainfall_total.py`, `rainfall_wet_season.py`, `rainfall_max_1day.py`,
`heavy_rain_days.py`, `pipeline/registry.py`, `pipeline/metrics/__init__.py`,
`tests/metrics/test_flood.py`, `tests/metrics/test_rainfall.py`, `docs/metrics.md`

## Problem statement

TANAW asks whether places flood, how much it rains, and whether the two line up.
Flood extent comes from Sentinel-1 SAR; rainfall comes from CHIRPS. The flood metric
depends on rainfall through a shared wet-season window (Jun 1 to Nov 30), and the
dashboard shows flood extent next to wet-season rainfall for the same area and years.
Both must be honest about what radar and 5.5 km rainfall pixels can and cannot show.

## The dependency (what "flood depends on rainfall" means here)

- The wet season window is defined once in `chirps.wet_season_window(year)`
  (Jun 1 to Nov 30) and reused by `sar_flood` for the flood scenes and by
  `rainfall_wet_season`. Flood extent and wet-season rainfall therefore cover the
  same period and are meant to be read together.
- A `flood_ha_per_mm` ("flood per mm of rain") metric was tried and removed:
  detected flooded area did not track rainfall in the dry run, so the ratio mostly
  reflected the denominator. The flood metric is a single-event maximum, NOT a
  ratio to rainfall. Any pairing with rainfall is presentational, not a division.

## Goals

- Compute flood extent per area per year from Sentinel-1 VV change detection.
- Compute rainfall metrics per area per year from CHIRPS: annual total, wet-season
  total, max 1-day, and heavy-rain-day count.
- Flag every value for the limits of radar and coarse rainfall pixels.
- Keep flood and wet-season rainfall on the same window so they can be compared.

## Non-goals

- A flood-per-rainfall ratio metric (tried and removed).
- Street-level flood from satellite (SAR VV does not see water between buildings;
  that is the IoT street stations' job).
- Rainfall at gauge or street resolution (CHIRPS pixels are about 5.5 km).

## User stories

1. As an analyst, I want flood extent per year so I can see the largest observed
   flood event per area.
2. As an analyst, I want wet-season rainfall for the same years so I can read flood
   extent against how wet the season was.
3. As a reviewer, I want flags that tell me when a value is a lower bound, urban and
   unreliable, from few scenes, or from a partial season.

## Functional requirements

- FR1: `flood_extent` SHALL be the largest flooded hectares of any single wet-season
  acquisition day (Jun 1 to Nov 30), by Sentinel-1 VV change detection: VV < -16 dB
  AND (dry-baseline minus scene) > 3 dB, with permanent water (GSW occurrence > 80)
  and slopes > 5 degrees removed.
- FR2: The dry baseline SHALL be the median of filtered Jan 1 to Apr 30 images of the
  same year and orbit direction; a 50 m focal-median speckle filter SHALL be applied.
- FR3: Flood scale SHALL be 10 m for areas <= 100,000 ha, else 30 m; flooded area
  SHALL be counted only inside each day's footprint (a lower bound on partial days).
- FR4: `rainfall_total`, `rainfall_wet_season`, `rainfall_max_1day`, and
  `heavy_rain_days` SHALL summarize the CHIRPS daily area-mean series over their
  window; wet-season rainfall uses the same window as flood extent.
- FR5: `heavy_rain_days` SHALL count days with area-mean rainfall >= 50 mm.
- FR6: Every metric SHALL return `(area_id, year, metric, value, quality_flag)` and a
  `no_data` row (value None) for years outside coverage.
- FR7: Flood flags SHALL follow the documented priority: `no_data`,
  `urban_unreliable`, `steep_terrain`, `partial_year`, `sparse_acquisitions`,
  `partial_footprint`, else `ok`. Rainfall flags: `no_data`, `partial_year`,
  `small_area`, `ok`.

## Non-functional requirements

- NFR1 (coverage start): Flood values begin in 2015 (Sentinel-1); rainfall in 1981
  (CHIRPS). State this; no flood value exists before 2015.
- NFR2 (honesty): Urban flood extent is a lower bound of open water, not a count of
  flooded streets, and SHALL be flagged `urban_unreliable`. Do not add flood values
  of a zone and its parent area.
- NFR3 (no invented ratio): The pipeline SHALL NOT reintroduce a flood-per-mm ratio
  without evidence that detected area tracks rainfall.
- NFR4 (resolution honesty): Rainfall is a 5.5 km area mean, lower than a gauge peak;
  state this for max-1-day and heavy-rain-day values.

## Acceptance criteria

- AC1: `flood_extent` dry-run returns per-area hectares for a wet season, flagged
  (`ok`, `urban_unreliable`, `partial_footprint`, etc.), and `no_data` before 2015.
- AC2: `rainfall_wet_season` uses the same Jun 1 to Nov 30 window as flood extent.
- AC3: `heavy_rain_days` counts days at or above 50 mm area-mean rainfall.
- AC4: Each metric has a schema test asserting
  `(area_id, year, metric, value, quality_flag)`.
- AC5: Urban areas carry `urban_unreliable` on flood extent.
