"""Clean the DPWH Infrastructure Transparency dataset into TANAW funding rows.

Usage: python -m funding.clean_dpwh_transparency data/raw/dpwh/dpwh_transparency_data.parquet
           [--flood-control-csv data/raw/funding/flood-control-projects-full_<date>.csv]

One row per contract (contractId), flood control and drainage contracts only. The dataset
covers 2016 onward and holds every contract of the older flood control file, which is given
with --flood-control-csv. For a contract that is in both, TypeofWork, the ABC, the
municipality, and the coordinates come from the flood control file. A contract that is only
in the transparency dataset has no TypeofWork, so its category is read from the description
and the row is flagged `category_from_description`.
"""

import argparse
import logging
from pathlib import Path

import pandas as pd

from funding.clean_dpwh import (
    LAT_RANGE,
    LON_RANGE,
    ROOT,
    assign_areas,
    classify,
    has_point,
    load_areas,
    print_summary,
    write_outputs,
)
from funding.clean_dpwh import clean as clean_flood_control

log = logging.getLogger("funding.clean_dpwh_transparency")

SOURCE = "dpwh_transparency"
STEM = "dpwh_transparency"
FLOOD_CONTROL = "Flood Control and Drainage"

# Taken from the flood control file where the contract is in it.
FROM_FLOOD_CONTROL = [
    "project_id",
    "type_of_work",
    "municipality",
    "abc_php",
    "fc_description",
    "fc_longitude",
    "fc_latitude",
]


def flood_control_lookup(raw_csv: pd.DataFrame) -> pd.DataFrame:
    """One row per ContractID from the flood control file.

    A contract can hold several project components. The first component gives the text
    fields and the point, and the ABC is the sum over the components.
    """
    components = clean_flood_control(raw_csv)
    components = components.assign(
        fc_description=raw_csv.drop_duplicates("ProjectComponentID")["ProjectDescription"]
        .str.strip()
        .replace("", pd.NA)
        .to_numpy(),
        fc_longitude=components["Longitude"].where(has_point(components)),
        fc_latitude=components["Latitude"].where(has_point(components)),
    )
    grouped = components.dropna(subset=["contract_id"]).groupby("contract_id", sort=False)
    lookup = grouped[[c for c in FROM_FLOOD_CONTROL if c != "abc_php"]].first()
    lookup["abc_php"] = grouped["abc_php"].sum(min_count=1)
    return lookup


def clean(raw: pd.DataFrame, lookup: pd.DataFrame | None = None) -> pd.DataFrame:
    """Transparency rows to one typed row per flood control contract."""
    flood = raw[raw["componentCategories"].fillna("").str.contains(FLOOD_CONTROL, regex=False)]
    if flood["contractId"].duplicated().any():
        raise ValueError("contractId is not unique in the transparency dataset")
    if lookup is None:
        lookup = pd.DataFrame(columns=FROM_FLOOD_CONTROL)
    known = flood[["contractId"]].join(lookup, on="contractId")
    in_flood_control = flood["contractId"].isin(lookup.index)

    text = flood[["description", "status", "contractor", "programName", "sourceOfFunds"]].apply(
        lambda col: col.str.strip()
    )
    text = text.replace("", pd.NA)
    location = pd.json_normalize(flood["location"].tolist()).set_index(flood.index)

    out = pd.DataFrame(index=flood.index)
    # The contract is the unit here, so it is also the key of funding_projects.
    out["component_id"] = flood["contractId"]
    out["project_id"] = known["project_id"]
    out["contract_id"] = flood["contractId"]
    out["year"] = pd.to_numeric(flood["infraYear"], errors="coerce").astype("Int64")
    out["type_of_work"] = known["type_of_work"]
    description = known["fc_description"].fillna(text["description"])
    out["category"] = [
        classify(
            # No TypeofWork: the description stands in for it.
            description if pd.isna(work) else work,
            None if pd.isna(description) else description,
        )
        if not (pd.isna(work) and pd.isna(description))
        else "other"
        for work, description in zip(out["type_of_work"], description, strict=True)
    ]
    # A budget of zero or less is a placeholder in the source, not an amount.
    out["amount_php"] = flood["budget"].where(flood["budget"] > 0).round(2)
    out["abc_php"] = known["abc_php"]
    out["contractor"] = text["contractor"]
    out["municipality"] = known["municipality"]
    out["province"] = location["province"]
    out["region"] = location["region"]
    for name, column in (("start_date", "startDate"), ("completion_date", "completionDate")):
        dates = pd.to_datetime(flood[column], errors="coerce")
        out[name] = dates.dt.date.where(dates.notna(), None)
    out["description"] = text["description"]
    out["status"] = text["status"]
    # Progress is a percent. A few source rows hold a negative placeholder.
    out["progress_pct"] = flood["progress"].where(flood["progress"].between(0, 100))
    out["program"] = text["programName"]
    out["source_of_funds"] = text["sourceOfFunds"]
    out["Longitude"] = known["fc_longitude"].fillna(flood["longitude"])
    out["Latitude"] = known["fc_latitude"].fillna(flood["latitude"])

    out["quality_flag"] = "ok"
    out.loc[~in_flood_control, "quality_flag"] = "category_from_description"
    inside = out["Longitude"].between(*LON_RANGE) & out["Latitude"].between(*LAT_RANGE)
    out.loc[~inside, "quality_flag"] = "coords_outside_ph"
    out.loc[out["Longitude"].isna() | out["Latitude"].isna(), "quality_flag"] = "coords_missing"

    out["source"] = SOURCE
    return out.reset_index(drop=True)


def run(parquet_path: Path, flood_control_csv: Path | None) -> pd.DataFrame:
    raw = pd.read_parquet(parquet_path)
    lookup = None
    if flood_control_csv is not None:
        lookup = flood_control_lookup(
            pd.read_csv(flood_control_csv, dtype=str, keep_default_na=False)
        )
    else:
        log.warning("no flood control file given, every category is read from the description")
    df = clean(raw, lookup)
    areas = load_areas()
    links = assign_areas(df, areas)
    paths = write_outputs(df, links, stem=STEM)
    print_summary(len(raw), df, links, dropped="rows that are not flood control")
    print("\nrows per quality_flag:")
    print(df["quality_flag"].value_counts().to_string())
    print("\nrows per status:")
    print(df["status"].value_counts(dropna=False).to_string())
    print("\nwrote:")
    for path in paths.values():
        print(f"  {path.relative_to(ROOT)}")
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parquet", type=Path, help="data/raw/dpwh/dpwh_transparency_data.parquet")
    parser.add_argument("--flood-control-csv", type=Path, help="the older flood control CSV")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run(args.parquet, args.flood_control_csv)


if __name__ == "__main__":
    main()
