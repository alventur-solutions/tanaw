"""Flood extent per study area per year, in hectares (Sentinel-1 VV change detection).

The value is the largest flooded area of any single acquisition day between Jun 1 and Nov 30:
pixels at -16 dB or darker in VV and at least 3 dB darker than the Jan to Apr median of the
same year, with permanent water and slopes over 5 degrees removed. It is one event, not a
season total, and it is a lower bound where a scene covers only part of the area. It shows
where radar saw standing water, not why it was there. The full method, the flags and the
limits are in pipeline/metrics/sar_flood.py.
"""

from datetime import date

import ee

from pipeline.metrics import sar_flood

METRIC = "flood_extent"
UNIT = "ha"
DATASET = sar_flood.S1_DATASET
FIRST_YEAR = sar_flood.FIRST_YEAR
LAST_YEAR = sar_flood.LAST_YEAR


def max_flood_ha(usable: ee.FeatureCollection) -> ee.Number:
    return ee.Number(usable.aggregate_max("flood_ha"))


def compute(
    year: int, areas: ee.FeatureCollection, today: date | None = None
) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    return sar_flood.compute_flood(year, areas, METRIC, max_flood_ha, today)
