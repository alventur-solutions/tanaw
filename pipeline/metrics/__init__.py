"""One Earth Engine module per metric."""

# Metric names stored in satellite_metrics.metric and accepted by POST /analyze.
# Keep this list in step with the modules in this package. No ee import here, so the
# API can read it without Earth Engine installed.
METRIC_NAMES: tuple[str, ...] = (
    "tree_cover_loss",
    "built_up_area",
    "green_space",
    "ndvi",
    "rainfall_total",
    "rainfall_wet_season",
    "rainfall_max_1day",
    "heavy_rain_days",
    "flood_extent",
    "night_lights",
)

# The metrics that have a module and an entry in pipeline.registry. POST /analyze accepts
# only these. A test keeps this tuple in step with the registry.
IMPLEMENTED_METRICS: tuple[str, ...] = (
    "tree_cover_loss",
    "rainfall_total",
    "rainfall_wet_season",
    "rainfall_max_1day",
    "heavy_rain_days",
)
