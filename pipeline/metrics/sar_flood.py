"""Shared Sentinel-1 flood handling for flood_extent and flood_ha_per_mm.

Method (follows .claude/skills/flood-extent-sar, with the choices below made explicit)

Scenes
    COPERNICUS/S1_GRD, instrumentMode IW, VV only, already in dB. One orbit direction per
    study area, fixed for every year: the direction with more images over the area in
    2017 to 2024 (ties go to DESCENDING). Relative orbits are not separated, so incidence
    angle differs between scenes of one direction. Images of the same UTC day are mosaicked,
    so one "scene" below is one acquisition day.
    A speckle filter (focal median, 50 m radius) is applied to every image.

Flood pixel
    Change detection against a dry baseline, not a threshold alone. The baseline is the
    median of the filtered Jan 1 to Apr 30 images of the same year and the same direction.
    A pixel of a wet season scene (Jun 1 to Nov 30) is flooded when VV < -16 dB and
    (baseline - scene) > 3 dB. Both conditions must hold.

Exclusions
    Permanent water: JRC/GSW1_4/GlobalSurfaceWater occurrence > 80 percent is removed.
    Steep terrain: SRTM slope > 5 degrees is removed (radar shadow and layover look like
    open water). An area where more than half of the land is steeper than that gets the
    steep_terrain flag, because most of it cannot be assessed.

Area types
    Sentinel-1 VV does not see water between buildings well (double bounce raises the
    return, shadow lowers it). Every urban area is flagged urban_unreliable. The number is
    still returned, as a lower bound of open water, not as a count of flooded streets.

Yearly value
    flood_extent: the largest flooded area of any single acquisition day in the wet season
    (not a union over the season, so the value is one event, not the sum of events).
    flood_ha_per_mm: for every acquisition day with at least MIN_EVENT_RAIN_MM of rain in
    the 3 days before it, flooded hectares divided by that rain. The yearly value is the
    median over those days. Rain is the CHIRPS area mean (pipeline.metrics.chirps).

Footprint
    One acquisition rarely covers a large basin. Flooded hectares are counted only inside
    the footprint of that day, so a value is a lower bound where the footprint is partial.
    Days covering less than MIN_DAY_COVERAGE of the area are not used. The row carries
    partial_footprint when the day that sets the value covers less than PARTIAL_COVERAGE.
    Scenes of a zone and of its whole area are chosen separately, so the rows of
    `<area_id>__up`, `<area_id>__down` and `<area_id>` do not add up. Never add them.

Scale
    10 m for areas of 100,000 ha or less, 30 m for larger areas (a 10 m reduction over a
    basin of millions of hectares does not fit in Earth Engine memory). The two scales are
    not exactly comparable, so compare an area with itself over the years first.

Quality flags (the first condition that holds is used)
    no_data              year before 2015 or after LAST_YEAR, or no usable VV images
                         (none in the baseline window, none in the wet season, or no day
                         with enough footprint). Value is empty.
    no_rain_events       flood_ha_per_mm only: scenes exist but none had MIN_EVENT_RAIN_MM
                         of rain in the 3 days before. Value is empty.
    urban_unreliable     study_type urban. Value is a lower bound.
    steep_terrain        more than half of the land is steeper than 5 degrees.
    partial_year         the wet season is not over, or Sentinel-1 data may not be in yet.
    sparse_acquisitions  fewer than MIN_SCENES usable days, or fewer than MIN_BASELINE
                         baseline images. The maximum or median rests on few dates.
    partial_footprint    the day that sets the value covers less than half of the area.
    ok                   none of the above.

Flood data starts in 2015, so flood trends begin there. No Sentinel-1 value exists before.
"""

import json
from collections.abc import Callable
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import ee

from pipeline.metrics import chirps

S1_DATASET = "COPERNICUS/S1_GRD"
GSW_DATASET = "JRC/GSW1_4/GlobalSurfaceWater"
SRTM_DATASET = "USGS/SRTMGL1_003"
FIRST_YEAR = 2015
LAST_YEAR = 2026  # the current year is allowed and is flagged partial_year until the season ends

AREAS_DIR = Path(__file__).resolve().parents[1] / "areas"

