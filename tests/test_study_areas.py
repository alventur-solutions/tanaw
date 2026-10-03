import json

import pytest
from shapely.geometry import shape

from pipeline.study_areas import AREAS, AREAS_DIR, area_ha

FILES = {a["area_id"]: AREAS_DIR / f"{a['area_id']}.geojson" for a in AREAS}
PROPERTIES = {"area_id", "name", "study_type", "zone", "area_ha", "version"}


def load(area_id: str) -> list[dict]:
    return json.loads(FILES[area_id].read_text(encoding="utf-8"))["features"]


@pytest.mark.parametrize("area", AREAS, ids=lambda a: a["area_id"])
def test_area_file_follows_conventions(area):
    features = load(area["area_id"])
    assert features[0]["properties"]["area_id"] == area["area_id"]
    assert features[0]["properties"]["zone"] is None
    for f in features:
        props = f["properties"]
        geom = shape(f["geometry"])
        assert set(props) == PROPERTIES
        assert props["study_type"] == area["study_type"]
        assert geom.geom_type == "MultiPolygon"
        assert geom.is_valid
        assert props["area_ha"] == pytest.approx(area_ha(geom), rel=1e-3)


def test_only_the_basin_has_zones():
    for area in AREAS:
        ids = [f["properties"]["area_id"] for f in load(area["area_id"])]
        expected = [area["area_id"]]
        if area["study_type"] == "river_basin":
            expected += [f"{area['area_id']}__up", f"{area['area_id']}__down"]
        assert ids == expected


def test_basin_zones_partition_the_basin():
    whole, up, down = (shape(f["geometry"]) for f in load("pasig-marikina-tullahan"))
    assert area_ha(up) + area_ha(down) == pytest.approx(area_ha(whole), rel=1e-3)
    assert area_ha(up.intersection(down)) < 1
