---
name: flood-extent-sar
description: How to compute flood extent and flood-per-rainfall for TANAW study areas using Sentinel-1 SAR and CHIRPS. Use for any flooding, inundation, or "floods even with ordinary rain" analysis.
---
# Flood extent from Sentinel-1

1. Collection: `COPERNICUS/S1_GRD`, instrumentMode IW, polarisation VV, one orbit direction per study area for consistency.
2. Speckle filter: focal median, 50 m radius.
3. Dry baseline: median of Jan to Apr for the same year.
4. Wet period: Jun 1 to Nov 30. For each scene, flooded = VV < -16 dB AND (baseline - scene) > 3 dB.
5. Remove permanent water with `JRC/GSW1_4/GlobalSurfaceWater` occurrence > 80.
6. Remove steep terrain: slope > 5 degrees from SRTM (radar shadow false positives).
7. Metric `flood_max_ha` = max flooded hectares across wet-season scenes.
8. Rainfall: `UCSB-CHG/CHIRPS/DAILY` sum over the 3 days before each scene.
9. Derived metric `flood_ha_per_mm` = flooded hectares / 3-day rainfall, per event, then yearly median.
10. quality_flag = number of usable wet-season scenes.

Data starts in 2015, so flood trends begin there. State this in any output.
