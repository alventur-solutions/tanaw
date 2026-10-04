import os

import pytest

from pipeline.metrics import (
    CLI_ONLY_METRICS,
    IMPLEMENTED_METRICS,
    METRIC_NAMES,
    tree_cover_loss,
)
from pipeline.registry import METRICS
from pipeline.run import ROW_KEYS, parse_years, select_features, to_rows
from pipeline.study_areas import read_features

BASIN = "pasig-marikina-tullahan"
FLAGS = {"ok", "storm_year", "storm_prior_year", "low_coverage", "no_data"}


def test_metric_is_registered():
    metric = METRICS["tree_cover_loss"]
    assert set(METRICS) <= set(METRIC_NAMES)
    # Every registered metric is either enabled for /analyze or listed as CLI only, never both.
    assert not set(IMPLEMENTED_METRICS) & set(CLI_ONLY_METRICS)
    assert sorted(set(IMPLEMENTED_METRICS) | set(CLI_ONLY_METRICS)) == sorted(METRICS)
    assert metric.compute is tree_cover_loss.compute
    assert metric.unit == "ha"
    assert metric.dataset == "UMD/hansen/global_forest_change_2025_v1_13"
    assert (metric.first_year, metric.last_year) == (2001, 2025)


def test_storm_years_are_per_area_and_zones_use_the_parent():
    assert tree_cover_loss.storm_flag(BASIN, 2009) == "storm_year"
    assert tree_cover_loss.storm_flag(BASIN + "__up", 2009) == "storm_year"
    assert tree_cover_loss.storm_flag(BASIN + "__down", 2020) == "storm_year"
    # The Metro Manila years are not applied to other areas.
    assert tree_cover_loss.storm_flag("iloilo-river-basin", 2009) == "ok"
    assert tree_cover_loss.storm_flag("iloilo-river-basin", 2013) == "storm_year"
    assert tree_cover_loss.storm_flag("iloilo-river-basin__down", 2019) == "storm_year"
    assert tree_cover_loss.storm_flag("cagayan-de-oro-river-basin", 2011) == "storm_year"


def test_unknown_area_never_gets_a_storm_flag():
    for year in (2009, 2011, 2020):
        assert tree_cover_loss.storm_flag("not-an-area", year) == "ok"
        assert tree_cover_loss.storm_flag("davao-river-basin", year) == "ok"


def test_late_season_storm_flags_the_next_year_only():
    assert tree_cover_loss.storm_flag(BASIN, 2021) == "storm_prior_year"  # Ulysses, November
    assert tree_cover_loss.storm_flag(BASIN, 2010) == "ok"  # Ondoy, September
    # A storm year wins when it is also the year after a late storm.
    assert tree_cover_loss.storm_flag("bicol-river-basin", 2020) == "storm_year"
    assert tree_cover_loss.storm_flag("bicol-river-basin", 2017) == "storm_prior_year"


def test_storm_flags_for_a_year_cover_every_zone():
    flags = tree_cover_loss.storm_flags(2020)
    assert flags[BASIN] == flags[BASIN + "__up"] == flags[BASIN + "__down"] == "storm_year"
    assert set(flags) == {
        f"{p}{z}" for p in tree_cover_loss.STORM_YEARS for z in ("", "__up", "__down")
    }


def test_storm_areas_are_real_study_areas_and_years_are_in_range():
    ids = {f["properties"]["area_id"] for f in read_features()}
    for area_id, storms in tree_cover_loss.STORM_YEARS.items():
        assert area_id in ids
        assert "__" not in area_id
        for year in storms:
            assert tree_cover_loss.FIRST_YEAR <= year <= tree_cover_loss.LAST_YEAR


def test_parse_years():
    assert parse_years("2021") == [2021]
    assert parse_years("2021-2022") == [2021, 2022]


def test_select_features_includes_basin_zones():
    ids = [f["properties"]["area_id"] for f in select_features(read_features(), BASIN)]
    assert ids == [BASIN, f"{BASIN}__up", f"{BASIN}__down"]


def test_select_features_rejects_unknown_area():
    with pytest.raises(SystemExit):
        select_features(read_features(), "upper-marikina")


def test_to_rows_keeps_schema_and_sorts():
    row = {"area_id": "b", "year": 2022, "metric": "tree_cover_loss", "quality_flag": "ok"}
    collection = {
        "features": [
            {"properties": row | {"value": 1.5, "extra": 1}},
            {"properties": row | {"area_id": "a", "quality_flag": "no_data"}},
        ]
    }
    rows = to_rows(collection)

    assert [tuple(r) for r in rows] == [ROW_KEYS, ROW_KEYS]
    assert [r["area_id"] for r in rows] == ["a", "b"]
    assert rows[0]["value"] is None


def test_to_rows_rejects_row_without_quality_flag():
    props = {"area_id": "a", "year": 2022, "metric": "tree_cover_loss", "value": 1.0}
    with pytest.raises(ValueError, match="quality_flag"):
        to_rows({"features": [{"properties": props}]})


@pytest.mark.skipif(not os.environ.get("TANAW_EE_TESTS"), reason="set TANAW_EE_TESTS=1 to run")
def test_compute_output_schema_on_earth_engine():
    from pipeline.run import compute_rows

    features = select_features(read_features(), BASIN)
    rows = compute_rows("tree_cover_loss", features, [2000, 2020, 2021])

    assert len(rows) == 9
    for row in rows:
        assert tuple(row) == (*ROW_KEYS, "source_version")
        assert row["source_version"] == tree_cover_loss.DATASET
        assert row["metric"] == "tree_cover_loss"
        assert row["quality_flag"] in FLAGS
    by_year = {r["year"]: r for r in rows if r["area_id"] == BASIN}
    assert by_year[2000]["value"] is None and by_year[2000]["quality_flag"] == "no_data"
    assert by_year[2020]["quality_flag"] == "storm_year"
    assert by_year[2021]["value"] >= 0
