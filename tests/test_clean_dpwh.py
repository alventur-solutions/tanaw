from datetime import date
from decimal import Decimal

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import box

from funding.clean_dpwh import (
    assign_areas,
    classify,
    classify_from_description,
    clean,
    totals_per_area,
)
from funding.load_dpwh import STAGING_COLUMNS, to_link_records, to_records


def _row(**overrides) -> dict[str, str]:
    row = {
        "InfraYear": "2022",
        "FundingYear": "2022",
        "CompletionYear": "2023",
        "Region": "National Capital Region",
        "Province": "METRO MANILA",
        "Municipality": "QUEZON CITY",
        "ProjectID": "P001",
        "ProjectComponentID": "P001-CW1",
        "ContractID": "22OF0001",
        "TypeofWork": "Construction of Drainage Structure",
        "ProjectDescription": "Construction of Drainage Structure, Quezon City",
        "Longitude": "121.05",
        "Latitude": "14.65",
        "ABC": "1000000.5",
        "ABC_String": "1000000.49",
        "ContractCost": "999999.1",
        "ContractCost_String": "999999.12",
        "CompletionDateOriginal": "1662249600000",
        "CompletionDateActual": "2023-04-17",
        "StartDate": "02/08/2022",
        "Contractor": "ACME BUILDERS",
    }
    return row | overrides


def _raw(*rows: dict[str, str]) -> pd.DataFrame:
    return pd.DataFrame(list(rows), dtype=str)


@pytest.mark.parametrize(
    ("type_of_work", "category"),
    [
        ("Construction of Drainage Structure", "drainage"),
        ("Construction of Flood Mitigation Structure", "river_structure"),
        ("Rehabilitation / Major Repair of Flood Control Structure", "river_structure"),
        ("Construction of Revetment", "river_structure"),
        ("Construction of Spur Dike", "river_structure"),
        ("Construction of Slope Protection Structure", "slope_protection"),
        ("Construction of Pumping Station", "pumping"),
        ("Construction of Retarding Basin", "other"),
        (None, "other"),
    ],
)
def test_classify(type_of_work, category):
    assert classify(type_of_work) == category


@pytest.mark.parametrize(
    ("type_of_work", "description", "category"),
    [
        # A pumping station in the description overrides the TypeofWork match.
        ("Construction of Flood Mitigation Facility", "Pumping Station at Estero", "pumping"),
        ("Construction of Drainage Structure", "Drainage with PUMPING STATION", "pumping"),
        ("Construction of Revetment", "Revetment and pumping  stations, Phase II", "pumping"),
        ("Construction of Waterway", "Rehabilitation of Pump Station along Estero", "pumping"),
        ("Construction of Flood Mitigation Facility", "Upgrading of Pumping Staiton", "pumping"),
        (None, "Construction of Pumping Stations, Phase II", "pumping"),
        # A pump is not a pumping station.
        ("Construction of Retarding Basin", "Installation of Booster Pump Accessories", "other"),
        (
            "Construction of Drainage Structure",
            "Drainage with Submersible Pump at Sta. 1",
            "drainage",
        ),
        # No pumping station in the description: TypeofWork decides.
        ("Construction of Flood Mitigation Facility", "Floodgate at Estero", "river_structure"),
        ("Construction of Retarding Basin", None, "other"),
    ],
)
def test_classify_pumping_station_in_description_overrides_type_of_work(
    type_of_work, description, category
):
    assert classify(type_of_work, description) == category


def test_clean_classifies_from_project_description():
    out = clean(
        _raw(
            _row(
                TypeofWork="Construction of Retarding Basin",
                ProjectDescription="Construction of Retarding Basin and Pumping Station",
            )
        )
    )
    assert out.loc[0, "category"] == "pumping"


def test_clean_parses_types():
    row = clean(_raw(_row(StartDate="02/08/2022 "))).iloc[0]

    assert row["component_id"] == "P001-CW1"
    assert row["year"] == 2022
    assert row["category"] == "drainage"
    assert row["amount_php"] == 999999.12
    assert row["abc_php"] == 1000000.49
    assert row["start_date"] == date(2022, 2, 8)
    assert row["completion_date"] == date(2023, 4, 17)
    assert row["completion_date_original"] == date(2022, 9, 4)
    assert row["quality_flag"] == "ok"


def test_clean_keeps_first_year_of_multi_year_contract():
    note = "MYCA with Project ID P001"
    raw = _raw(
        _row(InfraYear="2021", ABC_String=note, ContractCost_String=note),
        _row(InfraYear="2020"),
        _row(ProjectComponentID="P002-CW1", ProjectID="P002"),
    )
    out = clean(raw)

    assert list(out["component_id"]) == ["P001-CW1", "P002-CW1"]
    assert out.loc[0, "year"] == 2020
    assert out.loc[0, "amount_php"] == 999999.12


def test_clean_falls_back_to_numeric_cost_when_string_is_a_note():
    out = clean(_raw(_row(ContractCost_String="MYCA with Project ID P001")))
    assert out.loc[0, "amount_php"] == 999999.1


def test_clean_flags_coordinates_without_dropping():
    out = clean(
        _raw(
            _row(),
            _row(ProjectComponentID="P002-CW1", Longitude="14.65", Latitude="121.05"),
            _row(ProjectComponentID="P003-CW1", Longitude=""),
        )
    )
    assert list(out["quality_flag"]) == ["ok", "coords_outside_ph", "coords_missing"]


