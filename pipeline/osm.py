"""OpenStreetMap base data: waterways, bridge crossings over waterways, and urban roads.

Usage: python -m pipeline.osm fetch|build|load

fetch  asks the Overpass API for every tile that touches a study area and caches each raw
       response under data/raw/osm/tiles/. A rerun resumes from the cache.
build  reads the cache and writes three GeoParquet files to data/osm/ (osm_waterways,
       osm_crossings, osm_roads) and data/osm/meta.json. It refuses an incomplete fetch.
load   replaces the contents of the osm_* tables in one transaction (asyncpg COPY).

Map data from OpenStreetMap contributors, ODbL. Study areas overlap, so a count per area must
never be added across areas.
"""

import argparse
import asyncio
import json
import math
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from datetime import date
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
import shapely
from shapely.geometry import LineString, Point, box
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).resolve().parents[1]
AREAS_DIR = ROOT / "pipeline" / "areas"
RAW_DIR = ROOT / "data" / "raw" / "osm"
TILE_DIR = RAW_DIR / "tiles"
MANIFEST = RAW_DIR / "manifest.json"
OUT_DIR = ROOT / "data" / "osm"
META = OUT_DIR / "meta.json"

ATTRIBUTION = "Map data from OpenStreetMap contributors, ODbL"
USER_AGENT = "TANAW-research/0.1 (flood monitoring study areas; johncurada.02@gmail.com)"
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
TILE_DEG = 0.5
MIN_TILE_DEG = 0.0625  # a tile is not split below this size
PAUSE_SECONDS = 2.0
QUERY_TIMEOUT = 180
SOCKET_TIMEOUT = 240

WATERWAYS = ("river", "canal", "stream")
ROAD_CLASSES = tuple(
    f"{c}{suffix}"
    for c in ("motorway", "trunk", "primary", "secondary", "tertiary")
    for suffix in ("", "_link")
) + ("unclassified", "residential")
WATERWAY_FILES = {
    "waterways": "osm_waterways.parquet",
    "crossings": "osm_crossings.parquet",
    "roads": "osm_roads.parquet",
}

Bbox = tuple[float, float, float, float]  # west, south, east, north


# ---------------------------------------------------------------- areas and tiles


def load_areas(areas_dir: Path = AREAS_DIR) -> gpd.GeoDataFrame:
    """Every area and zone from the GeoJSON files, in EPSG:4326."""
    frames = [gpd.read_file(p) for p in sorted(areas_dir.glob("*.geojson"))]
    areas = gpd.GeoDataFrame(
        pd.concat(frames, ignore_index=True), geometry="geometry", crs="EPSG:4326"
    )
    return areas


