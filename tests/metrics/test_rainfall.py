import os
from datetime import date

import pytest

from pipeline.metrics import (
    IMPLEMENTED_METRICS,
    METRIC_NAMES,
    chirps,
    heavy_rain_days,
    rainfall_max_1day,
    rainfall_total,
    rainfall_wet_season,
)
from pipeline.registry import METRICS
from pipeline.run import ROW_KEYS, select_features
from pipeline.study_areas import read_features

BASIN = "pasig-marikina-tullahan"
FLAGS = {"ok", "partial_year", "small_area", "no_data"}
MODULES = {
    "rainfall_total": (rainfall_total, "mm"),
    "rainfall_wet_season": (rainfall_wet_season, "mm"),
    "rainfall_max_1day": (rainfall_max_1day, "mm"),
    "heavy_rain_days": (heavy_rain_days, "days"),
}


@pytest.mark.parametrize("name", MODULES)
def test_metric_is_registered(name):
    module, unit = MODULES[name]
    metric = METRICS[name]
    assert name in METRIC_NAMES and name in IMPLEMENTED_METRICS
    assert metric.compute is module.compute
    assert metric.unit == unit
    assert metric.dataset == "UCSB-CHG/CHIRPS/DAILY"
    assert metric.first_year <= 2001 and metric.last_year >= 2025
    assert module.METRIC == name


def test_rainfall_windows():
    assert chirps.year_window(2024) == (date(2024, 1, 1), date(2024, 12, 31))
    wet = chirps.wet_season_window(2024)
    assert wet == (date(2024, 6, 1), date(2024, 11, 30))
    assert chirps.window_days(wet) == 183
    assert chirps.window_days(chirps.year_window(2024)) == chirps.days_in_year(2024) == 366
    assert chirps.days_in_year(2023) == 365


def test_heavy_rain_threshold_is_stated():
    assert heavy_rain_days.HEAVY_RAIN_MM == 50.0
    assert "50 mm/day" in heavy_rain_days.__doc__


def test_quality_flags_are_documented():
    for flag in FLAGS:
        assert flag in chirps.__doc__


def test_pixel_area_is_about_one_chirps_pixel():
    assert 30e6 < chirps.PIXEL_AREA_M2 < 32e6


def test_study_areas_are_larger_than_one_pixel():
    # No current study area should carry small_area, so the flag only fires for new small areas.
    for feature in read_features():
        assert feature["properties"]["area_ha"] * 1e4 > chirps.PIXEL_AREA_M2


@pytest.mark.skipif(not os.environ.get("TANAW_EE_TESTS"), reason="set TANAW_EE_TESTS=1 to run")
@pytest.mark.parametrize("name", MODULES)
def test_compute_output_schema_on_earth_engine(name):
    from pipeline.run import compute_rows

    features = select_features(read_features(), BASIN)
    rows = compute_rows(name, features, [1980, 2021, 2022])

    assert len(rows) == 9
    for row in rows:
        assert tuple(row) == (*ROW_KEYS, "source_version")
        assert row["source_version"] == chirps.DATASET
        assert row["metric"] == name
        assert row["quality_flag"] in FLAGS
    by_year = {r["year"]: r for r in rows if r["area_id"] == BASIN}
    assert by_year[1980]["value"] is None and by_year[1980]["quality_flag"] == "no_data"
    assert by_year[2021]["value"] >= 0
