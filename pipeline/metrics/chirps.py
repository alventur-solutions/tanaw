"""Shared CHIRPS daily rainfall handling for the rainfall metrics.

Dataset: UCSB-CHG/CHIRPS/DAILY, band `precipitation`, mm per day, 0.05 degree pixels
(about 5.5 km), 1981 to present. The final product lags by weeks, so the newest days are
missing until they are published.

For each area the daily series is the area mean of the pixel values (pixels weighted by
the fraction of each pixel inside the area). The rainfall metrics summarise that series over
a window: total, maximum, or number of days above a threshold. The flood extent metric
(flood_ha_per_mm) should reuse `daily_collection` and `daily_area_series` for its 3-day
rainfall.

Quality flags used by the rainfall metrics:
    ok            the whole window is in the collection and the area spans one pixel or more
    partial_year  days are missing from the window (current year, or CHIRPS has not caught up)
    small_area    the area is smaller than one CHIRPS pixel, so the mean is one or two pixels
    no_data       year before 1981, after LAST_YEAR, or no CHIRPS images in the window
"""

import calendar
from collections.abc import Callable
from datetime import date

import ee

DATASET = "UCSB-CHG/CHIRPS/DAILY"
BAND = "precipitation"
UNIT = "mm"
FIRST_YEAR = 1981
LAST_YEAR = 2026  # the current year is allowed, and is flagged partial until Dec 31 is in

# CHIRPS grid: 0.05 degrees, upper left corner at (-180, 50). Reducing on this grid reads
# the native pixels without resampling.
PIXEL_DEG = 0.05
CRS_TRANSFORM = [PIXEL_DEG, 0, -180, 0, -PIXEL_DEG, 50]
PIXEL_AREA_M2 = 5566.0**2  # one pixel, about 31 km2 (a little less at 14 degrees north)

# Wet season used across TANAW (same as the flood-extent-sar skill): Jun 1 to Nov 30.
WET_START = (6, 1)
WET_END = (11, 30)  # inclusive


def year_window(year: int) -> tuple[date, date]:
    """First and last day, inclusive, of the calendar year."""
    return date(year, 1, 1), date(year, 12, 31)


def wet_season_window(year: int) -> tuple[date, date]:
    return date(year, *WET_START), date(year, *WET_END)


def days_in_year(year: int) -> int:
    return 366 if calendar.isleap(year) else 365


def window_days(window: tuple[date, date]) -> int:
    return (window[1] - window[0]).days + 1


def daily_collection(window: tuple[date, date]) -> ee.ImageCollection:
    """CHIRPS daily images from the first to the last day of the window, inclusive."""
    end_exclusive = ee.Date(window[1].isoformat()).advance(1, "day")
    return ee.ImageCollection(DATASET).select(BAND).filterDate(window[0].isoformat(), end_exclusive)


def daily_area_series(collection: ee.ImageCollection, geometry: ee.Geometry) -> ee.List:
    """Area mean rainfall in mm for each day of the collection, as an ee.List of numbers.

    The list is empty when the collection is empty. A day with no pixel under the area is
    dropped, so the length of the list is the number of days with data.
    """
    # toBands gives one band per day. An empty collection gets a placeholder so that the
    # call does not fail, and the empty list is returned below.
    stack = ee.Image(
        ee.Algorithms.If(collection.size().gt(0), collection.toBands(), ee.Image.constant(0))
    )
    means = stack.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geometry,
        crs="EPSG:4326",
        crsTransform=CRS_TRANSFORM,
        maxPixels=1e9,
        tileScale=4,
    )
    values = ee.Dictionary(means).values()
    return ee.List(ee.Algorithms.If(collection.size().gt(0), values, ee.List([])))


def compute_rainfall(
    year: int,
    areas: ee.FeatureCollection,
    metric: str,
    window: tuple[date, date],
    summarize: Callable[[ee.List], ee.Number],
) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag.

    `summarize` turns the list of daily area means (mm) into the value.
    """

    def no_data(feature: ee.Feature) -> ee.Feature:
        return ee.Feature(
            None,
            {
                "area_id": feature.get("area_id"),
                "year": year,
                "metric": metric,
                "value": None,
                "quality_flag": "no_data",
            },
        )

    if not FIRST_YEAR <= year <= LAST_YEAR:
        return areas.map(no_data)

    expected_days = window_days(window)
    collection = daily_collection(window)
    n_images = collection.size()

    def to_row(feature: ee.Feature) -> ee.Feature:
        geometry = feature.geometry()
        series = daily_area_series(collection, geometry)
        small = geometry.area(maxError=100).lt(PIXEL_AREA_M2)
        has_data = series.size().gt(0)
        flag = ee.Algorithms.If(
            has_data.Not(),
            "no_data",
            ee.Algorithms.If(
                n_images.lt(expected_days),
                "partial_year",
                ee.Algorithms.If(small, "small_area", "ok"),
            ),
        )
        value = ee.Algorithms.If(has_data, summarize(series), None)
        return ee.Feature(
            None,
            {
                "area_id": feature.get("area_id"),
                "year": year,
                "metric": metric,
                "value": value,
                "quality_flag": flag,
            },
        )

    return areas.map(to_row)