# Method constants.
BAND = "VV"
SPECKLE_RADIUS_M = 50
FLOOD_MAX_DB = -16.0
FLOOD_DROP_DB = 3.0
PERMANENT_WATER_PCT = 80
MAX_SLOPE_DEG = 5
STEEP_FRACTION = 0.5
BASELINE_START = (1, 1)
BASELINE_END = (4, 30)  # inclusive
RAIN_DAYS = 3
MIN_EVENT_RAIN_MM = 10.0
ORBIT_REFERENCE_YEARS = ("2017-01-01", "2025-01-01")  # end exclusive
DEFAULT_ORBIT = "DESCENDING"

# Acquisition thresholds.
MIN_DAY_COVERAGE = 0.10
PARTIAL_COVERAGE = 0.50
MIN_SCENES = 6
MIN_BASELINE = 3
INGEST_LAG_DAYS = 3

# Reduction settings.
SCALE_FINE_M = 10
SCALE_COARSE_M = 30
FINE_SCALE_MAX_HA = 100_000
TILE_SCALE = 8
MAX_PIXELS = 1e13

FLAGS = (
    "ok",
    "no_data",
    "no_rain_events",
    "urban_unreliable",
    "steep_terrain",
    "partial_year",
    "sparse_acquisitions",
    "partial_footprint",
)


# --- pure helpers (no Earth Engine) -------------------------------------------


def baseline_window(year: int) -> tuple[date, date]:
    return date(year, *BASELINE_START), date(year, *BASELINE_END)


def is_partial_year(year: int, today: date | None = None) -> bool:
    """True while the wet season is running or its last scenes may not be ingested yet."""
    today = today or date.today()
    wet_end = chirps.wet_season_window(year)[1]
    return today <= wet_end + timedelta(days=INGEST_LAG_DAYS)


def row_properties(area_id, year: int, metric: str, value, quality_flag) -> dict:
    """The row for one area and year. A missing value stays None, never 0."""
    return {
        "area_id": area_id,
        "year": year,
        "metric": metric,
        "value": value,
        "quality_flag": quality_flag,
    }


def ha_per_mm(flood_ha: float | None, rain_mm: float | None) -> float | None:
    """Flooded hectares per mm of rain, or None when rain is missing or below the minimum."""
    if flood_ha is None or rain_mm is None or rain_mm < MIN_EVENT_RAIN_MM:
        return None
    return flood_ha / rain_mm


def first_match(pairs: list[tuple], default: str, iff: Callable | None = None):
    """The flag of the first (condition, flag) pair whose condition holds, else default.

    `iff(condition, if_true, if_false)` defaults to ee.Algorithms.If so that the same
    priority list runs on server side conditions. Tests pass a plain Python version.
    """
    iff = iff or ee.Algorithms.If
    result = default
    for condition, flag in reversed(pairs):
        result = iff(condition, flag, result)
    return result


def flag_pairs(
    *,
    no_scenes,
    no_value,
    urban,
    steep,
    partial_year,
    n_scenes,
    n_baseline,
    best_coverage,
    lt=lambda a, b: a < b,
) -> list[tuple]:
    """Priority list for first_match. Order is the documented flag priority.

    `no_scenes` marks no_data, `no_value` marks no_rain_events (scenes but no value).
    """
    return [
        (no_scenes, "no_data"),
        (no_value, "no_rain_events"),
        (urban, "urban_unreliable"),
        (steep, "steep_terrain"),
        (partial_year, "partial_year"),
        (lt(n_scenes, MIN_SCENES), "sparse_acquisitions"),
        (lt(n_baseline, MIN_BASELINE), "sparse_acquisitions"),
        (lt(best_coverage, PARTIAL_COVERAGE), "partial_footprint"),
    ]


@lru_cache(maxsize=1)
def area_types() -> dict[str, str]:
    """area_id to study_type, read from the GeoJSON files (zones carry their parent's type)."""
    types = {}
    for path in sorted(AREAS_DIR.glob("*.geojson")):
        for feature in json.loads(path.read_text(encoding="utf-8"))["features"]:
            props = feature["properties"]
            types[props["area_id"]] = props["study_type"]
    return types


