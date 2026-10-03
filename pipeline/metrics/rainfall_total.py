"""Annual total rainfall per study area per year, in millimetres (CHIRPS daily).

The value is the sum over Jan 1 to Dec 31 of the daily area mean rainfall. CHIRPS pixels are
about 5.5 km, so it describes the area as a whole, not a street or a station. It is a blend of
satellite and gauge data, not a gauge reading.
"""

import ee

from pipeline.metrics import chirps

METRIC = "rainfall_total"
UNIT = chirps.UNIT
DATASET = chirps.DATASET
FIRST_YEAR = chirps.FIRST_YEAR
LAST_YEAR = chirps.LAST_YEAR


def total_mm(series: ee.List) -> ee.Number:
    return ee.Number(series.reduce(ee.Reducer.sum()))


def compute(year: int, areas: ee.FeatureCollection) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    return chirps.compute_rainfall(year, areas, METRIC, chirps.year_window(year), total_mm)
