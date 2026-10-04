"""Flood metric tests. Only the test gated by TANAW_EE_TESTS contacts Earth Engine."""

import os
from datetime import date

import pytest

from pipeline.metrics import (
    CLI_ONLY_METRICS,
    IMPLEMENTED_METRICS,
    METRIC_NAMES,
    chirps,
    flood_extent,
    sar_flood,
)
from pipeline.registry import METRICS
from pipeline.run import ROW_KEYS, select_features
from pipeline.study_areas import read_features

MODULES = {
    "flood_extent": (flood_extent, "ha"),
}
BASIN = "pasig-marikina-tullahan"


def iff(condition, if_true, if_false):
    return if_true if condition else if_false


def flag(**overrides):
    """The flag for a healthy case, with some inputs changed."""
    inputs = dict(
        no_scenes=False,
        urban=False,
        steep=False,
        partial_year=False,
        n_scenes=12,
        n_baseline=8,
        best_coverage=0.9,
    )
    inputs.update(overrides)
    return sar_flood.first_match(sar_flood.flag_pairs(**inputs), "ok", iff)


@pytest.mark.parametrize("name", MODULES)
def test_module_constants(name):
    module, unit = MODULES[name]
    assert module.METRIC == name
    assert module.UNIT == unit
    assert module.FIRST_YEAR == 2015
    assert module.LAST_YEAR >= 2025
    assert "COPERNICUS/S1_GRD" in module.DATASET


def test_flood_per_mm_is_removed():
    assert not hasattr(sar_flood, "ha_per_mm")
    assert "flood_ha_per_mm" not in METRICS
    assert "flood_ha_per_mm" not in METRIC_NAMES
    assert "flood_ha_per_mm" not in CLI_ONLY_METRICS
    assert "no_rain_events" not in sar_flood.FLAGS


def test_flood_extent_is_cli_only_and_not_exposed_to_analyze():
    assert "flood_extent" in CLI_ONLY_METRICS
    assert "flood_extent" not in IMPLEMENTED_METRICS


@pytest.mark.parametrize("name", MODULES)
def test_registration_is_consistent_if_present(name):
    # Registration is a separate step after a dry run. If it exists, it must point here.
    if name in METRICS:
        assert METRICS[name].compute is MODULES[name][0].compute
        assert METRICS[name].unit == MODULES[name][1]


def test_method_constants_follow_the_skill():
    assert sar_flood.BAND == "VV"
    assert sar_flood.FLOOD_MAX_DB == -16.0 and sar_flood.FLOOD_DROP_DB == 3.0
    assert sar_flood.PERMANENT_WATER_PCT == 80 and sar_flood.MAX_SLOPE_DEG == 5
    assert sar_flood.SPECKLE_RADIUS_M == 50
    assert sar_flood.baseline_window(2022) == (date(2022, 1, 1), date(2022, 4, 30))
    assert chirps.wet_season_window(2022) == (date(2022, 6, 1), date(2022, 11, 30))


def test_year_range_starts_with_sentinel_1():
    # Sentinel-1A launched in 2014, first usable wet season with a Jan to Apr baseline is 2015.
    assert sar_flood.FIRST_YEAR == 2015


def test_partial_year():
    assert sar_flood.is_partial_year(2026, today=date(2026, 10, 4))
    assert sar_flood.is_partial_year(2025, today=date(2025, 11, 30))
    assert sar_flood.is_partial_year(2025, today=date(2025, 12, 3))  # ingest lag
    assert not sar_flood.is_partial_year(2025, today=date(2025, 12, 4))
    assert not sar_flood.is_partial_year(2020, today=date(2026, 10, 4))


def test_flag_ok():
    assert flag() == "ok"


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"no_scenes": True}, "no_data"),
        ({"urban": True}, "urban_unreliable"),
        ({"steep": True}, "steep_terrain"),
        ({"partial_year": True}, "partial_year"),
        ({"n_scenes": 5}, "sparse_acquisitions"),
        ({"n_baseline": 2}, "sparse_acquisitions"),
        ({"best_coverage": 0.3}, "partial_footprint"),
    ],
)
def test_each_flag(overrides, expected):
    assert flag(**overrides) == expected
    assert expected in sar_flood.FLAGS


def test_flag_priority():
    assert flag(no_scenes=True, urban=True, partial_year=True) == "no_data"
    assert flag(urban=True, steep=True, n_scenes=1) == "urban_unreliable"
    assert flag(steep=True, partial_year=True) == "steep_terrain"
    assert flag(partial_year=True, n_scenes=1) == "partial_year"
    assert flag(n_scenes=1, best_coverage=0.1) == "sparse_acquisitions"


def test_scene_threshold_edges():
    assert flag(n_scenes=sar_flood.MIN_SCENES) == "ok"
    assert flag(n_scenes=sar_flood.MIN_SCENES - 1) == "sparse_acquisitions"
    assert flag(best_coverage=sar_flood.PARTIAL_COVERAGE) == "ok"


def test_flags_are_documented():
    for name in sar_flood.FLAGS:
        assert name in sar_flood.__doc__


def test_row_properties_fields_and_empty_value():
    row = sar_flood.row_properties("quezon-city", 2022, "flood_extent", None, "no_data")
    assert tuple(row) == ROW_KEYS
    assert row["value"] is None
    ok = sar_flood.row_properties("quezon-city", 2022, "flood_extent", 12.5, "ok")
    assert ok["value"] == 12.5 and ok["year"] == 2022


def test_area_types_cover_every_study_area():
    types = sar_flood.area_types()
    assert types["quezon-city"] == "urban"
    assert types["antipolo-rodriguez-uplands"] == "rural_upland"
    assert types[BASIN] == "river_basin" and types[BASIN + "__up"] == "river_basin"
    assert set(types) == {f["properties"]["area_id"] for f in read_features()}


@pytest.mark.skipif(not os.environ.get("TANAW_EE_TESTS"), reason="set TANAW_EE_TESTS=1 to run")
@pytest.mark.parametrize("name", MODULES)
def test_compute_output_schema_on_earth_engine(name):
    from pipeline.run import compute_rows

    features = select_features(read_features(), BASIN)
    rows = compute_rows(name, features, [2014, 2021])
    assert len(rows) == 6
    for row in rows:
        assert tuple(row) == (*ROW_KEYS, "source_version")
        assert row["quality_flag"] in sar_flood.FLAGS
    for row in rows:
        if row["year"] == 2014:
            assert row["value"] is None and row["quality_flag"] == "no_data"
