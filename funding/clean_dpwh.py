"""Clean, classify, deduplicate, and geotag the DPWH flood control projects CSV.

Usage: python -m funding.clean_dpwh funding/raw/<file>.csv
"""

import argparse
import logging
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd

log = logging.getLogger("funding.clean_dpwh")

ROOT = Path(__file__).resolve().parents[1]
AREAS_DIR = ROOT / "pipeline" / "areas"
CLEAN_DIR = ROOT / "funding" / "clean"
SOURCE = "dpwh_flood_control"

# Philippines bounding box. Rows outside are flagged, never dropped.
LON_RANGE = (116.0, 127.0)
LAT_RANGE = (4.0, 21.0)

# Checked in order, first match wins.
CATEGORY_KEYWORDS = [
    ("drainage", ("drainage",)),
    ("river_structure", ("flood mitigation", "flood control", "revetment", "dike")),
    ("slope_protection", ("slope protection",)),
    ("pumping", ("pumping",)),
]

# "pumping station", "pumping stations", "pump station", and the misspelling "staiton" that
# is in the source. A pump on its own ("Booster Pump Accessories") does not match.
PUMPING_STATION = re.compile(r"\bpump(ing)?\s+sta(ti|it)ons?\b", re.IGNORECASE)

EE_COLUMNS = ["component_id", "year", "category", "amount_php", "Longitude", "Latitude"]
LINK_COLUMNS = ["component_id", "area_id"]


def classify(type_of_work: str | None, description: str | None = None) -> str:
    """Category from TypeofWork, except that a pumping station in ProjectDescription wins.

    DPWH files pumping stations under general types such as "Flood Mitigation Facility",
    so TypeofWork alone never yields the pumping category.
    """
    if PUMPING_STATION.search(description or ""):
        return "pumping"
    text = (type_of_work or "").lower()
    for category, keywords in CATEGORY_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return category
    return "other"


def _money(strings: pd.Series, numbers: pd.Series) -> pd.Series:
    """PHP as float. The numeric column is the value of record but is rounded to 7 digits.

    The *_String column keeps the centavos, so it is used where it is the same amount
    unrounded. Where it holds a note ("MYCA with ...", "Clustered with ...") or a different
    amount, the numeric column stays.
    """
    value = pd.to_numeric(numbers, errors="coerce")
    exact = pd.to_numeric(strings.str.replace(",", ""), errors="coerce")
    same_amount = (exact - value).abs() < 0.06
    conflicts = int((exact.notna() & value.notna() & ~same_amount).sum())
    if conflicts:
        log.warning("%s: %d row(s) disagree with %s", strings.name, conflicts, numbers.name)
    return exact.where(same_amount, value).round(2)


def deduplicate(raw: pd.DataFrame) -> pd.DataFrame:
    """One row per ProjectComponentID.

    Duplicates are multi-year contract rows: the same contract and the same full cost repeated
    under each later InfraYear. Keeping the earliest year counts the cost once.
    """
    ordered = raw.assign(_year=pd.to_numeric(raw["InfraYear"], errors="coerce")).sort_values(
        "_year", kind="stable"
    )
    kept = ordered.drop_duplicates("ProjectComponentID", keep="first").sort_index()
    return kept.drop(columns="_year")


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    """Raw DPWH rows (all columns as str) to one typed row per project component."""
    df = deduplicate(raw)
    text = df.apply(lambda col: col.str.strip()).replace("", pd.NA)

    out = pd.DataFrame(index=df.index)
    out["component_id"] = text["ProjectComponentID"]
    out["project_id"] = text["ProjectID"]
    out["year"] = pd.to_numeric(text["InfraYear"], errors="coerce").astype("Int64")
    out["funding_year"] = pd.to_numeric(text["FundingYear"], errors="coerce").astype("Int64")
    out["completion_year"] = pd.to_numeric(text["CompletionYear"], errors="coerce").astype("Int64")
    out["type_of_work"] = text["TypeofWork"]
    out["category"] = [
        classify(None if pd.isna(work) else work, None if pd.isna(description) else description)
        for work, description in zip(text["TypeofWork"], text["ProjectDescription"], strict=True)
    ]
    out["amount_php"] = _money(text["ContractCost_String"], text["ContractCost"])
    out["abc_php"] = _money(text["ABC_String"], text["ABC"])
    out["contractor"] = text["Contractor"]
    out["municipality"] = text["Municipality"]
    out["province"] = text["Province"]
    out["region"] = text["Region"]
    out["start_date"] = pd.to_datetime(text["StartDate"], format="%m/%d/%Y", errors="coerce")
    out["completion_date"] = pd.to_datetime(
        text["CompletionDateActual"], format="%Y-%m-%d", errors="coerce"
    )
    out["completion_date_original"] = pd.to_datetime(
        pd.to_numeric(text["CompletionDateOriginal"], errors="coerce"), unit="ms"
    )
    for col in ("start_date", "completion_date", "completion_date_original"):
        out[col] = out[col].dt.date.where(out[col].notna(), None)
    out["Longitude"] = pd.to_numeric(text["Longitude"], errors="coerce")
    out["Latitude"] = pd.to_numeric(text["Latitude"], errors="coerce")

    out["quality_flag"] = "ok"
    inside = out["Longitude"].between(*LON_RANGE) & out["Latitude"].between(*LAT_RANGE)
    out.loc[~inside, "quality_flag"] = "coords_outside_ph"
    out.loc[out["Longitude"].isna() | out["Latitude"].isna(), "quality_flag"] = "coords_missing"

    out["source"] = SOURCE
    return out.reset_index(drop=True)


