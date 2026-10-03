"""Registry of satellite metrics. Add one entry per module in pipeline/metrics/."""

from collections.abc import Callable
from dataclasses import dataclass

import ee

from pipeline.metrics import tree_cover_loss


@dataclass(frozen=True)
class Metric:
    name: str
    unit: str
    dataset: str
    first_year: int
    last_year: int
    compute: Callable[[int, ee.FeatureCollection], ee.FeatureCollection]


METRICS: dict[str, Metric] = {
    m.name: m
    for m in [
        Metric(
            name=tree_cover_loss.METRIC,
            unit=tree_cover_loss.UNIT,
            dataset=tree_cover_loss.DATASET,
            first_year=tree_cover_loss.FIRST_YEAR,
            last_year=tree_cover_loss.LAST_YEAR,
            compute=tree_cover_loss.compute,
        ),
    ]
}
