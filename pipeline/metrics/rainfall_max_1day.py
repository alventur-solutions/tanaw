"""Maximum 1-day rainfall per study area per year, in millimetres (CHIRPS daily).

The value is the largest daily area mean rainfall between Jan 1 and Dec 31. A CHIRPS day runs
00:00 to 24:00 UTC (08:00 to 08:00 Philippine time), and the area mean smooths out cloudburst
peaks, so it is lower than a rain gauge maximum for the same storm.
"""

import ee

from pipeline.metrics import chirps

METRIC = "rainfall_max_1day"
UNIT = chirps.UNIT
DATASET = chirps.DATASET
FIRST_YEAR = chirps.FIRST_YEAR
LAST_YEAR = chirps.LAST_YEAR


def max_mm(series: ee.List) -> ee.Number:
    return ee.Number(series.reduce(ee.Reducer.max()))


def compute(year: int, areas: ee.FeatureCollection) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    return chirps.compute_rainfall(year, areas, METRIC, chirps.year_window(year), max_mm)