# --- Earth Engine ---------------------------------------------------------------


def s1_collection(geometry: ee.Geometry, direction, start, end) -> ee.ImageCollection:
    """Filtered VV images of one direction. `start` is a date, `end` an ee.Date (exclusive)."""
    return (
        ee.ImageCollection(S1_DATASET)
        .filterBounds(geometry)
        .filterDate(start.isoformat(), end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", BAND))
        .filter(ee.Filter.eq("orbitProperties_pass", direction))
        .select(BAND)
        .map(
            lambda image: image.focalMedian(SPECKLE_RADIUS_M, "circle", "meters").copyProperties(
                image, ["system:time_start"]
            )
        )
    )


def orbit_direction(geometry: ee.Geometry) -> ee.String:
    """The direction with more images over the area in the reference years."""

    def count(direction: str) -> ee.Number:
        return (
            ee.ImageCollection(S1_DATASET)
            .filterBounds(geometry)
            .filterDate(*ORBIT_REFERENCE_YEARS)
            .filter(ee.Filter.eq("instrumentMode", "IW"))
            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", BAND))
            .filter(ee.Filter.eq("orbitProperties_pass", direction))
            .size()
        )

    return ee.String(
        ee.Algorithms.If(count("ASCENDING").gt(count("DESCENDING")), "ASCENDING", DEFAULT_ORBIT)
    )


def terrain_slope() -> ee.Image:
    return ee.Terrain.slope(ee.Image(SRTM_DATASET)).rename("slope")


def analysis_mask() -> ee.Image:
    """1 where a flood can be judged: not permanent water and not steep."""
    occurrence = ee.Image(GSW_DATASET).select("occurrence").unmask(0)
    return occurrence.lte(PERMANENT_WATER_PCT).And(terrain_slope().lte(MAX_SLOPE_DEG))


def rain_before(day: ee.Date, geometry: ee.Geometry) -> ee.Number:
    """CHIRPS area mean rainfall in mm over the 3 days before `day`, or None if a day is missing.

    Uses chirps.daily_area_series, so the area mean is the same one the rainfall metrics use.
    """
    collection = (
        ee.ImageCollection(chirps.DATASET)
        .select(chirps.BAND)
        .filterDate(day.advance(-RAIN_DAYS, "day"), day)
    )
    series = chirps.daily_area_series(collection, geometry)
    return ee.Algorithms.If(
        series.size().eq(RAIN_DAYS), ee.Number(series.reduce(ee.Reducer.sum())), None
    )


def scene_days(wet: ee.ImageCollection) -> ee.List:
    """Distinct UTC acquisition days (yyyy-MM-dd) of a collection, sorted."""
    stamps = wet.aggregate_array("system:time_start")
    return stamps.map(lambda t: ee.Date(t).format("YYYY-MM-dd")).distinct().sort()


def scene_events(geometry: ee.Geometry, year: int, with_rain: bool) -> dict:
    """Server side objects describing the wet season of one area and year.

    Returns n_baseline, n_wet, events (FeatureCollection with day, flood_ha, coverage and
    optionally rain_mm and ratio), area_ha and steep_fraction.
    """
    direction = orbit_direction(geometry)
    base_start, base_end = baseline_window(year)
    wet_start, wet_end = chirps.wet_season_window(year)
    base_end_excl = ee.Date(base_end.isoformat()).advance(1, "day")
    wet_end_excl = ee.Date(wet_end.isoformat()).advance(1, "day")

    baseline_images = s1_collection(geometry, direction, base_start, base_end_excl)
    wet = s1_collection(geometry, direction, wet_start, wet_end_excl)
    n_baseline = baseline_images.size()
    n_wet = wet.size()
    baseline = baseline_images.median()
    keep = analysis_mask()

    area_ha = geometry.area(maxError=100).divide(1e4)
    scale = ee.Number(
        ee.Algorithms.If(area_ha.lte(FINE_SCALE_MAX_HA), SCALE_FINE_M, SCALE_COARSE_M)
    )
    pixel_ha = ee.Image.pixelArea().divide(1e4)

    def one_day(day) -> ee.Feature:
        start = ee.Date(day)
        scene = wet.filterDate(start, start.advance(1, "day")).mosaic()
        footprint = scene.mask().gt(0)
        flooded = (
            scene.lt(FLOOD_MAX_DB)
            .And(baseline.subtract(scene).gt(FLOOD_DROP_DB))
            .And(keep)
            .And(footprint)
            .unmask(0)
        )
        bands = flooded.multiply(pixel_ha).rename("flood_ha")
        bands = bands.addBands(footprint.unmask(0).multiply(pixel_ha).rename("covered_ha"))
        sums = bands.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geometry,
            scale=scale,
            maxPixels=MAX_PIXELS,
            tileScale=TILE_SCALE,
        )
        props = {
            "day": day,
            "flood_ha": ee.Number(sums.get("flood_ha")),
            "coverage": ee.Number(sums.get("covered_ha")).divide(area_ha),
        }
        if with_rain:
            rain = rain_before(start, geometry)
            props["rain_mm"] = rain
            props["ratio"] = ee.Algorithms.If(
                ee.Algorithms.IsEqual(rain, None),
                None,
                ee.Algorithms.If(
                    ee.Number(rain).gte(MIN_EVENT_RAIN_MM),
                    ee.Number(sums.get("flood_ha")).divide(rain),
                    None,
                ),
            )
        return ee.Feature(None, props)

    events = ee.FeatureCollection(scene_days(wet).map(one_day))

    steep = (
        terrain_slope()
        .gt(MAX_SLOPE_DEG)
        .reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geometry,
            scale=SCALE_COARSE_M,
            maxPixels=MAX_PIXELS,
            tileScale=TILE_SCALE,
        )
        .get("slope")
    )
    return {
        "n_baseline": n_baseline,
        "n_wet": n_wet,
        "events": events,
        "area_ha": area_ha,
        "steep_fraction": ee.Number(ee.Algorithms.If(steep, steep, 0)),
    }


