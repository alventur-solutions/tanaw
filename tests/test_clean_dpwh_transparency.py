from datetime import date

import pandas as pd

from funding.clean_dpwh import has_point
from funding.clean_dpwh_transparency import clean, flood_control_lookup
from funding.load_dpwh import STAGING_COLUMNS, to_records


def _contract(**overrides) -> dict:
    row = {
        "contractId": "24OF0014",
        "description": "CONSTRUCTION OF FLOOD CONTROL STRUCTURE AT CULIAT CREEK, QUEZON CITY",
        "category": "Flood Control and Drainage",
        "componentCategories": "Flood Control and Drainage",
        "status": "Completed",
        "budget": 19403573.03,
        "amountPaid": 0,
        "progress": 100.0,
        "location": {"province": "Quezon City 2nd DEO", "region": "National Capital Region"},
        "contractor": "AYANA CONSTRUCTION AND TRADING (38623)",
        "startDate": date(2024, 2, 6),
        "completionDate": date(2024, 9, 2),
        "infraYear": "2024",
        "programName": "Flood Management Program",
        "sourceOfFunds": "GAA 2024",
        "latitude": 14.66,
        "longitude": 121.06,
    }
    return row | overrides


def _component(**overrides) -> dict[str, str]:
    row = {
        "InfraYear": "2024",
        "FundingYear": "2024",
        "CompletionYear": "2024",
        "Region": "National Capital Region",
        "Province": "METRO MANILA",
        "Municipality": "QUEZON CITY",
        "ProjectID": "P001",
        "ProjectComponentID": "P001-CW1",
        "ContractID": "24OF0014",
        "TypeofWork": "Construction of Flood Mitigation Structure",
        "ProjectDescription": "Flood Mitigation Structure with Drainage, Culiat Creek",
        "Longitude": "121.05",
        "Latitude": "14.65",
        "ABC": "1000000",
        "ABC_String": "1000000.00",
        "ContractCost": "900000",
        "ContractCost_String": "900000.00",
        "CompletionDateOriginal": "1662249600000",
        "CompletionDateActual": "2024-09-02",
        "StartDate": "02/06/2024",
        "Contractor": "AYANA",
    }
    return row | overrides


def _lookup(*rows: dict[str, str]) -> pd.DataFrame:
    return flood_control_lookup(pd.DataFrame(list(rows), dtype=str))


def test_only_flood_control_contracts_are_kept() -> None:
    raw = pd.DataFrame(
        [
            _contract(),
            _contract(contractId="R1", componentCategories="Roads"),
            _contract(contractId="M1", componentCategories="Flood Control and Drainage, Roads"),
        ]
    )
    assert list(clean(raw)["component_id"]) == ["24OF0014", "M1"]


def test_contract_fields_are_typed() -> None:
    row = clean(pd.DataFrame([_contract()])).iloc[0]
    assert row["component_id"] == row["contract_id"] == "24OF0014"
    assert row["year"] == 2024
    assert row["amount_php"] == 19403573.03
    assert row["status"] == "Completed"
    assert row["progress_pct"] == 100.0
    assert row["province"] == "Quezon City 2nd DEO"
    assert row["start_date"] == date(2024, 2, 6)
    assert row["source"] == "dpwh_transparency"


def test_contract_only_in_this_dataset_is_classified_from_the_description() -> None:
    row = clean(pd.DataFrame([_contract(description="CONSTRUCTION OF DRAINAGE, BRGY. X")])).iloc[0]
    assert row["category"] == "drainage"
    assert pd.isna(row["type_of_work"])
    assert row["quality_flag"] == "category_from_description"


def test_contract_in_the_flood_control_file_keeps_its_type_of_work_and_point() -> None:
    row = clean(pd.DataFrame([_contract()]), _lookup(_component())).iloc[0]
    assert row["type_of_work"] == "Construction of Flood Mitigation Structure"
    # TypeofWork decides, although the description mentions drainage.
    assert row["category"] == "river_structure"
    assert (row["Longitude"], row["Latitude"]) == (121.05, 14.65)
    assert row["municipality"] == "QUEZON CITY"
    assert row["quality_flag"] == "ok"
    # The amount is the contract's, from the transparency dataset.
    assert row["amount_php"] == 19403573.03


def test_several_components_of_one_contract_become_one_row() -> None:
    lookup = _lookup(
        _component(),
        _component(
            ProjectComponentID="P002-CW1", ProjectID="P002", ABC_String="500000.00", ABC="500000"
        ),
    )
    out = clean(pd.DataFrame([_contract()]), lookup)
    assert len(out) == 1
    assert out.iloc[0]["project_id"] == "P001"
    assert out.iloc[0]["abc_php"] == 1500000.0


def test_placeholder_amounts_and_progress_become_empty() -> None:
    row = clean(pd.DataFrame([_contract(budget=0.0, progress=-100.0)])).iloc[0]
    assert pd.isna(row["amount_php"])
    assert pd.isna(row["progress_pct"])


def test_missing_coordinates_are_flagged_and_get_no_point() -> None:
    out = clean(pd.DataFrame([_contract(latitude=None, longitude=None)]))
    assert out.iloc[0]["quality_flag"] == "coords_missing"
    assert not has_point(out).iloc[0]


def test_records_match_the_staging_columns() -> None:
    record = to_records(clean(pd.DataFrame([_contract()])))[0]
    row = dict(zip(STAGING_COLUMNS, record, strict=True))
    assert row["contract_id"] == "24OF0014"
    assert row["status"] == "Completed"
    assert row["quality_flag"] == "category_from_description"
    assert (row["lon"], row["lat"]) == (121.06, 14.66)
    assert row["project_id"] is None


def test_description_rules_apply_only_without_type_of_work() -> None:
    contracts = pd.DataFrame(
        [
            _contract(contractId="A", description="CONSTRUCTION OF RIVERBANK PROTECTION, BRGY. X"),
            _contract(contractId="B", description="ORGANIZATIONAL OUTCOME 2: PROTECT LIVES"),
            _contract(contractId="C", description="CONSTRUCTION OF BOX CULVERT, BRGY. X"),
        ]
    )
    rows = clean(contracts, _lookup(_component(ContractID="C"))).set_index("contract_id")
    assert rows.loc["A", "category"] == "river_structure"
    assert rows.loc["B", "category"] == "other"
    # In the flood control file: TypeofWork decides, the description is not read for work.
    assert rows.loc["C", "category"] == "river_structure"
    assert rows.loc["C", "quality_flag"] == "ok"
    # Every row classified from the description stays an estimate.
    assert rows.loc[["A", "B"], "quality_flag"].eq("category_from_description").all()


def test_pumping_station_overrides_in_a_row_without_type_of_work() -> None:
    row = clean(
        pd.DataFrame([_contract(description="RIVERWALL AND PUMPING STATION, BRGY. X")])
    ).iloc[0]
    assert row["category"] == "pumping"
    assert row["quality_flag"] == "category_from_description"
