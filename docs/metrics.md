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
