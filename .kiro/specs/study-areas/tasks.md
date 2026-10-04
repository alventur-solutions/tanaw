# Tasks: Study Areas

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers.

## Task 1: Build areas from sources
- [x] `build` writes a GeoJSON per area from HydroSHEDS / WDPA / ADM3.
- Covers: FR1, FR2, FR3, FR5; D1
- Files: `pipeline/study_areas.py`, `pipeline/areas/*.geojson`
- Demo: `build` prints each area_id and area_ha and writes the files.
- Status: implemented; three demo areas present.

## Task 2: River basin zones
- [x] Upstream mask (elevation/slope), partition basin into `__up` / `__down`.
- Covers: FR4
- Files: `pipeline/study_areas.py`
- Demo: the basin file has whole + up + down; up + down area approx whole.
- Status: implemented; covered by `tests/test_study_areas.py`.

## Task 3: Feature conventions and validity
- [x] Fixed property set; valid WGS84 MultiPolygon; version 1.
- Covers: FR2, NFR1, NFR2
- Files: `pipeline/study_areas.py`
- Demo: each feature has the exact property set and a valid MultiPolygon.
- Status: implemented and tested.

## Task 4: Upload to Earth Engine
- [x] Export each file to an EE table asset, skipping existing assets.
- Covers: FR6
- Files: `pipeline/study_areas.py`
- Demo: `upload` starts an export task per new asset.
- Status: implemented.

## Task 5: Load into Neon
- [x] Upsert every feature into `study_areas` with ST_Multi geometry.
- Covers: FR7, NFR2
- Files: `pipeline/study_areas.py`
- Demo: `load` upserts and prints validity and area per area_id.
- Status: implemented; `study_areas` has 5 rows in Neon (verified earlier).

## Task 6: Add a new study area (operational)
- [ ] Add an entry to AREAS, build, upload, load; follow the study-area-setup skill.
- Covers: FR1, NFR1
- Files: `pipeline/study_areas.py`
- Demo: a new `area_id` file appears, uploads, and loads without renaming any id.
- Status: pending per new area.

## Task 7: Version bump workflow (operational)
- [ ] On a boundary source change, bump `version` and re-run funding links.
- Covers: NFR1; R1 mitigation
- Files: `pipeline/study_areas.py`, funding load
- Demo: version increments; funding links re-computed for moved projects.
- Status: pending as needed.
