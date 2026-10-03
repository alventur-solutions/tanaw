"""Flooded hectares per mm of rain, per study area per year (Sentinel-1 VV and CHIRPS).

For each acquisition day in Jun 1 to Nov 30 with at least 10 mm of area mean rain in the 3
days before it, the flooded area of that day (see flood_extent) is divided by that rain. The
value is the median of those ratios over the year. Days with less rain, or with a missing
CHIRPS day, are left out, so a missing or zero rainfall never produces a ratio. The rain is
the area mean, so a local cloudburst can be larger than the area mean. A ratio compares
patterns between years. It does not say what made the water stay. The full method, the flags
and the limits are in pipeline/metrics/sar_flood.py.
"""

from datetime import date

import ee

from pipeline.metrics import chirps, sar_flood

METRIC = "flood_ha_per_mm"
UNIT = "ha/mm"
DATASET = f"{sar_flood.S1_DATASET}+{chirps.DATASET}"
FIRST_YEAR = sar_flood.FIRST_YEAR
LAST_YEAR = sar_flood.LAST_YEAR


def median_ratio(usable: ee.FeatureCollection) -> ee.Number | None:
    """Median of the per-day ratios, or None when no day had enough rain."""
    ratios = usable.filter(ee.Filter.notNull(["ratio"])).aggregate_array("ratio")
    return ee.Algorithms.If(ratios.size().gt(0), ratios.reduce(ee.Reducer.median()), None)


def compute(
    year: int, areas: ee.FeatureCollection, today: date | None = None
) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    return sar_flood.compute_flood(year, areas, METRIC, True, median_ratio, today)
