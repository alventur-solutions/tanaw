"""Build, upload, and load TANAW study areas.

    python -m pipeline.study_areas build    # write pipeline/areas/<area_id>.geojson
    python -m pipeline.study_areas upload   # export each file to an Earth Engine table asset
    python -m pipeline.study_areas load     # upsert every feature into study_areas

Each GeoJSON file holds the whole area as feature 0. A river_basin file also holds
the zones `<area_id>__up` and `<area_id>__down` as features 1 and 2.
"""

import argparse
import asyncio
import json
import math
import os
import urllib.request
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).resolve().parents[1]
AREAS_DIR = ROOT / "pipeline" / "areas"
CACHE_DIR = ROOT / ".cache"

UTM_51N = 32651  # metric CRS for areas in Luzon
VERSION = 1

# Zone rule for river basins: upstream is elevation > 100 m or slope > 18 percent.
UP_ELEVATION_M = 100
UP_SLOPE_PCT = 18
ZONE_MIN_PATCH_HA = 25  # patches and holes smaller than this are merged into their surroundings

HYBAS_8 = "WWF/HydroSHEDS/v1/Basins/hybas_8"
WDPA = "WCMC/WDPA/current/polygons"
SRTM = "USGS/SRTMGL1_003"
# PSA / NAMRIA admin level 3 as republished by geoBoundaries (CC BY 3.0 IGO). 532 MB.
ADM3_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/PHL/ADM3/"
    "geoBoundaries-PHL-ADM3.geojson"
)

AREAS = [
    {
        "area_id": "pasig-marikina-tullahan",
        "name": "Pasig-Marikina-Tullahan River Basin",
        "study_type": "river_basin",
        # HydroSHEDS fallback: Marikina, lower Pasig with San Juan, Tullahan.
        "hybas_ids": [5080116340, 5080029360, 5080029370],
    },
    {
        "area_id": "antipolo-rodriguez-uplands",
        "name": "Antipolo-Rodriguez Uplands (Upper Marikina River Basin Protected Landscape)",
        "study_type": "rural_upland",
        "wdpa_site_id": 306416,
    },
    {
        "area_id": "quezon-city",
        "name": "Quezon City",
        "study_type": "urban",
        "adm3_name": "Quezon City",
        "adm3_bbox": (120.98, 14.58, 121.15, 14.78),
    },
]


def ee_project() -> str:
    project = os.environ.get("EE_PROJECT")
    if not project:
        # Not exported in the shell: fall back to .env, as the API does.
        from api.config import get_settings

        project = get_settings().ee_project
    if not project:
        raise SystemExit("EE_PROJECT is not set.")
    return project


def init_ee():
    import ee

    ee.Initialize(project=ee_project())
    return ee


# --- geometry helpers ---------------------------------------------------------


def polygons_of(geom: BaseGeometry) -> list[Polygon]:
    """Polygon parts of any geometry. Lines and points left by make_valid are dropped."""
    if geom.geom_type == "Polygon":
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in polygons_of(g)]
    return []


def clean(geom: BaseGeometry) -> MultiPolygon:
    """Valid MultiPolygon in EPSG:4326 with coordinates rounded to about 0.1 m."""
    geom = shapely.set_precision(shapely.make_valid(geom), 1e-6)
    return MultiPolygon([p for p in polygons_of(shapely.make_valid(geom)) if not p.is_empty])


def to_utm(geom: BaseGeometry) -> BaseGeometry:
    return gpd.GeoSeries([geom], crs=4326).to_crs(UTM_51N).iloc[0]


def to_wgs84(geom: BaseGeometry) -> BaseGeometry:
    return gpd.GeoSeries([geom], crs=UTM_51N).to_crs(4326).iloc[0]


def area_ha(geom: BaseGeometry) -> float:
    return round(to_utm(geom).area / 1e4, 1)


def drop_small_parts(geom: BaseGeometry, min_ha: float) -> BaseGeometry:
    """Remove polygons and fill holes smaller than min_ha. Input and output in UTM."""
    min_m2 = min_ha * 1e4
    kept = []
    for poly in polygons_of(geom):
        if poly.area < min_m2:
            continue
        holes = [ring for ring in poly.interiors if Polygon(ring).area >= min_m2]
        kept.append(Polygon(poly.exterior, holes))
    return shapely.unary_union(kept)


# --- boundary sources ---------------------------------------------------------


def basin_boundary(ee, hybas_ids: list[int]) -> BaseGeometry:
    fc = ee.FeatureCollection(HYBAS_8).filter(ee.Filter.inList("HYBAS_ID", hybas_ids))
    return shape(fc.geometry().dissolve(1).getInfo())


def upstream_mask(ee, basin: BaseGeometry) -> BaseGeometry:
    """Vectorized SRTM mask of elevation > 100 m or slope > 18 percent inside the basin."""
    dem = ee.Image(SRTM)
    slope_pct = ee.Terrain.slope(dem).multiply(math.pi / 180).tan().multiply(100)
    up = dem.gt(UP_ELEVATION_M).Or(slope_pct.gt(UP_SLOPE_PCT))
    up = up.focalMode(radius=90, units="meters").selfMask()
    vectors = up.reduceToVectors(
        geometry=ee.Geometry(mapping(basin)),
        scale=30,
        geometryType="polygon",
        eightConnected=True,
        maxPixels=1e9,
    )
    return shape(vectors.geometry().getInfo())