def _overlapping_areas() -> gpd.GeoDataFrame:
    """A city inside a basin zone inside a basin, as in the demo set."""
    return gpd.GeoDataFrame(
        {"area_id": ["basin", "basin__down", "city"]},
        geometry=[
            box(120.9, 14.4, 121.3, 14.9),
            box(120.9, 14.4, 121.15, 14.9),
            box(121.0, 14.6, 121.1, 14.7),
        ],
        crs=4326,
    )


def _three_sites() -> pd.DataFrame:
    """P001 in the city, P002 in the basin only, P003 outside every area."""
    return clean(
        _raw(
            _row(),
            _row(ProjectComponentID="P002-CW1", Longitude="121.2", Latitude="14.5"),
            _row(ProjectComponentID="P003-CW1", Longitude="123.0", Latitude="10.0"),
        )
    )


def test_assign_areas_returns_every_matching_area():
    links = assign_areas(_three_sites(), _overlapping_areas())

    assert list(links.columns) == ["component_id", "area_id"]
    assert list(links.itertuples(index=False, name=None)) == [
        ("P001-CW1", "basin"),
        ("P001-CW1", "basin__down"),
        ("P001-CW1", "city"),
        ("P002-CW1", "basin"),
    ]


def test_assign_areas_skips_flagged_coordinates():
    cleaned = clean(_raw(_row(Longitude="14.65", Latitude="121.05")))
    assert assign_areas(cleaned, _overlapping_areas()).empty


def test_assign_areas_without_study_areas_returns_no_links():
    links = assign_areas(clean(_raw(_row())), None)
    assert links.empty
    assert list(links.columns) == ["component_id", "area_id"]


def test_totals_are_per_area_and_never_added_across_overlapping_areas():
    cleaned = _three_sites()
    totals = totals_per_area(cleaned, assign_areas(cleaned, _overlapping_areas()))
    by_area = totals.set_index("area_id")

    # One row per area and year, and no row that combines areas.
    assert sorted(by_area.index) == ["basin", "basin__down", "city"]
    # The project in the city counts in full in each area it falls in.
    assert by_area.loc["city", "amount_php"] == 999999.12
    assert by_area.loc["basin__down", "amount_php"] == 999999.12
    assert by_area.loc["basin", "projects"] == 2
    # The basin row is already the full total for the basin: each linked project once.
    linked_once = cleaned[cleaned["component_id"] != "P003-CW1"]["amount_php"].sum()
    assert by_area.loc["basin", "amount_php"] == pytest.approx(linked_once)
    # Adding the areas together would count the city project three times.
    assert totals["amount_php"].sum() == pytest.approx(linked_once + 2 * 999999.12)


def test_to_records_matches_staging_columns():
    cleaned = clean(_raw(_row(), _row(ProjectComponentID="P002-CW1", Longitude="")))
    records = to_records(cleaned)
    first = dict(zip(STAGING_COLUMNS, records[0], strict=True))
    second = dict(zip(STAGING_COLUMNS, records[1], strict=True))

    assert "area_id" not in STAGING_COLUMNS
    assert first["amount_php"] == Decimal("999999.12")
    assert first["start_date"] == date(2022, 2, 8)
    assert (first["lon"], first["lat"]) == (121.05, 14.65)
    assert (second["lon"], second["lat"]) == (None, None)


def test_to_link_records_are_component_and_area_pairs():
    records = to_link_records(assign_areas(_three_sites(), _overlapping_areas()))
    assert records[0] == ("P001-CW1", "basin")
    assert len(records) == 4


@pytest.mark.parametrize(
    ("description", "category"),
    [
        ("Construction of Riverbank Protection, Brgy. X", "river_structure"),
        ("Improvement of Marikina River, Phase II", "river_structure"),
        ("Construction of Seawall at Brgy. Y", "river_structure"),
        ("Rehabilitation of Sapang Baho Creek", "river_structure"),
        ("Construction of Bank Protection along Highway", "river_structure"),
        ("Construction of Retarding Basin, Phase I", "river_structure"),
        ("Construction of Box Culvert, Brgy. Z", "drainage"),
        ("Construction of Canal Lining, Brgy. Z", "drainage"),
        ("Construction of Slope Protection, Sta. 1+000", "slope_protection"),
        ("Rock fall and landslide control", "slope_protection"),
        # The work named first decides when a description names two.
        ("Construction of Drainage and Slope Protection", "drainage"),
        ("Construction of Slope Protection and Drainage", "slope_protection"),
        ("Box Culvert along Balanti Creek", "drainage"),
        ("River Slope Protection at Brgy. Q", "river_structure"),
        # A pumping station wins over any other work.
        ("Riverwall with Pumping Station, Phase II", "pumping"),
        # A pump alone does not count.
        ("Installation of Booster Pump at Estero de Vitas", "other"),
        # Program text names no work. Text that is only a heading stays other.
        ("Organizational Outcome 2: Protect Lives and Properties against Major Floods", "other"),
        (
            "MFO 2 Flood Management Services - Flood Mitigation Structures and Drainage Systems",
            "other",
        ),
        (
            "Flood Mitigation Structures and Drainage Systems - Construction of River Control",
            "river_structure",
        ),
        ("Bridge widening, Brgy. Z", "other"),
        (None, "other"),
        ("", "other"),
    ],
)
def test_classify_from_description(description, category):
    assert classify_from_description(description) == category