def top_level(areas: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return areas[areas["zone"].isna()].reset_index(drop=True)


def union_of(areas: gpd.GeoDataFrame) -> BaseGeometry:
    return shapely.union_all(list(areas.geometry))


def plan_tiles(union: BaseGeometry, size: float = TILE_DEG) -> list[Bbox]:
    """Grid tiles of `size` degrees, aligned to multiples of size, that touch the union."""
    west, south, east, north = union.bounds
    shapely.prepare(union)
    tiles: list[Bbox] = []
    j0, j1 = math.floor(south / size), math.ceil(north / size)
    i0, i1 = math.floor(west / size), math.ceil(east / size)
    for j in range(j0, j1):
        for i in range(i0, i1):
            tile = (i * size, j * size, (i + 1) * size, (j + 1) * size)
            if shapely.intersects(box(*tile), union):
                tiles.append(tuple(round(v, 6) for v in tile))  # type: ignore[arg-type]
    return tiles


def split_tile(tile: Bbox) -> list[Bbox]:
    w, s, e, n = tile
    mx, my = (w + e) / 2, (s + n) / 2
    return [(w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)]


def plan(areas: gpd.GeoDataFrame, size: float = TILE_DEG) -> list[tuple[str, Bbox]]:
    """(kind, bbox) pairs. Kind a: every tile. Kind b: tiles touching an urban area."""
    tiles = plan_tiles(union_of(top_level(areas)), size)
    jobs = [("a", t) for t in tiles]
    urban = areas[(areas["study_type"] == "urban") & areas["zone"].isna()]
    if len(urban):
        urban_union = union_of(urban)
        jobs += [("b", t) for t in tiles if shapely.intersects(box(*t), urban_union)]
    return jobs


# ---------------------------------------------------------------- Overpass queries


def _bbox_text(tile: Bbox) -> str:
    w, s, e, n = tile
    return f"{s},{w},{n},{e}"


def build_query(kind: str, tile: Bbox, timeout: int = QUERY_TIMEOUT) -> str:
    """Overpass QL for one tile. Kind a: waterways and bridges. Kind b: urban roads."""
    box_text = _bbox_text(tile)
    if kind == "a":
        body = (
            f'way["waterway"~"^({"|".join(WATERWAYS)})$"]({box_text});\n'
            f'  way["highway"]["bridge"]["bridge"!="no"]({box_text});'
        )
    elif kind == "b":
        body = f'way["highway"~"^({"|".join(ROAD_CLASSES)})$"]({box_text});'
    else:
        raise ValueError(f"unknown query kind: {kind}")
    return f"[out:json][timeout:{timeout}];\n(\n  {body}\n);\nout geom;"


def tile_key(kind: str, tile: Bbox) -> str:
    w, s, e, n = tile
    return f"{kind}_{w:.4f}_{s:.4f}_{e:.4f}_{n:.4f}"


# ---------------------------------------------------------------- parsing


def parse_ways(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Ways from an Overpass JSON response: id, tags, and coordinates as (lon, lat)."""
    ways = []
    for element in response.get("elements", []):
        if element.get("type") != "way":
            continue
        coords = [(p["lon"], p["lat"]) for p in element.get("geometry") or [] if p]
        if len(coords) < 2:
            continue
        ways.append(
            {"osm_id": int(element["id"]), "tags": element.get("tags") or {}, "coords": coords}
        )
    return ways


def is_bridge(tags: dict[str, str]) -> bool:
    return "highway" in tags and tags.get("bridge") not in (None, "no")


def is_underground_waterway(tags: dict[str, str]) -> bool:
    """A tunnel or culvert: the water is not under a bridge there."""
    return tags.get("tunnel", "no") != "no"


def classify(ways: Iterable[dict[str, Any]]) -> dict[str, dict[int, dict[str, Any]]]:
    """Group unique ways (by OSM id) into waterways, bridges, and roads."""
    groups: dict[str, dict[int, dict[str, Any]]] = {"waterways": {}, "bridges": {}, "roads": {}}
    for way in ways:
        tags = way["tags"]
        if tags.get("waterway") in WATERWAYS and not is_underground_waterway(tags):
            groups["waterways"][way["osm_id"]] = way
        if is_bridge(tags):
            groups["bridges"][way["osm_id"]] = way
        if tags.get("highway") in ROAD_CLASSES:
            groups["roads"][way["osm_id"]] = way
    return groups


def _lines(ways: dict[int, dict[str, Any]]) -> tuple[list[int], list[LineString]]:
    ids = list(ways)
    return ids, [LineString(ways[i]["coords"]) for i in ids]


def compute_crossings(
    bridges: dict[int, dict[str, Any]], waterways: dict[int, dict[str, Any]]
) -> list[dict[str, Any]]:
    """One row per (bridge way, waterway way) pair that intersect.

    The point is the centroid of the intersection. Ways are unique by OSM id, so a way seen in
    two tiles is counted once. Tunnels and culverts must be removed from waterways first.
    """
    if not bridges or not waterways:
        return []
    bridge_ids, bridge_lines = _lines(bridges)
    water_ids, water_lines = _lines(waterways)
    tree = shapely.STRtree(water_lines)
    left, right = tree.query(bridge_lines, predicate="intersects")
    rows = []
    for b, w in zip(left.tolist(), right.tolist(), strict=True):
        point = bridge_lines[b].intersection(water_lines[w]).centroid
        bridge_tags = bridges[bridge_ids[b]]["tags"]
        water_tags = waterways[water_ids[w]]["tags"]
        rows.append(
            {
                "bridge_osm_id": bridge_ids[b],
                "waterway_osm_id": water_ids[w],
                "road_name": bridge_tags.get("name"),
                "highway": bridge_tags.get("highway"),
                "waterway": water_tags.get("waterway"),
                "waterway_name": water_tags.get("name"),
                "geometry": Point(point.x, point.y),
            }
        )
    rows.sort(key=lambda r: (r["bridge_osm_id"], r["waterway_osm_id"]))
    return rows


def count_by_area(
    features: gpd.GeoDataFrame, areas: gpd.GeoDataFrame, mask: Callable | None = None
) -> dict[str, int]:
    """Features intersecting each area. Areas overlap, so a feature counts in each of them."""
    if mask is not None:
        features = features[mask(features)]
    counts = {}
    geoms = features.geometry.values
    for area_id, geometry in zip(areas["area_id"], areas.geometry, strict=True):
        shapely.prepare(geometry)
        counts[area_id] = int(shapely.intersects(geoms, geometry).sum())
    return counts


# ---------------------------------------------------------------- fetch


class Timeout(Exception):
    """The server ran out of time or memory for this query. A smaller tile may succeed."""


class Unavailable(Exception):
    """The server refused or failed. Waiting or another endpoint may help."""


class Unreachable(Unavailable):
    """The endpoint cannot be used at all (for example a TLS failure). Try the next one."""


def _ssl_context() -> ssl.SSLContext:
    """Verified TLS. certifi's bundle is used when installed, because the Windows store can
    fail to build the chain for some Overpass hosts. Verification is never turned off."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def post_query(endpoint: str, query: str) -> dict[str, Any]:
    data = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(
        endpoint, data=data, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(
            request, timeout=SOCKET_TIMEOUT, context=_ssl_context()
        ) as reply:
            body = reply.read()
    except urllib.error.HTTPError as error:
        if error.code == 504:
            raise Timeout(f"HTTP 504 from {endpoint}") from error
        raise Unavailable(f"HTTP {error.code} from {endpoint}") from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, ssl.SSLError):
            raise Unreachable(f"TLS failure from {endpoint}: {error.reason}") from error
        raise Unavailable(f"{type(error).__name__} from {endpoint}: {error}") from error
    except (ConnectionError, TimeoutError) as error:
        raise Unavailable(f"{type(error).__name__} from {endpoint}: {error}") from error
    try:
        response = json.loads(body)
    except json.JSONDecodeError as error:
        raise Unavailable(f"unreadable reply from {endpoint}") from error
    remark = str(response.get("remark", ""))
    if "runtime error" in remark or "out of memory" in remark:
        raise Timeout(f"{remark} ({endpoint})")
    return response


class Fetcher:
    def __init__(
        self,
        send: Callable[[str, str], dict[str, Any]] = post_query,
        tile_dir: Path = TILE_DIR,
        manifest_path: Path = MANIFEST,
        pause: float = PAUSE_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
        endpoints: list[str] | None = None,
    ) -> None:
        self.send = send
        self.tile_dir = tile_dir
        self.manifest_path = manifest_path
        self.pause = pause
        self.sleep = sleep
        self.endpoints = endpoints or ENDPOINTS
        self.manifest = (
            json.loads(manifest_path.read_text()) if manifest_path.exists() else {"tiles": []}
        )
        self.requests = 0

    def save_manifest(self) -> None:
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.manifest_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.manifest, indent=1))
        tmp.replace(self.manifest_path)

    def cache_path(self, key: str) -> Path:
        return self.tile_dir / f"{key}.json"

    def request(self, kind: str, tile: Bbox) -> tuple[dict[str, Any] | None, str]:
        """One tile: try the endpoints with backoff. Returns (response, "") or (None, reason)
        where reason is "timeout" or "unavailable"."""
        query = build_query(kind, tile)
        timeouts = 0
        last = "unavailable"
        for endpoint in self.endpoints:
            for attempt in range(3):
                self.requests += 1
                try:
                    response = self.send(endpoint, query)
                    self.sleep(self.pause)
                    return response, ""
                except Timeout as error:
                    timeouts += 1
                    last = "timeout"
                    print(f"    timeout: {error}")
                    if timeouts >= 2:
                        return None, "timeout"
                    self.sleep(self.pause * 5)
                except Unreachable as error:
                    last = "unavailable"
                    print(f"    {error}; next endpoint")
                    break
                except Unavailable as error:
                    last = "unavailable"
                    wait = min(30 * 2**attempt, 240)
                    print(f"    {error}; waiting {wait}s")
                    self.sleep(wait)
        return None, last

    def started(self, kind: str, tile: Bbox) -> bool:
        """True when this tile or any tile split from it has a cached response."""
        if self.cache_path(tile_key(kind, tile)).exists():
            return True
        if (tile[2] - tile[0]) / 2 < MIN_TILE_DEG:
            return False
        return any(self.started(kind, c) for c in split_tile(tile))

    def fetch_tile(self, kind: str, tile: Bbox) -> bool:
        """Fetch one tile, splitting it in four after repeated timeouts. True when complete.

        State is read from the cache files, not the manifest: a tile that was split has cached
        children, so a rerun resumes at the right level.
        """
        key = tile_key(kind, tile)
        if self.cache_path(key).exists():
            return True
        split = any(self.started(kind, c) for c in split_tile(tile)) and (
            (tile[2] - tile[0]) / 2 >= MIN_TILE_DEG
        )
        if not split:
            print(f"  fetch {key}")
            response, reason = self.request(kind, tile)
            if response is not None:
                self.tile_dir.mkdir(parents=True, exist_ok=True)
                path = self.cache_path(key)
                path.with_suffix(".tmp").write_text(json.dumps(response))
                path.with_suffix(".tmp").replace(path)
                return True
            if reason == "timeout" and (tile[2] - tile[0]) / 2 >= MIN_TILE_DEG:
                print(f"  split {key} into four")
            else:
                print(f"  FAILED {key}: {reason}")
                return False
        return all([self.fetch_tile(kind, c) for c in split_tile(tile)])

    def run(self, jobs: list[tuple[str, Bbox]], reverse: bool = False) -> None:
        self.manifest["tiles"] = [[kind, list(tile)] for kind, tile in jobs]
        self.save_manifest()
        order = list(enumerate(jobs, 1))
        for number, (kind, tile) in reversed(order) if reverse else order:
            print(f"[{number}/{len(jobs)}] {kind} {tile}")
            self.fetch_tile(kind, tile)

    def leaves(self, kind: str, tile: Bbox) -> list[tuple[str, Bbox]]:
        """The cache files that make up one planned tile. A file that is not there is missing."""
        key = tile_key(kind, tile)
        if self.cache_path(key).exists():
            return [(key, tile)]
        if (tile[2] - tile[0]) / 2 < MIN_TILE_DEG or not self.started(kind, tile):
            return [(key, tile)]
        return [leaf for c in split_tile(tile) for leaf in self.leaves(kind, c)]


