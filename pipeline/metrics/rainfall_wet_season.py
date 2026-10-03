"""Wet season total rainfall per study area per year, in millimetres (CHIRPS daily).

The value is the sum over Jun 1 to Nov 30 of the daily area mean rainfall. This is the same
wet period the flood extent metric uses. The row is partial_year only when days of this
window are missing, so a year in progress is complete for this metric once Nov 30 is in.
"""

import ee

from pipeline.metrics import chirps

METRIC = "rainfall_wet_season"
UNIT = chirps.UNIT
DATASET = chirps.DATASET
FIRST_YEAR = chirps.FIRST_YEAR
LAST_YEAR = chirps.LAST_YEAR


def total_mm(series: ee.List) -> ee.Number:
    return ee.Number(series.reduce(ee.Reducer.sum()))


def compute(year: int, areas: ee.FeatureCollection) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    return chirps.compute_rainfall(year, areas, METRIC, chirps.wet_season_window(year), total_mm)
