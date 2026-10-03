# TANAW satellite metrics

Every metric writes rows of `(area_id, year, metric, value, quality_flag)`, plus
`source_version` (the dataset ID the value came from).
Run one with `python -m pipeline.run --metric <metric> --area <area_id> --years 2021-2022 --dry-run`.

## tree_cover_loss

| | |
|---|---|
| Module | `pipeline/metrics/tree_cover_loss.py` |
| Source | Hansen Global Forest Change v1.13, `UMD/hansen/global_forest_change_2025_v1_13` |
| Years | 2001 to 2025 |
| Unit | hectares |
| Scale | 30 m |
| Study types | Headline for `river_basin` (upstream vs downstream) and `rural_upland`. Supporting only for `urban`. |

**Definition.** Forest is any pixel with `treecover2000` of 30 percent or more. The value for a
year is the summed area (`pixelArea / 1e4`) of forest pixels whose `lossyear` equals that year,
inside the study area.

**quality_flag**

| Flag | Meaning |
|---|---|
| `ok` | At least 95 percent of the area has Hansen data. |
| `storm_year` | Same coverage, but the year had a major typhoon over the region (2009 Ondoy, 2020 Ulysses). Part of the loss may be natural. |
| `low_coverage` | Less than 95 percent of the area has Hansen data. Treat the value as a lower bound. |
| `no_data` | Year is outside 2001 to 2025. Value is empty. |

**Caveats**

- Label it "tree cover loss". The data records removal of tree canopy from any cause: clearing,
  fire, storm damage, landslide, or plantation harvest. It does not record land use change.
- Each pixel is counted once, in the year its first loss was detected. Regrowth and later losses
  on the same pixel are not counted.
- The baseline is tree cover in 2000. Trees planted after 2000 (for example under the National
  Greening Program) are not in the baseline, so their loss is not counted either.
- Detection improved from 2011 onward and again from 2015 (Landsat 8 and a revised method), so
  part of any rise between early and late years can come from the method. Compare multi-year
  windows and avoid reading a single year as a trend.
- Loss can be dated a year late when clouds hide the change, which is common in the wet season.
- For a river basin, the rows for `<area_id>__up` and `<area_id>__down` add up to the row for the
  whole basin, within rounding.

## Rainfall metrics (CHIRPS)

Four metrics share one source and one helper, `pipeline/metrics/chirps.py`. The flood extent
metric (`flood_ha_per_mm`) should reuse that helper for its 3-day rainfall.

| Metric | Module | Unit | Definition |
|---|---|---|---|
| `rainfall_total` | `rainfall_total.py` | mm | Sum of daily area mean rainfall, Jan 1 to Dec 31. |
| `rainfall_wet_season` | `rainfall_wet_season.py` | mm | Same sum, Jun 1 to Nov 30. |
| `rainfall_max_1day` | `rainfall_max_1day.py` | mm | Largest daily area mean rainfall in the year. |
| `heavy_rain_days` | `heavy_rain_days.py` | days | Days with area mean rainfall of 50 mm or more (`HEAVY_RAIN_MM`). |

| | |
|---|---|
| Source | CHIRPS Daily, `UCSB-CHG/CHIRPS/DAILY`, band `precipitation` (mm per day) |
| Years | 1981 to 2026 (the current year is flagged partial) |
| Scale | 0.05 degrees, about 5.5 km. The area mean weights each pixel by the fraction inside the area. |
| Study types | Context for all three. Headline for the "should this place be monitored" insight and the base for flood per mm of rain. |

**quality_flag**

| Flag | Meaning |
|---|---|
| `ok` | Every day of the metric window is in CHIRPS and the area is at least one pixel. |
| `partial_year` | Days of the window are missing, for example the current year. CHIRPS final data lags by weeks. The value is a lower bound for totals and counts. |
| `small_area` | The area is smaller than one CHIRPS pixel (about 31 km2), so the mean is one or two pixels. |
| `no_data` | Year before 1981 or after 2026, or no CHIRPS images in the window. Value is empty. |

**Caveats**

- The 50 mm threshold applies to the area mean, which is lower than a gauge peak, so a day at or
  above 50 mm is a widespread, intense day. The threshold is a choice, not an official category.
