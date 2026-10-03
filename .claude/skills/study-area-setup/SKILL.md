---
name: study-area-setup
description: Create or update a TANAW study area (river_basin, rural_upland, or urban) with its boundary, area_id, and zones, and upload it to Earth Engine. Use when adding any new place to study.
---
# Study area setup

1. Ask or decide the `study_type`: river_basin, rural_upland, urban.
2. Boundary source:
   - river_basin: official basin shapefile (NAMRIA / RBCO), fallback HydroSHEDS `WWF/HydroSHEDS/v1/Basins/hybas_8`.
   - rural_upland: protected area from `WCMC/WDPA/current/polygons` (e.g. Upper Marikina River Basin Protected Landscape) or municipal boundaries filtered by elevation > 100 m.
   - urban: city boundary (PSA / NAMRIA admin level 3), or `FAO/GAUL/2015/level2` as fallback.
3. Reproject to EPSG:4326, fix invalid geometry.
4. `area_id` = kebab slug, e.g. `pasig-marikina-tullahan`, `antipolo-rodriguez-uplands`, `quezon-city`.
5. river_basin only: add zones `<id>__up` (elevation > 100 m or slope > 18%) and `<id>__down`.
6. Save `pipeline/areas/<area_id>.geojson` with properties `area_id, name, study_type, zone, area_ha, version`.
7. Upload: `earthengine upload table --asset_id=projects/$EE_PROJECT/assets/areas/<area_id> <file>`.
8. Never change an existing area_id. Bump `version` instead.
