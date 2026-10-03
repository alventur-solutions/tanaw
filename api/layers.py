"""Map layers drawn by Earth Engine: GET /layers/greenery.

The response holds a tile URL that Earth Engine serves directly. Nothing is exported and no
row is written. The URL expires after some hours, so it is cached here for a short time only.
"""

import time
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/layers")

DATASET = "GOOGLE/DYNAMICWORLD/V1"
FIRST_YEAR = 2016
CACHE_SECONDS = 3600

# Dynamic World label values that are vegetation, in drawing order.
GREENERY_CLASSES = [
    {"label": 1, "name": "Trees", "color": "1f9d55"},
    {"label": 2, "name": "Grass", "color": "86c96a"},
    {"label": 5, "name": "Shrub and scrub", "color": "6b8f3a"},
    {"label": 4, "name": "Crops", "color": "c9c45a"},
    {"label": 3, "name": "Flooded vegetation", "color": "3aa08f"},
]
CAVEAT = (
    "Land cover is a model estimate at 10 m from Sentinel-2. Small gardens, street trees, and "
    "narrow strips can be missed, and built-up pixels can hide trees under them."
)

_cache: dict[int, tuple[float, str]] = {}


class LegendItem(BaseModel):
    name: str
    color: str


class GreeneryLayer(BaseModel):
    year: int
    window: str
    source: str
    tile_url: str
    legend: list[LegendItem]
    caveat: str = CAVEAT


def greenery_tile_url(year: int) -> str:
    """Tile URL for the vegetation classes of the dry season composite (Jan 1 to May 31)."""
    from pipeline.study_areas import init_ee

    ee = init_ee()
    label = (
        ee.ImageCollection(DATASET)
        .filterDate(f"{year}-01-01", f"{year}-06-01")
        .select("label")
        .mode()
    )
    classes = [c["label"] for c in GREENERY_CLASSES]
    greenery = label.remap(classes, list(range(1, len(classes) + 1))).selfMask()
    map_id = greenery.getMapId(
        {"min": 1, "max": len(classes), "palette": [c["color"] for c in GREENERY_CLASSES]}
    )
    return map_id["tile_fetcher"].url_format


@router.get("/greenery", response_model=GreeneryLayer)
def greenery(year: int | None = None) -> GreeneryLayer:
    """Existing vegetation cover as map tiles. Defaults to the latest full dry season."""
    now = datetime.now(UTC)
    latest = now.year if now.month >= 6 else now.year - 1
    year = year or latest
    if year < FIRST_YEAR or year > latest:
        raise HTTPException(
            status_code=422, detail=f"year must be between {FIRST_YEAR} and {latest}."
        )

    cached = _cache.get(year)
    if cached is None or time.monotonic() - cached[0] > CACHE_SECONDS:
        try:
            cached = (time.monotonic(), greenery_tile_url(year))
        except Exception as error:  # Earth Engine is not signed in, or it is unreachable.
            raise HTTPException(
                status_code=503, detail=f"Earth Engine is not available: {error}"
            ) from error
        _cache[year] = cached

    return GreeneryLayer(
        year=year,
        window=f"{year}-01-01 to {year}-05-31",
        source=DATASET,
        tile_url=cached[1],
        legend=[LegendItem(name=c["name"], color=f"#{c['color']}") for c in GREENERY_CLASSES],
    )