def compute_flood(
    year: int,
    areas: ee.FeatureCollection,
    metric: str,
    with_rain: bool,
    summarize: Callable[[ee.FeatureCollection], ee.Number],
    today: date | None = None,
) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag.

    `summarize` turns the usable events (day coverage of MIN_DAY_COVERAGE or more) into the
    value, or None when there is none.
    """
    types = area_types()
    partial_year = is_partial_year(year, today)

    def no_data(feature: ee.Feature) -> ee.Feature:
        return ee.Feature(
            None, row_properties(feature.get("area_id"), year, metric, None, "no_data")
        )

    if not FIRST_YEAR <= year <= LAST_YEAR:
        return areas.map(no_data)

    def to_row(feature: ee.Feature) -> ee.Feature:
        geometry = feature.geometry()
        info = scene_events(geometry, year, with_rain)
        usable = info["events"].filter(ee.Filter.gte("coverage", MIN_DAY_COVERAGE))
        n_scenes = usable.size()
        no_scenes = info["n_baseline"].eq(0).Or(info["n_wet"].eq(0)).Or(n_scenes.eq(0))
        value = ee.Algorithms.If(no_scenes, None, summarize(usable))
        # Coverage of the day with the largest flooded area, the one that sets a maximum.
        top = usable.sort("flood_ha", False).first()
        best_coverage = ee.Number(
            ee.Algorithms.If(n_scenes.gt(0), ee.Feature(top).get("coverage"), 0)
        )
        area_type = ee.Dictionary(types).get(feature.get("area_id"), "unknown")
        pairs = flag_pairs(
            no_scenes=no_scenes,
            no_value=ee.Algorithms.IsEqual(value, None),
            urban=ee.String(area_type).compareTo("urban").eq(0),
            steep=info["steep_fraction"].gt(STEEP_FRACTION),
            partial_year=partial_year,
            n_scenes=n_scenes,
            n_baseline=info["n_baseline"],
            best_coverage=best_coverage,
            lt=lambda a, b: ee.Number(a).lt(b),
        )
        flag = first_match(pairs, "ok")
        return ee.Feature(None, row_properties(feature.get("area_id"), year, metric, value, flag))

    return areas.map(to_row)
