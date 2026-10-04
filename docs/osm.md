# OpenStreetMap base data

TANAW mounts a river station on a bridge and a street station on a pole over a road. To say where a station could go, the database holds mapped waterways, bridges that cross them, and roads in urban study areas.

## Source and license

- Source: OpenStreetMap, read through the Overpass API (`overpass-api.de`, then `overpass.kumi.systems` as a fallback).
- License: Open Database License (ODbL).
- Attribution that must appear wherever the data is shown: **Map data from OpenStreetMap contributors, ODbL**
- The API returns this line in `attribution` and the date of the download in `fetched_on`. The raw responses stay untouched under `data/raw/osm/tiles/`.

## What is loaded

| Table | Content |
|---|---|
| `osm_waterways` | Ways tagged waterway river, canal, or stream that touch a study area. Tunnels and culverts are left out. |
| `osm_crossings` | One row per pair of a bridge way (a highway with a bridge tag other than "no") and a waterway way that intersect. The point is the centroid of the intersection. |
| `osm_roads` | Motorway to residential roads (and their link forms) inside urban study areas only. |
| `osm_meta` | One row: fetch date, attribution, and row counts. |

Every study area is covered, not a demo subset. Areas overlap, so a count for one area must never be added to a count for another.

## What a crossing means

A crossing is a place a station could be mounted. It is not a recommendation. Whether a site is suitable depends on access, power, signal, and the view of the water, which are not in this data.

## Limits

- OpenStreetMap is volunteer mapped. It is less complete in rural areas, so a place with no mapped crossing may still have a bridge.
- Waterway names are often missing, especially for streams. Streams are numerous, so the API returns river and canal crossings by default and adds streams with `?waterway=stream`.
- A bridge road without a bridge tag, or a river that is not mapped, produces no crossing.
- Road data is loaded for urban study areas only.

## Commands, in order

1. `python -m pipeline.osm fetch` downloads tiles of about 0.5 degrees that touch a study area, one request at a time with a pause. It can be run again to resume. A tile that times out is split in four.
2. `python -m pipeline.osm build` writes `data/osm/osm_waterways.parquet`, `osm_crossings.parquet`, `osm_roads.parquet`, and `meta.json`, and prints counts per area. It refuses to run when a tile is missing.
3. `python -m pipeline.osm load` replaces the `osm_*` tables in one transaction. Run `alembic upgrade head` first (revision 0008). It refuses an incomplete fetch.

Read the result with `GET /areas/{area_id}/crossings`. The response says `loaded: false` until step 3 has run.
