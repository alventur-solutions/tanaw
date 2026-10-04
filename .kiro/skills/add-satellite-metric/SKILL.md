---
name: add-satellite-metric
description: Step-by-step procedure for adding a new satellite metric to the TANAW Earth Engine pipeline. Use when asked to add, compute, or extract any new remote sensing variable per study area per year.
---
# Add a satellite metric

1. Confirm the dataset, its GEE ID, and the years it covers. If it does not reach 2010, say so and propose a fallback.
2. Create `pipeline/metrics/<metric>.py` with `compute(year, areas) -> ee.FeatureCollection`.
3. Inside compute:
   - Filter to the dry season window (Jan 1 to May 31) for optical data.
   - Mask clouds, apply scale factors, harmonize sensors.
   - Build the yearly image, add a valid-pixel band for quality_flag.
   - `reduceRegions` over areas at the right scale.
   - Map each feature to `{area_id, year, metric, value, quality_flag}`.
4. Register the metric in `pipeline/registry.py`.
5. Add `tests/metrics/test_<metric>.py` that asserts the output schema.
6. Run `python -m pipeline.run --metric <metric> --years 2010-2011 --dry-run`.
7. Ask the geospatial-reviewer agent to review before any real export.
8. Document the metric (source, units, caveats) in `docs/metrics.md`.
