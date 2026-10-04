# Requirements: Study Areas

Status: draft
Owner: TANAW
Related code: `pipeline/study_areas.py`, `pipeline/areas/*.geojson`,
`tests/test_study_areas.py`, `db/migrations/versions/0001_init.py`

## Problem statement

Every TANAW dataset joins on `area_id`. Study areas must be built from authoritative
boundaries, cleaned to valid WGS84 MultiPolygons, carry a stable `area_id`, and (for
river basins) split into upstream and downstream zones. The areas must be uploaded to
Earth Engine and loaded into Neon so the pipeline, funding join, and dashboard all
agree on the same geometry.

## Goals

- Build each demo area from its source: river basin (HydroSHEDS), rural upland
  (WDPA protected area), urban (admin level 3 city boundary).
- Produce one GeoJSON file per area, with basin zones as extra features.
- Keep `area_id` stable; bump `version` instead of renaming.
- Upload to Earth Engine and upsert into the Neon `study_areas` table.

## Non-goals

- Changing an existing `area_id` (never rename; bump version).
- Adding non-demo areas in this iteration.
- Storing per-year data here (that is the metrics pipeline).

## Study areas (current)

- `pasig-marikina-tullahan` (river_basin, HydroSHEDS hybas ids) with zones
  `__up` and `__down`.
- `antipolo-rodriguez-uplands` (rural_upland, WDPA site 306416).
- `quezon-city` (urban, admin level 3 "Quezon City").

## User stories

1. As a pipeline engineer, I want `build` to write each area's GeoJSON so metrics
   and funding can join on `area_id`.
2. As a basin analyst, I want upstream and downstream zones so I can compare
   change and spending by position in the basin.
3. As the platform, I want `load` to upsert areas into Neon so the API can serve
   them.

## Functional requirements

- FR1: `build` SHALL write `pipeline/areas/<area_id>.geojson`, with the whole area
  as feature 0 and, for a river basin, zones `<area_id>__up` and `<area_id>__down`
  as features 1 and 2.
- FR2: Each feature SHALL carry properties `area_id, name, study_type, zone,
  area_ha, version` and a valid WGS84 MultiPolygon geometry.
- FR3: Geometry SHALL be made valid and rounded to about 0.1 m; non-polygon parts
  from validation SHALL be dropped.
- FR4: For a river basin, upstream SHALL be elevation > 100 m or slope > 18 percent;
  patches and holes smaller than 25 ha SHALL be merged; up and down SHALL partition
  the basin.
- FR5: `area_ha` SHALL be computed in a metric CRS (UTM 51N).
- FR6: `upload` SHALL export each file to an Earth Engine table asset under
  `projects/$EE_PROJECT/assets/areas`, skipping assets that already exist.
- FR7: `load` SHALL upsert every feature into `study_areas` on `area_id`, storing a
  `ST_Multi` WGS84 geometry.

## Non-functional requirements

- NFR1 (stable keys): `area_id` SHALL never be renamed; `version` SHALL be bumped
  on any boundary change.
- NFR2 (validity): Stored geometry SHALL be a valid MultiPolygon in EPSG:4326.
- NFR3 (reproducible): Boundary sources and the zone rule SHALL be recorded in code
  so a build is reproducible.

## Acceptance criteria

- AC1: Each area file has the whole area as feature 0 with `zone = null` and the
  exact property set `{area_id, name, study_type, zone, area_ha, version}`.
- AC2: Only the river basin has `__up` and `__down` zones.
- AC3: For the basin, `area_ha(up) + area_ha(down)` approximately equals
  `area_ha(whole)`, and up and down barely intersect.
- AC4: Every stored geometry is a valid MultiPolygon; `area_ha` matches the computed
  area within tolerance.
- AC5: `load` upserts areas and prints validity and area per area_id.