def missing_tiles(fetcher: Fetcher) -> list[str]:
    """Keys of planned tiles with no cached response (empty when the fetch is complete)."""
    if not fetcher.manifest["tiles"]:
        return ["no fetch plan: run fetch first"]
    missing = []
    for kind, tile in fetcher.manifest["tiles"]:
        for key, _ in fetcher.leaves(kind, tuple(tile)):
            if not fetcher.cache_path(key).exists():
                missing.append(key)
    return missing


def fetch(pause: float = PAUSE_SECONDS, reverse: bool = False) -> int:
    areas = load_areas()
    jobs = plan(areas)
    fetcher = Fetcher(pause=pause)
    started = time.time()
    print(f"{len(jobs)} planned tiles ({sum(k == 'b' for k, _ in jobs)} road tiles)")
    fetcher.run(jobs, reverse)
    missing = missing_tiles(fetcher)
    cached = len(list(TILE_DIR.glob("*.json")))
    print(f"{fetcher.requests} requests, {cached} cache files, {time.time() - started:.0f}s")
    if missing:
        print(f"INCOMPLETE: {len(missing)} tiles missing. Run fetch again to resume.")
        for key in missing:
            print(f"  missing {key}")
        return 1
    print("fetch complete")
    return 0


# ---------------------------------------------------------------- build


