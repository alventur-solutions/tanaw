# Design: Study Areas

Status: draft
Traces: requirements.md (FR1-FR7, NFR1-NFR3)

## Overview

`pipeline/study_areas.py` has three commands: `build` (write GeoJSON from sources),
`upload` (export to Earth Engine assets), `load` (upsert into Neon). The GeoJSON
files in `pipeline/areas/` are the shared source of truth for `area_id` geometry.

## Commands

```
python -m pipeline.study_areas build    # pipeline/areas/<area_id>.geojson
python -m pipeline.study_areas upload   # EE table asset per file
python -m pipeline.study_areas load     # upsert study_areas in Neon
```

## Boundary sources (AREAS)

- river_basin `pasig-marikina-tullahan`: HydroSHEDS `hybas_8`, dissolve the given
  HYBAS_IDs.
- rural_upland `antipolo-rodriguez-uplands`: WDPA polygon by `SITE_ID` 306416.
- urban `quezon-city`: geoBoundaries PHL ADM3, the unit named "Quezon City"
  (downloaded and cached under `.cache/`).

## Geometry pipeline

- `clean`: `make_valid` + `set_precision(1e-6)` -> MultiPolygon in EPSG:4326,
  non-polygon parts dropped (FR3).
- `to_utm`/`to_wgs84`: convert for metric operations; `area_ha` uses UTM 51N (FR5).
- `drop_small_parts`: remove polygons and fill holes under `ZONE_MIN_PATCH_HA`
  (25 ha).

## Basin zones (FR4)

- `upstream_mask`: SRTM elevation > 100 m OR slope > 18 percent, focal-mode
  smoothed, vectorized within the basin.
- up = basin intersect mask, small parts dropped; down = basin minus up, small
  parts dropped; then `up = whole.difference(down)` so the two partition the basin.
- Features: whole (zone null), `__up` (zone "up"), `__down` (zone "down").

## Feature properties (FR2)

`{area_id, name, study_type, zone, area_ha, version}` with `version = VERSION` (1).
Zone suffixes `__up` / `__down`; names get " (upstream)" / " (downstream)".

## Upload (FR6)

- Ensure the `areas` asset folder exists; for each file, skip if the asset exists,
  else export the FeatureCollection with `Export.table.toAsset`.

## Load (FR7)

- `UPSERT` into `study_areas` on `area_id` with
  `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326))`; prints validity and
  geography area per area after loading.

## Decisions

- D1: GeoJSON files are the source of truth; EE assets and the DB are derived, so a
  rebuild is reproducible and reviewable in git.
- D2: Zones only for river basins, because the upstream/downstream question is
  specific to basins.
- D3: `area_id` is a stable kebab slug; boundary changes bump `version`, never the
  id (NFR1), so joins never break.

## Risks

- R1: Source boundary updates (HydroSHEDS/WDPA/ADM3) change geometry; bump
  `version` and re-run funding links, since a project may move across a boundary.
- R2: The ADM3 download is large (532 MB); cached under `.cache/` to avoid repeats.
