"""Bulk load the cleaned DPWH projects and their area links with asyncpg COPY.

Usage: python -m funding.load_dpwh [funding/clean/<file>.parquet] [--replace-source NAME]

The links are read from the file next to it (dpwh_flood_control_areas.parquet).
COPY goes into temporary staging tables. One INSERT ... ON CONFLICT builds the point
geometry and upserts funding_projects on component_id, then the links of the staged
projects are replaced in funding_project_areas. A refreshed file can be loaded again safely.

--replace-source removes the rows of an older source in the same transaction. Use it when
the loaded file holds the same contracts as that source, so no contract is counted twice.
"""

import argparse
import asyncio
from decimal import Decimal
from pathlib import Path

import pandas as pd

from funding.clean_dpwh import CLEAN_DIR, LINK_COLUMNS, has_point

STAGING_COLUMNS = {
    "component_id": "text",
    "project_id": "text",
    "contract_id": "text",
    "year": "integer",
    "category": "text",
    "type_of_work": "text",
    "amount_php": "numeric(18, 2)",
    "abc_php": "numeric(18, 2)",
    "contractor": "text",
    "municipality": "text",
    "province": "text",
    "start_date": "date",
    "completion_date": "date",
    "description": "text",
    "status": "text",
    "progress_pct": "double precision",
    "program": "text",
    "source_of_funds": "text",
    "quality_flag": "text",
    "source": "text",
    "lon": "double precision",
    "lat": "double precision",
}
TABLE_COLUMNS = [c for c in STAGING_COLUMNS if c not in ("lon", "lat")]

CREATE_STAGING = "CREATE TEMP TABLE funding_projects_staging ({}) ON COMMIT DROP".format(
    ", ".join(f"{name} {kind}" for name, kind in STAGING_COLUMNS.items())
)

CREATE_LINK_STAGING = (
    "CREATE TEMP TABLE funding_project_areas_staging (component_id text, area_id text) "
    "ON COMMIT DROP"
)

UNKNOWN_AREAS = """
    SELECT DISTINCT s.area_id FROM funding_project_areas_staging s
    LEFT JOIN study_areas a USING (area_id)
    WHERE a.area_id IS NULL
"""

UPSERT = """
    INSERT INTO funding_projects ({cols}, geom)
    SELECT {cols}, ST_SetSRID(ST_MakePoint(lon, lat), 4326)
    FROM funding_projects_staging
    ON CONFLICT (component_id) DO UPDATE SET {updates}, geom = EXCLUDED.geom
""".format(
    cols=", ".join(TABLE_COLUMNS),
    updates=", ".join(f"{c} = EXCLUDED.{c}" for c in TABLE_COLUMNS if c != "component_id"),
)


# Links are replaced for every staged project, so a project that moved out of an area
# after a boundary change loses its old link.
DELETE_LINKS = """
    DELETE FROM funding_project_areas
    WHERE component_id IN (SELECT component_id FROM funding_projects_staging)
"""

# The link rows go with them (ON DELETE CASCADE).
DELETE_SOURCE = "DELETE FROM funding_projects WHERE source = $1"

INSERT_LINKS = """
    INSERT INTO funding_project_areas (component_id, area_id)
    SELECT component_id, area_id FROM funding_project_areas_staging
"""


def _money(value: float | None) -> Decimal | None:
    return None if pd.isna(value) else Decimal(f"{value:.2f}")


def to_records(df: pd.DataFrame) -> list[tuple]:
    """Rows in STAGING_COLUMNS order, with None for missing values."""
    # Flagged coordinates are kept as a row but get no point geometry.
    point = has_point(df)
    # Files cleaned before a column existed load with that column empty.
    df = df.reindex(columns=[*df.columns, *(c for c in STAGING_COLUMNS if c not in df.columns)])
    staged = df.assign(
        lon=df["Longitude"].where(point),
        lat=df["Latitude"].where(point),
        amount_php=df["amount_php"].map(_money),
        abc_php=df["abc_php"].map(_money),
    )[list(STAGING_COLUMNS)]
    staged = staged.astype(object).where(staged.notna(), None)
    return list(staged.itertuples(index=False, name=None))


def to_link_records(links: pd.DataFrame) -> list[tuple]:
    return list(links[LINK_COLUMNS].itertuples(index=False, name=None))


async def load(
    records: list[tuple], link_records: list[tuple], replace_source: str | None = None
) -> tuple[int, int]:
    """COPY and upsert in one transaction. Returns (funding_projects, link) row counts."""
    from api.db import engine

    try:
        async with engine.connect() as connection:
            raw = await connection.get_raw_connection()
            pg = raw.driver_connection  # the asyncpg connection, cache settings from api.db
            # One transaction: the temp tables must not outlive a PgBouncer server connection.
            async with pg.transaction():
                await pg.execute(CREATE_STAGING)
                await pg.execute(CREATE_LINK_STAGING)
                await pg.copy_records_to_table(
                    "funding_projects_staging", records=records, columns=list(STAGING_COLUMNS)
                )
                await pg.copy_records_to_table(
                    "funding_project_areas_staging", records=link_records, columns=LINK_COLUMNS
                )
                unknown = [r["area_id"] for r in await pg.fetch(UNKNOWN_AREAS)]
                if unknown:
                    raise ValueError(f"area_id not in study_areas, load them first: {unknown}")
                if replace_source:
                    await pg.execute(DELETE_SOURCE, replace_source)
                await pg.execute(UPSERT)
                await pg.execute(DELETE_LINKS)
                await pg.execute(INSERT_LINKS)
                return (
                    await pg.fetchval("SELECT count(*) FROM funding_projects"),
                    await pg.fetchval("SELECT count(*) FROM funding_project_areas"),
                )
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "parquet", type=Path, nargs="?", default=CLEAN_DIR / "dpwh_flood_control.parquet"
    )
    parser.add_argument("--replace-source", help="source name whose rows are removed first")
    args = parser.parse_args()
    links_path = args.parquet.with_name(f"{args.parquet.stem}_areas.parquet")
    records = to_records(pd.read_parquet(args.parquet))
    link_records = to_link_records(pd.read_parquet(links_path))
    projects, links = asyncio.run(load(records, link_records, args.replace_source))
    print(f"copied {len(records)} rows, funding_projects now has {projects} rows")
    print(f"copied {len(link_records)} links, funding_project_areas now has {links} rows")


if __name__ == "__main__":
    main()
