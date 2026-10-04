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
| `storm_year` | Same coverage, but the year is one of the area's major typhoon years (table below). Part of the loss may be natural. |
| `storm_prior_year` | Same coverage, and the year before was a major typhoon year with the storm in November or December. Hansen dates loss to the first clear observation, so loss from that storm can show in this year. |
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
  Storms in November or December are the clearest case, so the year after one carries
  `storm_prior_year`. A storm earlier in the year is flagged only in its own year.
- For a river basin, the rows for `<area_id>__up` and `<area_id>__down` add up to the row for the
  whole basin, within rounding.

**Storm years per area**

Storm years are set per top-level area in `STORM_YEARS` in `pipeline/metrics/tree_cover_loss.py`.
Zones (`<area_id>__up`, `<area_id>__down`) use their parent's years. An area with no entry has no
storm flag. A year that is both a storm year and the year after a late storm is `storm_year`.
The list is a short set of major storms from public records. It is not a complete storm
history, and a year without a flag can still hold storm damage. "Late" means November or
December, so the next year gets `storm_prior_year`.

| Area | Storm years (storm names) | Late season |
|---|---|---|
| `pasig-marikina-tullahan`, `quezon-city`, `antipolo-rodriguez-uplands` | 2009 (Ondoy / Ketsana), 2020 (Ulysses / Vamco) | 2020 |
| `pampanga-river-basin`, `angat-river-basin` | 2009 (Pepeng / Parma, Ondoy / Ketsana), 2011 (Pedring / Nesat), 2015 (Lando / Koppu), 2020 (Ulysses / Vamco) | 2020 |
| `cagayan-river-basin` | 2010 (Juan / Megi), 2016 (Lawin / Haima), 2018 (Ompong / Mangkhut), 2020 (Ulysses / Vamco) | 2020 |
| `bicol-river-basin` | 2006 (Reming / Durian), 2016 (Nina / Nock-ten), 2019 (Tisoy / Kammuri), 2020 (Rolly / Goni) | all |
| `iloilo-river-basin`, `jalaur-river-basin` | 2008 (Frank / Fengshen), 2013 (Yolanda / Haiyan), 2019 (Ursula / Phanfone) | 2013, 2019 |
| `agusan-river-basin` | 2012 (Pablo / Bopha), 2021 (Odette / Rai) | all |
| `cagayan-de-oro-river-basin` | 2011 (Sendong / Washi), 2017 (Vinta / Tembin) | all |
| `davao-river-basin` | none listed | none |

## Rainfall metrics (CHIRPS)

Four metrics share one source and one helper, `pipeline/metrics/chirps.py`.

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
| Study types | Context for all three. Headline for the "should this place be monitored" insight. |

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

## Flood extent (Sentinel-1)

**Status: on hold. Do not export.** The code runs and is registered for the command line only
(`CLI_ONLY_METRICS`), and no rows are in the database. A review of the first dry run
(2026-10-04) found that the values are not ready to publish:

- Dense built-up zones such as Pasig-Marikina-Tullahan downstream are flagged `ok`, because the
  urban flag follows `study_type`. Radar does not see water between buildings, so a small value
  there would read as little flooding.
- Detected area did not follow rainfall in the dry run. It looks like seasonal water (reservoir
  and lake margins, rice fields) more than flood events.
- The date of the largest day and the number of passes are not stored, so a value cannot be
  checked against a known event.
- Nothing is validated against a mapped flood. The proposed check is Ulysses (Vamco) in the
  Cagayan Valley, November 2020, against a UNOSAT or DOST-ASTI flood map.

`flood_ha_per_mm` (flooded hectares per mm of 3-day rain) was removed. Because detected area did
not follow rain, the ratio was mostly one divided by rain, so it said little about the land. Its
module, flag and tests are deleted.

Before an export: a built-up mask from measured built-up share, a stricter permanent and
recurring water mask, the date and pass count stored with each row, and the validation above.

The metric is `flood_extent`, in `pipeline/metrics/flood_extent.py`. The method, the thresholds
and the flag priority are in `pipeline/metrics/sar_flood.py`.

| Metric | Module | Unit | Definition |
|---|---|---|---|
| `flood_extent` | `flood_extent.py` | ha | Largest flooded area of any single acquisition day between Jun 1 and Nov 30. One event, not a season total. |

| | |
|---|---|
| Source | Sentinel-1 GRD, `COPERNICUS/S1_GRD`, IW mode, VV only, one orbit direction per feature. Permanent water from `JRC/GSW1_4/GlobalSurfaceWater`, slope from `USGS/SRTMGL1_003`. |
| Years | 2015 to 2026 (the current year is flagged partial). No Sentinel-1 value exists before 2015, so flood trends begin there. |
| Scale | 10 m for areas of 100,000 ha or less, 30 m for larger areas. |
| Study types | Not settled. Radar suits open floodplains. Built-up zones, including downstream zones such as Pasig-Marikina-Tullahan downstream, are unreliable, and so are steep uplands. Only `urban` and steep areas carry a flag today. |

Flood pixel: VV below -16 dB and at least 3 dB darker than the Jan 1 to Apr 30 median of the
same year and direction, after a 50 m focal median. Pixels with water occurrence above 80
percent and slopes above 5 degrees are removed. Scenes of one UTC day are mosaicked.

**quality_flag** (the first condition that holds is used)

| Flag | Meaning |
|---|---|
| `ok` | None of the conditions below. |
| `no_data` | Year outside 2015 to 2026, or no usable VV images (none in the baseline or wet window, or no day covering at least 10 percent of the area). Value is empty. |
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
- Detected water includes rice fields, reservoir and lake margins, and other seasonal water. The
  method does not separate these from flood.
- The dry-season baseline depends on how dry that year was. In a wet early year the baseline is
  darker and floods are under-counted, in a dry year over-counted.
- The orbit direction and the scale (10 m or 30 m) are chosen per feature, so a zone and its
  whole area can use different ones. Compare an area with itself over the years before
  comparing areas.
- Large basins are rarely covered by one scene. Zones and the whole area pick their own best
  day, so their rows do not add up. Never add them.
- The wet window ends on Nov 30, so a December flood is not seen.
- Scene counts change by year. Sentinel-1B was lost in December 2021, so 2022 to 2024 have one
  active satellite and about half the scenes of earlier years. Sentinel-1C adds scenes from
  2025.
- The nearest pass can miss the peak. For Carina in July 2024 the nearest pass in the Pasig
  downstream dry run was before the peak, and it showed under 1 ha that day.
- In the dry run, detected area did not follow rainfall: Pasig downstream stayed within about
  4 to 17 ha across a wet season whatever the rain before each pass.
- The thresholds (-16 dB, 3 dB, 5 degrees, 80 percent) come from the project method and are not
  calibrated against mapped floods yet.
- No database migration is needed: `satellite_metrics.metric` is free text.
