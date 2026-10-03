"""Compute a satellite metric for study areas and years.

    python -m pipeline.run --metric tree_cover_loss --area quezon-city --years 2021-2022 --dry-run

--dry-run computes the rows and prints them. Nothing is written.
--confirmed computes the rows and upserts them into satellite_metrics.
One of the two is required, and a dry run always comes first.
"""

import argparse
import asyncio

from pipeline.registry import METRICS
from pipeline.study_areas import init_ee, read_features

ROW_KEYS = ("area_id", "year", "metric", "value", "quality_flag")
YEARS_PER_REQUEST = 4

UPSERT = """
INSERT INTO satellite_metrics (area_id, year, metric, value, quality_flag, source_version)
VALUES (:area_id, :year, :metric, :value, :quality_flag, :source_version)
ON CONFLICT (area_id, year, metric) DO UPDATE SET
    value = EXCLUDED.value,
    quality_flag = EXCLUDED.quality_flag,
    source_version = EXCLUDED.source_version,
    computed_at = now()
"""


def parse_years(text: str) -> list[int]:
    """'2021' or '2021-2022' (inclusive)."""
    first, _, last = text.partition("-")
    start, end = int(first), int(last or first)
    if end < start:
        raise argparse.ArgumentTypeError(f"year range {text!r} runs backwards")
    return list(range(start, end + 1))


def select_features(features: list[dict], area: str | None) -> list[dict]:
    """All features, or one area with its zones (`<area_id>__up`, `<area_id>__down`)."""
    if area is None:
        return features
    chosen = [
        f
        for f in features
        if f["properties"]["area_id"] == area or f["properties"]["area_id"].startswith(area + "__")
    ]
    if not chosen:
        known = sorted(f["properties"]["area_id"] for f in features)
        raise SystemExit(f"Unknown area {area!r}. Known: {', '.join(known)}")
    return chosen


def to_rows(collection: dict) -> list[dict]:
    """Rows from a computed FeatureCollection (as returned by getInfo), schema checked."""
    rows = []
    for feature in collection["features"]:
        props = feature["properties"]
        missing = [k for k in ROW_KEYS if k not in props and k != "value"]
        if missing:
            raise ValueError(f"metric row is missing {missing}: {props}")
        rows.append({k: props.get(k) for k in ROW_KEYS})
    return sorted(rows, key=lambda r: (r["area_id"], r["year"]))


def compute_rows(metric_name: str, features: list[dict], years: list[int]) -> list[dict]:
    ee = init_ee()
    metric = METRICS[metric_name]
    areas = ee.FeatureCollection(
        [
            ee.Feature(
                ee.Geometry(f["geometry"], geodesic=False),
                {"area_id": f["properties"]["area_id"]},
            )
            for f in features
        ]
    )
    # One request per few years: a long range in a single request is rejected with
    # "Too many concurrent aggregations".
    rows = []
    for start in range(0, len(years), YEARS_PER_REQUEST):
        batch = years[start : start + YEARS_PER_REQUEST]
        result = ee.FeatureCollection([metric.compute(year, areas) for year in batch]).flatten()
        rows += to_rows(result.getInfo())
    # The dataset the value came from, so rows from an older version can be told apart.
    rows = [{**row, "source_version": metric.dataset} for row in rows]
    return sorted(rows, key=lambda r: (r["area_id"], r["year"]))


def print_rows(rows: list[dict], unit: str) -> None:
    width = max(len(r["area_id"]) for r in rows)
    header = f"value ({unit})"
    print(f"{'area_id':<{width}}  year  {'metric':<16}  {header:>14}  quality_flag")
    for r in rows:
        value = "" if r["value"] is None else f"{r['value']:,.2f}"
        print(
            f"{r['area_id']:<{width}}  {r['year']}  {r['metric']:<16}  {value:>14}  "
            f"{r['quality_flag']}"
        )


async def save(rows: list[dict]) -> None:
    from sqlalchemy import text

    from api.db import SessionLocal, engine

    async with SessionLocal() as session:
        for row in rows:
            await session.execute(text(UPSERT), row)
        await session.commit()
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--metric", required=True, choices=sorted(METRICS))
    parser.add_argument("--area", help="area_id, zones included. Default: every study area.")
    parser.add_argument("--years", required=True, type=parse_years, help="2021 or 2021-2022")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="compute and print, write nothing")
    mode.add_argument("--confirmed", action="store_true", help="write to satellite_metrics")
    args = parser.parse_args()

    metric = METRICS[args.metric]
    features = select_features(read_features(), args.area)
    rows = compute_rows(args.metric, features, args.years)
    print(f"{metric.name} from {metric.dataset} ({metric.first_year} to {metric.last_year})")
    print_rows(rows, metric.unit)
    if args.dry_run:
        print(f"\nDry run: {len(rows)} rows computed, nothing written.")
        return
    asyncio.run(save(rows))
    print(f"\nUpserted {len(rows)} rows into satellite_metrics.")


if __name__ == "__main__":
    main()
