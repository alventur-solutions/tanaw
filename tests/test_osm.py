"""Tiling, the Overpass query, parsing, crossings, and per-area counts. No network."""

import json

import geopandas as gpd
import pytest
from shapely.geometry import Point, box

from pipeline import osm


def _way(osm_id: int, coords: list[tuple[float, float]], **tags: str) -> dict:
    return {"osm_id": osm_id, "tags": tags, "coords": coords}


def _element(way: dict) -> dict:
    return {
        "type": "way",
        "id": way["osm_id"],
        "tags": way["tags"],
        "geometry": [{"lon": x, "lat": y} for x, y in way["coords"]],
    }


def test_tiles_cover_the_union_and_skip_empty_tiles() -> None:
    # Two small areas far apart: the tiles between them (open sea) are skipped.
    union = box(120.1, 10.1, 120.3, 10.3).union(box(123.1, 10.1, 123.3, 10.3))
    tiles = osm.plan_tiles(union)
    assert tiles == [(120.0, 10.0, 120.5, 10.5), (123.0, 10.0, 123.5, 10.5)]
    assert box(*tiles[0]).union(box(*tiles[1])).contains(union)


def test_tiles_of_an_l_shape_skip_the_empty_corner() -> None:
    union = box(0.1, 0.1, 1.4, 0.4).union(box(0.1, 0.1, 0.4, 1.4))
    tiles = osm.plan_tiles(union)
    assert (1.0, 1.0, 1.5, 1.5) not in tiles
    assert len(tiles) == 5


def test_split_tile_is_four_quarters() -> None:
    quarters = osm.split_tile((0.0, 0.0, 1.0, 1.0))
    assert len(quarters) == 4
    assert box(*quarters[0]).union(box(*quarters[3])).area == 0.5
    assert all((q[2] - q[0]) == 0.5 for q in quarters)


def test_plan_adds_road_tiles_only_where_an_urban_area_is() -> None:
    areas = gpd.GeoDataFrame(
        {
            "area_id": ["city", "basin"],
            "study_type": ["urban", "river_basin"],
            "zone": [None, None],
        },
        geometry=[box(120.1, 10.1, 120.3, 10.3), box(123.1, 10.1, 123.3, 10.3)],
        crs="EPSG:4326",
    )
    jobs = osm.plan(areas)
    assert [j for j in jobs if j[0] == "b"] == [("b", (120.0, 10.0, 120.5, 10.5))]
    assert len([j for j in jobs if j[0] == "a"]) == 2


def test_query_a_asks_for_waterways_and_bridges() -> None:
    query = osm.build_query("a", (120.0, 10.0, 120.5, 10.5))
    assert "[out:json]" in query and "out geom;" in query
    assert 'way["waterway"~"^(river|canal|stream)$"](10.0,120.0,10.5,120.5);' in query
    assert 'way["highway"]["bridge"]["bridge"!="no"](10.0,120.0,10.5,120.5);' in query


def test_query_b_asks_for_road_classes_with_link_forms() -> None:
    query = osm.build_query("b", (120.0, 10.0, 120.5, 10.5))
    for name in ("motorway", "trunk_link", "primary", "secondary_link", "tertiary", "residential"):
        assert name in query
    assert "unclassified" in query and "waterway" not in query
    with pytest.raises(ValueError):
        osm.build_query("c", (0, 0, 1, 1))


CANNED = {
    "elements": [
        {
            "type": "way",
            "id": 11,
            "tags": {"waterway": "river", "name": "Marikina River"},
            "geometry": [{"lat": 14.60, "lon": 121.00}, {"lat": 14.61, "lon": 121.00}],
        },
        {"type": "way", "id": 12, "geometry": [{"lat": 14.6, "lon": 121.0}]},
        {"type": "node", "id": 13, "lat": 14.6, "lon": 121.0},
    ]
}


def test_parse_ways_keeps_lines_with_lon_lat_order() -> None:
    assert osm.parse_ways(CANNED) == [
        {
            "osm_id": 11,
            "tags": {"waterway": "river", "name": "Marikina River"},
            "coords": [(121.0, 14.60), (121.0, 14.61)],
        }
    ]


RIVER = _way(1, [(121.0, 14.0), (121.0, 14.2)], waterway="river", name="Marikina River")
BRIDGE = _way(
    2, [(120.99, 14.1), (121.01, 14.1)], highway="primary", bridge="yes", name="Main Bridge"
)


def test_a_bridge_over_a_river_gives_one_point() -> None:
    groups = osm.classify([RIVER, BRIDGE])
    rows = osm.compute_crossings(groups["bridges"], groups["waterways"])
    assert len(rows) == 1
    row = rows[0]
    assert (row["bridge_osm_id"], row["waterway_osm_id"]) == (2, 1)
    assert (row["road_name"], row["highway"]) == ("Main Bridge", "primary")
    assert (row["waterway"], row["waterway_name"]) == ("river", "Marikina River")
    assert row["geometry"].equals_exact(Point(121.0, 14.1), 1e-9)


