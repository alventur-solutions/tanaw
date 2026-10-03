"""Heavy rain days per study area per year, as a count of days (CHIRPS daily).

A heavy rain day is a day whose area mean rainfall is at least HEAVY_RAIN_MM (50 mm/day)
between Jan 1 and Dec 31. The threshold applies to the area mean over 5.5 km pixels, which is
lower than the peak a gauge sees, so 50 mm is already a widespread, intense day. It follows
the 50 mm daily index used in climate extremes work, and it sits well above the 20 mm "very
heavy" day that a tropical wet season reaches many times, so the count separates ordinary
years from storm years.
"""

import ee

from pipeline.metrics import chirps

METRIC = "heavy_rain_days"
UNIT = "days"
DATASET = chirps.DATASET
FIRST_YEAR = chirps.FIRST_YEAR
LAST_YEAR = chirps.LAST_YEAR
HEAVY_RAIN_MM = 50.0  # mm per day, area mean, inclusive


def count_days(series: ee.List) -> ee.Number:
    heavy = series.map(lambda v: ee.Number(v).gte(HEAVY_RAIN_MM))
    return ee.Number(heavy.reduce(ee.Reducer.sum()))


def compute(year: int, areas: ee.FeatureCollection) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    return chirps.compute_rainfall(year, areas, METRIC, chirps.year_window(year), count_days)