def load_areas(areas_dir: Path = AREAS_DIR) -> gpd.GeoDataFrame | None:
    files = sorted(areas_dir.glob("*.geojson"))
    if not files:
        return None
    areas = pd.concat([gpd.read_file(f).to_crs(4326) for f in files], ignore_index=True)
    return areas[["area_id", "geometry"]]


def assign_areas(df: pd.DataFrame, areas: gpd.GeoDataFrame | None) -> pd.DataFrame:
    """Point-in-polygon join of the project site to study areas.

    Returns one (component_id, area_id) row for every study area the site falls in. Study
    areas overlap (a city inside a basin, zones inside a basin), so a project can have
    several rows. The point is the project site, not the area it protects.
    """
    if areas is None or areas.empty:
        return pd.DataFrame(columns=LINK_COLUMNS)
    usable = df[df["quality_flag"] == "ok"]
    points = gpd.GeoDataFrame(
        usable[["component_id"]],
        geometry=gpd.points_from_xy(usable["Longitude"], usable["Latitude"]),
        crs=4326,
    )
    hits = gpd.sjoin(points, areas[["area_id", "geometry"]], predicate="within", how="inner")
    links = hits[LINK_COLUMNS].drop_duplicates().sort_values(LINK_COLUMNS)
    return links.reset_index(drop=True)


def totals_per_area(df: pd.DataFrame, links: pd.DataFrame) -> pd.DataFrame:
    """Projects and PHP per area_id per year, through the links.

    Each project counts in full in every area it falls in. Study areas overlap, so the rows
    of different areas must never be added together.
    """
    joined = links.merge(df[["component_id", "year", "amount_php"]], on="component_id")
    grouped = joined.groupby(["area_id", "year"], as_index=False)
    return grouped.agg(projects=("component_id", "count"), amount_php=("amount_php", "sum"))


def write_outputs(
    df: pd.DataFrame, links: pd.DataFrame, clean_dir: Path = CLEAN_DIR
) -> dict[str, Path]:
    clean_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "parquet": clean_dir / "dpwh_flood_control.parquet",
        "csv": clean_dir / "dpwh_flood_control.csv",
        "areas_parquet": clean_dir / "dpwh_flood_control_areas.parquet",
        "areas_csv": clean_dir / "dpwh_flood_control_areas.csv",
        "ee_csv": clean_dir / "dpwh_flood_control_ee.csv",
    }
    df.to_parquet(paths["parquet"], index=False)
    df.to_csv(paths["csv"], index=False)
    links.to_parquet(paths["areas_parquet"], index=False)
    links.to_csv(paths["areas_csv"], index=False)
    # Earth Engine table upload needs a point, so rows with flagged coordinates stay out.
    df.loc[df["quality_flag"] == "ok", EE_COLUMNS].to_csv(paths["ee_csv"], index=False)
    return paths


def print_summary(rows_in: int, df: pd.DataFrame, links: pd.DataFrame) -> None:
    print(f"rows in: {rows_in}")
    print(f"duplicates removed (ProjectComponentID): {rows_in - len(df)}")
    print(f"rows out: {len(df)}")
    print(f"flagged coordinates: {int((df['quality_flag'] != 'ok').sum())}")
    print("\nrows per category:")
    print(df["category"].value_counts().to_string())
    print("\nrows per year (InfraYear):")
    print(df["year"].value_counts().sort_index().to_string())
    linked = links["component_id"].nunique()
    print(f"\nprojects inside at least one study area: {linked}")
    print(f"projects outside every study area: {len(df) - linked}")
    if links.empty:
        return
    print("\nprojects per area (areas overlap, do not add across areas):")
    print(links["area_id"].value_counts().sort_index().to_string())
    print("\nPHP per area per year (areas overlap, do not add across areas):")
    per_year = totals_per_area(df, links).pivot_table(
        index="area_id", columns="year", values="amount_php", aggfunc="sum", fill_value=0
    )
    print(per_year.map(lambda v: f"{v:,.2f}").to_string())


def run(csv_path: Path) -> pd.DataFrame:
    raw = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    df = clean(raw)
    log.info("removed %d duplicate ProjectComponentID row(s)", len(raw) - len(df))
    areas = load_areas()
    if areas is None:
        log.warning("no study areas in %s, no project is linked to an area", AREAS_DIR)
    links = assign_areas(df, areas)
    paths = write_outputs(df, links)
    print_summary(len(raw), df, links)
    print("\nwrote:")
    for path in paths.values():
        print(f"  {path.relative_to(ROOT)}")
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="funding/raw/flood-control-projects-*.csv")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run(args.csv)


if __name__ == "__main__":
    main()