def test_a_bridge_that_touches_no_waterway_gives_none() -> None:
    far = _way(3, [(121.5, 14.1), (121.6, 14.1)], highway="primary", bridge="yes")
    groups = osm.classify([RIVER, far])
    assert osm.compute_crossings(groups["bridges"], groups["waterways"]) == []


def test_culverts_and_tunnels_are_skipped() -> None:
    culvert = _way(4, [(121.0, 14.0), (121.0, 14.2)], waterway="stream", tunnel="culvert")
    tunnel = _way(5, [(121.0, 14.0), (121.0, 14.2)], waterway="canal", tunnel="yes")
    groups = osm.classify([culvert, tunnel, BRIDGE])
    assert groups["waterways"] == {}
    assert osm.compute_crossings(groups["bridges"], groups["waterways"]) == []


def test_bridge_no_is_not_a_bridge() -> None:
    road = _way(6, [(120.99, 14.1), (121.01, 14.1)], highway="primary", bridge="no")
    assert osm.classify([road])["bridges"] == {}


def test_a_way_seen_in_two_tiles_is_counted_once(tmp_path) -> None:
    tile_dir = tmp_path / "tiles"
    tile_dir.mkdir()
    response = {"elements": [_element(RIVER), _element(BRIDGE)]}
    for name in ("a_1.json", "a_2.json"):
        (tile_dir / name).write_text(json.dumps(response))
    fetcher = osm.Fetcher(tile_dir=tile_dir, manifest_path=tmp_path / "m.json")
    ways = osm.read_ways(fetcher)
    assert len(ways) == 2
    groups = osm.classify(ways)
    assert len(osm.compute_crossings(groups["bridges"], groups["waterways"])) == 1


def test_counts_per_area_with_overlapping_areas_are_not_additive() -> None:
    areas = gpd.GeoDataFrame(
        {"area_id": ["big", "small"]},
        geometry=[box(0, 0, 10, 10), box(0, 0, 2, 2)],
        crs="EPSG:4326",
    )
    crossings = gpd.GeoDataFrame(
        {"waterway": ["river", "stream", "river"]},
        geometry=[Point(1, 1), Point(1.5, 1.5), Point(8, 8)],
        crs="EPSG:4326",
    )
    assert osm.count_by_area(crossings, areas) == {"big": 3, "small": 2}
    only_rivers = osm.count_by_area(crossings, areas, lambda f: f["waterway"] == "river")
    assert only_rivers == {"big": 2, "small": 1}
    assert sum(osm.count_by_area(crossings, areas).values()) > len(crossings)


def test_waterways_outside_the_study_areas_are_dropped() -> None:
    outside = _way(7, [(130.0, 5.0), (130.0, 5.1)], waterway="river")
    groups = osm.classify([RIVER, outside, BRIDGE])
    frames = osm.frames_from(groups, box(120.5, 13.9, 121.5, 14.3), None)
    assert list(frames["waterways"]["osm_id"]) == [1]
    assert len(frames["crossings"]) == 1 and len(frames["roads"]) == 0


class _Script:
    """A fake Overpass: replies from a list, recording the endpoints called."""

    def __init__(self, replies: list) -> None:
        self.replies = list(replies)
        self.calls: list[str] = []

    def __call__(self, endpoint: str, query: str) -> dict:
        self.calls.append(endpoint)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def _fetcher(tmp_path, script) -> osm.Fetcher:
    return osm.Fetcher(
        send=script,
        tile_dir=tmp_path / "tiles",
        manifest_path=tmp_path / "manifest.json",
        pause=0,
        sleep=lambda _: None,
    )


def test_fetch_caches_and_resumes(tmp_path) -> None:
    tile = (120.0, 10.0, 120.5, 10.5)
    first = _fetcher(tmp_path, _Script([{"elements": []}]))
    first.run([("a", tile)])
    assert osm.missing_tiles(first) == []
    again = _fetcher(tmp_path, _Script([]))  # no replies: a request would fail
    again.run([("a", tile)])
    assert again.requests == 0


def test_repeated_timeout_splits_the_tile_in_four(tmp_path) -> None:
    tile = (120.0, 10.0, 121.0, 11.0)
    replies = [osm.Timeout("t"), osm.Timeout("t"), *[{"elements": []}] * 4]
    fetcher = _fetcher(tmp_path, _Script(replies))
    fetcher.run([("a", tile)])
    assert osm.missing_tiles(fetcher) == []
    assert len(list((tmp_path / "tiles").glob("*.json"))) == 4


def test_a_refusing_server_leaves_the_tile_missing(tmp_path) -> None:
    tile = (120.0, 10.0, 120.5, 10.5)
    script = _Script([osm.Unreachable("tls")] * 3)
    fetcher = _fetcher(tmp_path, script)
    fetcher.run([("a", tile)])
    assert osm.missing_tiles(fetcher) == [osm.tile_key("a", tile)]
    assert len(set(script.calls)) == 2  # tried each endpoint