def protected_area_boundary(ee, site_id: int) -> BaseGeometry:
    fc = ee.FeatureCollection(WDPA).filter(ee.Filter.eq("SITE_ID", site_id))
    return shape(fc.geometry().getInfo())


def city_boundary(name: str, bbox: tuple[float, float, float, float]) -> BaseGeometry:
    path = CACHE_DIR / "geoBoundaries-PHL-ADM3.geojson"
    if not path.exists():
        CACHE_DIR.mkdir(exist_ok=True)
        print(f"Downloading PSA/NAMRIA admin level 3 boundaries to {path} (532 MB)")
        urllib.request.urlretrieve(ADM3_URL, path)
    rows = gpd.read_file(path, bbox=bbox)
    rows = rows[rows["shapeName"] == name]
    if len(rows) != 1:
        raise SystemExit(f"Expected one admin level 3 unit named {name!r}, found {len(rows)}")
    return rows.geometry.iloc[0]


# --- build ----------------------------------------------------------------------


def feature(area: dict, geom: BaseGeometry, zone: str | None = None) -> dict:
    geom = clean(geom)
    suffix = f"__{zone}" if zone else ""
    label = {"up": " (upstream)", "down": " (downstream)"}.get(zone, "")
    return {
        "type": "Feature",
        "properties": {
            "area_id": area["area_id"] + suffix,
            "name": area["name"] + label,
            "study_type": area["study_type"],
            "zone": zone,
            "area_ha": area_ha(geom),
            "version": VERSION,
        },
        "geometry": mapping(geom),
    }


def build_area(ee, area: dict) -> list[dict]:
    if area["study_type"] == "river_basin":
        whole = clean(basin_boundary(ee, area["hybas_ids"]))
        whole_utm = to_utm(whole)
        mask = to_utm(shapely.make_valid(upstream_mask(ee, whole)))
        up_utm = drop_small_parts(mask.intersection(whole_utm), ZONE_MIN_PATCH_HA)
        # Small downstream slivers and pockets go to the upstream zone.
        down_utm = drop_small_parts(whole_utm.difference(up_utm), ZONE_MIN_PATCH_HA)
        down = clean(to_wgs84(down_utm)).intersection(whole)
        up = whole.difference(down)
        return [feature(area, whole), feature(area, up, "up"), feature(area, down, "down")]
    if area["study_type"] == "rural_upland":
        return [feature(area, protected_area_boundary(ee, area["wdpa_site_id"]))]
    return [feature(area, city_boundary(area["adm3_name"], area["adm3_bbox"]))]


def build() -> None:
    ee = init_ee()
    AREAS_DIR.mkdir(parents=True, exist_ok=True)
    for area in AREAS:
        features = build_area(ee, area)
        path = AREAS_DIR / f"{area['area_id']}.geojson"
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8"
        )
        for f in features:
            props = f["properties"]
            print(f"{path.name}: {props['area_id']} {props['area_ha']:,.1f} ha")


def read_features() -> list[dict]:
    features = []
    for path in sorted(AREAS_DIR.glob("*.geojson")):
        features += json.loads(path.read_text(encoding="utf-8"))["features"]
    return features


# --- upload to Earth Engine -----------------------------------------------------


def upload() -> None:
    ee = init_ee()
    folder = f"projects/{ee_project()}/assets/areas"
    try:
        ee.data.getAsset(folder)
    except ee.EEException:
        ee.data.createAsset({"type": "FOLDER"}, folder)
    for path in sorted(AREAS_DIR.glob("*.geojson")):
        asset_id = f"{folder}/{path.stem}"
        try:
            ee.data.getAsset(asset_id)
            print(f"{asset_id} already exists, skipped. Delete it by hand to replace it.")
            continue
        except ee.EEException:
            pass
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
        fc = ee.FeatureCollection(
            [
                ee.Feature(
                    ee.Geometry(f["geometry"], geodesic=False),
                    {k: v for k, v in f["properties"].items() if v is not None},
                )
                for f in features
            ]
        )
        task = ee.batch.Export.table.toAsset(fc, description=f"area_{path.stem}", assetId=asset_id)
        task.start()
        print(f"Started export task {task.id} for {asset_id}")


# --- load into Postgres ---------------------------------------------------------

UPSERT = """
INSERT INTO study_areas (area_id, name, study_type, zone, area_ha, version, geom)
VALUES (
    :area_id, :name, :study_type, :zone, :area_ha, :version,
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))
)
ON CONFLICT (area_id) DO UPDATE SET
    name = EXCLUDED.name,
    study_type = EXCLUDED.study_type,
    zone = EXCLUDED.zone,
    area_ha = EXCLUDED.area_ha,
    version = EXCLUDED.version,
    geom = EXCLUDED.geom
"""


async def load() -> None:
    from sqlalchemy import text

    from api.db import SessionLocal, engine

    rows = [{**f["properties"], "geom": json.dumps(f["geometry"])} for f in read_features()]
    async with SessionLocal() as session:
        for row in rows:
            await session.execute(text(UPSERT), row)
        await session.commit()
        result = await session.execute(
            text(
                "SELECT area_id, study_type, zone, area_ha, version, ST_IsValid(geom), "
                "round((ST_Area(geom::geography) / 10000)::numeric, 1) "
                "FROM study_areas ORDER BY area_id"
            )
        )
        for row in result:
            print(tuple(row))
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["build", "upload", "load"])
    command = parser.parse_args().command
    if command == "build":
        build()
    elif command == "upload":
        upload()
    else:
        asyncio.run(load())


if __name__ == "__main__":
    main()