def read_ways(fetcher: Fetcher) -> list[dict[str, Any]]:
    ways: dict[int, dict[str, Any]] = {}
    for path in sorted(fetcher.tile_dir.glob("*.json")):
        for way in parse_ways(json.loads(path.read_text())):
            ways[way["osm_id"]] = way
    return list(ways.values())


def frames_from(
    groups: dict[str, dict[int, dict[str, Any]]], union: BaseGeometry, urban: BaseGeometry | None
) -> dict[str, gpd.GeoDataFrame]:
    """The three output tables, clipped by selection to the study areas."""
    shapely.prepare(union)
    ids, lines = _lines(groups["waterways"])
    keep = shapely.intersects(lines, union)
    water_rows = [
        {
            "osm_id": ids[i],
            "waterway": groups["waterways"][ids[i]]["tags"]["waterway"],
            "name": groups["waterways"][ids[i]]["tags"].get("name"),
            "geometry": lines[i],
        }
        for i in range(len(ids))
        if keep[i]
    ]
    waterways = gpd.GeoDataFrame(
        water_rows,
        columns=["osm_id", "waterway", "name", "geometry"],
        geometry="geometry",
        crs="EPSG:4326",
    )
    kept = {r["osm_id"]: groups["waterways"][r["osm_id"]] for r in water_rows}
    crossing_rows = compute_crossings(groups["bridges"], kept)
    crossings = gpd.GeoDataFrame(
        crossing_rows,
        columns=[
            "bridge_osm_id",
            "waterway_osm_id",
            "road_name",
            "highway",
            "waterway",
            "waterway_name",
            "geometry",
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )
    if len(crossings):
        crossings = crossings[shapely.intersects(crossings.geometry.values, union)]
    road_rows = []
    if urban is not None:
        shapely.prepare(urban)
        rid, rlines = _lines(groups["roads"])
        rkeep = shapely.intersects(rlines, urban)
        road_rows = [
            {
                "osm_id": rid[i],
                "highway": groups["roads"][rid[i]]["tags"]["highway"],
                "name": groups["roads"][rid[i]]["tags"].get("name"),
                "geometry": rlines[i],
            }
            for i in range(len(rid))
            if rkeep[i]
        ]
    roads = gpd.GeoDataFrame(
        road_rows,
        columns=["osm_id", "highway", "name", "geometry"],
        geometry="geometry",
        crs="EPSG:4326",
    )
    return {"waterways": waterways, "crossings": crossings.reset_index(drop=True), "roads": roads}


def build() -> int:
    fetcher = Fetcher()
    missing = missing_tiles(fetcher)
    if missing:
        print(f"Refusing to build: {len(missing)} tiles missing, the fetch is incomplete.")
        for key in missing[:20]:
            print(f"  missing {key}")
        return 1
    areas = load_areas()
    tops = top_level(areas)
    urban_areas = tops[tops["study_type"] == "urban"]
    urban = union_of(urban_areas) if len(urban_areas) else None
    groups = classify(read_ways(fetcher))
    frames = frames_from(groups, union_of(tops), urban)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, frame in frames.items():
        frame.to_parquet(OUT_DIR / WATERWAY_FILES[name])
    fetched = sorted(
        date.fromtimestamp(p.stat().st_mtime).isoformat() for p in fetcher.tile_dir.glob("*.json")
    )
    meta = {
        "fetched_on": fetched[0] if fetched else date.today().isoformat(),
        "fetched_last": fetched[-1] if fetched else None,
        "attribution": ATTRIBUTION,
        "complete": True,
        "counts": {name: len(frame) for name, frame in frames.items()},
    }
    META.write_text(json.dumps(meta, indent=1))
    report(frames, tops)
    return 0


def report(frames: dict[str, gpd.GeoDataFrame], tops: gpd.GeoDataFrame) -> None:
    water, crossings, roads = frames["waterways"], frames["crossings"], frames["roads"]
    print("waterways by class:", water["waterway"].value_counts().to_dict())
    print("crossings by waterway class:", crossings["waterway"].value_counts().to_dict())
    print("urban roads:", len(roads))
    print("Per top-level area. Areas overlap, so do not add these across areas.")
    main = lambda f: f["waterway"].isin(["river", "canal"])  # noqa: E731
    w_all = count_by_area(water, tops)
    w_main = count_by_area(water, tops, main)
    c_all = count_by_area(crossings, tops)
    c_main = count_by_area(crossings, tops, main)
    r_all = count_by_area(roads, tops)
    print(
        f"{'area':32}{'waterways':>10}{'riv+canal':>10}{'crossings':>10}{'riv+canal':>10}{'roads':>8}"
    )
    for area_id in tops["area_id"]:
        print(
            f"{area_id:32}{w_all[area_id]:>10}{w_main[area_id]:>10}"
            f"{c_all[area_id]:>10}{c_main[area_id]:>10}{r_all[area_id]:>8}"
        )


# ---------------------------------------------------------------- load

CREATE_WATERWAYS_STAGING = (
    "CREATE TEMP TABLE osm_waterways_staging (osm_id bigint, waterway text, name text, wkt text) "
    "ON COMMIT DROP"
)
CREATE_CROSSINGS_STAGING = (
    "CREATE TEMP TABLE osm_crossings_staging (bridge_osm_id bigint, waterway_osm_id bigint, "
    "road_name text, highway text, waterway text, waterway_name text, wkt text) ON COMMIT DROP"
)
CREATE_ROADS_STAGING = (
    "CREATE TEMP TABLE osm_roads_staging (osm_id bigint, highway text, name text, wkt text) "
    "ON COMMIT DROP"
)
INSERT_WATERWAYS = (
    "INSERT INTO osm_waterways (osm_id, waterway, name, geom) "
    "SELECT osm_id, waterway, name, ST_SetSRID(ST_GeomFromText(wkt), 4326) "
    "FROM osm_waterways_staging"
)
INSERT_CROSSINGS = (
    "INSERT INTO osm_crossings (bridge_osm_id, waterway_osm_id, road_name, highway, waterway, "
    "waterway_name, geom) SELECT bridge_osm_id, waterway_osm_id, road_name, highway, waterway, "
    "waterway_name, ST_SetSRID(ST_GeomFromText(wkt), 4326) FROM osm_crossings_staging"
)
INSERT_ROADS = (
    "INSERT INTO osm_roads (osm_id, highway, name, geom) "
    "SELECT osm_id, highway, name, ST_SetSRID(ST_GeomFromText(wkt), 4326) FROM osm_roads_staging"
)
INSERT_META = (
    "INSERT INTO osm_meta (id, fetched_on, attribution, waterways, crossings, roads) "
    "VALUES (1, $1, $2, $3, $4, $5)"
)


def to_records(frame: gpd.GeoDataFrame, columns: list[str]) -> list[tuple]:
    wkt = shapely.to_wkt(frame.geometry.values, rounding_precision=7)
    rows = frame[columns].astype(object).where(frame[columns].notna(), None)
    return [(*row, w) for row, w in zip(rows.itertuples(index=False, name=None), wkt, strict=True)]


async def load(frames: dict[str, gpd.GeoDataFrame], meta: dict[str, Any]) -> dict[str, int]:
    """Replace the osm_* tables in one transaction. Returns the row counts."""
    from api.db import engine

    water_cols = ["osm_id", "waterway", "name"]
    cross_cols = [
        "bridge_osm_id",
        "waterway_osm_id",
        "road_name",
        "highway",
        "waterway",
        "waterway_name",
    ]
    road_cols = ["osm_id", "highway", "name"]
    try:
        async with engine.connect() as connection:
            raw = await connection.get_raw_connection()
            pg = raw.driver_connection
            async with pg.transaction():
                await pg.execute(CREATE_WATERWAYS_STAGING)
                await pg.execute(CREATE_CROSSINGS_STAGING)
                await pg.execute(CREATE_ROADS_STAGING)
                for table, frame, cols in (
                    ("osm_waterways_staging", frames["waterways"], water_cols),
                    ("osm_crossings_staging", frames["crossings"], cross_cols),
                    ("osm_roads_staging", frames["roads"], road_cols),
                ):
                    await pg.copy_records_to_table(
                        table, records=to_records(frame, cols), columns=[*cols, "wkt"]
                    )
                for table in ("osm_meta", "osm_crossings", "osm_waterways", "osm_roads"):
                    await pg.execute(f"DELETE FROM {table}")
                await pg.execute(INSERT_WATERWAYS)
                await pg.execute(INSERT_CROSSINGS)
                await pg.execute(INSERT_ROADS)
                counts = {
                    t: await pg.fetchval(f"SELECT count(*) FROM {t}")
                    for t in ("osm_waterways", "osm_crossings", "osm_roads")
                }
                await pg.execute(
                    INSERT_META,
                    date.fromisoformat(meta["fetched_on"]),
                    meta["attribution"],
                    counts["osm_waterways"],
                    counts["osm_crossings"],
                    counts["osm_roads"],
                )
                return counts
    finally:
        await engine.dispose()


def load_command() -> int:
    if not META.exists():
        print("No data/osm/meta.json. Run fetch and build first.")
        return 1
    meta = json.loads(META.read_text())
    if not meta.get("complete"):
        print("Refusing to load: the build is marked incomplete.")
        return 1
    fetcher = Fetcher()
    missing = missing_tiles(fetcher)
    if missing:
        print(f"Refusing to load: {len(missing)} tiles are missing from the cache.")
        return 1
    frames = {name: gpd.read_parquet(OUT_DIR / file) for name, file in WATERWAY_FILES.items()}
    counts = asyncio.run(load(frames, meta))
    for table, count in counts.items():
        print(f"{table} now has {count} rows")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["fetch", "build", "load"])
    parser.add_argument(
        "--pause", type=float, default=PAUSE_SECONDS, help="seconds between requests"
    )
    parser.add_argument("--reverse", action="store_true", help="fetch tiles last to first")
    args = parser.parse_args()
    if args.command == "fetch":
        raise SystemExit(fetch(args.pause, args.reverse))
    raise SystemExit(build() if args.command == "build" else load_command())


if __name__ == "__main__":
    main()