- CHIRPS blends satellite estimates with gauges. It describes the area, not a street.
  Neighbouring study areas can share pixels, so their values are close but never added together.
- A CHIRPS day runs 00:00 to 24:00 UTC, which is 08:00 to 08:00 Philippine time.
- No database migration is needed: `satellite_metrics.metric` is free text.

## Flood metrics (Sentinel-1)

Two metrics share one helper, `pipeline/metrics/sar_flood.py`, which holds the method, the
thresholds and the flag priority. Rainfall comes from `chirps.daily_area_series`.

| Metric | Module | Unit | Definition |
|---|---|---|---|
| `flood_extent` | `flood_extent.py` | ha | Largest flooded area of any single acquisition day between Jun 1 and Nov 30. One event, not a season total. |
| `flood_ha_per_mm` | `flood_ha_per_mm.py` | ha/mm | Median over acquisition days with at least 10 mm of rain in the 3 days before (`MIN_EVENT_RAIN_MM`) of flooded hectares divided by that rain. |

| | |
|---|---|
| Source | Sentinel-1 GRD, `COPERNICUS/S1_GRD`, IW mode, VV only, one orbit direction per area. `flood_ha_per_mm` also uses `UCSB-CHG/CHIRPS/DAILY`. Permanent water from `JRC/GSW1_4/GlobalSurfaceWater`, slope from `USGS/SRTMGL1_003`. |
| Years | 2015 to 2026 (the current year is flagged partial). No Sentinel-1 value exists before 2015, so flood trends begin there. |
| Scale | 10 m for areas of 100,000 ha or less, 30 m for larger areas. |
| Study types | `river_basin` downstream zones are the intended use. Unreliable for `urban` and for steep `rural_upland` areas (flagged). |

Flood pixel: VV below -16 dB and at least 3 dB darker than the Jan 1 to Apr 30 median of the
same year and direction, after a 50 m focal median. Pixels with water occurrence above 80
percent and slopes above 5 degrees are removed. Scenes of one UTC day are mosaicked.

**quality_flag** (the first condition that holds is used)

| Flag | Meaning |
|---|---|
| `ok` | None of the conditions below. |
| `no_data` | Year outside 2015 to 2026, or no usable VV images (none in the baseline or wet window, or no day covering at least 10 percent of the area). Value is empty. |
| `no_rain_events` | `flood_ha_per_mm` only. Scenes exist, but none had 10 mm of rain in the 3 days before, or CHIRPS was missing. Value is empty. |
| `urban_unreliable` | Urban area. VV sees water between buildings poorly, so the value is a lower bound of open water, not a count of flooded streets. |
| `steep_terrain` | More than half of the land is steeper than 5 degrees and cannot be judged. |
| `partial_year` | The wet season is not over, or the newest scenes may not be ingested yet. |
| `sparse_acquisitions` | Fewer than 6 usable acquisition days, or fewer than 3 baseline images. The value rests on few dates. |
| `partial_footprint` | The day that sets the value covers less than half of the area, so the value is a lower bound. |

**Caveats**

- A flag hides the flags below it in the list. A flagged value is still a number to read with
  care, and an empty value is never a zero.
- The value shows where radar saw standing water. It does not say why the water was there or
  how long it stayed. Scenes are a few days apart, so a short flood between two passes is missed.
- Large basins are rarely covered by one scene. Zones and the whole area pick their own best
  day, so their rows do not add up. Never add them.
- The 10 m and 30 m scales are not exactly comparable. Compare an area with itself over the years
  before comparing areas.
- Relative orbits are not separated, so incidence angle differs between scenes. After 2021 only
  one Sentinel-1 satellite is active, which halves the number of scenes.
- Rain is the CHIRPS area mean (about 5.5 km pixels), so local rain can differ from it. The
  10 mm minimum and the 3 day window are choices, not official categories.
- The thresholds (-16 dB, 3 dB, 5 degrees, 80 percent) come from the project method and are not
  calibrated against mapped floods yet.
- No database migration is needed: `satellite_metrics.metric` is free text.
